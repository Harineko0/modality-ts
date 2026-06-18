use crate::domain::initial_values;
use crate::expr::{eval_expr, mount_guard_holds, EvalOptions};
use crate::model::{mount_guard_for_scope, CompiledModel, UNMOUNTED};
use crate::state::ModelState;

pub fn normalize_initial_mount_locals(
    compiled: &CompiledModel,
    state: ModelState,
) -> Vec<ModelState> {
    reset_mount_locals(compiled, None, state, true)
}

pub fn reset_mount_locals(
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
                s.values[var_idx] = serde_json::Value::String(UNMOUNTED.to_string());
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
        AbstractDomain, Bounds, CompiledModel, ExprIR, InitialValue, Model, Scope,
        StateVarDecl, Transition,
    };
    use serde_json::json;

    fn route_model(local_scope: Scope, local_initial: serde_json::Value) -> CompiledModel {
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
                    role: None,
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
                    role: None,
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
                    role: None,
                },
                StateVarDecl {
                    id: "local:panel".into(),
                    domain: AbstractDomain::Bool,
                    origin: json!("test"),
                    scope: local_scope,
                    initial: InitialValue::Single(local_initial),
                    role: None,
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

    fn state_on_route(compiled: &CompiledModel, route: &str, panel: serde_json::Value) -> ModelState {
        let route_idx = compiled.sys_route_index.unwrap();
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        let mut state = ModelState::new(vec![serde_json::Value::Null; compiled.model.vars.len()]);
        state.values[route_idx] = json!(route);
        state.values[panel_idx] = panel;
        state
    }

    #[test]
    fn mount_local_unmounts_off_route() {
        let compiled = route_model(
            Scope::MountLocal {
                id: "route:/a".into(),
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
            json!(true),
        );
        let previous = state_on_route(&compiled, "/a", json!(true));
        let next = state_on_route(&compiled, "/b", json!(true));
        let out = reset_mount_locals(&compiled, Some(&previous), next, false);
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
        let out = reset_mount_locals(&compiled, Some(&previous), next, false);
        assert_eq!(out.len(), 1);
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        assert_eq!(out[0].get(panel_idx), &json!(false));
    }

    #[test]
    fn assignment_driven_location_change_resets_mount_locals() {
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
                    role: None,
                },
                StateVarDecl {
                    id: "sys:history".into(),
                    domain: AbstractDomain::BoundedList {
                        inner: Box::new(AbstractDomain::Enum {
                            values: vec!["/a".into(), "/b".into()],
                        }),
                        max_len: 1,
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!([])),
                    role: None,
                },
                StateVarDecl {
                    id: "loc:current".into(),
                    domain: AbstractDomain::Enum {
                        values: vec!["/a".into(), "/b".into()],
                    },
                    origin: json!("system"),
                    scope: Scope::Global,
                    initial: InitialValue::Single(json!("/a")),
                    role: None,
                },
                StateVarDecl {
                    id: "local:panel".into(),
                    domain: AbstractDomain::Bool,
                    origin: json!("test"),
                    scope: Scope::MountLocal {
                        id: "slot-a".into(),
                        when: ExprIR::Eq {
                            args: vec![
                                ExprIR::Read {
                                    var: "loc:current".into(),
                                    path: None,
                                },
                                ExprIR::Lit {
                                    value: json!("/a"),
                                },
                            ],
                        },
                    },
                    initial: InitialValue::Single(json!(true)),
                    role: None,
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
        let compiled = CompiledModel::compile(model, false).unwrap();
        let location_idx = compiled.var_idx("loc:current").unwrap();
        let panel_idx = compiled.var_idx("local:panel").unwrap();
        let mut previous =
            ModelState::new(vec![serde_json::Value::Null; compiled.model.vars.len()]);
        previous.values[location_idx] = json!("/a");
        previous.values[panel_idx] = json!(true);
        let mut next = previous.clone();
        next.values[location_idx] = json!("/b");
        let out = reset_mount_locals(&compiled, Some(&previous), next, false);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].get(panel_idx), &json!(UNMOUNTED));
    }
}
