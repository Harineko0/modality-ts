mod canon;
mod ctl;
mod diagnostics;
mod domain;
mod effect;
mod expr;
mod frontier;
mod graph;
mod memory;
mod model;
mod mount;
mod por;
mod property;
mod report;
mod scc;
mod search;
mod stabilize;
mod state;
mod step;
mod trace;
mod transition_index;
mod visited;

use model::{CheckRequest, Model};
use napi_derive::napi;
use search::{check_model_request, model_initial_states as compute_initial_states, model_successors as compute_successors};
use report::{wrap_err, wrap_ok};
use serde_json::Value;

#[napi]
pub fn check_model(serialized_request: String) -> napi::Result<String> {
    match serde_json::from_str::<CheckRequest>(&serialized_request) {
        Ok(request) => match check_model_request(request) {
            Ok(result) => Ok(wrap_ok(result)),
            Err(error) => Ok(wrap_err(error)),
        },
        Err(error) => Ok(wrap_err(format!("invalid request JSON: {error}"))),
    }
}

#[napi]
pub fn model_initial_states(model_json: String) -> napi::Result<String> {
    match serde_json::from_str::<Model>(&model_json) {
        Ok(model) => match compute_initial_states(model) {
            Ok(states) => {
                let value: Vec<Value> = states
                    .into_iter()
                    .map(|s| Value::Object(s))
                    .collect();
                Ok(wrap_ok(Value::Array(value)))
            }
            Err(error) => Ok(wrap_err(error)),
        },
        Err(error) => Ok(wrap_err(format!("invalid model JSON: {error}"))),
    }
}

#[napi]
pub fn model_successors(model_json: String, state_json: String) -> napi::Result<String> {
    let model: Model = match serde_json::from_str(&model_json) {
        Ok(m) => m,
        Err(error) => return Ok(wrap_err(format!("invalid model JSON: {error}"))),
    };
    let state: serde_json::Map<String, Value> = match serde_json::from_str(&state_json) {
        Ok(s) => s,
        Err(error) => return Ok(wrap_err(format!("invalid state JSON: {error}"))),
    };
    match compute_successors(model, state) {
        Ok(steps) => Ok(wrap_ok(Value::Array(steps))),
        Err(error) => Ok(wrap_err(error)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_opaque_effects_at_validation() {
        let model = json!({
            "schemaVersion": 1,
            "id": "m",
            "vars": [
                { "id": "sys:route", "domain": { "kind": "enum", "values": ["/"] }, "origin": "system", "scope": { "kind": "global" }, "initial": "/" },
                { "id": "sys:history", "domain": { "kind": "boundedList", "inner": { "kind": "enum", "values": ["/"] }, "maxLen": 0 }, "origin": "system", "scope": { "kind": "global" }, "initial": [] },
                { "id": "sys:pending", "domain": { "kind": "boundedList", "inner": { "kind": "record", "fields": { "opId": { "kind": "enum", "values": ["op"] }, "continuation": { "kind": "enum", "values": ["c"] }, "args": { "kind": "record", "fields": {} } } }, "maxLen": 0 }, "origin": "system", "scope": { "kind": "global" }, "role": { "kind": "pending-queue" }, "initial": [] },
                { "id": "x", "domain": { "kind": "bool" }, "origin": { "file": "a.ts" }, "scope": { "kind": "global" }, "initial": false }
            ],
            "transitions": [{
                "id": "t1", "cls": "user", "label": { "kind": "click" },
                "source": [], "guard": { "kind": "lit", "value": true },
                "effect": { "kind": "opaque", "ref": { "module": "m", "export": "f", "declaredReads": [], "declaredWrites": ["x"] } },
                "reads": [], "writes": ["x"], "confidence": "exact"
            }],
            "bounds": { "maxDepth": 2, "maxPending": 0, "maxInternalSteps": 1 }
        });
        let request = json!({
            "model": model,
            "properties": [{
                "kind": "temporal",
                "name": "p",
                "formula": { "kind": "AG", "arg": { "kind": "atom", "predicate": { "kind": "lit", "value": true } } }
            }],
            "options": {}
        });
        let out = check_model(request.to_string()).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed.get("ok"), Some(&json!(true)));
        let verdicts = parsed
            .pointer("/result/verdicts/0/status")
            .and_then(|v| v.as_str());
        assert_eq!(verdicts, Some("error"));
    }
}
