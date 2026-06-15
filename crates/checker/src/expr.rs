use crate::domain::domain_at_path;
use crate::model::{CompiledModel, ExprIR, ModelState};
use crate::state::{read_path, values_equal, write_path};
use serde_json::{json, Value};

pub struct EvalOptions<'a> {
    pub on_bound_hit: Option<&'a mut dyn FnMut(&str)>,
}

impl Default for EvalOptions<'_> {
    fn default() -> Self {
        Self { on_bound_hit: None }
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
            let base = state.get(var);
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
        ExprIR::And { args } => Value::Bool(
            args.iter()
                .all(|a| eval_expr(compiled, state, a, options).as_bool() == Some(true)),
        ),
        ExprIR::Or { args } => Value::Bool(
            args.iter()
                .any(|a| eval_expr(compiled, state, a, options).as_bool() == Some(true)),
        ),
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
                crate::model::route_local_mounted(compiled, transition, state)
                    && guard_holds(compiled, transition, state),
            )
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
                if serde_json::to_string(&t).unwrap_or_default()
                    == serde_json::to_string(&e).unwrap_or_default()
                {
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

pub fn eval_state_predicate(
    compiled: &CompiledModel,
    state: &ModelState,
    expr: &ExprIR,
    allowed_reads: &std::collections::HashSet<String>,
    property_name: &str,
    context: &str,
) -> Result<bool, String> {
    let result = eval_expr_checked(
        compiled,
        state,
        expr,
        &mut EvalOptions::default(),
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
            let base = state.get(var);
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
        ExprIR::And { args } => Ok(Value::Bool(
            args.iter()
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .collect::<Result<Vec<_>, _>>()?
                .iter()
                .all(|v| v.as_bool() == Some(true)),
        )),
        ExprIR::Or { args } => Ok(Value::Bool(
            args.iter()
                .map(|a| eval_expr_checked(compiled, state, a, options, allowed, property_name, context))
                .collect::<Result<Vec<_>, _>>()?
                .iter()
                .any(|v| v.as_bool() == Some(true)),
        )),
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
                crate::model::route_local_mounted(compiled, transition, state)
                    && guard_holds(compiled, transition, state),
            ))
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
