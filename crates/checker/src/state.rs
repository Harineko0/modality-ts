use crate::model::ModelState;
use serde_json::Value;

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
            _ => serde_json::Map::new(),
        };
        let existing = obj.get(head).cloned().unwrap_or(Value::Null);
        obj.insert(head.clone(), write_path(&existing, tail, value));
        Value::Object(obj)
    }
}

pub fn clone_state(state: &ModelState) -> ModelState {
    state.clone()
}

pub fn set_var(state: &mut ModelState, var: &str, value: Value) {
    state.insert(var.to_string(), value);
}

pub fn get_var<'a>(state: &'a ModelState, var: &str) -> Option<&'a Value> {
    state.get(var)
}

pub fn values_equal(a: &Value, b: &Value) -> bool {
    serde_json::to_string(a).unwrap_or_default() == serde_json::to_string(b).unwrap_or_default()
}

pub fn is_record(value: &Value) -> bool {
    value.is_object()
}
