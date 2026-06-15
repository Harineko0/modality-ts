use crate::model::Model;
use crate::stabilize::enabled_transitions;
use std::collections::HashSet;

pub fn record_max_depth_bound_hits(
    model: &Model,
    frontier: &[crate::model::ModelState],
    enabled_transition_ids: &mut HashSet<String>,
    bound_hits: &mut HashSet<String>,
    compiled: &crate::model::CompiledModel,
) {
    if frontier.is_empty() {
        return;
    }
    let mut blocked = HashSet::new();
    for state in frontier {
        for transition in enabled_transitions(compiled, state) {
            enabled_transition_ids.insert(transition.id.clone());
            blocked.insert(transition.id.clone());
        }
    }
    let mut ids: Vec<_> = blocked.into_iter().collect();
    ids.sort();
    for id in ids {
        bound_hits.insert(format!("maxDepth reached before {id}"));
    }
}

pub fn vacuity_warnings(
    model: &Model,
    states: &std::collections::HashMap<String, crate::model::ModelState>,
    enabled_transition_ids: &HashSet<String>,
) -> Vec<String> {
    let mut warnings = Vec::new();
    for transition in &model.transitions {
        if transition.cls != "internal" && !enabled_transition_ids.contains(&transition.id) {
            warnings.push(format!("transition never enabled: {}", transition.id));
        }
    }
    for decl in &model.vars {
        if let crate::model::AbstractDomain::Enum { values } = &decl.domain {
            let inhabited: HashSet<String> = states
                .values()
                .filter_map(|state| state.get(&decl.id))
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect();
            for value in values {
                if !inhabited.contains(value) {
                    warnings.push(format!("enum value never inhabited: {}={value}", decl.id));
                }
            }
        }
    }
    warnings.sort();
    warnings
}
