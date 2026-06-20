use serde_json::{json, Value};

pub fn wrap_ok(result: Value) -> String {
    serde_json::to_string(&json!({ "ok": true, "result": result })).unwrap_or_else(|e| {
        serde_json::to_string(&json!({ "ok": false, "error": e.to_string() })).unwrap()
    })
}

pub fn wrap_err(error: impl ToString) -> String {
    serde_json::to_string(&json!({ "ok": false, "error": error.to_string() })).unwrap()
}

pub fn build_check_result(
    properties: &[crate::model::PropertyIR],
    verdicts: &std::collections::HashMap<String, Value>,
    stats: Value,
    vacuity_warnings: Vec<String>,
    bound_hits: Vec<String>,
    diagnostics: Option<Value>,
) -> Value {
    let verdict_list: Vec<Value> = properties
        .iter()
        .map(|p| {
            let name = match p {
                crate::model::PropertyIR::Temporal { name, .. }
                | crate::model::PropertyIR::AlwaysStep { name, .. }
                | crate::model::PropertyIR::LeadsToWithin { name, .. } => name,
            };
            verdicts
                .get(name)
                .cloned()
                .unwrap_or_else(|| {
                    json!({
                        "status": "verified-within-bounds",
                        "property": name,
                    })
                })
        })
        .collect();
    let mut result = json!({
        "verdicts": verdict_list,
        "stats": stats,
        "vacuityWarnings": vacuity_warnings,
        "boundHits": bound_hits,
    });
    if let Some(d) = diagnostics {
        result
            .as_object_mut()
            .unwrap()
            .insert("diagnostics".into(), d);
    }
    result
}

pub fn invalid_model_result(
    properties: &[crate::model::PropertyIR],
    errors: &str,
) -> Value {
    let verdicts: Vec<Value> = properties
        .iter()
        .map(|p| {
            let name = match p {
                crate::model::PropertyIR::Temporal { name, .. }
                | crate::model::PropertyIR::AlwaysStep { name, .. }
                | crate::model::PropertyIR::LeadsToWithin { name, .. } => name,
            };
            json!({
                "status": "error",
                "property": name,
                "message": errors,
            })
        })
        .collect();
    json!({
        "verdicts": verdicts,
        "stats": { "states": 0, "edges": 0, "depth": 0 },
        "vacuityWarnings": [],
        "boundHits": [],
    })
}
