use crate::model::CompiledModel;
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct ModelState {
    pub values: Vec<Value>,
}

impl ModelState {
    pub fn new(values: Vec<Value>) -> Self {
        Self { values }
    }

    pub fn from_json(compiled: &CompiledModel, json: &Map<String, Value>) -> Result<Self, String> {
        let mut values = vec![Value::Null; compiled.model.vars.len()];
        for (idx, decl) in compiled.model.vars.iter().enumerate() {
            values[idx] = json.get(&decl.id).cloned().unwrap_or(Value::Null);
        }
        Ok(Self { values })
    }

    pub fn to_json(&self, compiled: &CompiledModel) -> Map<String, Value> {
        let mut out = Map::new();
        for (idx, decl) in compiled.model.vars.iter().enumerate() {
            out.insert(decl.id.clone(), self.values[idx].clone());
        }
        out
    }

    pub fn get(&self, var_idx: usize) -> &Value {
        &self.values[var_idx]
    }

    pub fn with_var(&self, var_idx: usize, value: Value) -> Self {
        let mut values = self.values.clone();
        values[var_idx] = value;
        Self { values }
    }
}

pub fn read_path(value: Option<&Value>, path: &[String]) -> Value {
    let mut current = value.cloned();
    for segment in path {
        current = match current {
            Some(Value::Array(arr)) => arr.get(segment.parse().unwrap_or(0)).cloned(),
            Some(Value::Object(obj)) => obj.get(segment).cloned(),
            _ => None,
        };
    }
    current.unwrap_or(Value::Null)
}

pub fn write_path(target: &Value, path: &[String], value: Value) -> Value {
    if path.is_empty() {
        return value;
    }
    let head = &path[0];
    let tail = &path[1..];
    if let Value::Array(arr) = target {
        let mut copy = arr.clone();
        let idx: usize = head.parse().unwrap_or(0);
        let existing = copy.get(idx).cloned().unwrap_or(Value::Null);
        if idx < copy.len() {
            copy[idx] = write_path(&existing, tail, value);
        } else {
            while copy.len() <= idx {
                copy.push(Value::Null);
            }
            copy[idx] = write_path(&Value::Null, tail, value);
        }
        Value::Array(copy)
    } else {
        let mut obj = match target {
            Value::Object(o) => o.clone(),
            _ => Map::new(),
        };
        let existing = obj.get(head).cloned().unwrap_or(Value::Null);
        obj.insert(head.clone(), write_path(&existing, tail, value));
        Value::Object(obj)
    }
}

pub fn values_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Number(x), Value::Number(y)) => {
            if let (Some(xi), Some(yi)) = (x.as_i64(), y.as_i64()) {
                xi == yi
            } else if let (Some(xf), Some(yf)) = (x.as_f64(), y.as_f64()) {
                xf == yf
            } else {
                false
            }
        }
        (Value::String(x), Value::String(y)) => x == y,
        (Value::Array(xs), Value::Array(ys)) => {
            xs.len() == ys.len()
                && xs
                    .iter()
                    .zip(ys)
                    .all(|(left, right)| values_equal(left, right))
        }
        (Value::Object(xs), Value::Object(ys)) => {
            xs.len() == ys.len()
                && xs
                    .iter()
                    .all(|(key, left)| ys.get(key).is_some_and(|right| values_equal(left, right)))
        }
        _ => false,
    }
}

pub fn changed_var_indexes(
    pre: &ModelState,
    post: &ModelState,
) -> std::collections::HashSet<usize> {
    pre.values
        .iter()
        .zip(&post.values)
        .enumerate()
        .filter(|(_, (before, after))| !values_equal(before, after))
        .map(|(idx, _)| idx)
        .collect()
}

pub fn diff(pre: &ModelState, post: &ModelState, compiled: &CompiledModel) -> Map<String, Value> {
    let mut out = Map::new();
    for (idx, decl) in compiled.model.vars.iter().enumerate() {
        let before = &pre.values[idx];
        let after = &post.values[idx];
        if !values_equal(before, after) {
            let mut entry = Map::new();
            entry.insert("before".into(), before.clone());
            entry.insert("after".into(), after.clone());
            out.insert(decl.id.clone(), Value::Object(entry));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::initial_values;
    use crate::model::{
        AbstractDomain, Bounds, CompiledModel, InitialValue, Model, Scope, StateVarDecl,
    };
    use serde_json::json;

    fn sample_compiled() -> CompiledModel {
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
                        id: "rec".into(),
                        domain: AbstractDomain::Record {
                            fields: [("a".into(), AbstractDomain::Bool)].into_iter().collect(),
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!({ "a": false })),
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
    fn structural_equality_distinguishes_nested_values() {
        assert!(values_equal(&json!({"a": 1}), &json!({"a": 1})));
        assert!(!values_equal(&json!({"a": 1}), &json!({"a": 2})));
        assert!(!values_equal(&json!([1, 2]), &json!([1])));
    }

    #[test]
    fn path_read_write_round_trips() {
        let base = json!({"a": {"b": 1}, "items": [10, 20]});
        assert_eq!(read_path(Some(&base), &["a".into(), "b".into()]), json!(1));
        assert_eq!(
            read_path(Some(&base), &["items".into(), "1".into()]),
            json!(20)
        );
        let updated = write_path(&base, &["a".into(), "b".into()], json!(9));
        assert_eq!(
            read_path(Some(&updated), &["a".into(), "b".into()]),
            json!(9)
        );
    }

    #[test]
    fn compact_state_json_round_trip() {
        let compiled = sample_compiled();
        let mut json_state = Map::new();
        for decl in &compiled.model.vars {
            for value in initial_values(&decl.domain, &decl.initial) {
                json_state.insert(decl.id.clone(), value);
                break;
            }
        }
        let state = ModelState::from_json(&compiled, &json_state).unwrap();
        let round = state.to_json(&compiled);
        assert_eq!(round.get("rec"), json_state.get("rec"));
    }

    #[test]
    fn changed_var_indexes_uses_dense_indexes() {
        let compiled = sample_compiled();
        let mut pre = ModelState::new(vec![Value::Null; compiled.model.vars.len()]);
        let mut post = pre.clone();
        let rec_idx = *compiled.var_index.get("rec").unwrap();
        pre.values[rec_idx] = json!({"a": false});
        post.values[rec_idx] = json!({"a": true});
        let changed = changed_var_indexes(&pre, &post);
        assert_eq!(changed, std::collections::HashSet::from([rec_idx]));
    }
}
