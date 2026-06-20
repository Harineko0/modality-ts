/// Global CTL model-checking engine.
///
/// Implements the full CTL operator set over the materialized explored state
/// graph, using standard fixpoint algorithms and Tarjan SCC for EG/AF.
/// Fair CTL uses Emerson–Lei generalized fairness.
use crate::expr::{allowed_reads, eval_state_predicate};
use crate::graph::GraphRecording;
use crate::model::{CompiledModel, FairnessConstraintIR, TemporalFormulaIR};
use crate::scc::{non_trivial_sccs, tarjan_sccs};
use crate::trace::{trace_to, TraceContext};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

// ---------------------------------------------------------------------------
// Graph index
// ---------------------------------------------------------------------------

/// Forward and backward adjacency indexed by canonical state bytes.
pub struct GraphIndex {
    /// forward: state → its successor states
    pub forward: HashMap<Vec<u8>, Vec<Vec<u8>>>,
    /// backward: state → its predecessor states
    pub backward: HashMap<Vec<u8>, Vec<Vec<u8>>>,
}

impl GraphIndex {
    pub fn build(
        state_universe: &HashSet<Vec<u8>>,
        graph: &GraphRecording,
    ) -> Self {
        let mut forward: HashMap<Vec<u8>, Vec<Vec<u8>>> = HashMap::new();
        let mut backward: HashMap<Vec<u8>, Vec<Vec<u8>>> = HashMap::new();
        // Initialize all states (some may have no edges)
        for s in state_universe {
            forward.entry(s.clone()).or_default();
            backward.entry(s.clone()).or_default();
        }
        for edge in &graph.reverse_edges {
            // ReverseEdge stores pre → post
            if state_universe.contains(&edge.pre_canon)
                && state_universe.contains(&edge.post_canon)
            {
                forward
                    .entry(edge.pre_canon.clone())
                    .or_default()
                    .push(edge.post_canon.clone());
                backward
                    .entry(edge.post_canon.clone())
                    .or_default()
                    .push(edge.pre_canon.clone());
            }
        }
        Self { forward, backward }
    }

    pub fn successors(&self, s: &[u8]) -> &[Vec<u8>] {
        self.forward.get(s).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn predecessors(&self, s: &[u8]) -> &[Vec<u8>] {
        self.backward.get(s).map(|v| v.as_slice()).unwrap_or(&[])
    }
}

// ---------------------------------------------------------------------------
// Main label function
// ---------------------------------------------------------------------------

/// Compute the set of states satisfying `formula` within the explored graph.
/// Exposed for unit testing; production code uses `check_temporal`.
#[cfg(test)]
pub fn label(
    formula: &TemporalFormulaIR,
    compiled: &CompiledModel,
    ctx: &TraceContext,
    index: &GraphIndex,
    universe: &HashSet<Vec<u8>>,
    reads: Option<&[String]>,
    enabled_transitions: Option<&[String]>,
    fairness: Option<&[FairnessConstraintIR]>,
) -> Result<HashSet<Vec<u8>>, String> {
    let allowed = allowed_reads(reads, enabled_transitions, compiled);
    label_formula(formula, compiled, ctx, index, universe, &allowed, fairness)
}

fn label_formula(
    formula: &TemporalFormulaIR,
    compiled: &CompiledModel,
    ctx: &TraceContext,
    index: &GraphIndex,
    universe: &HashSet<Vec<u8>>,
    allowed: &HashSet<String>,
    fairness: Option<&[FairnessConstraintIR]>,
) -> Result<HashSet<Vec<u8>>, String> {
    match formula {
        TemporalFormulaIR::Atom { predicate } => {
            let mut sat = HashSet::new();
            for (canon, state) in ctx.states {
                if eval_state_predicate(
                    compiled,
                    state,
                    predicate,
                    allowed,
                    "temporal",
                    "atom predicate",
                )? {
                    sat.insert(canon.clone());
                }
            }
            Ok(sat)
        }

        TemporalFormulaIR::Fnot { arg } => {
            let inner = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
            Ok(universe.difference(&inner).cloned().collect())
        }

        TemporalFormulaIR::Fand { args } => {
            let mut result = universe.clone();
            for arg in args {
                let sat = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
                result = result.intersection(&sat).cloned().collect();
            }
            Ok(result)
        }

        TemporalFormulaIR::For { args } => {
            let mut result = HashSet::new();
            for arg in args {
                let sat = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
                result = result.union(&sat).cloned().collect();
            }
            Ok(result)
        }

        // EX f — states with at least one successor in [f]
        TemporalFormulaIR::EX { arg } => {
            let sat_arg = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
            let mut result = HashSet::new();
            for s in universe {
                for succ in index.successors(s) {
                    if sat_arg.contains(succ) {
                        result.insert(s.clone());
                        break;
                    }
                }
            }
            Ok(result)
        }

        // AX f — states where ALL successors satisfy f (conservative: states with no
        // successors recorded in the explored graph satisfy AX vacuously)
        TemporalFormulaIR::AX { arg } => {
            let sat_arg = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
            let mut result = HashSet::new();
            for s in universe {
                let succs = index.successors(s);
                if succs.iter().all(|succ| sat_arg.contains(succ)) {
                    result.insert(s.clone());
                }
            }
            Ok(result)
        }

        // EF f — backward BFS from [f]
        TemporalFormulaIR::EF { arg } => {
            let sat_arg = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
            Ok(backward_reachable(sat_arg, index, universe))
        }

        // AG f = ¬EF¬f
        TemporalFormulaIR::AG { arg } => {
            let not_f = TemporalFormulaIR::Fnot { arg: Box::new(*arg.clone()) };
            let ef_not_f = backward_reachable(
                label_formula(&not_f, compiled, ctx, index, universe, allowed, fairness)?,
                index,
                universe,
            );
            Ok(universe.difference(&ef_not_f).cloned().collect())
        }

        // EG f — greatest fixpoint via SCC: states in [f] that can reach a
        // non-trivial SCC fully within [f]
        TemporalFormulaIR::EG { arg } => {
            let sat_f = label_formula(arg, compiled, ctx, index, universe, allowed, fairness)?;
            if sat_f.is_empty() {
                return Ok(HashSet::new());
            }
            Ok(eg_label(sat_f, index, universe))
        }

        // AF f = ¬EG¬f
        TemporalFormulaIR::AF { arg } => {
            let not_f = TemporalFormulaIR::Fnot { arg: Box::new(*arg.clone()) };
            let sat_not_f =
                label_formula(&not_f, compiled, ctx, index, universe, allowed, fairness)?;
            let eg_not_f = eg_label(sat_not_f, index, universe);
            Ok(universe.difference(&eg_not_f).cloned().collect())
        }

        // EU p q — E[p U q]: least fixpoint starting from [q], expanding to predecessors in [p]
        TemporalFormulaIR::EU { left, right } => {
            let sat_q = label_formula(right, compiled, ctx, index, universe, allowed, fairness)?;
            let sat_p = label_formula(left, compiled, ctx, index, universe, allowed, fairness)?;
            let mut result = sat_q.clone();
            let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
            while let Some(s) = worklist.pop() {
                for pred in index.predecessors(&s) {
                    if !result.contains(pred) && sat_p.contains(pred) {
                        result.insert(pred.clone());
                        worklist.push(pred.clone());
                    }
                }
            }
            Ok(result)
        }

        // AU p q — A[p U q] = ¬(E[¬q U (¬p ∧ ¬q)] ∨ EG¬q)
        TemporalFormulaIR::AU { left, right } => {
            let sat_q = label_formula(right, compiled, ctx, index, universe, allowed, fairness)?;
            let sat_p = label_formula(left, compiled, ctx, index, universe, allowed, fairness)?;
            let not_q: HashSet<Vec<u8>> = universe.difference(&sat_q).cloned().collect();
            let not_p: HashSet<Vec<u8>> = universe.difference(&sat_p).cloned().collect();
            let not_p_and_not_q: HashSet<Vec<u8>> =
                not_p.intersection(&not_q).cloned().collect();
            // E[¬q U (¬p ∧ ¬q)]
            let eu_not_q_to_not_p_not_q = {
                let mut result = not_p_and_not_q.clone();
                let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
                while let Some(s) = worklist.pop() {
                    for pred in index.predecessors(&s) {
                        if !result.contains(pred) && not_q.contains(pred) {
                            result.insert(pred.clone());
                            worklist.push(pred.clone());
                        }
                    }
                }
                result
            };
            // EG¬q
            let eg_not_q = eg_label(not_q.clone(), index, universe);
            let violating: HashSet<Vec<u8>> = eu_not_q_to_not_p_not_q
                .union(&eg_not_q)
                .cloned()
                .collect();
            Ok(universe.difference(&violating).cloned().collect())
        }
    }
}

// ---------------------------------------------------------------------------
// Core fixpoints
// ---------------------------------------------------------------------------

/// Backward BFS: compute all states that can reach `seeds` within `universe`.
fn backward_reachable(
    seeds: HashSet<Vec<u8>>,
    index: &GraphIndex,
    universe: &HashSet<Vec<u8>>,
) -> HashSet<Vec<u8>> {
    let mut result = seeds;
    let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
    while let Some(s) = worklist.pop() {
        for pred in index.predecessors(&s) {
            if universe.contains(pred) && !result.contains(pred) {
                result.insert(pred.clone());
                worklist.push(pred.clone());
            }
        }
    }
    result
}

/// EG f — compute states in [f] that can reach a non-trivial SCC within [f].
fn eg_label(sat_f: HashSet<Vec<u8>>, index: &GraphIndex, _universe: &HashSet<Vec<u8>>) -> HashSet<Vec<u8>> {
    if sat_f.is_empty() {
        return HashSet::new();
    }
    // Restrict forward successors to sat_f
    let restricted_succs = |s: &Vec<u8>| -> Vec<Vec<u8>> {
        index
            .successors(s)
            .iter()
            .filter(|t| sat_f.contains(*t))
            .cloned()
            .collect()
    };
    let roots: Vec<Vec<u8>> = sat_f.iter().cloned().collect();
    let sccs = tarjan_sccs(&roots, restricted_succs);
    // A "bottom" SCC is one where every state can only reach other SCCs within sat_f
    // Non-trivial = has a cycle (size > 1 or self-loop)
    let has_self_loop = |s: &Vec<u8>| index.successors(s).iter().any(|t| t == s);
    let nontrivial = non_trivial_sccs(sccs, has_self_loop);
    if nontrivial.is_empty() {
        return HashSet::new();
    }
    // Collect all states in non-trivial SCCs, then backward-reach within sat_f
    let scc_states: HashSet<Vec<u8>> = nontrivial.into_iter().flatten().collect();
    // Restrict backward index to sat_f
    let mut result = scc_states;
    let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
    while let Some(s) = worklist.pop() {
        for pred in index.predecessors(&s) {
            if sat_f.contains(pred) && !result.contains(pred) {
                result.insert(pred.clone());
                worklist.push(pred.clone());
            }
        }
    }
    result
}

// ---------------------------------------------------------------------------
// Fair CTL (Emerson–Lei generalized fairness)
// ---------------------------------------------------------------------------

/// EG_fair(f) under fairness constraints.
///
/// A state satisfies EG_fair(f) iff there is a path from it that stays in [f]
/// and visits every fairness condition infinitely often.
///
/// Algorithm (Emerson–Lei):
/// 1. Start with Q = [f].
/// 2. For each fairness condition c_i: restrict Q to states that can reach Q ∩ [c_i] within Q.
/// 3. Repeat step 2 until fixpoint.
/// 4. The result is the states that remain in Q.
fn eg_fair(
    sat_f: HashSet<Vec<u8>>,
    fairness_sets: &[HashSet<Vec<u8>>],
    index: &GraphIndex,
    universe: &HashSet<Vec<u8>>,
) -> HashSet<Vec<u8>> {
    if sat_f.is_empty() || fairness_sets.is_empty() {
        // No fairness constraints: fall back to plain EG
        return eg_label(sat_f, index, universe);
    }

    let mut q = sat_f;
    loop {
        let mut new_q = q.clone();
        for fi in fairness_sets {
            // States in Q that satisfy fi
            let q_and_fi: HashSet<Vec<u8>> = q.intersection(fi).cloned().collect();
            // Backward-reachable within Q from q_and_fi
            let reachable_to_fi = {
                let mut result = q_and_fi;
                let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
                while let Some(s) = worklist.pop() {
                    for pred in index.predecessors(&s) {
                        if q.contains(pred) && !result.contains(pred) {
                            result.insert(pred.clone());
                            worklist.push(pred.clone());
                        }
                    }
                }
                result
            };
            new_q = new_q.intersection(&reachable_to_fi).cloned().collect();
        }
        if new_q == q {
            break;
        }
        q = new_q;
    }
    // Further restrict to states that can reach a cycle within q (plain EG within q)
    eg_label(q, index, universe)
}

// ---------------------------------------------------------------------------
// Top-level verdict production
// ---------------------------------------------------------------------------

/// Check a temporal property and produce a verdict JSON value.
///
/// `initial_states` is the set of initial state canonical bytes.
/// `exhaustive` is true iff the BFS fully explored the state space.
/// Check a temporal property and produce a verdict JSON value.
///
/// `initial_canons` is the canonical encoding of each initial state.
/// `exhaustive` is true iff the BFS fully explored the state space.
pub fn check_temporal(
    name: &str,
    formula: &TemporalFormulaIR,
    compiled: &CompiledModel,
    ctx: &TraceContext,
    graph: &GraphRecording,
    reads: Option<&[String]>,
    enabled_transitions: Option<&[String]>,
    fairness: Option<&[FairnessConstraintIR]>,
    initial_canons: &[Vec<u8>],
    exhaustive: bool,
) -> Result<Value, String> {
    let universe: HashSet<Vec<u8>> = ctx.states.keys().cloned().collect();
    let index = GraphIndex::build(&universe, graph);

    let allowed = allowed_reads(reads, enabled_transitions, compiled);
    let sat = label_with_fairness(formula, compiled, ctx, &index, &universe, &allowed, fairness)?;

    let all_initial_satisfy = initial_canons.iter().all(|c| sat.contains(c));

    if all_initial_satisfy {
        // Property holds at all initial states
        let status = if exhaustive {
            "verified"
        } else {
            "verified-within-bounds"
        };
        Ok(json!({
            "status": status,
            "property": name,
            "boundedness": if exhaustive { "exhaustive" } else { "bounded" },
        }))
    } else {
        // Find a violating initial state and produce a witness / counterexample
        let verdict = make_violation_verdict(
            name,
            formula,
            &sat,
            &universe,
            &index,
            initial_canons,
            compiled,
            ctx,
        )?;
        Ok(verdict)
    }
}

fn label_with_fairness(
    formula: &TemporalFormulaIR,
    compiled: &CompiledModel,
    ctx: &TraceContext,
    index: &GraphIndex,
    universe: &HashSet<Vec<u8>>,
    allowed: &HashSet<String>,
    fairness: Option<&[FairnessConstraintIR]>,
) -> Result<HashSet<Vec<u8>>, String> {
    if let Some(constraints) = fairness {
        if !constraints.is_empty() {
            // Compute fairness condition sets
            let mut fairness_sets = Vec::new();
            for c in constraints {
                let fi = label_formula(&c.condition, compiled, ctx, index, universe, allowed, None)?;
                fairness_sets.push(fi);
            }
            return label_formula_fair(
                formula,
                compiled,
                ctx,
                index,
                universe,
                allowed,
                &fairness_sets,
            );
        }
    }
    label_formula(formula, compiled, ctx, index, universe, allowed, None)
}

/// Label with fairness constraints threaded through EG.
fn label_formula_fair(
    formula: &TemporalFormulaIR,
    compiled: &CompiledModel,
    ctx: &TraceContext,
    index: &GraphIndex,
    universe: &HashSet<Vec<u8>>,
    allowed: &HashSet<String>,
    fairness_sets: &[HashSet<Vec<u8>>],
) -> Result<HashSet<Vec<u8>>, String> {
    match formula {
        // EG under fairness uses the Emerson–Lei algorithm
        TemporalFormulaIR::EG { arg } => {
            let sat_f = label_formula_fair(arg, compiled, ctx, index, universe, allowed, fairness_sets)?;
            Ok(eg_fair(sat_f, fairness_sets, index, universe))
        }
        // AF = ¬EG¬ (with fairness)
        TemporalFormulaIR::AF { arg } => {
            let not_f = TemporalFormulaIR::Fnot { arg: Box::new(*arg.clone()) };
            let sat_not_f = label_formula_fair(&not_f, compiled, ctx, index, universe, allowed, fairness_sets)?;
            let eg_not_f = eg_fair(sat_not_f, fairness_sets, index, universe);
            Ok(universe.difference(&eg_not_f).cloned().collect())
        }
        // All other cases delegate back to the unfair version but with fairness threaded into EG
        TemporalFormulaIR::Fnot { arg } => {
            let inner = label_formula_fair(arg, compiled, ctx, index, universe, allowed, fairness_sets)?;
            Ok(universe.difference(&inner).cloned().collect())
        }
        TemporalFormulaIR::Fand { args } => {
            let mut result = universe.clone();
            for arg in args {
                let sat = label_formula_fair(arg, compiled, ctx, index, universe, allowed, fairness_sets)?;
                result = result.intersection(&sat).cloned().collect();
            }
            Ok(result)
        }
        TemporalFormulaIR::For { args } => {
            let mut result = HashSet::new();
            for arg in args {
                let sat = label_formula_fair(arg, compiled, ctx, index, universe, allowed, fairness_sets)?;
                result = result.union(&sat).cloned().collect();
            }
            Ok(result)
        }
        TemporalFormulaIR::EU { left, right } => {
            let sat_q = label_formula_fair(right, compiled, ctx, index, universe, allowed, fairness_sets)?;
            let sat_p = label_formula_fair(left, compiled, ctx, index, universe, allowed, fairness_sets)?;
            let mut result = sat_q;
            let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
            while let Some(s) = worklist.pop() {
                for pred in index.predecessors(&s) {
                    if !result.contains(pred) && sat_p.contains(pred) {
                        result.insert(pred.clone());
                        worklist.push(pred.clone());
                    }
                }
            }
            Ok(result)
        }
        TemporalFormulaIR::AU { left, right } => {
            // Delegate, but use fair EG in the inner call
            let sat_q = label_formula_fair(right, compiled, ctx, index, universe, allowed, fairness_sets)?;
            let sat_p = label_formula_fair(left, compiled, ctx, index, universe, allowed, fairness_sets)?;
            let not_q: HashSet<Vec<u8>> = universe.difference(&sat_q).cloned().collect();
            let not_p: HashSet<Vec<u8>> = universe.difference(&sat_p).cloned().collect();
            let not_p_and_not_q: HashSet<Vec<u8>> = not_p.intersection(&not_q).cloned().collect();
            let eu_not_q_to_not_p_not_q = {
                let mut result = not_p_and_not_q;
                let mut worklist: Vec<Vec<u8>> = result.iter().cloned().collect();
                while let Some(s) = worklist.pop() {
                    for pred in index.predecessors(&s) {
                        if !result.contains(pred) && not_q.contains(pred) {
                            result.insert(pred.clone());
                            worklist.push(pred.clone());
                        }
                    }
                }
                result
            };
            let eg_not_q = eg_fair(not_q, fairness_sets, index, universe);
            let violating: HashSet<Vec<u8>> =
                eu_not_q_to_not_p_not_q.union(&eg_not_q).cloned().collect();
            Ok(universe.difference(&violating).cloned().collect())
        }
        // Atom and modal operators with single arg: delegate
        _ => label_formula(formula, compiled, ctx, index, universe, allowed, Some(&[])),
    }
}

// ---------------------------------------------------------------------------
// Violation witness / counterexample production
// ---------------------------------------------------------------------------

fn make_violation_verdict(
    name: &str,
    formula: &TemporalFormulaIR,
    sat: &HashSet<Vec<u8>>,
    universe: &HashSet<Vec<u8>>,
    index: &GraphIndex,
    initial_canons: &[Vec<u8>],
    _compiled: &CompiledModel,
    ctx: &TraceContext,
) -> Result<Value, String> {
    // Find the first initial state that violates the property
    let violating_initial = initial_canons
        .iter()
        .find(|c| !sat.contains(*c));

    match violating_initial {
        None => {
            // All initial states satisfy it — shouldn't reach here
            Ok(json!({
                "status": "verified-within-bounds",
                "property": name,
                "boundedness": "bounded",
            }))
        }
        Some(init_canon) => {
            match formula {
                // For existential operators (EF, EG, EU, EX), a violation means the
                // witness was not found in the explored graph.
                // For EF p: no initial state can reach p → vacuous-warning-style,
                // but we check if ANY initial state satisfies.
                // Actually the violation here means no initial state is in [formula].
                // For EF this is "not reachable" → vacuous warning.
                // For AG this is a real violation with a counterexample.

                // AG f violation — find a state in ¬[f] reachable from initial
                TemporalFormulaIR::AG { .. } => {
                    // The violating set is universe \ sat
                    let not_sat: HashSet<Vec<u8>> = universe.difference(sat).cloned().collect();
                    // Find the closest (BFS-order) violating state reachable from init
                    if let Some(violating_canon) = find_nearest_in_set(init_canon, &not_sat, index) {
                        let trace = trace_to(ctx, &violating_canon);
                        Ok(json!({
                            "status": "violated",
                            "property": name,
                            "trace": trace,
                            "replayable": true,
                        }))
                    } else {
                        Ok(json!({
                            "status": "violated",
                            "property": name,
                            "boundedness": "bounded",
                        }))
                    }
                }
                // EF f violation — property not reachable
                TemporalFormulaIR::EF { .. } => {
                    Ok(json!({
                        "status": "vacuous-warning",
                        "property": name,
                        "message": "No reachable witness within bounds",
                    }))
                }
                // AX f — some immediate successor violates f
                TemporalFormulaIR::AX { .. } => {
                    let trace = trace_to(ctx, init_canon);
                    Ok(json!({
                        "status": "violated",
                        "property": name,
                        "trace": trace,
                        "replayable": false,
                        "replayBlockedReason": "AX counterexamples assert next-state absence",
                    }))
                }
                // EX f — no successor satisfies f
                TemporalFormulaIR::EX { .. } => {
                    Ok(json!({
                        "status": "vacuous-warning",
                        "property": name,
                        "message": "No satisfying successor found within bounds",
                    }))
                }
                // AF f — some path avoids f forever (cycle in ¬[f])
                TemporalFormulaIR::AF { .. } => {
                    let trace = trace_to(ctx, init_canon);
                    Ok(json!({
                        "status": "violated",
                        "property": name,
                        "trace": trace,
                        "replayable": false,
                        "replayBlockedReason": "AF counterexamples require infinite paths",
                    }))
                }
                // EG f — no cycle in [f] reachable from initial
                TemporalFormulaIR::EG { .. } => {
                    Ok(json!({
                        "status": "vacuous-warning",
                        "property": name,
                        "message": "No infinite path satisfying the formula found within bounds",
                    }))
                }
                // AU p q — violation: some path avoids q while p breaks
                TemporalFormulaIR::AU { .. } => {
                    let trace = trace_to(ctx, init_canon);
                    Ok(json!({
                        "status": "violated",
                        "property": name,
                        "trace": trace,
                        "replayable": false,
                        "replayBlockedReason": "AU counterexamples require infinite path enumeration",
                    }))
                }
                // EU p q — no path satisfying the until condition
                TemporalFormulaIR::EU { .. } => {
                    Ok(json!({
                        "status": "vacuous-warning",
                        "property": name,
                        "message": "No path satisfying the until condition found within bounds",
                    }))
                }
                // Compound: produce a generic violation with trace to initial
                _ => {
                    let trace = trace_to(ctx, init_canon);
                    Ok(json!({
                        "status": "violated",
                        "property": name,
                        "trace": trace,
                    }))
                }
            }
        }
    }
}

/// BFS from `start` within the explored graph to find the nearest state in `target`.
fn find_nearest_in_set(
    start: &[u8],
    target: &HashSet<Vec<u8>>,
    index: &GraphIndex,
) -> Option<Vec<u8>> {
    if target.contains(start) {
        return Some(start.to_vec());
    }
    let mut visited = HashSet::new();
    let mut queue = std::collections::VecDeque::new();
    queue.push_back(start.to_vec());
    visited.insert(start.to_vec());
    while let Some(s) = queue.pop_front() {
        for succ in index.successors(&s) {
            if !visited.contains(succ) {
                if target.contains(succ) {
                    return Some(succ.clone());
                }
                visited.insert(succ.clone());
                queue.push_back(succ.clone());
            }
        }
    }
    None
}
