use crate::domain::changed_vars;
use crate::effect::apply_effect;
use crate::expr::guard_holds;
use crate::model::{route_local_mounted, CompiledModel, ModelState, Transition};
use std::collections::HashSet;

#[derive(Clone)]
struct StabilizingOut {
    state: ModelState,
    changed: HashSet<String>,
}

pub struct TransitionIndexView<'a> {
    pub compiled: &'a CompiledModel,
}

pub fn stabilize(
    compiled: &CompiledModel,
    state: ModelState,
    changed: HashSet<String>,
    canon_cache: &mut dyn FnMut(&ModelState) -> String,
) -> Result<Vec<ModelState>, String> {
    let mut states = vec![StabilizingOut { state, changed }];

    for _ in 0..compiled.model.bounds.max_internal_steps {
        let mut next = Vec::new();
        let mut changed_this_round = false;
        for candidate in &states {
            let internal = indexed_internal_candidates(compiled, &candidate.changed)
                .into_iter()
                .filter(|t| {
                    route_local_mounted(compiled, t, &candidate.state)
                        && internal_triggered(t, &candidate.changed)
                        && guard_holds(compiled, t, &candidate.state)
                })
                .collect::<Vec<_>>();
            if internal.is_empty() {
                next.push(candidate.clone());
            } else {
                changed_this_round = true;
                for sequence in stabilizing_sequences(&internal) {
                    next.extend(apply_internal_sequence(
                        compiled,
                        &candidate.state,
                        &sequence,
                    ));
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
    changed: &HashSet<String>,
) -> Vec<Transition> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut add = |idx: usize| {
        if seen.insert(idx) {
            out.push(compiled.sorted_transitions[idx].clone());
        }
    };
    for &idx in &compiled.always_triggered_internal {
        add(idx);
    }
    for var_id in changed {
        if let Some(indices) = compiled.internal_by_triggered_var.get(var_id) {
            for &idx in indices {
                add(idx);
            }
        }
    }
    out
}

fn internal_triggered(transition: &Transition, changed: &HashSet<String>) -> bool {
    match transition.triggered_by.as_deref() {
        None | Some([]) => true,
        Some(vars) => vars.iter().any(|id| changed.contains(id)),
    }
}

fn stabilizing_sequences(internal: &[Transition]) -> Vec<Vec<Transition>> {
    if !has_write_conflict(internal) {
        return vec![internal.to_vec()];
    }
    permutations(internal)
}

fn apply_internal_sequence(
    compiled: &CompiledModel,
    state: &ModelState,
    sequence: &[Transition],
) -> Vec<StabilizingOut> {
    #[derive(Clone)]
    struct StabilizingState {
        state: ModelState,
        changed: HashSet<String>,
    }

    let var_ids: Vec<String> = compiled.model.vars.iter().map(|v| v.id.clone()).collect();
    let initial = state.clone();
    let mut states = vec![StabilizingState {
        state: state.clone(),
        changed: HashSet::new(),
    }];
    for transition in sequence {
        let mut next_states = Vec::new();
        for candidate in states {
            if !route_local_mounted(compiled, transition, &candidate.state)
                || !guard_holds(compiled, transition, &candidate.state)
            {
                next_states.push(candidate);
                continue;
            }
            let posts = apply_effect(
                compiled,
                &candidate.state,
                &transition.effect,
                &mut crate::expr::EvalOptions::default(),
            )
            .unwrap_or_default();
            for post in posts {
                next_states.push(StabilizingState {
                    state: post.clone(),
                    changed: changed_vars(&initial, &post, &var_ids),
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
    canon_cache: &mut dyn FnMut(&ModelState) -> String,
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

fn has_write_conflict(transitions: &[Transition]) -> bool {
    for i in 0..transitions.len() {
        for j in (i + 1)..transitions.len() {
            if intersects(&transitions[i].writes, &transitions[j].writes) {
                return true;
            }
        }
    }
    false
}

fn intersects(left: &[String], right: &[String]) -> bool {
    let set: HashSet<_> = left.iter().collect();
    right.iter().any(|item| set.contains(item))
}

fn permutations(values: &[Transition]) -> Vec<Vec<Transition>> {
    if values.len() <= 1 {
        return vec![values.to_vec()];
    }
    let mut out = Vec::new();
    for (index, head) in values.iter().enumerate() {
        let tail: Vec<_> = values
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != index)
            .map(|(_, t)| t.clone())
            .collect();
        for rest in permutations(&tail) {
            let mut seq = vec![head.clone()];
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
        .filter(|t| route_local_mounted(compiled, t, state) && guard_holds(compiled, t, state))
        .collect()
}

pub fn sort_states_by_canon(
    states: Vec<ModelState>,
    canon: &mut dyn FnMut(&ModelState) -> String,
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
