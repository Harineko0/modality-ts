use crate::domain::enumerate_domain;
use crate::expr::{eval_expr, EvalOptions};
use crate::model::{CompiledModel, EffectIR};
use crate::navigation;
use crate::state::ModelState;
use serde_json::Value;
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
    result
}

fn apply_effect_inner(
    compiled: &CompiledModel,
    state: &ModelState,
    effect: &EffectIR,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, EffectError> {
    match effect {
        EffectIR::Assign { var, expr } => {
            let value = eval_assign_expr(compiled, state, expr, options)?;
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
                if let EffectIR::Dequeue { index } = effect {
                    if let Some(s) = states.first() {
                        if let Some(args) =
                            pending_op_args_at(compiled, s, *index)
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
            op,
            continuation,
            args,
        } => {
            let pending_idx = compiled
                .sys_pending_index
                .ok_or_else(|| EffectError::TokenExhausted("sys:pending".into()))?;
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
        EffectIR::Dequeue { index } => {
            let pending_idx = compiled
                .sys_pending_index
                .ok_or_else(|| EffectError::TokenExhausted("sys:pending".into()))?;
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
        EffectIR::Navigate { mode, to } => navigation::navigate(compiled, state, mode, to.as_ref(), options),
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
    index: usize,
) -> Option<serde_json::Map<String, Value>> {
    let pending_idx = compiled.sys_pending_index?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, ExprIR, InitialValue, Model, Scope, StateVarDecl,
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
                    },
                    StateVarDecl {
                        id: "x".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),
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
        let pending_idx = compiled.sys_pending_index.unwrap();
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
                op: "op".into(),
                continuation: "c".into(),
                args: HashMap::new(),
            },
            &mut EvalOptions::default(),
        )
        .unwrap();
        assert!(posts.is_empty());
    }
}
