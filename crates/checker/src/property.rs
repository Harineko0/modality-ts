use crate::canon::canonical_key;
use crate::expr::{allowed_reads, eval_state_predicate};
use crate::graph::{FullEdge, GraphRecording};
use crate::model::{CompiledModel, PropertyIR, Scope, StepPredicateIR, UNMOUNTED};
use crate::state::ModelState;
use crate::step::{facts, matches_step_predicate, matches_step_spec, StepFacts};
use crate::trace::{replay_checked_verdict, trace_to, trace_with_edge, trace_with_suffix, TraceContext};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn observe_states(
    compiled: &CompiledModel,
    properties: &[PropertyIR],
    candidates: &[ModelState],
    ctx: &TraceContext,
    verdicts: &mut HashMap<String, Value>,
) {
    for state in candidates {
        let canon = canonical_key(compiled, state);
        for property in properties {
            let name = property_name(property);
            if verdicts.contains_key(&name) {
                continue;
            }
            let result = match property {
                PropertyIR::Always {
                    predicate,
                    reads,
                    enabled_transitions,
                    include_unmounted,
                    ..
                } => {
                    if !property_mounted(compiled, property, state, *include_unmounted) {
                        continue;
                    }
                    let allowed = allowed_reads(
                        reads.as_deref(),
                        enabled_transitions.as_deref(),
                        compiled,
                    );
                    match eval_state_predicate(
                        compiled,
                        state,
                        predicate,
                        &allowed,
                        &name,
                        "state predicate",
                    ) {
                        Ok(true) => None,
                        Ok(false) => Some(replay_checked_verdict(
                            "violated",
                            &name,
                            trace_to(ctx, &canon),
                        )),
                        Err(msg) => Some(error_verdict(&name, &msg)),
                    }
                }
                PropertyIR::Reachable {
                    predicate,
                    reads,
                    enabled_transitions,
                    include_unmounted,
                    ..
                } => {
                    if !property_mounted(compiled, property, state, *include_unmounted) {
                        continue;
                    }
                    let allowed = allowed_reads(
                        reads.as_deref(),
                        enabled_transitions.as_deref(),
                        compiled,
                    );
                    match eval_state_predicate(
                        compiled,
                        state,
                        predicate,
                        &allowed,
                        &name,
                        "state predicate",
                    ) {
                        Ok(true) => Some(replay_checked_verdict(
                            "reachable",
                            &name,
                            trace_to(ctx, &canon),
                        )),
                        Ok(false) => None,
                        Err(msg) => Some(error_verdict(&name, &msg)),
                    }
                }
                _ => None,
            };
            if let Some(verdict) = result {
                verdicts.insert(name, verdict);
            }
        }
    }
}

pub fn observe_edge(
    compiled: &CompiledModel,
    properties: &[PropertyIR],
    pre: &ModelState,
    post: &ModelState,
    transition: &crate::model::Transition,
    step: &StepFacts,
    ctx: &TraceContext,
    verdicts: &mut HashMap<String, Value>,
) {
    for property in properties {
        let PropertyIR::AlwaysStep {
            name,
            predicate,
            reads,
            enabled_transitions,
            include_unmounted,
            ..
        } = property
        else {
            continue;
        };
        if verdicts.contains_key(name) {
            continue;
        }
        if !property_mounted_edge(compiled, property, pre, post, *include_unmounted) {
            continue;
        }
        let allowed = allowed_reads(
            reads.as_deref(),
            enabled_transitions.as_deref(),
            compiled,
        );
        let ok = match matches_step_spec(compiled, pre, post, step, predicate, &allowed, name) {
            Ok(v) => v,
            Err(msg) => {
                verdicts.insert(name.clone(), error_verdict(name, &msg));
                continue;
            }
        };
        if !ok {
            let pre_canon = canonical_key(compiled, pre);
            let trace = trace_with_edge(ctx, &pre_canon, pre, post, transition);
            verdicts.insert(
                name.clone(),
                replay_checked_verdict("violated", name, trace),
            );
        }
    }
}

pub fn finalize_properties(
    compiled: &CompiledModel,
    properties: &[PropertyIR],
    ctx: &TraceContext,
    graph: &GraphRecording,
    verdicts: &mut HashMap<String, Value>,
) {
    for property in properties {
        let name = property_name(property);
        if verdicts.contains_key(&name) {
            continue;
        }
        let result = (|| -> Result<Option<Value>, String> {
            Ok(match property {
                PropertyIR::Reachable { .. } => Some(json!({
                    "status": "vacuous-warning",
                    "property": name,
                    "message": "No reachable witness within bounds",
                })),
                PropertyIR::ReachableFrom {
                    when,
                    goal,
                    reads,
                    enabled_transitions,
                    include_unmounted,
                    ..
                } => {
                    let allowed_when = allowed_reads(
                        reads.as_deref(),
                        enabled_transitions.as_deref(),
                        compiled,
                    );
                    let allowed_goal = allowed_when.clone();
                    if let Some((canon, _)) =
                        unreachable_witness(compiled, graph, ctx, when, goal, &allowed_when, &allowed_goal, *include_unmounted)
                    {
                        Some(json!({
                            "status": "violated",
                            "property": name,
                            "trace": trace_to(ctx, &canon),
                            "replayable": false,
                            "replayBlockedReason": "reachableFrom counterexamples assert absence of a path and are not replayable",
                        }))
                    } else {
                        None
                    }
                }
                PropertyIR::LeadsToWithin {
                    trigger,
                    goal,
                    budget,
                    allow_user_events,
                    reads,
                    enabled_transitions,
                    include_unmounted,
                    ..
                } => finalize_leads_to(
                    compiled,
                    ctx,
                    graph,
                    &name,
                    trigger,
                    goal,
                    budget,
                    *allow_user_events,
                    reads.as_deref(),
                    enabled_transitions.as_deref(),
                    *include_unmounted,
                )?,
                _ => None,
            })
        })();
        match result {
            Ok(Some(v)) => {
                verdicts.insert(name, v);
            }
            Ok(None) => {}
            Err(msg) => {
                verdicts.insert(name.clone(), error_verdict(&name, &msg));
            }
        }
    }
}

fn finalize_leads_to(
    compiled: &CompiledModel,
    ctx: &TraceContext,
    graph: &GraphRecording,
    name: &str,
    trigger: &StepPredicateIR,
    goal: &crate::model::ExprIR,
    budget: &crate::model::LeadsBudget,
    allow_user_events: Option<bool>,
    reads: Option<&[String]>,
    enabled_transitions: Option<&[String]>,
    include_unmounted: Option<bool>,
) -> Result<Option<Value>, String> {
    let trigger_edges = resolve_trigger_edges(compiled, ctx, graph, name, trigger);
    if trigger_edges.is_empty() {
        return Ok(Some(json!({
            "status": "vacuous-warning",
            "property": name,
            "message": "Trigger never fired within bounds",
        })));
    }
    let allowed = allowed_reads(reads, enabled_transitions, compiled);
    for edge in trigger_edges {
        if let Some(suffix) = failing_suffix_within(
            compiled,
            goal,
            &allowed,
            name,
            &edge.post,
            budget,
            allow_user_events.unwrap_or(false),
            include_unmounted,
        )? {
            let suffix_steps: Vec<_> = suffix
                .iter()
                .map(|e| (e.pre.clone(), e.post.clone(), e.transition.clone()))
                .collect();
            let trace = trace_with_suffix(
                ctx,
                &edge.pre_canon,
                &edge.pre,
                &edge.post,
                &edge.transition,
                &suffix_steps,
            );
            return Ok(Some(replay_checked_verdict("violated", name, trace)));
        }
    }
    Ok(None)
}

fn resolve_trigger_edges(
    compiled: &CompiledModel,
    ctx: &TraceContext,
    graph: &GraphRecording,
    property_name: &str,
    trigger: &StepPredicateIR,
) -> Vec<FullEdge> {
    use crate::graph::EdgeRecordingMode;
    match graph.mode {
        EdgeRecordingMode::Full => graph
            .full_edges
            .iter()
            .filter(|e| matches_step_predicate(&e.step, &e.pre, &e.post, trigger))
            .cloned()
            .collect(),
        EdgeRecordingMode::Compact => graph
            .compact_edges
            .iter()
            .filter(|e| e.triggered_properties.iter().any(|p| p == property_name))
            .filter_map(|e| materialize_edge(compiled, ctx, e))
            .collect(),
        _ => vec![],
    }
}

fn materialize_edge(
    compiled: &CompiledModel,
    ctx: &TraceContext,
    edge: &crate::graph::CompactEdge,
) -> Option<FullEdge> {
    let pre = ctx.states.get(&edge.pre_canon)?;
    let post = ctx.states.get(&edge.post_canon)?;
    let transition = compiled
        .transition_index
        .get(&edge.transition_id)
        .map(|&idx| compiled.transition(idx).clone())?;
    let step = facts(ctx.compiled, pre, post, &transition);
    Some(FullEdge {
        pre_canon: edge.pre_canon.clone(),
        post_canon: edge.post_canon.clone(),
        pre: pre.clone(),
        post: post.clone(),
        transition,
        step,
    })
}

fn unreachable_witness(
    compiled: &CompiledModel,
    graph: &GraphRecording,
    ctx: &TraceContext,
    when: &crate::model::ExprIR,
    goal: &crate::model::ExprIR,
    allowed_when: &HashSet<String>,
    allowed_goal: &HashSet<String>,
    include_unmounted: Option<bool>,
) -> Option<(Vec<u8>, ModelState)> {
    let goal_canons: HashSet<Vec<u8>> = ctx
        .states
        .iter()
        .filter(|(_, state)| {
            eval_state_predicate(
                compiled,
                state,
                goal,
                allowed_goal,
                "reachableFrom",
                "reachableFrom goal",
            )
            .unwrap_or(false)
        })
        .map(|(canon, _)| canon.clone())
        .collect();
    let mut backward = goal_canons;
    let mut changed = true;
    while changed {
        changed = false;
        for edge in &graph.reverse_edges {
            if backward.contains(&edge.post_canon) && !backward.contains(&edge.pre_canon) {
                backward.insert(edge.pre_canon.clone());
                changed = true;
            }
        }
    }
    for (canon, state) in ctx.states.iter() {
        if backward.contains(canon) {
            continue;
        }
        if property_mounted_for_property(compiled, include_unmounted, state) {
            if eval_state_predicate(
                compiled,
                state,
                when,
                allowed_when,
                "reachableFrom",
                "reachableFrom when",
            )
            .unwrap_or(false)
            {
                return Some((canon.clone(), state.clone()));
            }
        }
    }
    None
}

fn failing_suffix_within(
    compiled: &CompiledModel,
    goal: &crate::model::ExprIR,
    allowed: &HashSet<String>,
    property_name: &str,
    start: &ModelState,
    budget: &crate::model::LeadsBudget,
    allow_user_events: bool,
    include_unmounted: Option<bool>,
) -> Result<Option<Vec<FullEdge>>, String> {
    let max_steps = budget.steps.or(budget.environment).unwrap_or(0);
    let mut memo: HashMap<String, Option<Vec<FullEdge>>> = HashMap::new();

    fn visit(
        compiled: &CompiledModel,
        goal: &crate::model::ExprIR,
        allowed: &HashSet<String>,
        property_name: &str,
        state: &ModelState,
        depth: u32,
        max_steps: u32,
        allow_user_events: bool,
        include_unmounted: Option<bool>,
        memo: &mut HashMap<String, Option<Vec<FullEdge>>>,
    ) -> Result<Option<Vec<FullEdge>>, String> {
        if eval_state_predicate(
            compiled,
            state,
            goal,
            allowed,
            property_name,
            "leadsToWithin goal",
        )? {
            return Ok(None);
        }
        let _canon = canonical_key(compiled, state);
        let key = format!("{}:{depth}", crate::canon::canonical_state(compiled, state));
        if let Some(cached) = memo.get(&key) {
            return Ok(cached.clone());
        }
        if depth >= max_steps {
            memo.insert(key, Some(vec![]));
            return Ok(Some(vec![]));
        }
        let successors = scheduler_successors(
            compiled,
            state,
            allow_user_events,
            include_unmounted,
        );
        if successors.is_empty() {
            memo.insert(key, Some(vec![]));
            return Ok(Some(vec![]));
        }
        for edge in successors {
            if let Some(mut suffix) = visit(
                compiled,
                goal,
                allowed,
                property_name,
                &edge.post,
                depth + 1,
                max_steps,
                allow_user_events,
                include_unmounted,
                memo,
            )? {
                let mut failure = vec![edge];
                failure.append(&mut suffix);
                memo.insert(key, Some(failure.clone()));
                return Ok(Some(failure));
            }
        }
        memo.insert(key, None);
        Ok(None)
    }

    visit(
        compiled,
        goal,
        allowed,
        property_name,
        start,
        0,
        max_steps,
        allow_user_events,
        include_unmounted,
        &mut memo,
    )
}

fn scheduler_successors(
    compiled: &CompiledModel,
    pre: &ModelState,
    allow_user_events: bool,
    include_unmounted: Option<bool>,
) -> Vec<FullEdge> {
    let pre_canon = canonical_key(compiled, pre);
    let mut out = Vec::new();
    for transition in crate::stabilize::enabled_transitions(compiled, pre) {
        if !scheduler_allows(transition, allow_user_events) {
            continue;
        }
        let posts = crate::effect::apply_effect(
            compiled,
            pre,
            &transition.effect,
            &mut crate::expr::EvalOptions::default(),
        )
        .unwrap_or_default();
        for raw_post in posts {
            let changed = crate::state::changed_var_indexes(pre, &raw_post);
            if let Ok(stabilized) = crate::stabilize::stabilize(
                compiled,
                raw_post,
                changed,
                &mut |s| canonical_key(compiled, s),
            ) {
                for post in stabilized {
                    let post_canon = canonical_key(compiled, &post);
                    let step = facts(compiled, pre, &post, transition);
                    let _ = include_unmounted;
                    out.push(FullEdge {
                        pre_canon: pre_canon.clone(),
                        post_canon,
                        pre: pre.clone(),
                        post,
                        transition: (*transition).clone(),
                        step,
                    });
                }
            }
        }
    }
    out.sort_by(|a, b| {
        a.transition
            .id
            .cmp(&b.transition.id)
            .then(a.post_canon.cmp(&b.post_canon))
    });
    out
}

fn scheduler_allows(transition: &crate::model::Transition, allow_user_events: bool) -> bool {
    matches!(
        transition.cls.as_str(),
        "env" | "library" | "internal"
    ) || (allow_user_events && matches!(transition.cls.as_str(), "user" | "nav"))
}

fn property_name(property: &PropertyIR) -> String {
    match property {
        PropertyIR::Always { name, .. }
        | PropertyIR::Reachable { name, .. }
        | PropertyIR::AlwaysStep { name, .. }
        | PropertyIR::ReachableFrom { name, .. }
        | PropertyIR::LeadsToWithin { name, .. } => name.clone(),
    }
}

fn error_verdict(property: &str, message: &str) -> Value {
    json!({
        "status": "error",
        "property": property,
        "message": message,
    })
}

fn property_mounted(
    compiled: &CompiledModel,
    property: &PropertyIR,
    state: &ModelState,
    include_unmounted: Option<bool>,
) -> bool {
    if include_unmounted == Some(true) {
        return true;
    }
    property_mounted_for_property(compiled, include_unmounted, state)
        && route_local_reads_ok(compiled, property, state)
}

fn property_mounted_edge(
    compiled: &CompiledModel,
    property: &PropertyIR,
    pre: &ModelState,
    post: &ModelState,
    include_unmounted: Option<bool>,
) -> bool {
    property_mounted(compiled, property, pre, include_unmounted)
        && property_mounted(compiled, property, post, include_unmounted)
}

fn property_mounted_for_property(
    _compiled: &CompiledModel,
    include_unmounted: Option<bool>,
    state: &ModelState,
) -> bool {
    if include_unmounted == Some(true) {
        return true;
    }
    let _ = state;
    true
}

fn route_local_reads_ok(
    compiled: &CompiledModel,
    property: &PropertyIR,
    state: &ModelState,
) -> bool {
    let reads = property_reads(property);
    if reads.is_empty() {
        return true;
    }
    let route = compiled
        .sys_route_index
        .and_then(|idx| state.get(idx).as_str());
    for id in reads {
        if let Some(decl) = compiled.var_decl(id) {
            if let Scope::RouteLocal { route: r, .. } = &decl.scope {
                if route != Some(r.as_str()) {
                    return false;
                }
                if let Some(var_idx) = compiled.var_idx(id) {
                    if state.get(var_idx) == &Value::String(UNMOUNTED.into()) {
                        return false;
                    }
                }
            }
        }
    }
    true
}

fn property_reads(property: &PropertyIR) -> Vec<&str> {
    match property {
        PropertyIR::Always { reads, .. }
        | PropertyIR::Reachable { reads, .. }
        | PropertyIR::AlwaysStep { reads, .. }
        | PropertyIR::ReachableFrom { reads, .. }
        | PropertyIR::LeadsToWithin { reads, .. } => reads
            .as_ref()
            .map(|r| r.iter().map(|s| s.as_str()).collect())
            .unwrap_or_default(),
    }
}
