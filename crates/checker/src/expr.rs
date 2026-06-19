use crate::domain::domain_at_path;
use crate::model::{transition_locals_mounted, AbstractDomain, CompiledModel, ExprIR};
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
            Value::Bool(transition_is_enabled(compiled, transition, state))
        }
        ExprIR::TransitionEnabledPrefix { prefix } => {
            Value::Bool(any_transition_enabled_with_prefix(compiled, state, prefix))
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
        ExprIR::Lt { args } => eval_comparison(compiled, state, args, options, |l, r| l < r),
        ExprIR::Lte { args } => eval_comparison(compiled, state, args, options, |l, r| l <= r),
        ExprIR::Gt { args } => eval_comparison(compiled, state, args, options, |l, r| l > r),
        ExprIR::Gte { args } => eval_comparison(compiled, state, args, options, |l, r| l >= r),
        ExprIR::Add { args } => eval_binary_int(compiled, state, args, options, |l, r| l + r),
        ExprIR::Sub { args } => eval_binary_int(compiled, state, args, options, |l, r| l - r),
        ExprIR::Mod { args } => {
            let left = args
                .first()
                .map(|a| eval_expr(compiled, state, a, options))
                .and_then(|v| as_integer(&v));
            let right = args
                .get(1)
                .map(|a| eval_expr(compiled, state, a, options))
                .and_then(|v| as_integer(&v));
            match (left, right) {
                (Some(l), Some(r)) if r != 0 => json!(l.rem_euclid(r)),
                _ => Value::Null,
            }
        }
    }
}

pub fn mount_guard_holds(
    compiled: &CompiledModel,
    state: &ModelState,
    guard: &ExprIR,
) -> bool {
    eval_expr(
        compiled,
        state,
        guard,
        &mut EvalOptions::default(),
    )
    .as_bool()
    .unwrap_or(false)
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

fn expr_read_vars(expr: &ExprIR, out: &mut std::collections::HashSet<String>) {
    match expr {
        ExprIR::Read { var, .. } => {
            out.insert(var.clone());
        }
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
                expr_read_vars(arg, out);
            }
        }
        ExprIR::UpdateField { target, value, .. } => {
            expr_read_vars(target, out);
            expr_read_vars(value, out);
        }
        ExprIR::TagIs { arg, .. } | ExprIR::LenCat { arg } => {
            expr_read_vars(arg, out);
        }
        ExprIR::FreshToken { domain_of } => {
            out.insert(domain_of.clone());
        }
        ExprIR::Lit { .. }
        | ExprIR::TransitionEnabled { .. }
        | ExprIR::TransitionEnabledPrefix { .. }
        | ExprIR::ReadPre { .. }
        | ExprIR::ReadOpArg { .. } => {}
    }
}

fn enabledness_read_vars(
    compiled: &CompiledModel,
    transition_idx: usize,
) -> std::collections::HashSet<String> {
    let transition = compiled.transition(transition_idx);
    let mut vars = std::collections::HashSet::new();
    expr_read_vars(&transition.guard, &mut vars);
    for &var_idx in &compiled.transitions[transition_idx].mount_local_var_indexes {
        if let Some(guard) = &compiled.vars[var_idx].mount_guard {
            expr_read_vars(guard, &mut vars);
        }
    }
    loop {
        let before = vars.len();
        for (idx, compiled_var) in compiled.vars.iter().enumerate() {
            if compiled_var.mount_guard.is_none() {
                continue;
            }
            let var_id = &compiled.model.vars[idx].id;
            if !vars.contains(var_id) {
                continue;
            }
            if let Some(guard) = &compiled_var.mount_guard {
                expr_read_vars(guard, &mut vars);
            }
        }
        if vars.len() == before {
            break;
        }
    }
    vars
}

fn transition_is_enabled(
    compiled: &CompiledModel,
    transition: &crate::model::Transition,
    state: &ModelState,
) -> bool {
    let Some(&idx) = compiled.transition_index.get(&transition.id) else {
        return false;
    };
    transition_locals_mounted(compiled, idx, state) && guard_holds(compiled, transition, state)
}

fn any_transition_enabled_with_prefix(
    compiled: &CompiledModel,
    state: &ModelState,
    prefix: &str,
) -> bool {
    compiled
        .sorted_transitions
        .iter()
        .filter(|transition| transition.id.starts_with(prefix))
        .any(|transition| transition_is_enabled(compiled, transition, state))
}

fn transitions_matching_prefix<'a>(
    compiled: &'a CompiledModel,
    prefix: &str,
) -> Vec<&'a crate::model::Transition> {
    compiled
        .sorted_transitions
        .iter()
        .filter(|transition| transition.id.starts_with(prefix))
        .collect()
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
        ExprIR::Lit { value } => literal_domain(value),
        ExprIR::Lt { .. }
        | ExprIR::Lte { .. }
        | ExprIR::Gt { .. }
        | ExprIR::Gte { .. } => Some(AbstractDomain::Bool),
        ExprIR::Add { args }
        | ExprIR::Sub { args }
        | ExprIR::Mod { args } => infer_arithmetic_domain(compiled, expr, args),
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

fn as_integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|n| n.fract() == 0.0)
            .map(|n| n as i64)
    })
}

fn eval_comparison(
    compiled: &CompiledModel,
    state: &ModelState,
    args: &[ExprIR],
    options: &mut EvalOptions,
    cmp: fn(i64, i64) -> bool,
) -> Value {
    let left = args
        .first()
        .map(|a| eval_expr(compiled, state, a, options))
        .and_then(|v| as_integer(&v));
    let right = args
        .get(1)
        .map(|a| eval_expr(compiled, state, a, options))
        .and_then(|v| as_integer(&v));
    Value::Bool(match (left, right) {
        (Some(l), Some(r)) => cmp(l, r),
        _ => false,
    })
}

fn eval_binary_int(
    compiled: &CompiledModel,
    state: &ModelState,
    args: &[ExprIR],
    options: &mut EvalOptions,
    op: fn(i64, i64) -> i64,
) -> Value {
    let left = args
        .first()
        .map(|a| eval_expr(compiled, state, a, options))
        .and_then(|v| as_integer(&v));
    let right = args
        .get(1)
        .map(|a| eval_expr(compiled, state, a, options))
        .and_then(|v| as_integer(&v));
    match (left, right) {
        (Some(l), Some(r)) => json!(op(l, r)),
        _ => Value::Null,
    }
}

fn eval_comparison_checked(
    compiled: &CompiledModel,
    state: &ModelState,
    args: &[ExprIR],
    options: &mut EvalOptions,
    allowed: &std::collections::HashSet<String>,
    property_name: &str,
    context: &str,
    cmp: fn(i64, i64) -> bool,
) -> Result<Value, String> {
    let left = args
        .first()
        .map(|a| {
            eval_expr_checked(
                compiled,
                state,
                a,
                options,
                allowed,
                property_name,
                context,
            )
        })
        .transpose()?
        .and_then(|v| as_integer(&v));
    let right = args
        .get(1)
        .map(|a| {
            eval_expr_checked(
                compiled,
                state,
                a,
                options,
                allowed,
                property_name,
                context,
            )
        })
        .transpose()?
        .and_then(|v| as_integer(&v));
    Ok(Value::Bool(match (left, right) {
        (Some(l), Some(r)) => cmp(l, r),
        _ => false,
    }))
}

fn eval_binary_int_checked(
    compiled: &CompiledModel,
    state: &ModelState,
    args: &[ExprIR],
    options: &mut EvalOptions,
    allowed: &std::collections::HashSet<String>,
    property_name: &str,
    context: &str,
    op: fn(i64, i64) -> i64,
) -> Result<Value, String> {
    let left = args
        .first()
        .map(|a| {
            eval_expr_checked(
                compiled,
                state,
                a,
                options,
                allowed,
                property_name,
                context,
            )
        })
        .transpose()?
        .and_then(|v| as_integer(&v));
    let right = args
        .get(1)
        .map(|a| {
            eval_expr_checked(
                compiled,
                state,
                a,
                options,
                allowed,
                property_name,
                context,
            )
        })
        .transpose()?
        .and_then(|v| as_integer(&v));
    Ok(match (left, right) {
        (Some(l), Some(r)) => json!(op(l, r)),
        _ => Value::Null,
    })
}

const MAX_INFERRED_INT_SET_PRODUCT: usize = 64;

fn literal_domain(value: &Value) -> Option<AbstractDomain> {
    as_integer(value).map(|n| AbstractDomain::BoundedInt {
        min: n,
        max: n,
        overflow: None,
    })
}

fn infer_arithmetic_domain(
    compiled: &CompiledModel,
    kind: &ExprIR,
    args: &[ExprIR],
) -> Option<AbstractDomain> {
    let left = args.first().and_then(|arg| domain_for_expr(compiled, arg))?;
    let right = args.get(1).and_then(|arg| domain_for_expr(compiled, arg))?;
    let left_values = numeric_domain_values(&left)?;
    let right_values = numeric_domain_values(&right)?;
    if left_values.len() * right_values.len() > MAX_INFERRED_INT_SET_PRODUCT {
        return conservative_arithmetic_range(kind, &left, &right);
    }
    let mut results = std::collections::BTreeSet::new();
    for l in &left_values {
        for r in &right_values {
            if let Some(value) = apply_arithmetic(kind, *l, *r) {
                results.insert(value);
            }
        }
    }
    if results.is_empty() {
        return None;
    }
    let sorted: Vec<i64> = results.into_iter().collect();
    if sorted.len() == (sorted[sorted.len() - 1] - sorted[0] + 1) as usize {
        return Some(AbstractDomain::BoundedInt {
            min: sorted[0],
            max: sorted[sorted.len() - 1],
            overflow: None,
        });
    }
    Some(AbstractDomain::IntSet {
        values: sorted,
        overflow: None,
    })
}

fn numeric_domain_values(domain: &AbstractDomain) -> Option<Vec<i64>> {
    match domain {
        AbstractDomain::BoundedInt { min, max, .. } => {
            if (*max - *min + 1) as usize > MAX_INFERRED_INT_SET_PRODUCT {
                return None;
            }
            Some((*min..=*max).collect())
        }
        AbstractDomain::IntSet { values, .. } => Some(values.clone()),
        _ => None,
    }
}

fn conservative_arithmetic_range(
    kind: &ExprIR,
    left: &AbstractDomain,
    right: &AbstractDomain,
) -> Option<AbstractDomain> {
    let (l_min, l_max) = bounded_domain_range(left)?;
    let (r_min, r_max) = bounded_domain_range(right)?;
    match kind {
        ExprIR::Add { .. } => Some(AbstractDomain::BoundedInt {
            min: l_min + r_min,
            max: l_max + r_max,
            overflow: None,
        }),
        ExprIR::Sub { .. } => Some(AbstractDomain::BoundedInt {
            min: l_min - r_max,
            max: l_max - r_min,
            overflow: None,
        }),
        ExprIR::Mod { .. } => {
            let divisor = positive_literal_or_range_max(right)?;
            if divisor > 0 {
                Some(AbstractDomain::BoundedInt {
                    min: 0,
                    max: divisor - 1,
                    overflow: None,
                })
            } else {
                None
            }
        }
        _ => None,
    }
}

fn bounded_domain_range(domain: &AbstractDomain) -> Option<(i64, i64)> {
    match domain {
        AbstractDomain::BoundedInt { min, max, .. } => Some((*min, *max)),
        AbstractDomain::IntSet { values, .. } if !values.is_empty() => {
            Some((*values.first().unwrap(), *values.last().unwrap()))
        }
        _ => None,
    }
}

fn positive_literal_or_range_max(domain: &AbstractDomain) -> Option<i64> {
    match domain {
        AbstractDomain::BoundedInt { min, max, .. } if *min == *max && *min > 0 => Some(*min),
        AbstractDomain::BoundedInt { min, max, .. } if *min > 0 => Some(*max),
        AbstractDomain::IntSet { values, .. } => {
            if values.iter().all(|value| *value > 0) && !values.is_empty() {
                Some(*values.iter().max().unwrap())
            } else {
                None
            }
        }
        _ => None,
    }
}

fn apply_arithmetic(kind: &ExprIR, left: i64, right: i64) -> Option<i64> {
    match kind {
        ExprIR::Add { .. } => Some(left + right),
        ExprIR::Sub { .. } => Some(left - right),
        ExprIR::Mod { .. } if right != 0 => Some(left.rem_euclid(right)),
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
            for var in enabledness_read_vars(compiled, idx) {
                if !allowed.contains(&var) {
                    return Err(format!(
                        "{property_name}: {context} read undeclared var {var}"
                    ));
                }
            }
            Ok(Value::Bool(transition_is_enabled(compiled, transition, state)))
        }
        ExprIR::TransitionEnabledPrefix { prefix } => {
            let mut saw_match = false;
            for transition in transitions_matching_prefix(compiled, prefix) {
                saw_match = true;
                let Some(&idx) = compiled.transition_index.get(&transition.id) else {
                    continue;
                };
                for var in enabledness_read_vars(compiled, idx) {
                    if !allowed.contains(&var) {
                        return Err(format!(
                            "{property_name}: {context} read undeclared var {var}"
                        ));
                    }
                }
            }
            if !saw_match {
                return Ok(Value::Bool(false));
            }
            Ok(Value::Bool(any_transition_enabled_with_prefix(
                compiled, state, prefix,
            )))
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
        ExprIR::Lt { args } => Ok(eval_comparison_checked(
            compiled, state, args, options, allowed, property_name, context, |l, r| l < r,
        )?),
        ExprIR::Lte { args } => Ok(eval_comparison_checked(
            compiled, state, args, options, allowed, property_name, context, |l, r| l <= r,
        )?),
        ExprIR::Gt { args } => Ok(eval_comparison_checked(
            compiled, state, args, options, allowed, property_name, context, |l, r| l > r,
        )?),
        ExprIR::Gte { args } => Ok(eval_comparison_checked(
            compiled, state, args, options, allowed, property_name, context, |l, r| l >= r,
        )?),
        ExprIR::Add { args } => eval_binary_int_checked(
            compiled, state, args, options, allowed, property_name, context, |l, r| l + r,
        ),
        ExprIR::Sub { args } => eval_binary_int_checked(
            compiled, state, args, options, allowed, property_name, context, |l, r| l - r,
        ),
        ExprIR::Mod { args } => {
            let left = args
                .first()
                .map(|a| {
                    eval_expr_checked(
                        compiled,
                        state,
                        a,
                        options,
                        allowed,
                        property_name,
                        context,
                    )
                })
                .transpose()?
                .and_then(|v| as_integer(&v));
            let right = args
                .get(1)
                .map(|a| {
                    eval_expr_checked(
                        compiled,
                        state,
                        a,
                        options,
                        allowed,
                        property_name,
                        context,
                    )
                })
                .transpose()?
                .and_then(|v| as_integer(&v));
            match (left, right) {
                (Some(l), Some(r)) if r != 0 => Ok(json!(l.rem_euclid(r))),
                _ => Ok(Value::Null),
            }
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
                allowed.extend(enabledness_read_vars(compiled, idx));
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
                        id: "x".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(initial.clone()),

                        role: None,
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

    fn compiled_with_count(initial: i64) -> (CompiledModel, ModelState) {
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
                        domain: AbstractDomain::BoundedInt {
                            min: 0,
                            max: 3,
                            overflow: None,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(initial)),

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
        let mut state = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        let count = *compiled.var_index.get("count").unwrap();
        state.values[count] = json!(initial);
        (compiled, state)
    }

    #[test]
    fn numeric_comparison_and_arithmetic_eval() {
        let (compiled, state) = compiled_with_count(2);
        let lt = ExprIR::Lt {
            args: vec![
                ExprIR::Read {
                    var: "count".into(),
                    path: None,
                },
                ExprIR::Lit { value: json!(3) },
            ],
        };
        assert_eq!(
            eval_expr(&compiled, &state, &lt, &mut EvalOptions::default()),
            json!(true)
        );
        let add = ExprIR::Add {
            args: vec![
                ExprIR::Read {
                    var: "count".into(),
                    path: None,
                },
                ExprIR::Lit { value: json!(1) },
            ],
        };
        assert_eq!(
            eval_expr(&compiled, &state, &add, &mut EvalOptions::default()),
            json!(3)
        );
        let modulo = ExprIR::Mod {
            args: vec![
                ExprIR::Lit { value: json!(7) },
                ExprIR::Lit { value: json!(3) },
            ],
        };
        assert_eq!(
            eval_expr(&compiled, &state, &modulo, &mut EvalOptions::default()),
            json!(1)
        );
    }

    #[test]
    fn mod_by_zero_returns_null() {
        let (compiled, state) = compiled_with_count(0);
        let modulo = ExprIR::Mod {
            args: vec![
                ExprIR::Lit { value: json!(1) },
                ExprIR::Lit { value: json!(0) },
            ],
        };
        assert_eq!(
            eval_expr(&compiled, &state, &modulo, &mut EvalOptions::default()),
            Value::Null
        );
    }

    #[test]
    fn arithmetic_domain_inference_dense_range() {
        let (compiled, _) = compiled_with_count(1);
        let expr = ExprIR::Add {
            args: vec![
                ExprIR::Read {
                    var: "count".into(),
                    path: None,
                },
                ExprIR::Lit { value: json!(1) },
            ],
        };
        let domain = domain_for_expr(&compiled, &expr).unwrap();
        assert!(matches!(
            domain,
            AbstractDomain::BoundedInt { min: 1, max: 4, .. }
        ));
    }

    #[test]
    fn allowed_reads_for_enabled_transition_excludes_effect_writes() {
        let (compiled, _) = compiled_with_x(json!(false));
        let allowed = allowed_reads(Some(&[]), Some(&["t".into()]), &compiled);
        assert!(!allowed.contains("x"));
        assert!(allowed.is_empty());
    }

    #[test]
    fn transition_enabled_checked_eval_accepts_narrow_enabledness_reads() {
        let (compiled, state) = compiled_with_x(json!(false));
        let expr = ExprIR::TransitionEnabled {
            transition_id: "t".into(),
        };
        let allowed = allowed_reads(Some(&[]), Some(&["t".into()]), &compiled);
        let value = eval_expr_checked(
            &compiled,
            &state,
            &expr,
            &mut EvalOptions::default(),
            &allowed,
            "p",
            "predicate",
        )
        .expect("narrow enabledness reads should satisfy checked evaluation");
        assert_eq!(value, json!(true));
    }
}
