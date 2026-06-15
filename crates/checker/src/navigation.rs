use crate::domain::initial_values;
use crate::expr::{eval_expr, EvalOptions};
use crate::model::{CompiledModel, ExprIR, UNMOUNTED};
use crate::state::ModelState;
use serde_json::Value;

pub fn navigate(
    compiled: &CompiledModel,
    state: &ModelState,
    mode: &str,
    to: Option<&ExprIR>,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, crate::effect::EffectError> {
    let route_idx = compiled
        .sys_route_index
        .ok_or_else(|| crate::effect::EffectError::TokenExhausted("sys:route".into()))?;
    let history_idx = compiled
        .sys_history_index
        .ok_or_else(|| crate::effect::EffectError::TokenExhausted("sys:history".into()))?;

    let route = state.get(route_idx).clone();
    let history = state
        .get(history_idx)
        .as_array()
        .cloned()
        .unwrap_or_default();

    if mode == "back" {
        let previous = history.last().and_then(|v| v.as_str());
        if previous.is_none() {
            return Ok(vec![state.clone()]);
        }
        let previous = previous.unwrap().to_string();
        let mut next = state.clone();
        next.values[route_idx] = Value::String(previous);
        next.values[history_idx] = Value::Array(history[..history.len().saturating_sub(1)].to_vec());
        return Ok(reset_route_locals(
            compiled,
            next,
            Some(&route),
            false,
        ));
    }

    let to_val = to.map(|expr| eval_expr(compiled, state, expr, options));
    let to_str = to_val.as_ref().and_then(|v| v.as_str());
    if to_str.is_none() {
        return Ok(vec![state.clone()]);
    }
    let to_str = to_str.unwrap().to_string();

    let history_cap = compiled
        .var_decl("sys:history")
        .and_then(|decl| {
            if let crate::model::AbstractDomain::BoundedList { max_len, .. } = &decl.domain {
                Some(*max_len)
            } else {
                None
            }
        });

    if mode == "push" {
        if let Some(cap) = history_cap {
            if history.len() >= cap as usize {
                if let Some(hit) = options.on_bound_hit.as_mut() {
                    hit("history cap saturated");
                }
                return Ok(vec![]);
            }
        }
    }

    let next_history = if mode == "push" {
        if let Value::String(r) = &route {
            let mut h = history;
            h.push(Value::String(r.clone()));
            h
        } else {
            history
        }
    } else {
        history
    };

    let mut next = state.clone();
    next.values[route_idx] = Value::String(to_str);
    next.values[history_idx] = Value::Array(next_history);
    Ok(reset_route_locals(
        compiled,
        next,
        Some(&route),
        false,
    ))
}

pub fn normalize_initial_route_locals(
    compiled: &CompiledModel,
    state: ModelState,
) -> Vec<ModelState> {
    reset_route_locals(compiled, state, None, true)
}

fn reset_route_locals(
    compiled: &CompiledModel,
    state: ModelState,
    previous_route: Option<&Value>,
    preserve_mounted: bool,
) -> Vec<ModelState> {
    let route_idx = match compiled.sys_route_index {
        Some(idx) => idx,
        None => return vec![state],
    };
    let current_route = state.get(route_idx).clone();
    if previous_route == Some(&current_route) {
        return vec![state];
    }
    let mut states = vec![state];
    for (var_idx, decl) in compiled.model.vars.iter().enumerate() {
        let route_local = match &decl.scope {
            crate::model::Scope::RouteLocal { route, .. } => Some(route.as_str()),
            _ => None,
        };
        if route_local.is_none() {
            continue;
        }
        let route = route_local.unwrap();
        if current_route == Value::String(route.to_string()) {
            if preserve_mounted {
                continue;
            }
            let initials = initial_values(&decl.domain, &decl.initial);
            let mut next_states = Vec::new();
            for candidate in states {
                for value in &initials {
                    let mut s = candidate.clone();
                    s.values[var_idx] = value.clone();
                    next_states.push(s);
                }
            }
            states = next_states;
        } else {
            states = states
                .into_iter()
                .map(|mut candidate| {
                    candidate.values[var_idx] = Value::String(UNMOUNTED.to_string());
                    candidate
                })
                .collect();
        }
    }
    states
}
