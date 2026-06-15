use crate::domain::diff;
use crate::model::{CompiledModel, ModelState, Transition};
use crate::step::StepFacts;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Parent {
    pub parent: Option<String>,
    pub transition_id: Option<String>,
}

pub struct TraceContext<'a> {
    pub compiled: &'a CompiledModel,
    pub parents: &'a HashMap<String, Parent>,
    pub states: &'a HashMap<String, ModelState>,
}

pub fn trace_to(ctx: &TraceContext, canon: &str) -> Value {
    let mut steps = Vec::new();
    let mut current = Some(canon.to_string());
    while let Some(ref c) = current {
        let Some(parent) = ctx.parents.get(c) else {
            break;
        };
        if let (Some(pre_canon), Some(tid)) = (&parent.parent, &parent.transition_id) {
            if let (Some(pre), Some(post)) = (ctx.states.get(pre_canon), ctx.states.get(c)) {
                if let Some(transition) = ctx
                    .compiled
                    .transition_index
                    .get(tid)
                    .map(|&idx| ctx.compiled.transition(idx).clone())
                {
                    steps.push(make_trace_step(pre, post, &transition));
                }
            }
        }
        current = parent.parent.clone();
    }
    steps.reverse();
    json!({ "steps": steps })
}

pub fn make_trace_step(pre: &ModelState, post: &ModelState, transition: &Transition) -> Value {
    json!({
        "transitionId": transition.id,
        "label": transition.label,
        "pre": Value::Object(pre.clone()),
        "post": Value::Object(post.clone()),
        "diff": Value::Object(diff(pre, post)),
    })
}

pub fn replay_checked_verdict(
    status: &str,
    property: &str,
    trace: Value,
) -> Value {
    let replay_blocked = replay_blocked_reason_for_trace(&trace);
    let mut verdict = Map::new();
    verdict.insert("status".into(), json!(status));
    verdict.insert("property".into(), json!(property));
    verdict.insert("trace".into(), trace);
    if let Some(reason) = replay_blocked {
        verdict.insert("replayable".into(), json!(false));
        verdict.insert("replayBlockedReason".into(), json!(reason));
    }
    Value::Object(verdict)
}

fn replay_blocked_reason_for_trace(trace: &Value) -> Option<String> {
    let steps = trace.get("steps")?.as_array()?;
    let blocked: Vec<String> = steps
        .iter()
        .filter_map(|step| {
            let transition_id = step.get("transitionId")?.as_str()?;
            let label = step.get("label")?.as_object()?;
            let kind = label.get("kind")?.as_str()?;
            if matches!(kind, "click" | "submit" | "input") && !label.contains_key("locator") {
                Some(format!("{transition_id}:{kind}"))
            } else {
                None
            }
        })
        .collect();
    if blocked.is_empty() {
        None
    } else {
        Some(format!(
            "trace contains locatorless replay steps: {}",
            blocked.join(", ")
        ))
    }
}

pub fn trace_with_edge(
    ctx: &TraceContext,
    pre_canon: &str,
    pre: &ModelState,
    post: &ModelState,
    transition: &Transition,
) -> Value {
    let mut trace = trace_to(ctx, pre_canon);
    if let Some(steps) = trace.get_mut("steps").and_then(|v| v.as_array_mut()) {
        steps.push(make_trace_step(pre, post, transition));
    }
    trace
}

pub fn trace_with_suffix(
    ctx: &TraceContext,
    pre_canon: &str,
    pre: &ModelState,
    post: &ModelState,
    transition: &Transition,
    suffix: &[(ModelState, ModelState, Transition)],
) -> Value {
    let mut trace = trace_with_edge(ctx, pre_canon, pre, post, transition);
    if let Some(steps) = trace.get_mut("steps").and_then(|v| v.as_array_mut()) {
        for (s_pre, s_post, t) in suffix {
            steps.push(make_trace_step(s_pre, s_post, t));
        }
    }
    trace
}
