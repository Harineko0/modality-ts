use crate::domain::enumerate_domain;
use crate::expr::{eval_expr, EvalOptions};
use crate::model::{CompiledModel, EffectIR, ModelState};
use crate::navigation;
use crate::state::{clone_state, set_var};
use serde_json::Value;
use std::collections::HashSet;

pub struct TokenExhausted(pub String);

pub enum EffectError {
    TokenExhausted(String),
    Opaque(String),
}

pub fn apply_effect(
    compiled: &CompiledModel,
    state: &ModelState,
    effect: &EffectIR,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, String> {
    match apply_effect_inner(compiled, state, effect, options) {
        Ok(states) => Ok(states),
        Err(EffectError::TokenExhausted(domain)) => {
            if let Some(hit) = options.on_bound_hit.as_mut() {
                hit(&format!("token cap exhausted for {domain}"));
            }
            Ok(vec![])
        }
        Err(EffectError::Opaque(message)) => Err(message),
    }
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
            let mut next = clone_state(state);
            set_var(&mut next, var, value);
            Ok(vec![next])
        }
        EffectIR::Havoc { var } => {
            let decl = compiled
                .var_decl(var)
                .ok_or_else(|| EffectError::TokenExhausted(var.clone()))?;
            Ok(enumerate_domain(&decl.domain)
                .into_iter()
                .map(|value| {
                    let mut next = clone_state(state);
                    set_var(&mut next, var, value);
                    next
                })
                .collect())
        }
        EffectIR::Choose { var, among } => Ok(among
            .iter()
            .map(|expr| {
                let mut next = clone_state(state);
                set_var(&mut next, var, eval_expr(compiled, state, expr, options));
                next
            })
            .collect()),
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
            for effect in effects {
                states = states
                    .into_iter()
                    .flat_map(|s| {
                        apply_effect(compiled, &s, effect, options).unwrap_or_default()
                    })
                    .collect();
            }
            Ok(states)
        }
        EffectIR::Enqueue {
            op,
            continuation,
            args,
        } => {
            let pending = read_pending(state);
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
            let mut next = clone_state(state);
            let mut new_pending = pending;
            new_pending.push(Value::Object(op_obj));
            set_var(&mut next, "sys:pending", Value::Array(new_pending));
            Ok(vec![next])
        }
        EffectIR::Dequeue { index } => {
            let pending = read_pending(state);
            if *index >= pending.len() {
                return Ok(vec![state.clone()]);
            }
            let mut next = clone_state(state);
            let filtered: Vec<_> = pending
                .into_iter()
                .enumerate()
                .filter(|(i, _)| *i != *index)
                .map(|(_, v)| v)
                .collect();
            set_var(&mut next, "sys:pending", Value::Array(filtered));
            Ok(vec![next])
        }
        EffectIR::Navigate { mode, to } => {
            navigation::navigate(compiled, state, mode, to.as_ref(), options)
        }
        EffectIR::Opaque { r#ref } => apply_opaque(compiled, state, r#ref),
    }
}

fn eval_assign_expr(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &crate::model::ExprIR,
    options: &mut EvalOptions,
) -> Result<Value, EffectError> {
    if let crate::model::ExprIR::FreshToken { domain_of } = expr {
        return fresh_token(compiled, state, domain_of).map(|token| Value::String(token));
    }
    Ok(eval_expr(compiled, state, expr, options))
}

fn apply_opaque(
    compiled: &CompiledModel,
    state: &ModelState,
    opaque_ref: &crate::model::OpaqueRef,
) -> Result<Vec<ModelState>, EffectError> {
    execute_opaque_effect(compiled, state, opaque_ref).map_err(EffectError::Opaque)
}

fn execute_opaque_effect(
    compiled: &CompiledModel,
    state: &ModelState,
    opaque_ref: &crate::model::OpaqueRef,
) -> Result<Vec<ModelState>, String> {
    if !opaque_ref.module.ends_with("opaque-effects.cjs") {
        return Err(format!(
            "unsupported opaque module {} (only test/checker/opaque-effects.cjs is bundled)",
            opaque_ref.module
        ));
    }
    let first = apply_opaque_export(compiled, state, &opaque_ref.export_name)?;
    let second = apply_opaque_export(compiled, state, &opaque_ref.export_name)?;
    if serde_json::to_string(&first).unwrap_or_default()
        != serde_json::to_string(&second).unwrap_or_default()
    {
        return Err(format!(
            "Opaque effect {}#{} returned nondeterministic results for identical input",
            opaque_ref.module, opaque_ref.export_name
        ));
    }
    first
        .into_iter()
        .enumerate()
        .map(|(index, candidate)| {
            validate_opaque_state(compiled, state, &candidate, opaque_ref, index)
        })
        .collect()
}

fn apply_opaque_export(
    compiled: &CompiledModel,
    state: &ModelState,
    export_name: &str,
) -> Result<Vec<ModelState>, String> {
    let mut next = clone_state(state);
    match export_name {
        "setDone" => set_var(&mut next, "done", serde_json::json!(true)),
        "writeUndeclared" => set_var(&mut next, "auth", serde_json::json!(true)),
        "invalidDone" => set_var(&mut next, "done", serde_json::json!("yes")),
        "nondeterministicDone" => {
            use std::cell::Cell;
            thread_local! {
                static FLIP: Cell<bool> = const { Cell::new(false) };
            }
            FLIP.with(|flip| {
                let value = !flip.get();
                flip.set(value);
                set_var(&mut next, "done", serde_json::json!(value));
            });
        }
        other => {
            return Err(format!(
                "unknown opaque export {other} in test/checker/opaque-effects.cjs"
            ));
        }
    }
    Ok(vec![next])
}

fn validate_opaque_state(
    compiled: &CompiledModel,
    pre: &ModelState,
    post: &ModelState,
    opaque_ref: &crate::model::OpaqueRef,
    index: usize,
) -> Result<ModelState, String> {
    let declared_writes: HashSet<_> = opaque_ref.declared_writes.iter().cloned().collect();
    let var_ids: HashSet<_> = compiled.model.vars.iter().map(|v| v.id.clone()).collect();
    for key in post.keys() {
        if !var_ids.contains(key) {
            return Err(format!(
                "Opaque effect {}#{} wrote unknown var {key}",
                opaque_ref.module, opaque_ref.export_name
            ));
        }
    }
    for decl in &compiled.model.vars {
        let post_value = post.get(&decl.id).cloned().unwrap_or(Value::Null);
        if !post.contains_key(&decl.id) {
            return Err(format!(
                "Opaque effect {}#{} result {index} omitted var {}",
                opaque_ref.module, opaque_ref.export_name, decl.id
            ));
        }
        if !declared_writes.contains(&decl.id)
            && serde_json::to_string(pre.get(&decl.id).unwrap_or(&Value::Null)).unwrap_or_default()
                != serde_json::to_string(&post_value).unwrap_or_default()
        {
            return Err(format!(
                "Opaque effect {}#{} wrote undeclared var {}",
                opaque_ref.module, opaque_ref.export_name, decl.id
            ));
        }
        if !crate::domain::validate_value(&decl.domain, &post_value) {
            return Err(format!(
                "Opaque effect {}#{} produced invalid value for {}",
                opaque_ref.module, opaque_ref.export_name, decl.id
            ));
        }
    }
    Ok(post.clone())
}

pub fn read_pending(state: &ModelState) -> Vec<Value> {
    state
        .get("sys:pending")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
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
    for value in state.values() {
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
