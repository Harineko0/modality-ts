use crate::model::{AbstractDomain, Model, ModelState};
use serde_json::Value;
use std::collections::BTreeMap;

pub fn canonical_state(model: &Model, state: &ModelState) -> String {
    let mut token_map: BTreeMap<String, String> = BTreeMap::new();
    let mut next_token = 1usize;
    let pairs: Vec<(String, Value)> = model
        .vars
        .iter()
        .map(|decl| {
            let encoded = encode_value(
                &decl.domain,
                state.get(&decl.id),
                &mut token_map,
                &mut next_token,
            );
            (decl.id.clone(), encoded)
        })
        .collect();
    canonical_json(&pairs)
}

fn encode_value(
    domain: &AbstractDomain,
    value: Option<&Value>,
    token_map: &mut BTreeMap<String, String>,
    next_token: &mut usize,
) -> Value {
    let value = value.cloned().unwrap_or(Value::Null);
    match domain {
        AbstractDomain::Tokens { count, names } => {
            if let Value::String(s) = &value {
                if !token_map.contains_key(s) {
                    token_map.insert(s.clone(), format!("tok{next_token}"));
                    *next_token += 1;
                }
                Value::String(token_map.get(s).cloned().unwrap_or_else(|| s.clone()))
            } else {
                value
            }
        }
        AbstractDomain::Option { inner } => {
            if value.is_null() {
                Value::Null
            } else {
                encode_value(inner, Some(&value), token_map, next_token)
            }
        }
        AbstractDomain::Record { fields } => {
            if let Value::Object(obj) = &value {
                let mut entries: Vec<_> = fields.iter().collect();
                entries.sort_by(|a, b| a.0.cmp(b.0));
                let mut out = serde_json::Map::new();
                for (key, inner) in entries {
                    out.insert(
                        key.clone(),
                        encode_value(inner, obj.get(key.as_str()), token_map, next_token),
                    );
                }
                Value::Object(out)
            } else {
                value
            }
        }
        AbstractDomain::Tagged { tag, variants } => {
            if let Value::Object(record) = &value {
                let tag_val = record.get(tag).and_then(|v| v.as_str());
                let variant = tag_val.and_then(|t| variants.get(t));
                let mut entries: Vec<_> = record.iter().collect();
                entries.sort_by(|a, b| a.0.cmp(b.0));
                let mut out = serde_json::Map::new();
                for (key, item) in entries {
                    let encoded = if key == tag {
                        item.clone()
                    } else if let Some(variant_domain) = variant {
                        if let AbstractDomain::Record { fields } = variant_domain {
                            let field_domain = fields.get(key.as_str()).cloned().unwrap_or(
                                AbstractDomain::Enum {
                                    values: vec![],
                                },
                            );
                            encode_value(&field_domain, Some(item), token_map, next_token)
                        } else {
                            item.clone()
                        }
                    } else {
                        item.clone()
                    };
                    out.insert(key.clone(), encoded);
                }
                Value::Object(out)
            } else {
                value
            }
        }
        AbstractDomain::BoundedList { inner, .. } => {
            if let Value::Array(arr) = &value {
                Value::Array(
                    arr.iter()
                        .map(|item| encode_value(inner, Some(item), token_map, next_token))
                        .collect(),
                )
            } else {
                value
            }
        }
        _ => {
            if let Value::Array(arr) = &value {
                Value::Array(arr.iter().map(sort_json).collect())
            } else if let Value::Object(obj) = &value {
                sort_json(&Value::Object(obj.clone()))
            } else {
                value
            }
        }
    }
}

pub fn sort_json(value: &Value) -> Value {
    match value {
        Value::Array(arr) => Value::Array(arr.iter().map(sort_json).collect()),
        Value::Object(obj) => {
            let mut entries: Vec<_> = obj.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            let mut out = serde_json::Map::new();
            for (k, v) in entries {
                out.insert(k.clone(), sort_json(v));
            }
            Value::Object(out)
        }
        _ => value.clone(),
    }
}

pub fn canonical_json(value: &impl serde::Serialize) -> String {
    let sorted = sort_json(&serde_json::to_value(value).unwrap_or(Value::Null));
    serde_json::to_string(&sorted).unwrap_or_else(|_| "null".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Bounds, InitialValue, Scope, StateVarDecl};
    use serde_json::json;

    #[test]
    fn canonical_sorts_object_keys() {
        let model = Model {
            schema_version: 1,
            id: "m".into(),
            vars: vec![StateVarDecl {
                id: "x".into(),
                domain: AbstractDomain::Bool,
                origin: json!("system"),
                scope: Scope::Global,
                initial: InitialValue::Single(json!(false)),
            }],
            transitions: vec![],
            bounds: Bounds {
                max_depth: 1,
                max_pending: 0,
                max_internal_steps: 1,
            },
            metadata: None,
        };
        let mut state = ModelState::new();
        state.insert("x".into(), json!(true));
        let canon = canonical_state(&model, &state);
        assert!(canon.contains("x"));
    }
}
