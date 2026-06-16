use crate::domain::initial_values;
use crate::expr::{eval_expr, mount_guard_holds, EvalOptions};
use crate::model::{mount_guard_for_scope, CompiledModel, UNMOUNTED};
use crate::state::ModelState;
use serde_json::Value;

pub fn navigate(
    compiled: &CompiledModel,
    state: &ModelState,
    mode: &str,
    to: Option<&crate::model::ExprIR>,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, crate::effect::EffectError> {
    let route_idx = compiled
        .sys_route_index
        .ok_or_else(|| crate::effect::EffectError::TokenExhausted("sys:route".into()))?;
    let history_idx = compiled
        .sys_history_index
        .ok_or_else(|| crate::effect::EffectError::TokenExhausted("sys:history".into()))?;

    let route = state.get(route_idx).clone();
    let history = state
        .get(history_idx)
        .as_array()
        .cloned()
        .unwrap_or_default();

    if mode == "back" {
        let previous = history.last().and_then(|v| v.as_str());
        if previous.is_none() {
            return Ok(vec![state.clone()]);
        }
        let previous = previous.unwrap().to_string();
        let mut next = state.clone();
        next.values[route_idx] = Value::String(previous);
        next.values[history_idx] = Value::Array(history[..history.len().saturating_sub(1)].to_vec());
        return Ok(vec![next]);
    }

    let to_val = to.map(|expr| eval_expr(compiled, state, expr, options));
    let to_str = to_val.as_ref().and_then(|v| v.as_str());
    if to_str.is_none() {
        return Ok(vec![state.clone()]);
    }
    let to_str = to_str.unwrap().to_string();

    let history_cap = compiled
        .var_decl("sys:history")
        .and_then(|decl| {
            if let crate::model::AbstractDomain::BoundedList { max_len, .. } = &decl.domain {
                Some(*max_len)
            } else {
                None
            }
        });

    if mode == "push" {
        if let Some(cap) = history_cap {
            if history.len() >= cap as usize {
                if let Some(hit) = options.on_bound_hit.as_mut() {
                    hit("history cap saturated");
                }
                return Ok(vec![]);
            }
        }
    }

    let next_history = if mode == "push" {
        if let Value::String(r) = &route {
            let mut h = history;
            h.push(Value::String(r.clone()));
            h
        } else {
            history
        }
    } else {
        history
    };

    let mut next = state.clone();
    next.values[route_idx] = Value::String(to_str);
    next.values[history_idx] = Value::Array(next_history);
    Ok(vec![next])
}

pub fn normalize_initial_route_locals(
    compiled: &CompiledModel,
    state: ModelState,
) -> Vec<ModelState> {
    reset_local_scopes(compiled, None, state, true)
}

pub fn reset_local_scopes(
    compiled: &CompiledModel,
    previous_state: Option<&ModelState>,
    next_state: ModelState,
    preserve_mounted: bool,
) -> Vec<ModelState> {
    let mut states = vec![next_state];
    for (var_idx, decl) in compiled.model.vars.iter().enumerate() {
        let mount_guard = match mount_guard_for_scope(&decl.scope) {
            Some(guard) => guard,
            None => continue,
        };
        let was_active = previous_state
            .map(|state| mount_guard_holds(compiled, state, &mount_guard))
            .unwrap_or(false);
        let mut next_states = Vec::new();
        for candidate in states {
            let is_active = mount_guard_holds(compiled, &candidate, &mount_guard);
            if preserve_mounted && is_active {
                next_states.push(candidate);
                continue;
            }
            if is_active && !was_active {
                let initials = initial_values(&decl.domain, &decl.initial);
                for value in &initials {
                    let mut s = candidate.clone();
                    s.values[var_idx] = value.clone();
                    next_states.push(s);
                }
            } else if is_active {
                next_states.push(candidate);
            } else {
                let mut s = candidate;
                s.values[var_idx] = Value::String(UNMOUNTED.to_string());
                next_states.push(s);
            }
        }
        states = next_states;
    }
    states
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, CompiledModel, EffectIR, ExprIR, InitialValue, Model, Scope,
        StateVarDecl, Transition,
    };
    use serde_json::json;

    fn route_model(local_scope: Scope, local_initial: Value) -> CompiledModel {
        let model = Model {
            schema_version: 1,
            id: "m".into(),
            vars: vec![
                StateVarDecl {
                    id: "sys:route".into(),
                    domain: AbstractDomain::Enum {
                        values: vec!["/a".into(), "/b".into()],
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!("/a")),
                },
                StateVarDecl {
                    id: "sys:history".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Enum {
                            values: vec!["/a".into(), "/b".into()],
                        }),
                        max_len: 4,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                },
                StateVarDecl {
                    id: "sys:pending".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Record {
                            fields: std::collections::HashMap::new(),
                        }),
                        max_len: 0,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                },
                StateVarDecl {
                    id: "local:panel".into(),
                    domain: AbstractDomain::Bool,
                    origin: json!("test"),
                    scope: local_scope,
                    initial: InitialValue::Single(local_initial),
                },
            ],
            transitions: vec![],
            bounds: Bounds {
                max_depth: 1,
                max_pending: 0,
                max_internal_steps: 1,
            },
            metadata: None,
        };
        CompiledModel::compile(model, false).unwrap()
    }

    fn state_on_route(compiled: &CompiledModel, route: &str, panel: Value) -> ModelState {
        let route_idx = compiled.sys_route_index.unwrap();
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        let mut state = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        state.values[route_idx] = json!(route);
        state.values[panel_idx] = panel;
        state
    }

    #[test]
    fn route_local_unmounts_off_route() {
        let compiled = route_model(
            Scope::RouteLocal {
                route: "/a".into(),
            },
            json!(true),
        );
        let previous = state_on_route(&compiled, "/a", json!(true));
        let next = state_on_route(&compiled, "/b", json!(true));
        let out = reset_local_scopes(&compiled, Some(&previous), next, false);
        assert_eq!(out.len(), 1);
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        assert_eq!(out[0].get(panel_idx), &json!(UNMOUNTED));
    }

    #[test]
    fn mount_local_resets_on_activation() {
        let compiled = route_model(
            Scope::MountLocal {
                id: "slot-a".into(),
                when: ExprIR::Eq {
                    args: vec![
                        ExprIR::Read {
                            var: "sys:route".into(),
                            path: None,
                        },
                        ExprIR::Lit {
                            value: json!("/a"),
                        },
                    ],
                },
            },
            json!(false),
        );
        let previous = state_on_route(&compiled, "/b", json!(UNMOUNTED));
        let next = state_on_route(&compiled, "/a", json!(UNMOUNTED));
        let out = reset_local_scopes(&compiled, Some(&previous), next, false);
        assert_eq!(out.len(), 1);
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        assert_eq!(out[0].get(panel_idx), &json!(false));
    }
}
