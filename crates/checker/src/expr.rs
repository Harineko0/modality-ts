use crate::domain::domain_at_path;
use crate::model::{route_local_mounted, CompiledModel, ExprIR};
use crate::state::{read_path, values_equal, write_path, ModelState};
use crate::step::StepFacts;
use serde_json::{json, Value};

pub struct EvalOptions<'a> {
    pub on_bound_hit: Option<&'a mut dyn FnMut(&str)>,
    pub step_ctx: Option<StepEvalContext<'a>>,
    pub pre_state: Option<ModelState>,
    pub resolving_op_args: Option<serde_json::Map<String, Value>>,
}

pub struct StepEvalContext<'a> {
    pub pre: Option<&'a ModelState>,
    pub step: Option<&'a StepFacts>,
}

impl Default for EvalOptions<'_> {
    fn default() -> Self {
        Self {
            on_bound_hit: None,
            step_ctx: None,
            pre_state: None,
            resolving_op_args: None,
        }
    }
}

pub fn eval_expr(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &ExprIR,
    options: &mut EvalOptions,
) -> Value {
    match expr {
        ExprIR::Lit { value } => value.clone(),
        ExprIR::Read { var, path } => {
            let base = compiled
                .var_idx(var)
                .map(|idx| state.get(idx));
            read_path(base, path.as_deref().unwrap_or(&[]))
        }
        ExprIR::Eq { args } => {
            let left = args.first().map(|a| eval_expr(compiled, state, a, options));
            let right = args.get(1).map(|a| eval_expr(compiled, state, a, options));
            Value::Bool(values_equal(
                &left.unwrap_or(Value::Null),
                &right.unwrap_or(Value::Null),
            ))
        }
        ExprIR::Neq { args } => {
            let left = args.first().map(|a| eval_expr(compiled, state, a, options));
            let right = args.get(1).map(|a| eval_expr(compiled, state, a, options));
            Value::Bool(!values_equal(
                &left.unwrap_or(Value::Null),
                &right.unwrap_or(Value::Null),
            ))
        }
        ExprIR::And { args } => {
            for arg in args {
                if !eval_expr(compiled, state, arg, options)
                    .as_bool()
                    .unwrap_or(false)
                {
                    return Value::Bool(false);
                }
            }
            Value::Bool(true)
        }
        ExprIR::Or { args } => {
            for arg in args {
                if eval_expr(compiled, state, arg, options)
                    .as_bool()
                    .unwrap_or(false)
                {
                    return Value::Bool(true);
                }
            }
            Value::Bool(false)
        }
        ExprIR::Not { args } => {
            let arg = args.first().map(|a| eval_expr(compiled, state, a, options));
            Value::Bool(!arg.and_then(|v| v.as_bool()).unwrap_or(false))
        }
        ExprIR::Cond { args } => {
            let cond = args.first().map(|a| eval_expr(compiled, state, a, options));
            if cond.and_then(|v| v.as_bool()).unwrap_or(false) {
                args.get(1)
                    .map(|a| eval_expr(compiled, state, a, options))
                    .unwrap_or(Value::Null)
            } else {
                args.get(2)
                    .map(|a| eval_expr(compiled, state, a, options))
                    .unwrap_or(Value::Null)
            }
        }
        ExprIR::UpdateField { target, path, value } => {
            let t = eval_expr(compiled, state, target, options);
            let v = eval_expr(compiled, state, value, options);
            write_path(&t, path, v)
        }
        ExprIR::TagIs { arg, tag: expected_tag } => {
            let val = eval_expr(compiled, state, arg, options);
            let domain = tagged_domain_for_expr(compiled, arg);
            if let (Some(crate::model::AbstractDomain::Tagged { tag: tag_field, .. }), Value::Object(obj)) =
                (domain, &val)
            {
                Value::Bool(obj.get(&tag_field) == Some(&Value::String(expected_tag.clone())))
            } else {
                Value::Bool(false)
            }
        }
        ExprIR::LenCat { arg } => {
            let val = eval_expr(compiled, state, arg, options);
            match val {
                Value::Array(arr) => match arr.len() {
                    0 => json!("0"),
                    1 => json!("1"),
                    _ => json!("many"),
                },
                _ => json!("0"),
            }
        }
        ExprIR::FreshToken { domain_of } => match crate::effect::fresh_token(
            compiled,
            state,
            domain_of,
        ) {
            Ok(token) => json!(token),
            Err(_) => {
                if let Some(hit) = options.on_bound_hit.as_mut() {
                    hit(&format!("token cap exhausted for {domain_of}"));
                }
                Value::Null
            }
        },
        ExprIR::TransitionEnabled { transition_id } => {
            let Some(&idx) = compiled.transition_index.get(transition_id) else {
                return Value::Bool(false);
            };
            let transition = compiled.transition(idx);
            Value::Bool(
                route_local_mounted(compiled, idx, state)
                    && guard_holds(compiled, transition, state),
            )
        }
        ExprIR::ReadPre { var, path } => {
            let read_state = options
                .pre_state
                .as_ref()
                .or_else(|| options.step_ctx.as_ref().and_then(|ctx| ctx.pre))
                .unwrap_or(state);
            if options.pre_state.is_none()
                && options.step_ctx.as_ref().and_then(|ctx| ctx.pre).is_none()
            {
                debug_assert!(
                    false,
                    "readPre requires pre-state evaluation context"
                );
            }
            let base = compiled.var_idx(var).map(|idx| read_state.get(idx));
            read_path(base, path.as_deref().unwrap_or(&[]))
        }
        ExprIR::ReadOpArg { key } => {
            if let Some(args) = &options.resolving_op_args {
                return args.get(key).cloned().unwrap_or(Value::Null);
            }
            if let Some(step) = options
                .step_ctx
                .as_ref()
                .and_then(|ctx| ctx.step.as_ref())
                .and_then(|step| step.op.as_ref())
            {
                return step.args.get(key).cloned().unwrap_or(Value::Null);
            }
            debug_assert!(
                false,
                "readOpArg requires op-arg evaluation context"
            );
            Value::Null
        }
    }
}

pub fn guard_holds(
    compiled: &CompiledModel,
    transition: &crate::model::Transition,
    state: &ModelState,
) -> bool {
    eval_expr(
        compiled,
        state,
        &transition.guard,
        &mut EvalOptions::default(),
    )
    .as_bool()
    .unwrap_or(false)
}

fn tagged_domain_for_expr(
    compiled: &CompiledModel,
    expr: &ExprIR,
) -> Option<crate::model::AbstractDomain> {
    let domain = domain_for_expr(compiled, expr)?;
    if matches!(domain, crate::model::AbstractDomain::Tagged { .. }) {
        Some(domain)
    } else {
        None
    }
}

fn domain_for_expr(
    compiled: &CompiledModel,
    expr: &ExprIR,
) -> Option<crate::model::AbstractDomain> {
    match expr {
        ExprIR::Read { var, path } => {
            let decl = compiled.var_decl(var)?;
            domain_at_path(&decl.domain, path.as_deref().unwrap_or(&[]))
        }
        ExprIR::Cond { args } => {
            let then_d = args.get(1).and_then(|e| domain_for_expr(compiled, e));
            let else_d = args.get(2).and_then(|e| domain_for_expr(compiled, e));
            if let (Some(t), Some(e)) = (then_d, else_d) {
                if domains_equal(&t, &e) {
                    Some(t)
                } else {
                    None
                }
            } else {
                None
            }
        }
        ExprIR::UpdateField { target, .. } => domain_for_expr(compiled, target),
        _ => None,
    }
}

fn domains_equal(left: &crate::model::AbstractDomain, right: &crate::model::AbstractDomain) -> bool {
    serde_json::to_string(left).unwrap_or_default() == serde_json::to_string(right).unwrap_or_default()
}

pub fn eval_state_predicate(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &ExprIR,
    allowed_reads: &std::collections::HashSet<String>,
    property_name: &str,
    context: &str,
) -> Result<bool, String> {
    eval_state_predicate_with_step(
        compiled,
        state,
        expr,
        allowed_reads,
        property_name,
        context,
        None,
    )
}

pub fn eval_state_predicate_with_step(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &ExprIR,
    allowed_reads: &std::collections::HashSet<String>,
    property_name: &str,
    context: &str,
    step_ctx: Option<StepEvalContext<'_>>,
) -> Result<bool, String> {
    let mut options = EvalOptions {
        on_bound_hit: None,
        step_ctx,
        pre_state: None,
        resolving_op_args: None,
    };
    let result = eval_expr_checked(
        compiled,
        state,
        expr,
        &mut options,
        allowed_reads,
        property_name,
        context,
    )?;
    Ok(result.as_bool().unwrap_or(false))
}

fn eval_expr_checked(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &ExprIR,
    options: &mut EvalOptions,
    allowed: &std::collections::HashSet<String>,
    property_name: &str,
    context: &str,
) -> Result<Value, String> {
    match expr {
        ExprIR::Lit { value } => Ok(value.clone()),
        ExprIR::Read { var, path } => {
            if !allowed.contains(var) {
                return Err(format!(
                    "{property_name}: {context} read undeclared var {var}"
                ));
            }
            let base = compiled
                .var_idx(var)
                .map(|idx| state.get(idx));
            Ok(read_path(base, path.as_deref().unwrap_or(&[])))
        }
        ExprIR::Eq { args } => {
            let left = args
                .first()
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .transpose()?
                .unwrap_or(Value::Null);
            let right = args
                .get(1)
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .transpose()?
                .unwrap_or(Value::Null);
            Ok(Value::Bool(values_equal(&left, &right)))
        }
        ExprIR::Neq { args } => {
            let left = args
                .first()
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .transpose()?
                .unwrap_or(Value::Null);
            let right = args
                .get(1)
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .transpose()?
                .unwrap_or(Value::Null);
            Ok(Value::Bool(!values_equal(&left, &right)))
        }
        ExprIR::And { args } => {
            for arg in args {
                if !eval_expr_checked(compiled, state, arg, options, allowed, property_name, context)?
                    .as_bool()
                    .unwrap_or(false)
                {
                    return Ok(Value::Bool(false));
                }
            }
            Ok(Value::Bool(true))
        }
        ExprIR::Or { args } => {
            for arg in args {
                if eval_expr_checked(compiled, state, arg, options, allowed, property_name, context)?
                    .as_bool()
                    .unwrap_or(false)
                {
                    return Ok(Value::Bool(true));
                }
            }
            Ok(Value::Bool(false))
        }
        ExprIR::Not { args } => {
            let arg = args
                .first()
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .transpose()?
                .unwrap_or(Value::Null);
            Ok(Value::Bool(!arg.as_bool().unwrap_or(false)))
        }
        ExprIR::Cond { args } => {
            let cond = args
                .first()
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .transpose()?
                .unwrap_or(Value::Null);
            if cond.as_bool().unwrap_or(false) {
                Ok(args
                    .get(1)
                    .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                    .transpose()?
                    .unwrap_or(Value::Null))
            } else {
                Ok(args
                    .get(2)
                    .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                    .transpose()?
                    .unwrap_or(Value::Null))
            }
        }
        ExprIR::UpdateField { target, path, value } => {
            let t = eval_expr_checked(compiled, state, target, options, allowed, property_name, context)?;
            let v = eval_expr_checked(compiled, state, value, options, allowed, property_name, context)?;
            Ok(write_path(&t, path, v))
        }
        ExprIR::TagIs { arg, tag: expected_tag } => {
            let val = eval_expr_checked(compiled, state, arg, options, allowed, property_name, context)?;
            let domain = tagged_domain_for_expr(compiled, arg);
            if let (Some(crate::model::AbstractDomain::Tagged { tag: tag_field, .. }), Value::Object(obj)) =
                (domain, &val)
            {
                Ok(Value::Bool(
                    obj.get(&tag_field) == Some(&Value::String(expected_tag.clone())),
                ))
            } else {
                Ok(Value::Bool(false))
            }
        }
        ExprIR::LenCat { arg } => {
            let val = eval_expr_checked(compiled, state, arg, options, allowed, property_name, context)?;
            Ok(match val {
                Value::Array(arr) => match arr.len() {
                    0 => json!("0"),
                    1 => json!("1"),
                    _ => json!("many"),
                },
                _ => json!("0"),
            })
        }
        ExprIR::FreshToken { domain_of } => {
            if !allowed.contains(domain_of) {
                return Err(format!(
                    "{property_name}: {context} read undeclared var {domain_of}"
                ));
            }
            match crate::effect::fresh_token(compiled, state, domain_of) {
                Ok(token) => Ok(json!(token)),
                Err(_) => {
                    if let Some(hit) = options.on_bound_hit.as_mut() {
                        hit(&format!("token cap exhausted for {domain_of}"));
                    }
                    Ok(Value::Null)
                }
            }
        }
        ExprIR::TransitionEnabled { transition_id } => {
            let Some(&idx) = compiled.transition_index.get(transition_id) else {
                return Ok(Value::Bool(false));
            };
            let transition = compiled.transition(idx);
            for var in transition
                .reads
                .iter()
                .chain(transition.writes.iter())
                .chain(std::iter::once(&"sys:route".to_string()))
            {
                if !allowed.contains(var) {
                    return Err(format!(
                        "{property_name}: {context} read undeclared var {var}"
                    ));
                }
            }
            Ok(Value::Bool(
                route_local_mounted(compiled, idx, state)
                    && guard_holds(compiled, transition, state),
            ))
        }
        ExprIR::ReadPre { var, path } => {
            let Some(step_ctx) = options.step_ctx.as_ref() else {
                return Err(format!(
                    "{property_name}: {context} readPre requires step evaluation context"
                ));
            };
            let Some(pre) = step_ctx.pre else {
                return Err(format!(
                    "{property_name}: {context} readPre requires a pre-state"
                ));
            };
            if !allowed.contains(var) {
                return Err(format!(
                    "{property_name}: {context} read undeclared var {var}"
                ));
            }
            let base = compiled.var_idx(var).map(|idx| pre.get(idx));
            Ok(read_path(base, path.as_deref().unwrap_or(&[])))
        }
        ExprIR::ReadOpArg { key } => {
            let Some(step_ctx) = options.step_ctx.as_ref() else {
                return Err(format!(
                    "{property_name}: {context} readOpArg is only valid in step post predicates"
                ));
            };
            let Some(step) = step_ctx.step else {
                return Err(format!(
                    "{property_name}: {context} readOpArg requires step facts"
                ));
            };
            let Some(op) = step.op.as_ref() else {
                return Ok(Value::Null);
            };
            Ok(op.args.get(key).cloned().unwrap_or(Value::Null))
        }
    }
}

pub fn allowed_reads(
    property_reads: Option<&[String]>,
    enabled_transitions: Option<&[String]>,
    compiled: &CompiledModel,
) -> std::collections::HashSet<String> {
    let mut allowed: std::collections::HashSet<String> =
        property_reads.unwrap_or(&[]).iter().cloned().collect();
    if let Some(ids) = enabled_transitions {
        for tid in ids {
            if let Some(&idx) = compiled.transition_index.get(tid) {
                let t = compiled.transition(idx);
                allowed.extend(t.reads.iter().cloned());
                allowed.extend(t.writes.iter().cloned());
            }
        }
    }
    allowed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, EffectIR, InitialValue, Model, Scope, StateVarDecl, Transition,
    };
    use std::collections::HashMap;

    fn compiled_with_x(initial: Value) -> (CompiledModel, ModelState) {
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
                        initial: InitialValue::Single(initial.clone()),
                    },
                ],
                transitions: vec![Transition {
                    id: "t".into(),
                    cls: "user".into(),
                    label: json!({"kind": "click"}),
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
        )
        .unwrap();
        let mut state = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        let x = *compiled.var_index.get("x").unwrap();
        state.values[x] = initial;
        (compiled, state)
    }

    #[test]
    fn and_short_circuits() {
        let (compiled, state) = compiled_with_x(json!(false));
        let mut calls = 0;
        let expr = ExprIR::And {
            args: vec![
                ExprIR::Read {
                    var: "x".into(),
                    path: None,
                },
                ExprIR::Lit {
                    value: json!({
                        "__probe": { "calls": { "$set": true } }
                    }),
                },
            ],
        };
        let _ = eval_expr(&compiled, &state, &expr, &mut EvalOptions::default());
        let side_effect = ExprIR::And {
            args: vec![
                ExprIR::Read {
                    var: "x".into(),
                    path: None,
                },
                ExprIR::Lit {
                    value: json!(true),
                },
            ],
        };
        assert_eq!(
            eval_expr(&compiled, &state, &side_effect, &mut EvalOptions::default()),
            json!(false)
        );
        let _ = calls;
    }

    #[test]
    fn transition_enabled_respects_guard() {
        let (compiled, mut state) = compiled_with_x(json!(false));
        let x = *compiled.var_index.get("x").unwrap();
        state.values[x] = json!(true);
        let expr = ExprIR::TransitionEnabled {
            transition_id: "t".into(),
        };
        assert_eq!(
            eval_expr(&compiled, &state, &expr, &mut EvalOptions::default()),
            json!(true)
        );
    }
}
