use crate::effect::read_pending;
use crate::model::{CompiledModel, EffectIR, Transition};
use crate::state::{values_equal, ModelState};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct PendingOp {
    pub op_id: String,
    pub continuation: String,
    pub args: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct StepOp {
    pub id: String,
    pub continuation: String,
    pub args: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone)]
pub struct StepFacts {
    pub transition: Transition,
    pub enqueued_op: Option<String>,
    pub resolved_op: Option<(String, Option<String>)>,
    pub op: Option<StepOp>,
}

pub fn facts(
    compiled: &CompiledModel,
    pre: &ModelState,
    post: &ModelState,
    transition: &Transition,
) -> StepFacts {
    let pending_idx = pending_queue_idx_for_transition(compiled, transition, pre, post);
    let before = read_pending_ops_with_idx(pre, pending_idx);
    let after = read_pending_ops_with_idx(post, pending_idx);
    let enqueued = after
        .iter()
        .find(|op| !before.iter().any(|c| same_op(c, op)))
        .cloned();
    let dequeued = before
        .iter()
        .find(|op| !after.iter().any(|c| same_op(c, op)))
        .cloned();

    let op = enqueued
        .as_ref()
        .map(|e| StepOp {
            id: e.op_id.clone(),
            continuation: e.continuation.clone(),
            args: e.args.clone(),
        })
        .or_else(|| {
            dequeued.as_ref().map(|d| StepOp {
                id: d.op_id.clone(),
                continuation: d.continuation.clone(),
                args: d.args.clone(),
            })
        });

    StepFacts {
        transition: transition.clone(),
        enqueued_op: enqueued.map(|e| e.op_id),
        resolved_op: resolve_facts(transition),
        op,
    }
}

fn pending_queue_idx_for_transition(
    compiled: &CompiledModel,
    transition: &Transition,
    pre: &ModelState,
    post: &ModelState,
) -> Option<usize> {
    let mut queues = HashSet::new();
    collect_pending_queues_from_effect(compiled, &transition.effect, &mut queues);
    if queues.len() == 1 {
        return queues.into_iter().next();
    }
    let changed: Vec<usize> = compiled
        .pending_queue_var_indexes()
        .into_iter()
        .filter(|idx| read_pending(pre, *idx) != read_pending(post, *idx))
        .collect();
    match changed.len() {
        0 => compiled.pending_queue_var_indexes().into_iter().next(),
        1 => Some(changed[0]),
        _ => changed.last().copied(),
    }
}

fn collect_pending_queues_from_effect(
    compiled: &CompiledModel,
    effect: &EffectIR,
    queues: &mut HashSet<usize>,
) {
    match effect {
        EffectIR::Enqueue { queue, .. } | EffectIR::Dequeue { queue, .. } => {
            if let Ok(idx) = compiled.pending_queue_idx(queue.as_deref()) {
                queues.insert(idx);
            }
        }
        EffectIR::If {
            then, else_branch, ..
        } => {
            collect_pending_queues_from_effect(compiled, then, queues);
            collect_pending_queues_from_effect(compiled, else_branch, queues);
        }
        EffectIR::Seq { effects } => {
            for child in effects {
                collect_pending_queues_from_effect(compiled, child, queues);
            }
        }
        _ => {}
    }
}

fn resolve_facts(transition: &Transition) -> Option<(String, Option<String>)> {
    if let Value::Object(label) = &transition.label {
        if label.get("kind") == Some(&Value::String("resolve".into())) {
            let op = label.get("op")?.as_str()?.to_string();
            let outcome = label.get("outcome").and_then(|v| v.as_str()).map(|s| s.to_string());
            return Some((op, outcome));
        }
    }
    None
}

fn read_pending_ops_with_idx(state: &ModelState, pending_idx: Option<usize>) -> Vec<PendingOp> {
    let Some(pending_idx) = pending_idx else {
        return vec![];
    };
    read_pending(state, pending_idx)
        .into_iter()
        .filter_map(|v| {
            let obj = v.as_object()?;
            Some(PendingOp {
                op_id: obj.get("opId")?.as_str()?.to_string(),
                continuation: obj.get("continuation")?.as_str()?.to_string(),
                args: obj
                    .get("args")
                    .and_then(|a| a.as_object())
                    .cloned()
                    .unwrap_or_default(),
            })
        })
        .collect()
}

fn same_op(a: &PendingOp, b: &PendingOp) -> bool {
    a.op_id == b.op_id
        && a.continuation == b.continuation
        && values_equal(
            &Value::Object(a.args.clone()),
            &Value::Object(b.args.clone()),
        )
}

pub fn enqueued(step: &StepFacts, op: &str) -> bool {
    step.enqueued_op.as_deref() == Some(op)
}

pub fn resolved(step: &StepFacts, op: &str, outcome: Option<&str>) -> bool {
    match &step.resolved_op {
        Some((resolved_op, resolved_outcome)) if resolved_op == op => match outcome {
            None => true,
            Some(o) => resolved_outcome.as_deref() == Some(o),
        },
        _ => false,
    }
}

fn var_changed(pre: &ModelState, post: &ModelState, idx: usize) -> bool {
    !values_equal(&pre.get(idx), &post.get(idx))
}

fn var_changed_to(pre: &ModelState, post: &ModelState, idx: usize, expected: &Value) -> bool {
    var_changed(pre, post, idx) && values_equal(&post.get(idx), expected)
}

pub fn label_kind(transition: &Transition) -> Option<String> {
    transition
        .label
        .as_object()
        .and_then(|l| l.get("kind"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn validate_step_var(
    compiled: &CompiledModel,
    var_id: &str,
    property_name: &str,
) -> Result<usize, String> {
    compiled
        .var_idx(var_id)
        .ok_or_else(|| format!("{property_name}: step predicate references unknown var {var_id}"))
}

pub fn matches_step_predicate(
    compiled: &CompiledModel,
    step: &StepFacts,
    pre: &ModelState,
    post: &ModelState,
    pred: &crate::model::StepPredicateIR,
    property_name: &str,
) -> Result<bool, String> {
    if let Some(id) = &pred.transition_id {
        if &step.transition.id != id {
            return Ok(false);
        }
    }
    if let Some(cls) = &pred.transition_class {
        if &step.transition.cls != cls {
            return Ok(false);
        }
    }
    if let Some(kind) = &pred.label_kind {
        if label_kind(&step.transition).as_deref() != Some(kind.as_str()) {
            return Ok(false);
        }
    }
    if let Some(op) = &pred.enqueued {
        if !enqueued(step, op) {
            return Ok(false);
        }
    }
    if let Some(resolved_spec) = &pred.resolved {
        let op = resolved_spec.first().map(|s| s.as_str());
        let outcome = resolved_spec.get(1).map(|s| s.as_str());
        if !op.is_some_and(|o| resolved(step, o, outcome)) {
            return Ok(false);
        }
    }
    if let Some(var_id) = &pred.changed {
        let idx = validate_step_var(compiled, var_id, property_name)?;
        if !var_changed(pre, post, idx) {
            return Ok(false);
        }
    }
    if let Some(changed_to) = &pred.changed_to {
        let idx = validate_step_var(compiled, &changed_to.var, property_name)?;
        if !var_changed_to(pre, post, idx, &changed_to.value) {
            return Ok(false);
        }
    }
    if let Some(op_id) = &pred.op_id {
        if step.op.as_ref().map(|o| &o.id) != Some(op_id) {
            return Ok(false);
        }
    }
    if let Some(cont) = &pred.continuation {
        if step.op.as_ref().map(|o| &o.continuation) != Some(cont) {
            return Ok(false);
        }
    }
    if let Some(args) = &pred.op_args {
        if let Some(op) = &step.op {
            for (key, expected) in args {
                if op.args.get(key) != Some(expected) {
                    return Ok(false);
                }
            }
        } else {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn matches_step_spec(
    compiled: &crate::model::CompiledModel,
    pre: &ModelState,
    post: &ModelState,
    step: &StepFacts,
    spec: &crate::model::StepPredicateSpec,
    allowed: &std::collections::HashSet<String>,
    property_name: &str,
) -> Result<bool, String> {
    match spec {
        crate::model::StepPredicateSpec::Flat(pred) => {
            Ok(matches_step_predicate(compiled, step, pre, post, pred, property_name)?)
        }
        crate::model::StepPredicateSpec::Composite(c) => {
            let mut matched = true;
            if let Some(pre_expr) = &c.pre {
                let step_ctx = crate::expr::StepEvalContext {
                    pre: Some(pre),
                    step: Some(step),
                };
                if !crate::expr::eval_state_predicate_with_step(
                    compiled,
                    pre,
                    pre_expr,
                    allowed,
                    property_name,
                    "step pre-state",
                    Some(step_ctx),
                )? {
                    matched = false;
                }
            }
            if matched
                && !matches_step_predicate(compiled, step, pre, post, &c.step, property_name)?
            {
                matched = false;
            }
            if matched {
                if let Some(post_expr) = &c.post {
                    let step_ctx = crate::expr::StepEvalContext {
                        pre: Some(pre),
                        step: Some(step),
                    };
                    if !crate::expr::eval_state_predicate_with_step(
                        compiled,
                        post,
                        post_expr,
                        allowed,
                        property_name,
                        "step post-state",
                        Some(step_ctx),
                    )? {
                        matched = false;
                    }
                }
            }
            Ok(if c.negate == Some(true) {
                !matched
            } else {
                matched
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effect::apply_effect;
    use crate::expr::EvalOptions;
    use crate::model::{
        AbstractDomain, Bounds, CompiledModel, EffectIR, ExprIR, InitialValue, Model, Scope,
        StateVarDecl, StepPredicateIR, Transition,
    };
    use crate::stabilize::stabilize;
    use serde_json::json;

    fn location_model() -> CompiledModel {
        CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "location-step-facts".into(),
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
                            max_len: 2,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                        role: None,
                    },
                    StateVarDecl {
                        id: "system:location".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/a".into(), "/b".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/a")),
                        role: None,
                    },
                    StateVarDecl {
                        id: "flag".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),
                        role: None,
                    },
                ],
                transitions: vec![Transition {
                    id: "goB".into(),
                    cls: "user".into(),
                    label: json!({ "kind": "click", "text": "Go" }),
                    source: vec![],
                    guard: ExprIR::Lit { value: json!(true) },
                    effect: EffectIR::Assign {
                        var: "system:location".into(),
                        expr: ExprIR::Lit { value: json!("/b") },
                    },
                    reads: vec!["system:location".into()],
                    writes: vec!["system:location".into()],
                    confidence: "exact".into(),
                    triggered_by: None,
                    phase: None,
                }],
                bounds: Bounds {
                    max_depth: 2,
                    max_pending: 0,
                    max_internal_steps: 4,
                },
                metadata: None,
            },
            false,
        )
        .unwrap()
    }

    fn step_facts(compiled: &CompiledModel) -> (ModelState, ModelState, StepFacts) {
        let pre = crate::domain::initial_states(compiled)[0].clone();
        let transition_idx = *compiled.transition_index.get("goB").unwrap();
        let transition = compiled.transition(transition_idx);
        let mut options = EvalOptions::default();
        let raw_post = apply_effect(compiled, &pre, &transition.effect, &mut options)
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let changed = crate::state::changed_var_indexes(&pre, &raw_post);
        let post = stabilize(compiled, raw_post, changed, &mut |_| Vec::new())
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let step = facts(compiled, &pre, &post, transition);
        (pre, post, step)
    }

    #[test]
    fn changed_matches_when_var_value_differs() {
        let compiled = location_model();
        let (pre, post, step) = step_facts(&compiled);
        let pred = StepPredicateIR {
            transition_id: None,
            transition_class: None,
            label_kind: None,
            enqueued: None,
            resolved: None,
            changed: Some("system:location".into()),
            changed_to: None,
            op_id: None,
            continuation: None,
            op_args: None,
        };
        assert!(matches_step_predicate(&compiled, &step, &pre, &post, &pred, "p").unwrap());
        let unchanged = StepPredicateIR {
            changed: Some("flag".into()),
            ..pred.clone()
        };
        assert!(!matches_step_predicate(&compiled, &step, &pre, &post, &unchanged, "p").unwrap());
    }

    #[test]
    fn changed_to_matches_post_value_after_change() {
        let compiled = location_model();
        let (pre, post, step) = step_facts(&compiled);
        let pred = StepPredicateIR {
            transition_id: None,
            transition_class: None,
            label_kind: None,
            enqueued: None,
            resolved: None,
            changed: None,
            changed_to: Some(crate::model::ChangedToPredicate {
                var: "system:location".into(),
                value: json!("/b"),
            }),
            op_id: None,
            continuation: None,
            op_args: None,
        };
        assert!(matches_step_predicate(&compiled, &step, &pre, &post, &pred, "p").unwrap());
        let wrong_target = StepPredicateIR {
            changed_to: Some(crate::model::ChangedToPredicate {
                var: "system:location".into(),
                value: json!("/a"),
            }),
            ..pred
        };
        assert!(!matches_step_predicate(&compiled, &step, &pre, &post, &wrong_target, "p").unwrap());
    }

    #[test]
    fn changed_predicate_errors_on_unknown_var() {
        let compiled = location_model();
        let (pre, post, step) = step_facts(&compiled);
        let pred = StepPredicateIR {
            transition_id: None,
            transition_class: None,
            label_kind: None,
            enqueued: None,
            resolved: None,
            changed: Some("missing:var".into()),
            changed_to: None,
            op_id: None,
            continuation: None,
            op_args: None,
        };
        let err = matches_step_predicate(&compiled, &step, &pre, &post, &pred, "p").unwrap_err();
        assert!(err.contains("unknown var missing:var"));
    }
}
