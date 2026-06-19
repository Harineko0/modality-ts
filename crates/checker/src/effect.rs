use crate::domain::{apply_numeric_assign, enumerate_domain, validate_value, NumericAssignOutcome};
use crate::expr::{eval_expr, EvalOptions};
use crate::model::{CompiledModel, EffectIR, ExprIR};
use crate::mount;
use crate::state::ModelState;
use serde_json::{json, Value};
use std::collections::HashSet;

pub enum EffectError {
    TokenExhausted(String),
}

pub fn apply_effect(
    compiled: &CompiledModel,
    state: &ModelState,
    effect: &EffectIR,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, String> {
    let had_pre = options.pre_state.is_some();
    let pre_state_for_reset = if !had_pre {
        Some(state.clone())
    } else {
        None
    };
    if !had_pre {
        options.pre_state = Some(state.clone());
    }
    let result = match apply_effect_inner(compiled, state, effect, options) {
        Ok(states) => Ok(states),
        Err(EffectError::TokenExhausted(domain)) => {
            if let Some(hit) = options.on_bound_hit.as_mut() {
                hit(&format!("token cap exhausted for {domain}"));
            }
            Ok(vec![])
        }
    };
    if !had_pre {
        options.pre_state = None;
    }
    result.map(|states| {
        if let Some(ref pre_state) = pre_state_for_reset {
            states
                .into_iter()
                .flat_map(|successor| {
                    mount::reset_mount_locals(compiled, Some(pre_state), successor, false)
                })
                .collect()
        } else {
            states
        }
    })
}

fn apply_effect_inner(
    compiled: &CompiledModel,
    state: &ModelState,
    effect: &EffectIR,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, EffectError> {
    match effect {
        EffectIR::Assign { var, expr } => {
            let raw_value = eval_assign_expr(compiled, state, expr, options)?;
            let decl = compiled
                .var_decl(var)
                .ok_or_else(|| EffectError::TokenExhausted(var.clone()))?;
            let value = match &decl.domain {
                crate::model::AbstractDomain::BoundedInt { .. }
                | crate::model::AbstractDomain::IntSet { .. } => {
                    let Some(raw) = as_integer_value(&raw_value) else {
                        return Ok(vec![]);
                    };
                    match apply_numeric_assign(&decl.domain, raw) {
                        NumericAssignOutcome::Value(value) => json!(value),
                        NumericAssignOutcome::Forbid(message) => {
                            if let Some(hit) = options.on_bound_hit.as_mut() {
                                hit(&message);
                            }
                            return Ok(vec![]);
                        }
                    }
                }
                crate::model::AbstractDomain::BoundedList { .. } => {
                    if !validate_value(&decl.domain, &raw_value) {
                        if let Some(hit) = options.on_bound_hit.as_mut() {
                            hit(&format!("history cap saturated for {var}"));
                        }
                        return Ok(vec![]);
                    }
                    raw_value
                }
                _ => raw_value,
            };
            let var_idx = compiled
                .var_idx(var)
                .ok_or_else(|| EffectError::TokenExhausted(var.clone()))?;
            Ok(vec![state.with_var(var_idx, value)])
        }
        EffectIR::Havoc { var } => {
            let decl = compiled
                .var_decl(var)
                .ok_or_else(|| EffectError::TokenExhausted(var.clone()))?;
            let var_idx = compiled
                .var_idx(var)
                .ok_or_else(|| EffectError::TokenExhausted(var.clone()))?;
            Ok(enumerate_domain(&decl.domain)
                .into_iter()
                .map(|value| state.with_var(var_idx, value))
                .collect())
        }
        EffectIR::Choose { var, among } => {
            let var_idx = compiled
                .var_idx(var)
                .ok_or_else(|| EffectError::TokenExhausted(var.clone()))?;
            Ok(among
                .iter()
                .map(|expr| {
                    state.with_var(var_idx, eval_expr(compiled, state, expr, options))
                })
                .collect())
        }
        EffectIR::If {
            cond,
            then,
            else_branch,
        } => {
            let branch = if eval_expr(compiled, state, cond, options)
                .as_bool()
                .unwrap_or(false)
            {
                then
            } else {
                else_branch
            };
            apply_effect_inner(compiled, state, branch, options)
        }
        EffectIR::Seq { effects } => {
            let mut states = vec![state.clone()];
            let saved_args = options.resolving_op_args.take();
            for effect in effects {
                if let EffectIR::Dequeue { queue, index } = effect {
                    if let Some(s) = states.first() {
                        if let Some(args) =
                            pending_op_args_at(compiled, s, queue, *index)
                        {
                            options.resolving_op_args = Some(args);
                        }
                    }
                }
                states = states
                    .into_iter()
                    .flat_map(|s| {
                        apply_effect_inner(compiled, &s, effect, options).unwrap_or_default()
                    })
                    .collect();
            }
            options.resolving_op_args = saved_args;
            Ok(states)
        }
        EffectIR::Enqueue {
            queue,
            op,
            continuation,
            args,
        } => {
            let pending_idx = compiled
                .pending_queue_idx(queue.as_deref())
                .map_err(EffectError::TokenExhausted)?;
            let pending = read_pending(state, pending_idx);
            if pending.len() >= compiled.model.bounds.max_pending as usize {
                return Ok(vec![]);
            }
            let mut op_args = serde_json::Map::new();
            for (key, expr) in args {
                op_args.insert(key.clone(), eval_expr(compiled, state, expr, options));
            }
            let mut op_obj = serde_json::Map::new();
            op_obj.insert("opId".into(), Value::String(op.clone()));
            op_obj.insert(
                "continuation".into(),
                Value::String(continuation.clone()),
            );
            op_obj.insert("args".into(), Value::Object(op_args));
            let mut new_pending = pending;
            new_pending.push(Value::Object(op_obj));
            Ok(vec![state.with_var(pending_idx, Value::Array(new_pending))])
        }
        EffectIR::Dequeue { queue, index } => {
            let pending_idx = compiled
                .pending_queue_idx(queue.as_deref())
                .map_err(EffectError::TokenExhausted)?;
            let pending = read_pending(state, pending_idx);
            if *index >= pending.len() {
                return Ok(vec![state.clone()]);
            }
            let filtered: Vec<_> = pending
                .into_iter()
                .enumerate()
                .filter(|(i, _)| *i != *index)
                .map(|(_, v)| v)
                .collect();
            Ok(vec![state.with_var(pending_idx, Value::Array(filtered))])
        }
        EffectIR::Opaque { .. } => Err(EffectError::TokenExhausted(
            "unsupported opaque effect".into(),
        )),
    }
}

fn eval_assign_expr(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &crate::model::ExprIR,
    options: &mut EvalOptions,
) -> Result<Value, EffectError> {
    if let crate::model::ExprIR::FreshToken { domain_of } = expr {
        return fresh_token(compiled, state, domain_of).map(Value::String);
    }
    Ok(eval_expr(compiled, state, expr, options))
}

fn as_integer_value(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|n| n.fract() == 0.0)
            .map(|n| n as i64)
    })
}

pub fn read_pending(state: &ModelState, pending_idx: usize) -> Vec<Value> {
    state
        .get(pending_idx)
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn pending_op_args_at(
    compiled: &CompiledModel,
    state: &ModelState,
    queue: &Option<String>,
    index: usize,
) -> Option<serde_json::Map<String, Value>> {
    let pending_idx = compiled.pending_queue_idx(queue.as_deref()).ok()?;
    let pending = read_pending(state, pending_idx);
    let op = pending.get(index)?;
    let Value::Object(op) = op else {
        return None;
    };
    let args = op.get("args")?;
    let Value::Object(args) = args else {
        return None;
    };
    Some(args.clone())
}

pub fn fresh_token(
    compiled: &CompiledModel,
    state: &ModelState,
    domain_of: &str,
) -> Result<String, EffectError> {
    let decl = compiled
        .var_decl(domain_of)
        .ok_or_else(|| EffectError::TokenExhausted(domain_of.to_string()))?;
    let names = match &decl.domain {
        crate::model::AbstractDomain::Tokens { count, names } => {
            crate::domain::token_names(*count, names.as_deref())
        }
        _ => return Err(EffectError::TokenExhausted(domain_of.to_string())),
    };
    let token_set: HashSet<_> = names.iter().cloned().collect();
    let mut used = HashSet::new();
    for value in &state.values {
        collect_tokens(value, &mut used, &token_set);
    }
    names
        .into_iter()
        .find(|n| !used.contains(n))
        .ok_or_else(|| EffectError::TokenExhausted(domain_of.to_string()))
}

fn collect_tokens(value: &Value, out: &mut HashSet<String>, token_set: &HashSet<String>) {
    match value {
        Value::String(s) if token_set.contains(s) => {
            out.insert(s.clone());
        }
        Value::Array(arr) => {
            for item in arr {
                collect_tokens(item, out, token_set);
            }
        }
        Value::Object(obj) => {
            for item in obj.values() {
                collect_tokens(item, out, token_set);
            }
        }
        _ => {}
    }
}

pub fn effect_contains_enqueue(effect: &EffectIR) -> bool {
    match effect {
        EffectIR::Enqueue { .. } => true,
        EffectIR::Seq { effects } => effects.iter().any(effect_contains_enqueue),
        EffectIR::If { then, else_branch, .. } => {
            effect_contains_enqueue(then) || effect_contains_enqueue(else_branch)
        }
        _ => false,
    }
}

#[derive(Debug, Default, Clone)]
pub struct EffectFootprintScan {
    pub uses_read_pre: bool,
    pub uses_read_op_arg: bool,
    pub uses_fresh_token: bool,
    pub has_havoc_or_opaque_like: bool,
    pub may_branch: bool,
    pub touches_pending_queue: bool,
    pub pending_queue_var_ids: std::collections::HashSet<String>,
}

fn scan_expr_for_effect_footprint(expr: &ExprIR, scan: &mut EffectFootprintScan) {
    match expr {
        ExprIR::FreshToken { .. } => scan.uses_fresh_token = true,
        ExprIR::ReadPre { .. } => scan.uses_read_pre = true,
        ExprIR::ReadOpArg { .. } => scan.uses_read_op_arg = true,
        ExprIR::Eq { args }
        | ExprIR::Neq { args }
        | ExprIR::And { args }
        | ExprIR::Or { args }
        | ExprIR::Not { args }
        | ExprIR::Cond { args }
        | ExprIR::Lt { args }
        | ExprIR::Lte { args }
        | ExprIR::Gt { args }
        | ExprIR::Gte { args }
        | ExprIR::Add { args }
        | ExprIR::Sub { args }
        | ExprIR::Mod { args } => {
            for arg in args {
                scan_expr_for_effect_footprint(arg, scan);
            }
        }
        ExprIR::UpdateField { target, value, .. } => {
            scan_expr_for_effect_footprint(target, scan);
            scan_expr_for_effect_footprint(value, scan);
        }
        ExprIR::TagIs { arg, .. } | ExprIR::LenCat { arg } => {
            scan_expr_for_effect_footprint(arg, scan);
        }
        ExprIR::Lit { .. }
        | ExprIR::Read { .. }
        | ExprIR::TransitionEnabled { .. }
        | ExprIR::TransitionEnabledPrefix { .. } => {}
    }
}

pub fn scan_effect_footprint(effect: &EffectIR, scan: &mut EffectFootprintScan) {
    match effect {
        EffectIR::Assign { expr, .. } => scan_expr_for_effect_footprint(expr, scan),
        EffectIR::Havoc { .. } => scan.has_havoc_or_opaque_like = true,
        EffectIR::Choose { among, .. } => {
            scan.has_havoc_or_opaque_like = true;
            scan.may_branch = true;
            for expr in among {
                scan_expr_for_effect_footprint(expr, scan);
            }
        }
        EffectIR::If {
            cond,
            then,
            else_branch,
        } => {
            scan.may_branch = true;
            scan_expr_for_effect_footprint(cond, scan);
            scan_effect_footprint(then, scan);
            scan_effect_footprint(else_branch, scan);
        }
        EffectIR::Seq { effects } => {
            for child in effects {
                scan_effect_footprint(child, scan);
            }
        }
        EffectIR::Enqueue { queue, args, .. } => {
            scan.touches_pending_queue = true;
            if let Some(id) = queue {
                scan.pending_queue_var_ids.insert(id.clone());
            }
            for expr in args.values() {
                scan_expr_for_effect_footprint(expr, scan);
            }
        }
        EffectIR::Dequeue { queue, .. } => {
            scan.touches_pending_queue = true;
            if let Some(id) = queue {
                scan.pending_queue_var_ids.insert(id.clone());
            }
        }
        EffectIR::Opaque { .. } => scan.has_havoc_or_opaque_like = true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, ExprIR, InitialValue, Model, Scope, StateVarDecl, Transition,
    };
    use serde_json::json;
    use std::collections::HashMap;

    fn base_compiled() -> CompiledModel {
        CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "m".into(),
                vars: vec![
                    StateVarDecl {
                        id: "sys:route".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/".into(), "/next".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/")),

                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:history".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Enum {
                                values: vec!["/".into(), "/next".into()],
                            }),
                            max_len: 2,
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
                                fields: HashMap::from([
                                    (
                                        "opId".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["op".into()],
                                        },
                                    ),
                                    (
                                        "continuation".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["c".into()],
                                        },
                                    ),
                                    (
                                        "args".into(),
                                        AbstractDomain::Record {
                                            fields: HashMap::new(),
                                        },
                                    ),
                                ]),
                            }),
                            max_len: 1,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),

                        role: Some(crate::model::SystemVarRole { kind: crate::model::SystemVarRoleKind::PendingQueue, group: None }),
                    },
                    StateVarDecl {
                        id: "x".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),

                        role: None,
                    },
                ],
                transitions: vec![],
                bounds: Bounds {
                    max_depth: 2,
                    max_pending: 1,
                    max_internal_steps: 2,
                },
                metadata: None,
            },
            false,
        )
        .unwrap()
    }

    fn blank_state(compiled: &CompiledModel) -> ModelState {
        let mut state = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        for (idx, decl) in compiled.model.vars.iter().enumerate() {
            state.values[idx] =
                crate::domain::initial_values(&decl.domain, &decl.initial)[0].clone();
        }
        state
    }

    #[test]
    fn assign_and_havoc_branch_states() {
        let compiled = base_compiled();
        let state = blank_state(&compiled);
        let x = *compiled.var_index.get("x").unwrap();
        let assigned = apply_effect(
            &compiled,
            &state,
            &EffectIR::Assign {
                var: "x".into(),
                expr: ExprIR::Lit {
                    value: json!(true),
                },
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert_eq!(assigned[0].values[x], json!(true));
        let havoc = apply_effect(
            &compiled,
            &state,
            &EffectIR::Havoc { var: "x".into() },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert_eq!(havoc.len(), 2);
    }

    #[test]
    fn enqueue_respects_pending_cap() {
        let compiled = base_compiled();
        let state = blank_state(&compiled);
        let pending_idx = compiled.pending_queue_idx(None).unwrap();
        let full = state.with_var(
            pending_idx,
            json!([{
                "opId": "op",
                "continuation": "c",
                "args": {}
            }]),
        );
        let posts = apply_effect(
            &compiled,
            &full,
            &EffectIR::Enqueue {
                queue: None,
                op: "op".into(),
                continuation: "c".into(),
                args: HashMap::new(),
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert!(posts.is_empty());
    }

    fn numeric_compiled(
        domain: AbstractDomain,
        initial: Value,
    ) -> (CompiledModel, ModelState) {
        let compiled = CompiledModel::compile(
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

                        role: None,
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

                        role: None,
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

                        role: None,
                    },
                    StateVarDecl {
                        id: "count".into(),
                        domain,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(initial.clone()),

                        role: None,
                    },
                ],
                transitions: vec![],
                bounds: Bounds {
                    max_depth: 4,
                    max_pending: 0,
                    max_internal_steps: 4,
                },
                metadata: None,
            },
            false,
        )
        .unwrap();
        let mut state = blank_state(&compiled);
        let count = *compiled.var_index.get("count").unwrap();
        state.values[count] = initial;
        (compiled, state)
    }

    #[test]
    fn forbid_overflow_produces_no_successor() {
        let (compiled, state) = numeric_compiled(
            AbstractDomain::BoundedInt {
                min: 0,
                max: 3,
                overflow: Some(crate::model::NumericOverflowPolicy::Forbid),
            },
            json!(3),
        );
        let count = *compiled.var_index.get("count").unwrap();
        let mut hits = Vec::new();
        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Assign {
                var: "count".into(),
                expr: ExprIR::Add {
                    args: vec![
                        ExprIR::Read {
                            var: "count".into(),
                            path: None,
                        },
                        ExprIR::Lit { value: json!(1) },
                    ],
                },
            },
            &mut EvalOptions {
                on_bound_hit: Some(&mut |hit| hits.push(hit.to_string())),
                ..EvalOptions::default()
            },
        )
        .unwrap();
        assert!(posts.is_empty());
        assert!(!hits.is_empty());
        let _ = count;
    }

    #[test]
    fn wrap_overflow_wraps_dense_range() {
        let (compiled, state) = numeric_compiled(
            AbstractDomain::BoundedInt {
                min: 0,
                max: 3,
                overflow: Some(crate::model::NumericOverflowPolicy::Wrap),
            },
            json!(3),
        );
        let count = *compiled.var_index.get("count").unwrap();
        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Assign {
                var: "count".into(),
                expr: ExprIR::Add {
                    args: vec![
                        ExprIR::Read {
                            var: "count".into(),
                            path: None,
                        },
                        ExprIR::Lit { value: json!(1) },
                    ],
                },
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert_eq!(posts[0].values[count], json!(0));
    }

    #[test]
    fn saturate_overflow_clamps_dense_range() {
        let (compiled, state) = numeric_compiled(
            AbstractDomain::BoundedInt {
                min: 0,
                max: 3,
                overflow: Some(crate::model::NumericOverflowPolicy::Saturate),
            },
            json!(3),
        );
        let count = *compiled.var_index.get("count").unwrap();
        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Assign {
                var: "count".into(),
                expr: ExprIR::Add {
                    args: vec![
                        ExprIR::Read {
                            var: "count".into(),
                            path: None,
                        },
                        ExprIR::Lit { value: json!(1) },
                    ],
                },
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert_eq!(posts[0].values[count], json!(3));
    }

    #[test]
    fn int_set_forbid_rejects_non_member() {
        let (compiled, state) = numeric_compiled(
            AbstractDomain::IntSet {
                values: vec![0, 2],
                overflow: Some(crate::model::NumericOverflowPolicy::Forbid),
            },
            json!(2),
        );
        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Assign {
                var: "count".into(),
                expr: ExprIR::Add {
                    args: vec![
                        ExprIR::Read {
                            var: "count".into(),
                            path: None,
                        },
                        ExprIR::Lit { value: json!(1) },
                    ],
                },
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert!(posts.is_empty());
    }

    fn next_mount_local_compiled() -> (CompiledModel, ModelState) {
        let compiled = CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "next-mount".into(),
                vars: vec![
                    StateVarDecl {
                        id: "sys:route".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/".into(), "/dashboard".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/")),

                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:history".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Enum {
                                values: vec!["/".into(), "/dashboard".into()],
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
                                fields: HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),

                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:next:slot:children".into(),
                        domain: AbstractDomain::Enum {
                            values: vec![
                                "__none".into(),
                                "app/page".into(),
                                "app/dashboard/page".into(),
                            ],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("__none")),

                        role: None,
                    },
                    StateVarDecl {
                        id: "local:Dashboard.count".into(),
                        domain: AbstractDomain::BoundedInt {
                            min: 0,
                            max: 10,
                            overflow: None,
                        },
                        origin: json!("test"),
                        scope: Scope::MountLocal {
                            id: "next:page:app:dashboard".into(),
                            when: ExprIR::And {
                                args: vec![
                                    ExprIR::Eq {
                                        args: vec![
                                            ExprIR::Read {
                                                var: "sys:route".into(),
                                                path: None,
                                            },
                                            ExprIR::Lit {
                                                value: json!("/dashboard"),
                                            },
                                        ],
                                    },
                                    ExprIR::Eq {
                                        args: vec![
                                            ExprIR::Read {
                                                var: "sys:next:slot:children".into(),
                                                path: None,
                                            },
                                            ExprIR::Lit {
                                                value: json!("app/dashboard/page"),
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                        initial: InitialValue::Single(json!(0)),

                        role: None,
                    },
                ],
                transitions: vec![],
                bounds: Bounds {
                    max_depth: 4,
                    max_pending: 0,
                    max_internal_steps: 4,
                },
                metadata: None,
            },
            false,
        )
        .unwrap();
        let mut state = blank_state(&compiled);
        let count_idx = compiled.var_idx("local:Dashboard.count").unwrap();
        state.values[count_idx] = json!(crate::model::UNMOUNTED);
        (compiled, state)
    }

    #[test]
    fn seq_location_assign_then_slot_assign_activates_mount_local() {
        let (compiled, state) = next_mount_local_compiled();
        let route_idx = compiled.var_idx("sys:route").unwrap();
        let slot_idx = compiled.var_idx("sys:next:slot:children").unwrap();
        let count_idx = compiled.var_idx("local:Dashboard.count").unwrap();

        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Seq {
                effects: vec![
                    EffectIR::Assign {
                        var: "sys:route".into(),
                        expr: ExprIR::Lit {
                            value: json!("/dashboard"),
                        },
                    },
                    EffectIR::Assign {
                        var: "sys:next:slot:children".into(),
                        expr: ExprIR::Lit {
                            value: json!("app/dashboard/page"),
                        },
                    },
                ],
            },
            &mut EvalOptions::default(),
        )
        .unwrap();

        assert_eq!(posts.len(), 1);
        assert_eq!(posts[0].get(route_idx), &json!("/dashboard"));
        assert_eq!(posts[0].get(slot_idx), &json!("app/dashboard/page"));
        assert_eq!(posts[0].get(count_idx), &json!(0));
    }

    #[test]
    fn choose_slot_assign_normalizes_mount_local_successors() {
        let (compiled, state) = next_mount_local_compiled();
        let count_idx = compiled.var_idx("local:Dashboard.count").unwrap();

        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Seq {
                effects: vec![
                    EffectIR::Assign {
                        var: "sys:route".into(),
                        expr: ExprIR::Lit {
                            value: json!("/dashboard"),
                        },
                    },
                    EffectIR::Choose {
                        var: "sys:next:slot:children".into(),
                        among: vec![
                            ExprIR::Lit {
                                value: json!("app/dashboard/page"),
                            },
                            ExprIR::Lit {
                                value: json!("app/page"),
                            },
                        ],
                    },
                ],
            },
            &mut EvalOptions::default(),
        )
        .unwrap();

        assert_eq!(posts.len(), 2);
        let slot_idx = compiled.var_idx("sys:next:slot:children").unwrap();
        for post in &posts {
            let slot = post.get(slot_idx).as_str().unwrap();
            if slot == "app/dashboard/page" {
                assert_eq!(post.get(count_idx), &json!(0));
            } else {
                assert_eq!(post.get(count_idx), &json!(crate::model::UNMOUNTED));
            }
        }
        let route_idx = compiled.var_idx("sys:route").unwrap();
        let active = posts
            .iter()
            .find(|post| post.get(count_idx) == &json!(0))
            .expect("dashboard mount-local should initialize when slot matches");
        assert_eq!(active.get(route_idx), &json!("/dashboard"));
    }

    #[test]
    fn enqueue_dequeue_use_named_pending_queue_role() {
        let compiled = CompiledModel::compile(
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
                        role: None,
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
                        role: None,
                    },
                    StateVarDecl {
                        id: "system:asyncQueue".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::from([
                                    (
                                        "opId".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["op".into()],
                                        },
                                    ),
                                    (
                                        "continuation".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["c".into()],
                                        },
                                    ),
                                    (
                                        "args".into(),
                                        AbstractDomain::Record {
                                            fields: HashMap::new(),
                                        },
                                    ),
                                ]),
                            }),
                            max_len: 1,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                        role: Some(crate::model::SystemVarRole {
                            kind: crate::model::SystemVarRoleKind::PendingQueue,
                            group: None,
                        }),
                    },
                ],
                transitions: vec![],
                bounds: Bounds {
                    max_depth: 1,
                    max_pending: 1,
                    max_internal_steps: 1,
                },
                metadata: None,
            },
            false,
        )
        .unwrap();
        let state = blank_state(&compiled);
        let queue_idx = compiled.pending_queue_idx(None).unwrap();
        assert_eq!(compiled.model.vars[queue_idx].id, "system:asyncQueue");
        let posts = apply_effect(
            &compiled,
            &state,
            &EffectIR::Enqueue {
                queue: None,
                op: "op".into(),
                continuation: "c".into(),
                args: HashMap::from([(
                    "token".into(),
                    ExprIR::Lit {
                        value: json!("x"),
                    },
                )]),
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        let queued = read_pending(&posts[0], queue_idx);
        assert_eq!(queued.len(), 1);
        let dequeued = apply_effect(
            &compiled,
            &posts[0],
            &EffectIR::Dequeue {
                queue: None,
                index: 0,
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert!(read_pending(&dequeued[0], queue_idx).is_empty());
    }

    #[test]
    fn ambiguous_implicit_pending_queue_fails_validation() {
        let result = CompiledModel::compile(
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
                        role: None,
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
                        role: None,
                    },
                    StateVarDecl {
                        id: "app:pendingA".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::from([
                                    (
                                        "opId".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["op".into()],
                                        },
                                    ),
                                    (
                                        "continuation".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["c".into()],
                                        },
                                    ),
                                    (
                                        "args".into(),
                                        AbstractDomain::Record {
                                            fields: HashMap::new(),
                                        },
                                    ),
                                ]),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                        role: Some(crate::model::SystemVarRole {
                            kind: crate::model::SystemVarRoleKind::PendingQueue,
                            group: None,
                        }),
                    },
                    StateVarDecl {
                        id: "app:pendingB".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::from([
                                    (
                                        "opId".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["op".into()],
                                        },
                                    ),
                                    (
                                        "continuation".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["c".into()],
                                        },
                                    ),
                                    (
                                        "args".into(),
                                        AbstractDomain::Record {
                                            fields: HashMap::new(),
                                        },
                                    ),
                                ]),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                        role: Some(crate::model::SystemVarRole {
                            kind: crate::model::SystemVarRoleKind::PendingQueue,
                            group: None,
                        }),
                    },
                ],
                transitions: vec![Transition {
                    id: "t1".into(),
                    cls: "user".into(),
                    label: json!({"kind":"click"}),
                    source: vec![],
                    guard: ExprIR::Lit {
                        value: json!(true),
                    },
                    effect: EffectIR::Enqueue {
                        queue: None,
                        op: "op".into(),
                        continuation: "c".into(),
                        args: HashMap::new(),
                    },
                    reads: vec![],
                    writes: vec!["app:pendingA".into()],
                    confidence: "exact".into(),
                    triggered_by: None,
                    phase: None,
                }],
                bounds: Bounds {
                    max_depth: 1,
                    max_pending: 0,
                    max_internal_steps: 1,
                },
                metadata: None,
            },
            false,
        );
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .contains("enqueue/dequeue queue is ambiguous"));
    }
}
