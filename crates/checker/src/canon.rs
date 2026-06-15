use crate::model::{AbstractDomain, CompiledModel, UNMOUNTED};
use crate::state::ModelState;
use serde_json::Value;
use std::collections::BTreeMap;

const TAG_NULL: u8 = 0;
const TAG_BOOL_FALSE: u8 = 1;
const TAG_BOOL_TRUE: u8 = 2;
const TAG_INT: u8 = 3;
const TAG_STRING: u8 = 4;
const TAG_UNMOUNTED: u8 = 5;
const TAG_RECORD: u8 = 6;
const TAG_TAGGED: u8 = 7;
const TAG_LIST: u8 = 8;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CanonicalIdentity {
    pub bytes: Vec<u8>,
    pub hash: u64,
}

pub fn canonical_identity(compiled: &CompiledModel, state: &ModelState) -> CanonicalIdentity {
    let mut token_map: BTreeMap<String, u32> = BTreeMap::new();
    let mut next_token = 1u32;
    let mut bytes = Vec::new();
    for (idx, decl) in compiled.model.vars.iter().enumerate() {
        encode_value(
            &decl.domain,
            &state.values[idx],
            &mut bytes,
            &mut token_map,
            &mut next_token,
        );
    }
    let hash = fnv1a64(&bytes);
    CanonicalIdentity { bytes, hash }
}

pub fn canonical_key(compiled: &CompiledModel, state: &ModelState) -> Vec<u8> {
    canonical_identity(compiled, state).bytes
}

pub fn canonical_state(compiled: &CompiledModel, state: &ModelState) -> String {
    let identity = canonical_identity(compiled, state);
    format!("{:016x}", identity.hash)
}

pub fn canonical_identity_hash(bytes: &[u8]) -> u64 {
    fnv1a64(bytes)
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut hash = OFFSET;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

fn encode_value(
    domain: &AbstractDomain,
    value: &Value,
    out: &mut Vec<u8>,
    token_map: &mut BTreeMap<String, u32>,
    next_token: &mut u32,
) {
    if value == &Value::String(UNMOUNTED.into()) {
        out.push(TAG_UNMOUNTED);
        return;
    }
    match domain {
        AbstractDomain::Bool => match value.as_bool() {
            Some(true) => out.push(TAG_BOOL_TRUE),
            Some(false) => out.push(TAG_BOOL_FALSE),
            None => out.push(TAG_NULL),
        },
        AbstractDomain::Enum { .. } | AbstractDomain::LengthCat { .. } => {
            encode_string(value.as_str().unwrap_or(""), out);
        }
        AbstractDomain::BoundedInt { .. } => {
            let n = value.as_i64().unwrap_or(0);
            out.push(TAG_INT);
            out.extend_from_slice(&n.to_le_bytes());
        }
        AbstractDomain::Tokens { .. } => {
            if let Value::String(s) = value {
                let mapped = *token_map.entry(s.clone()).or_insert_with(|| {
                    let id = *next_token;
                    *next_token += 1;
                    id
                });
                encode_string(&format!("tok{mapped}"), out);
            } else {
                out.push(TAG_NULL);
            }
        }
        AbstractDomain::Option { inner } => {
            if value.is_null() {
                out.push(TAG_NULL);
            } else {
                encode_value(inner, value, out, token_map, next_token);
            }
        }
        AbstractDomain::Record { fields } => {
            out.push(TAG_RECORD);
            let mut keys: Vec<_> = fields.keys().collect();
            keys.sort();
            out.extend_from_slice(&(keys.len() as u32).to_le_bytes());
            if let Value::Object(obj) = value {
                for key in keys {
                    encode_value(&fields[key], obj.get(key).unwrap_or(&Value::Null), out, token_map, next_token);
                }
            } else {
                for key in keys {
                    encode_value(&fields[key], &Value::Null, out, token_map, next_token);
                }
            }
        }
        AbstractDomain::Tagged { tag, variants } => {
            out.push(TAG_TAGGED);
            if let Value::Object(record) = value {
                let tag_val = record.get(tag).and_then(|v| v.as_str()).unwrap_or("");
                encode_string(tag_val, out);
                let variant_domain = variants.get(tag_val);
                let mut keys: Vec<_> = record.keys().collect();
                keys.sort();
                out.extend_from_slice(&(keys.len() as u32).to_le_bytes());
                for key in keys {
                    if key == tag {
                        encode_string(tag_val, out);
                    } else if let Some(AbstractDomain::Record { fields }) = variant_domain {
                        let field_domain = fields
                            .get(key.as_str())
                            .cloned()
                            .unwrap_or(AbstractDomain::Enum { values: vec![] });
                        encode_value(
                            &field_domain,
                            record.get(key).unwrap_or(&Value::Null),
                            out,
                            token_map,
                            next_token,
                        );
                    } else {
                        encode_string(
                            record.get(key).and_then(|v| v.as_str()).unwrap_or(""),
                            out,
                        );
                    }
                }
            } else {
                encode_string("", out);
                out.extend_from_slice(&0u32.to_le_bytes());
            }
        }
        AbstractDomain::BoundedList { inner, .. } => {
            out.push(TAG_LIST);
            if let Value::Array(arr) = value {
                out.extend_from_slice(&(arr.len() as u32).to_le_bytes());
                for item in arr {
                    encode_value(inner, item, out, token_map, next_token);
                }
            } else {
                out.extend_from_slice(&0u32.to_le_bytes());
            }
        }
    }
}

fn encode_string(value: &str, out: &mut Vec<u8>) {
    out.push(TAG_STRING);
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::initial_values;
    use crate::model::{
        Bounds, InitialValue, Model, Scope, StateVarDecl,
    };
    use serde_json::json;

    fn token_model() -> CompiledModel {
        CompiledModel::compile(
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
                                fields: std::collections::HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                    },
                    StateVarDecl {
                        id: "a".into(),
                        domain: AbstractDomain::Tokens {
                            count: 2,
                            names: None,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("tok1")),
                    },
                    StateVarDecl {
                        id: "b".into(),
                        domain: AbstractDomain::Tokens {
                            count: 2,
                            names: None,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("tok2")),
                    },
                ],
                transitions: vec![],
                bounds: Bounds {
                    max_depth: 1,
                    max_pending: 0,
                    max_internal_steps: 1,
                },
                metadata: None,
            },
            false,
        )
        .unwrap()
    }

    #[test]
    fn token_canonicalization_is_order_invariant() {
        let compiled = token_model();
        let mut left = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        let mut right = left.clone();
        let a = *compiled.var_index.get("a").unwrap();
        let b = *compiled.var_index.get("b").unwrap();
        for decl in &compiled.model.vars {
            let idx = *compiled.var_index.get(&decl.id).unwrap();
            left.values[idx] = initial_values(&decl.domain, &decl.initial)[0].clone();
            right.values[idx] = initial_values(&decl.domain, &decl.initial)[0].clone();
        }
        left.values[a] = json!("tok1");
        left.values[b] = json!("tok2");
        right.values[a] = json!("tok2");
        right.values[b] = json!("tok1");
        assert_eq!(
            canonical_identity(&compiled, &left).bytes,
            canonical_identity(&compiled, &right).bytes
        );
    }

    #[test]
    fn canonical_bytes_differ_for_different_states() {
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
                                fields: std::collections::HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                    },
                    StateVarDecl {
                        id: "flag".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),
                    },
                ],
                transitions: vec![],
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
        let mut left = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        let mut right = left.clone();
        let flag = *compiled.var_index.get("flag").unwrap();
        left.values[flag] = json!(false);
        right.values[flag] = json!(true);
        assert_ne!(
            canonical_identity(&compiled, &left).bytes,
            canonical_identity(&compiled, &right).bytes
        );
    }
}
