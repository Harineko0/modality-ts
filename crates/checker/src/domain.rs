use crate::model::{
    AbstractDomain, CompiledModel, InitialValue, Model, NumericOverflowPolicy, StateVarDecl,
    SystemVarRoleKind, UNMOUNTED,
};
use crate::mount;
use crate::state::ModelState;
use serde_json::{json, Value};
use std::collections::HashSet;

pub struct ValidationResult {
    pub ok: bool,
    pub errors: Vec<String>,
}

pub fn validate_model_with_options(model: &Model, sliced: bool) -> Result<(), String> {
    let result = validate_model_full(model, sliced);
    if result.ok {
        Ok(())
    } else {
        Err(result.errors.join("; "))
    }
}

pub fn validate_model_full(model: &Model, sliced: bool) -> ValidationResult {
    let mut errors = Vec::new();
    if model.schema_version != 1 {
        errors.push(format!(
            "Unsupported model schemaVersion {}",
            model.schema_version
        ));
    }
    validate_bounds(&mut errors, model);
    push_duplicates(
        &mut errors,
        "state var",
        &model.vars.iter().map(|v| v.id.clone()).collect::<Vec<_>>(),
    );
    push_duplicates(
        &mut errors,
        "transition",
        &model
            .transitions
            .iter()
            .map(|t| t.id.clone())
            .collect::<Vec<_>>(),
    );
    for decl in &model.vars {
        validate_decl(&mut errors, decl);
    }
    let vars_by_id: std::collections::HashMap<_, _> =
        model.vars.iter().map(|v| (v.id.as_str(), v)).collect();
    if sliced {
        validate_present_system_vars(&mut errors, &vars_by_id, model);
    } else {
        validate_system_vars(&mut errors, &vars_by_id, model);
    }
    let var_ids: HashSet<_> = model.vars.iter().map(|v| v.id.as_str()).collect();
    for transition in &model.transitions {
        validate_transition(&mut errors, transition, &var_ids, &vars_by_id, model);
    }
    ValidationResult {
        ok: errors.is_empty(),
        errors,
    }
}

fn validate_bounds(errors: &mut Vec<String>, model: &Model) {
    let b = &model.bounds;
    if b.max_internal_steps < 1 {
        errors.push("bounds.maxInternalSteps must be a positive integer".into());
    }
}

fn effect_reads(effect: &crate::model::EffectIR) -> Vec<String> {
    use crate::model::{EffectIR, ExprIR};
    let mut reads = HashSet::new();
    fn walk_expr(expr: &ExprIR, reads: &mut HashSet<String>) {
        match expr {
            ExprIR::Read { var, .. } => {
                reads.insert(var.clone());
            }
            ExprIR::Eq { args }
            | ExprIR::Neq { args }
            | ExprIR::And { args }
            | ExprIR::Or { args } => {
                for arg in args {
                    walk_expr(arg, reads);
                }
            }
            ExprIR::Not { args } => walk_expr(&args[0], reads),
            ExprIR::Cond { args } => {
                for arg in args {
                    walk_expr(arg, reads);
                }
            }
            ExprIR::UpdateField { target, value, .. } => {
                walk_expr(target, reads);
                walk_expr(value, reads);
            }
            ExprIR::TagIs { arg, .. } => walk_expr(arg, reads),
            ExprIR::LenCat { arg } => walk_expr(arg, reads),
            ExprIR::Lt { args }
            | ExprIR::Lte { args }
            | ExprIR::Gt { args }
            | ExprIR::Gte { args }
            | ExprIR::Add { args }
            | ExprIR::Sub { args }
            | ExprIR::Mod { args } => {
                for arg in args {
                    walk_expr(arg, reads);
                }
            }
            ExprIR::FreshToken { .. }
            | ExprIR::TransitionEnabled { .. }
            | ExprIR::TransitionEnabledPrefix { .. }
            | ExprIR::Lit { .. }
            | ExprIR::ReadPre { .. }
            | ExprIR::ReadOpArg { .. } => {}
        }
    }
    fn walk_effect(effect: &EffectIR, reads: &mut HashSet<String>) {
        match effect {
            EffectIR::Assign { expr, .. } => walk_expr(expr, reads),
            EffectIR::Havoc { .. } | EffectIR::Dequeue { .. } => {}
            EffectIR::Choose { among, .. } => {
                for expr in among {
                    walk_expr(expr, reads);
                }
            }
            EffectIR::If {
                cond,
                then,
                else_branch,
            } => {
                walk_expr(cond, reads);
                walk_effect(then, reads);
                walk_effect(else_branch, reads);
            }
            EffectIR::Seq { effects } => {
                for child in effects {
                    walk_effect(child, reads);
                }
            }
            EffectIR::Enqueue { args, .. } => {
                for expr in args.values() {
                    walk_expr(expr, reads);
                }
            }
            EffectIR::Opaque { r#ref } => {
                for read in &r#ref.declared_reads {
                    reads.insert(read.clone());
                }
            }
        }
    }
    walk_effect(effect, &mut reads);
    reads.into_iter().collect()
}

fn effect_writes_for_model(
    errors: &mut Vec<String>,
    model: &Model,
    effect: &crate::model::EffectIR,
    transition_id: &str,
) -> Vec<String> {
    use crate::model::EffectIR;
    let mut writes = HashSet::new();
    fn walk(
        effect: &EffectIR,
        writes: &mut HashSet<String>,
        errors: &mut Vec<String>,
        model: &Model,
        transition_id: &str,
    ) {
        match effect {
            EffectIR::Assign { var, .. }
            | EffectIR::Havoc { var }
            | EffectIR::Choose { var, .. } => {
                writes.insert(var.clone());
            }
            EffectIR::If {
                then, else_branch, ..
            } => {
                walk(then, writes, errors, model, transition_id);
                walk(else_branch, writes, errors, model, transition_id);
            }
            EffectIR::Seq { effects } => {
                for child in effects {
                    walk(child, writes, errors, model, transition_id);
                }
            }
            EffectIR::Enqueue { queue, .. } | EffectIR::Dequeue { queue, .. } => {
                match resolve_pending_queue_var(errors, model, queue.as_deref(), transition_id) {
                    Some(decl) => {
                        writes.insert(decl.id.clone());
                    }
                    None => {}
                }
            }
            EffectIR::Opaque { r#ref } => {
                for write in &r#ref.declared_writes {
                    writes.insert(write.clone());
                }
            }
        }
    }
    walk(effect, &mut writes, errors, model, transition_id);
    writes.into_iter().collect()
}

fn resolve_pending_queue_var<'a>(
    errors: &mut Vec<String>,
    model: &'a Model,
    explicit_queue: Option<&str>,
    context: &str,
) -> Option<&'a StateVarDecl> {
    let vars_by_id: std::collections::HashMap<_, _> =
        model.vars.iter().map(|v| (v.id.as_str(), v)).collect();
    if let Some(id) = explicit_queue {
        let Some(decl) = vars_by_id.get(id) else {
            errors.push(format!(
                "{context}: pending queue references unknown var {id}"
            ));
            return None;
        };
        if !decl
            .role
            .as_ref()
            .is_some_and(|role| role.kind == SystemVarRoleKind::PendingQueue)
        {
            errors.push(format!("{context}: {id} is not a pending-queue role var"));
            return None;
        }
        return Some(decl);
    }
    let queues: Vec<_> = model
        .vars
        .iter()
        .filter(|decl| {
            decl.role
                .as_ref()
                .is_some_and(|role| role.kind == SystemVarRoleKind::PendingQueue)
        })
        .collect();
    match queues.len() {
        0 => {
            errors.push(format!(
                "{context}: enqueue/dequeue requires a pending-queue role var"
            ));
            None
        }
        1 => Some(queues[0]),
        _ => {
            errors.push(format!(
                "{context}: enqueue/dequeue queue is ambiguous; specify queue explicitly"
            ));
            None
        }
    }
}

fn validate_system_vars(
    errors: &mut Vec<String>,
    vars_by_id: &std::collections::HashMap<&str, &StateVarDecl>,
    model: &Model,
) {
    for id in ["sys:route", "sys:history"] {
        if vars_by_id.get(id).is_none() {
            errors.push(format!("Missing required system var {id}"));
        }
    }
    validate_system_shapes(errors, vars_by_id, model);
    validate_pending_queue_roles(errors, model);
}

fn validate_present_system_vars(
    errors: &mut Vec<String>,
    vars_by_id: &std::collections::HashMap<&str, &StateVarDecl>,
    model: &Model,
) {
    validate_system_shapes(errors, vars_by_id, model);
    validate_pending_queue_roles(errors, model);
}

fn validate_pending_queue_roles(errors: &mut Vec<String>, model: &Model) {
    for decl in &model.vars {
        if !decl
            .role
            .as_ref()
            .is_some_and(|role| role.kind == SystemVarRoleKind::PendingQueue)
        {
            continue;
        }
        validate_pending_queue_decl(errors, decl, model);
    }
}

fn validate_pending_queue_decl(
    errors: &mut Vec<String>,
    decl: &StateVarDecl,
    model: &Model,
) {
    if decl.origin != json!("system") {
        errors.push(format!("{} must have system origin", decl.id));
    }
    if !matches!(decl.scope, crate::model::Scope::Global) {
        errors.push(format!("{} must have global scope", decl.id));
    }
    match &decl.domain {
        AbstractDomain::BoundedList { max_len, inner } => {
            if *max_len != model.bounds.max_pending {
                errors.push(format!(
                    "{} maxLen must match bounds.maxPending",
                    decl.id
                ));
            }
            validate_pending_op_domain(errors, &decl.id, inner);
        }
        _ => errors.push(format!("{} must use a boundedList domain", decl.id)),
    }
}

fn validate_pending_op_domain(
    errors: &mut Vec<String>,
    var_id: &str,
    domain: &AbstractDomain,
) {
    let AbstractDomain::Record { fields } = domain else {
        errors.push(format!("{var_id} items must use a record domain"));
        return;
    };
    let op_id = fields.get("opId");
    let continuation = fields.get("continuation");
    let args = fields.get("args");
    if op_id.is_none() {
        errors.push(format!("{var_id} item domain missing opId"));
    } else if !matches!(op_id, Some(AbstractDomain::Enum { .. })) {
        errors.push(format!("{var_id} opId must use an enum domain"));
    }
    if continuation.is_none() {
        errors.push(format!("{var_id} item domain missing continuation"));
    } else if !matches!(continuation, Some(AbstractDomain::Enum { .. })) {
        errors.push(format!("{var_id} continuation must use an enum domain"));
    }
    if args.is_none() {
        errors.push(format!("{var_id} item domain missing args"));
    } else if !matches!(args, Some(AbstractDomain::Record { .. })) {
        errors.push(format!("{var_id} args must use a record domain"));
    }
}

fn validate_system_shapes(
    errors: &mut Vec<String>,
    vars_by_id: &std::collections::HashMap<&str, &StateVarDecl>,
    _model: &Model,
) {
    if let Some(route) = vars_by_id.get("sys:route") {
        if !matches!(route.domain, AbstractDomain::Enum { .. }) {
            errors.push("sys:route must use an enum domain".into());
        }
    }
}

fn validate_decl(errors: &mut Vec<String>, decl: &StateVarDecl) {
    let initials = initial_values(&decl.domain, &decl.initial);
    if initials.is_empty() {
        errors.push(format!("{}: initial must not be empty", decl.id));
    }
    for value in &initials {
        if !validate_value(&decl.domain, value) {
            errors.push(format!(
                "{}: invalid initial {}",
                decl.id,
                serde_json::to_string(value).unwrap_or_default()
            ));
        }
    }
}

fn validate_transition(
    errors: &mut Vec<String>,
    transition: &crate::model::Transition,
    var_ids: &HashSet<&str>,
    vars_by_id: &std::collections::HashMap<&str, &StateVarDecl>,
    model: &Model,
) {
    let declared_reads: HashSet<_> = transition.reads.iter().map(|s| s.as_str()).collect();
    let declared_writes: HashSet<_> = transition.writes.iter().map(|s| s.as_str()).collect();
    for id in transition.reads.iter().chain(transition.writes.iter()) {
        if !var_ids.contains(id.as_str()) {
            errors.push(format!("{}: references unknown var {id}", transition.id));
        }
    }
    for read in effect_reads(&transition.effect) {
        if !declared_reads.contains(read.as_str()) {
            errors.push(format!(
                "{}: effect reads {read} but reads does not declare it",
                transition.id
            ));
        }
    }
    for write in effect_writes_for_model(errors, model, &transition.effect, &transition.id) {
        if !declared_writes.contains(write.as_str()) {
            errors.push(format!(
                "{}: effect writes {write} but writes does not declare it",
                transition.id
            ));
        }
    }
    validate_effect_queues(errors, model, &transition.effect, &transition.id);
    let _ = vars_by_id;
}

fn validate_effect_queues(
    errors: &mut Vec<String>,
    model: &Model,
    effect: &crate::model::EffectIR,
    transition_id: &str,
) {
    use crate::model::EffectIR;
    match effect {
        EffectIR::Enqueue { queue, .. } | EffectIR::Dequeue { queue, .. } => {
            resolve_pending_queue_var(errors, model, queue.as_deref(), transition_id);
        }
        EffectIR::If {
            then, else_branch, ..
        } => {
            validate_effect_queues(errors, model, then, transition_id);
            validate_effect_queues(errors, model, else_branch, transition_id);
        }
        EffectIR::Seq { effects } => {
            for child in effects {
                validate_effect_queues(errors, model, child, transition_id);
            }
        }
        _ => {}
    }
}

fn push_duplicates(errors: &mut Vec<String>, kind: &str, ids: &[String]) {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id.clone()) {
            errors.push(format!("Duplicate {kind} id {id}"));
        }
    }
}

pub fn initial_values(domain: &AbstractDomain, initial: &InitialValue) -> Vec<Value> {
    match initial {
        InitialValue::Single(v) => {
            if let Value::Array(arr) = v {
                if !matches!(domain, AbstractDomain::BoundedList { .. }) {
                    return arr.clone();
                }
            }
            vec![v.clone()]
        }
        InitialValue::Many(v) => v.clone(),
    }
}

pub fn enumerate_domain(domain: &AbstractDomain) -> Vec<Value> {
    match domain {
        AbstractDomain::Bool => vec![json!(false), json!(true)],
        AbstractDomain::Enum { values } => values.iter().map(|v| json!(v)).collect(),
        AbstractDomain::BoundedInt { min, max, .. } => (*min..=*max).map(|n| json!(n)).collect(),
        AbstractDomain::IntSet { values, .. } => values.iter().map(|n| json!(n)).collect(),
        AbstractDomain::Option { inner } => {
            let mut out = vec![Value::Null];
            out.extend(enumerate_domain(inner));
            out
        }
        AbstractDomain::Record { fields } => {
            let entries: Vec<_> = sorted_fields(fields);
            cartesian(entries.iter().map(|(_, d)| enumerate_domain(d)).collect())
                .into_iter()
                .map(|values| {
                    let mut obj = serde_json::Map::new();
                    for (i, (key, _)) in entries.iter().enumerate() {
                        if let Some(v) = values.get(i) {
                            obj.insert((*key).clone(), v.clone());
                        }
                    }
                    Value::Object(obj)
                })
                .collect()
        }
        AbstractDomain::Tagged { tag, variants } => {
            let mut out = Vec::new();
            let mut variant_keys: Vec<_> = variants.keys().collect();
            variant_keys.sort();
            for tag_value in variant_keys {
                let record_domain = &variants[tag_value];
                if let AbstractDomain::Record { fields } = record_domain {
                    for v in enumerate_domain(&AbstractDomain::Record {
                        fields: fields.clone(),
                    }) {
                        if let Value::Object(mut obj) = v {
                            obj.insert(tag.clone(), json!(tag_value));
                            out.push(Value::Object(obj));
                        }
                    }
                }
            }
            out
        }
        AbstractDomain::Tokens { count, names } => token_names(*count, names.as_deref())
            .into_iter()
            .map(|n| json!(n))
            .collect(),
        AbstractDomain::LengthCat => vec![json!("0"), json!("1"), json!("many")],
        AbstractDomain::BoundedList { inner, max_len } => {
            let items = enumerate_domain(inner);
            let mut lists = vec![json!([])];
            for len in 1..=*max_len {
                for combo in cartesian(vec![items.clone(); len as usize]) {
                    lists.push(Value::Array(combo));
                }
            }
            lists
        }
    }
}

pub fn token_names(count: u32, names: Option<&[String]>) -> Vec<String> {
    if let Some(names) = names {
        names.to_vec()
    } else {
        (1..=count).map(|i| format!("tok{i}")).collect()
    }
}

pub fn validate_value(domain: &AbstractDomain, value: &Value) -> bool {
    if value == &Value::String(UNMOUNTED.into()) {
        return true;
    }
    match domain {
        AbstractDomain::Bool => value.is_boolean(),
        AbstractDomain::Enum { values } => value
            .as_str()
            .is_some_and(|s| values.contains(&s.to_string())),
        AbstractDomain::BoundedInt { min, max, .. } => {
            value.as_i64().is_some_and(|n| n >= *min && n <= *max)
        }
        AbstractDomain::IntSet { values, .. } => {
            value.as_i64().is_some_and(|n| values.contains(&n))
        }
        AbstractDomain::Option { inner } => value.is_null() || validate_value(inner, value),
        AbstractDomain::Record { fields } => {
            if let Value::Object(obj) = value {
                fields
                    .iter()
                    .all(|(k, d)| obj.get(k).is_some_and(|v| validate_value(d, v)))
            } else {
                false
            }
        }
        AbstractDomain::Tagged { tag, variants } => {
            if let Value::Object(obj) = value {
                if let Some(Value::String(tag_val)) = obj.get(tag) {
                    variants
                        .get(tag_val)
                        .is_some_and(|d| validate_value(d, value))
                } else {
                    false
                }
            } else {
                false
            }
        }
        AbstractDomain::Tokens { count, names } => {
            if let Some(s) = value.as_str() {
                token_names(*count, names.as_deref()).contains(&s.to_string())
            } else {
                false
            }
        }
        AbstractDomain::LengthCat => {
            matches!(value.as_str(), Some("0") | Some("1") | Some("many"))
        }
        AbstractDomain::BoundedList { inner, max_len } => {
            if let Value::Array(arr) = value {
                arr.len() <= *max_len as usize && arr.iter().all(|v| validate_value(inner, v))
            } else {
                false
            }
        }
    }
}

pub fn domain_at_path(domain: &AbstractDomain, path: &[String]) -> Option<AbstractDomain> {
    let mut current = domain.clone();
    for segment in path {
        loop {
            if let AbstractDomain::Option { inner } = &current {
                current = (**inner).clone();
            } else {
                break;
            }
        }
        current = match current {
            AbstractDomain::Record { fields } => fields.get(segment)?.clone(),
            AbstractDomain::BoundedList { inner, max_len } => {
                if !segment.chars().all(|c| c.is_ascii_digit()) {
                    return None;
                }
                let index: usize = segment.parse().ok()?;
                if index >= max_len as usize {
                    return None;
                }
                (*inner).clone()
            }
            AbstractDomain::Tagged {
                tag: tag_field,
                variants,
            } => {
                if segment == tag_field.as_str() {
                    AbstractDomain::Enum {
                        values: variants.keys().cloned().collect(),
                    }
                } else {
                    return None;
                }
            }
            _ => return None,
        };
    }
    Some(current)
}

pub fn numeric_overflow_policy(domain: &AbstractDomain) -> NumericOverflowPolicy {
    match domain {
        AbstractDomain::BoundedInt { overflow, .. } | AbstractDomain::IntSet { overflow, .. } => {
            overflow.clone().unwrap_or(NumericOverflowPolicy::Forbid)
        }
        _ => NumericOverflowPolicy::Forbid,
    }
}

pub enum NumericAssignOutcome {
    Value(i64),
    Forbid(String),
}

pub fn apply_numeric_assign(domain: &AbstractDomain, raw_value: i64) -> NumericAssignOutcome {
    match domain {
        AbstractDomain::BoundedInt { min, max, .. } => {
            apply_numeric_policy(numeric_overflow_policy(domain), raw_value, *min, *max, None)
        }
        AbstractDomain::IntSet { values, .. } => {
            if values.is_empty() {
                return NumericAssignOutcome::Forbid("empty intSet domain".into());
            }
            let min = *values.first().unwrap();
            let max = *values.last().unwrap();
            apply_numeric_policy(
                numeric_overflow_policy(domain),
                raw_value,
                min,
                max,
                Some(values),
            )
        }
        _ => NumericAssignOutcome::Value(raw_value),
    }
}

fn apply_numeric_policy(
    policy: NumericOverflowPolicy,
    raw_value: i64,
    min: i64,
    max: i64,
    int_set: Option<&[i64]>,
) -> NumericAssignOutcome {
    if let Some(values) = int_set {
        if values.contains(&raw_value) {
            return NumericAssignOutcome::Value(raw_value);
        }
        return match policy {
            NumericOverflowPolicy::Forbid => {
                NumericAssignOutcome::Forbid(format!("numeric value {raw_value} outside intSet"))
            }
            NumericOverflowPolicy::Wrap => {
                let len = values.len() as i64;
                if len == 0 {
                    return NumericAssignOutcome::Forbid("empty intSet domain".into());
                }
                let index = raw_value.rem_euclid(len) as usize;
                NumericAssignOutcome::Value(values[index])
            }
            NumericOverflowPolicy::Saturate => {
                NumericAssignOutcome::Value(if raw_value <= min { min } else { max })
            }
        };
    }

    if raw_value >= min && raw_value <= max {
        return NumericAssignOutcome::Value(raw_value);
    }
    match policy {
        NumericOverflowPolicy::Forbid => NumericAssignOutcome::Forbid(format!(
            "numeric overflow {raw_value} outside [{min},{max}]"
        )),
        NumericOverflowPolicy::Wrap => {
            let span = max - min + 1;
            if span <= 0 {
                return NumericAssignOutcome::Forbid("invalid boundedInt span".into());
            }
            NumericAssignOutcome::Value(min + raw_value.rem_euclid(span))
        }
        NumericOverflowPolicy::Saturate => {
            NumericAssignOutcome::Value(if raw_value < min { min } else { max })
        }
    }
}

fn sorted_fields(
    fields: &std::collections::HashMap<String, AbstractDomain>,
) -> Vec<(String, AbstractDomain)> {
    let mut entries: Vec<_> = fields.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

fn cartesian<T: Clone>(sets: Vec<Vec<T>>) -> Vec<Vec<T>> {
    sets.into_iter().fold(vec![vec![]], |acc, set| {
        acc.into_iter()
            .flat_map(|prefix| {
                set.iter()
                    .map(|item| {
                        let mut next = prefix.clone();
                        next.push(item.clone());
                        next
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    })
}

pub fn initial_states(compiled: &CompiledModel) -> Vec<ModelState> {
    let n = compiled.model.vars.len();
    let mut states = vec![ModelState::new(vec![Value::Null; n])];
    for (var_idx, decl) in compiled.model.vars.iter().enumerate() {
        let initials = initial_values(&decl.domain, &decl.initial);
        let mut next = Vec::new();
        for state in states {
            for value in &initials {
                let mut s = state.clone();
                s.values[var_idx] = value.clone();
                next.push(s);
            }
        }
        states = next;
    }
    states
        .into_iter()
        .flat_map(|s| mount::normalize_initial_mount_locals(compiled, s))
        .collect()
}

pub fn initial_changed_var_indexes(compiled: &CompiledModel) -> HashSet<usize> {
    (0..compiled.model.vars.len()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Bounds, Scope};
    use serde_json::json;

    fn minimal_decl(id: &str, domain: AbstractDomain, initial: Value) -> StateVarDecl {
        StateVarDecl {
            id: id.into(),
            domain,
            origin: json!("system"),
            scope: Scope::Global,
            initial: InitialValue::Single(initial),
            role: None,
        }
    }

    fn minimal_model(vars: Vec<StateVarDecl>) -> Model {
        Model {
            schema_version: 1,
            id: "m".into(),
            vars,
            transitions: vec![],
            bounds: Bounds {
                max_depth: 1,
                max_pending: 0,
                max_internal_steps: 1,
            },
            metadata: None,
        }
    }

    fn with_system_vars(extra: Vec<StateVarDecl>) -> Model {
        let mut vars = vec![
            minimal_decl(
                "sys:route",
                AbstractDomain::Enum {
                    values: vec!["/".into()],
                },
                json!("/"),
            ),
            minimal_decl(
                "sys:history",
                AbstractDomain::BoundedList {
                    inner: Box::new(AbstractDomain::Enum {
                        values: vec!["/".into()],
                    }),
                    max_len: 0,
                },
                json!([]),
            ),
        ];
        vars.extend(extra);
        minimal_model(vars)
    }

    #[test]
    fn enumerate_domain_covers_bool_and_enum() {
        assert_eq!(
            enumerate_domain(&AbstractDomain::Bool),
            vec![json!(false), json!(true)]
        );
        assert_eq!(
            enumerate_domain(&AbstractDomain::Enum {
                values: vec!["a".into(), "b".into()]
            }),
            vec![json!("a"), json!("b")]
        );
    }

    #[test]
    fn enumerate_record_uses_schema_order() {
        let mut fields = std::collections::HashMap::new();
        fields.insert("b".into(), AbstractDomain::Bool);
        fields.insert("a".into(), AbstractDomain::Bool);
        let values = enumerate_domain(&AbstractDomain::Record { fields });
        assert_eq!(values.len(), 4);
        assert!(values
            .iter()
            .all(|value| { value.as_object().and_then(|obj| obj.get("a")).is_some() }));
    }

    #[test]
    fn validate_rejects_invalid_initial() {
        let model = with_system_vars(vec![minimal_decl("x", AbstractDomain::Bool, json!("nope"))]);
        let result = validate_model_full(&model, false);
        assert!(!result.ok);
        assert!(result.errors.iter().any(|e| e.contains("invalid initial")));
    }

    #[test]
    fn int_set_enumeration_and_membership() {
        let domain = AbstractDomain::IntSet {
            values: vec![0, 2],
            overflow: None,
        };
        assert_eq!(enumerate_domain(&domain), vec![json!(0), json!(2)]);
        assert!(validate_value(&domain, &json!(2)));
        assert!(!validate_value(&domain, &json!(1)));
    }

    #[test]
    fn apply_numeric_assign_wrap_and_saturate() {
        let bounded = AbstractDomain::BoundedInt {
            min: 0,
            max: 3,
            overflow: Some(crate::model::NumericOverflowPolicy::Wrap),
        };
        assert!(matches!(
            apply_numeric_assign(&bounded, 4),
            NumericAssignOutcome::Value(0)
        ));
        let saturated = AbstractDomain::BoundedInt {
            min: 0,
            max: 3,
            overflow: Some(crate::model::NumericOverflowPolicy::Saturate),
        };
        assert!(matches!(
            apply_numeric_assign(&saturated, 5),
            NumericAssignOutcome::Value(3)
        ));
    }
}
