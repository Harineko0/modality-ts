use crate::effect::apply_effect;
use crate::expr::guard_holds;
use crate::model::{transition_locals_mounted, CompiledModel, Transition};
use crate::state::{changed_var_indexes, ModelState};
use std::collections::HashSet;

#[derive(Clone)]
struct StabilizingOut {
    state: ModelState,
    changed: HashSet<usize>,
}

pub fn stabilize(
    compiled: &CompiledModel,
    state: ModelState,
    changed: HashSet<usize>,
    canon_cache: &mut dyn FnMut(&ModelState) -> Vec<u8>,
) -> Result<Vec<ModelState>, String> {
    let mut states = vec![StabilizingOut { state, changed }];

    for _ in 0..compiled.model.bounds.max_internal_steps {
        let mut next = Vec::new();
        let mut changed_this_round = false;
        for candidate in &states {
            let internal = indexed_internal_candidates(compiled, &candidate.changed)
                .into_iter()
                .filter(|&idx| {
                    transition_locals_mounted(compiled, idx, &candidate.state)
                        && internal_triggered(compiled, idx, &candidate.changed)
                        && guard_holds(compiled, compiled.transition(idx), &candidate.state)
                })
                .collect::<Vec<_>>();
            if internal.is_empty() {
                next.push(candidate.clone());
            } else {
                changed_this_round = true;
                for sequence in stabilizing_sequences(compiled, &internal) {
                    next.extend(apply_internal_sequence(compiled, &candidate.state, &sequence));
                }
            }
        }
        states = unique_stabilizing_states(next, canon_cache);
        if !changed_this_round {
            return Ok(states.into_iter().map(|s| s.state).collect());
        }
    }
    Err(format!(
        "Internal transitions did not stabilize within {} steps",
        compiled.model.bounds.max_internal_steps
    ))
}

fn indexed_internal_candidates(
    compiled: &CompiledModel,
    changed: &HashSet<usize>,
) -> Vec<usize> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut add = |idx: usize| {
        if seen.insert(idx) {
            out.push(idx);
        }
    };
    for &idx in &compiled.always_triggered_internal {
        add(idx);
    }
    for var_idx in changed {
        if let Some(indices) = compiled.internal_by_triggered_var.get(var_idx) {
            for &idx in indices {
                add(idx);
            }
        }
    }
    out.sort();
    out
}

fn internal_triggered(
    compiled: &CompiledModel,
    transition_idx: usize,
    changed: &HashSet<usize>,
) -> bool {
    let transition = compiled.transition(transition_idx);
    match transition.triggered_by.as_deref() {
        None | Some([]) => true,
        Some(_) => compiled.transitions[transition_idx]
            .triggered_by_indexes
            .iter()
            .any(|idx| changed.contains(idx)),
    }
}

pub(crate) fn stabilizing_sequences(compiled: &CompiledModel, internal: &[usize]) -> Vec<Vec<usize>> {
    if !has_write_conflict(compiled, internal) {
        return vec![internal.to_vec()];
    }
    let sequences = permutations(internal);
    if !spans_multiple_phase_tiers(compiled, internal) {
        return sequences;
    }
    sequences
        .into_iter()
        .filter(|sequence| is_non_decreasing_phase(compiled, sequence))
        .collect()
}

fn apply_internal_sequence(
    compiled: &CompiledModel,
    state: &ModelState,
    sequence: &[usize],
) -> Vec<StabilizingOut> {
    #[derive(Clone)]
    struct StabilizingState {
        state: ModelState,
        changed: HashSet<usize>,
    }

    let initial = state.clone();
    let mut states = vec![StabilizingState {
        state: state.clone(),
        changed: HashSet::new(),
    }];
    for &transition_idx in sequence {
        let transition = compiled.transition(transition_idx);
        let mut next_states = Vec::new();
        for candidate in states {
            if !transition_locals_mounted(compiled, transition_idx, &candidate.state)
                || !guard_holds(compiled, transition, &candidate.state)
            {
                next_states.push(candidate);
                continue;
            }
            let mut eval_options = crate::expr::EvalOptions {
                on_bound_hit: None,
                step_ctx: None,
                pre_state: Some(state.clone()),
                resolving_op_args: None,
            };
            let posts = apply_effect(
                compiled,
                &candidate.state,
                &transition.effect,
                &mut eval_options,
            )
            .unwrap_or_default();
            for post in posts {
                next_states.push(StabilizingState {
                    state: post.clone(),
                    changed: changed_var_indexes(&initial, &post),
                });
            }
        }
        states = next_states;
    }
    states
        .into_iter()
        .map(|s| StabilizingOut {
            state: s.state,
            changed: s.changed,
        })
        .collect()
}

fn unique_stabilizing_states(
    states: Vec<StabilizingOut>,
    canon_cache: &mut dyn FnMut(&ModelState) -> Vec<u8>,
) -> Vec<StabilizingOut> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for candidate in states {
        let key = canon_cache(&candidate.state);
        if seen.insert(key) {
            out.push(candidate);
        }
    }
    out
}

fn has_write_conflict(compiled: &CompiledModel, transitions: &[usize]) -> bool {
    for i in 0..transitions.len() {
        for j in (i + 1)..transitions.len() {
            if intersects(
                &compiled.transitions[transitions[i]].write_indexes,
                &compiled.transitions[transitions[j]].write_indexes,
            ) {
                return true;
            }
        }
    }
    false
}

fn intersects(left: &[usize], right: &[usize]) -> bool {
    let set: HashSet<_> = left.iter().copied().collect();
    right.iter().any(|item| set.contains(item))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum PhaseTier {
    Ordinal(u32),
    Default,
}

fn transition_phase_tier(compiled: &CompiledModel, transition_idx: usize) -> PhaseTier {
    match compiled.sorted_transitions[transition_idx].phase {
        Some(phase) => PhaseTier::Ordinal(phase),
        None => PhaseTier::Default,
    }
}

fn spans_multiple_phase_tiers(compiled: &CompiledModel, transitions: &[usize]) -> bool {
    let mut tiers = transitions
        .iter()
        .map(|&idx| transition_phase_tier(compiled, idx))
        .collect::<Vec<_>>();
    tiers.sort();
    tiers.dedup();
    tiers.len() > 1
}

fn is_non_decreasing_phase(compiled: &CompiledModel, sequence: &[usize]) -> bool {
    let mut last = None;
    for &idx in sequence {
        let tier = transition_phase_tier(compiled, idx);
        if let Some(prev) = last {
            if tier < prev {
                return false;
            }
        }
        last = Some(tier);
    }
    true
}

fn permutations(values: &[usize]) -> Vec<Vec<usize>> {
    if values.len() <= 1 {
        return vec![values.to_vec()];
    }
    let mut out = Vec::new();
    for (index, head) in values.iter().enumerate() {
        let tail: Vec<_> = values
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != index)
            .map(|(_, t)| *t)
            .collect();
        for rest in permutations(&tail) {
            let mut seq = vec![*head];
            seq.extend(rest);
            out.push(seq);
        }
    }
    out
}

pub fn enabled_transitions<'a>(
    compiled: &'a CompiledModel,
    state: &ModelState,
) -> Vec<&'a Transition> {
    compiled
        .non_internal
        .iter()
        .map(|&idx| &compiled.sorted_transitions[idx])
        .filter(|t| {
            let idx = compiled.transition_index[&t.id];
            transition_locals_mounted(compiled, idx, state) && guard_holds(compiled, t, state)
        })
        .collect()
}

pub fn sort_states_by_canon(
    states: Vec<ModelState>,
    canon: &mut dyn FnMut(&ModelState) -> Vec<u8>,
) -> Vec<ModelState> {
    let mut keyed: Vec<_> = states
        .into_iter()
        .map(|state| {
            let key = canon(&state);
            (key, state)
        })
        .collect();
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    keyed.into_iter().map(|(_, state)| state).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, EffectIR, ExprIR, InitialValue, Model, Scope, StateVarDecl,
        Transition,
    };
    use serde_json::{json, Value};
    use std::collections::HashMap;

    fn conflict_model() -> CompiledModel {
        CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "m".into(),
                vars: vec![
                    StateVarDecl {
                        id: "sys:route".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/")),
                    },
                    StateVarDecl {
                        id: "sys:history".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Enum {
                                values: vec!["/".into()],
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                    },
                    StateVarDecl {
                        id: "sys:pending".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                    },
                    StateVarDecl {
                        id: "x".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),
                    },
                ],
                transitions: vec![
                    Transition {
                        id: "a".into(),
                        cls: "internal".into(),
                        label: json!({"kind": "internal", "text": "a"}),
                        source: vec![],
                        guard: ExprIR::Lit {
                            value: json!(true),
                        },
                        effect: EffectIR::Assign {
                            var: "x".into(),
                            expr: ExprIR::Lit {
                                value: json!(true),
                            },
                        },
                        reads: vec![],
                        writes: vec!["x".into()],
                        confidence: "exact".into(),
                        triggered_by: Some(vec!["x".into()]),
                        phase: None,
                    },
                    Transition {
                        id: "b".into(),
                        cls: "internal".into(),
                        label: json!({"kind": "internal", "text": "b"}),
                        source: vec![],
                        guard: ExprIR::Lit {
                            value: json!(true),
                        },
                        effect: EffectIR::Assign {
                            var: "x".into(),
                            expr: ExprIR::Lit {
                                value: json!(false),
                            },
                        },
                        reads: vec![],
                        writes: vec!["x".into()],
                        confidence: "exact".into(),
                        triggered_by: Some(vec!["x".into()]),
                        phase: None,
                    },
                ],
                bounds: Bounds {
                    max_depth: 1,
                    max_pending: 0,
                    max_internal_steps: 2,
                },
                metadata: None,
            },
            false,
        )
        .unwrap()
    }

    #[test]
    fn conflicting_internal_transitions_explore_both_orders() {
        let compiled = conflict_model();
        let internal: Vec<usize> = compiled.internal.clone();
        let sequences = stabilizing_sequences(&compiled, &internal);
        assert_eq!(sequences.len(), 2);
        assert_ne!(sequences[0], sequences[1]);
    }

    fn phase_conflict_model() -> CompiledModel {
        let mut model = conflict_model().model;
        model.transitions[0].phase = Some(0);
        model.transitions[1].phase = Some(1);
        CompiledModel::compile(model, false).unwrap()
    }

    #[test]
    fn cross_tier_internal_ordering_is_phase_monotonic() {
        let compiled = phase_conflict_model();
        let internal: Vec<usize> = compiled.internal.clone();
        let sequences = stabilizing_sequences(&compiled, &internal);
        assert_eq!(sequences.len(), 1);
        assert_eq!(sequences[0], vec![0, 1]);
    }
}
