use crate::domain::initial_values;
use crate::expr::{eval_expr, EvalOptions};
use crate::model::{CompiledModel, ExprIR, Model, ModelState, UNMOUNTED};
use crate::state::{clone_state, set_var};
use serde_json::Value;

pub fn navigate(
    compiled: &CompiledModel,
    state: &ModelState,
    mode: &str,
    to: Option<&ExprIR>,
    options: &mut EvalOptions,
) -> Result<Vec<ModelState>, crate::effect::EffectError> {
    let route = state.get("sys:route").cloned();
    let history = state
        .get("sys:history")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if mode == "back" {
        let previous = history.last().and_then(|v| v.as_str());
        if previous.is_none() {
            return Ok(vec![state.clone()]);
        }
        let previous = previous.unwrap().to_string();
        let mut next = clone_state(state);
        set_var(&mut next, "sys:route", Value::String(previous));
        set_var(
            &mut next,
            "sys:history",
            Value::Array(history[..history.len().saturating_sub(1)].to_vec()),
        );
        return Ok(reset_route_locals(
            &compiled.model,
            next,
            route.as_ref(),
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
        if let Some(Value::String(r)) = &route {
            let mut h = history;
            h.push(Value::String(r.clone()));
            h
        } else {
            history
        }
    } else {
        history
    };

    let mut next = clone_state(state);
    set_var(&mut next, "sys:route", Value::String(to_str));
    set_var(&mut next, "sys:history", Value::Array(next_history));
    Ok(reset_route_locals(
        &compiled.model,
        next,
        route.as_ref(),
        false,
    ))
}

pub fn normalize_initial_route_locals(model: &Model, state: ModelState) -> Vec<ModelState> {
    reset_route_locals(model, state, None, true)
}

fn reset_route_locals(
    model: &Model,
    state: ModelState,
    previous_route: Option<&Value>,
    preserve_mounted: bool,
) -> Vec<ModelState> {
    let current_route = state.get("sys:route").cloned();
    if previous_route == current_route.as_ref() {
        return vec![state];
    }
    let mut states = vec![state];
    for decl in &model.vars {
        let route_local = match &decl.scope {
            crate::model::Scope::RouteLocal { route, .. } => Some(route.as_str()),
            _ => None,
        };
        if route_local.is_none() {
            continue;
        }
        let route = route_local.unwrap();
        if current_route.as_ref() == Some(&Value::String(route.to_string())) {
            if preserve_mounted {
                continue;
            }
            let initials = initial_values(&decl.domain, &decl.initial);
            let mut next_states = Vec::new();
            for candidate in states {
                for value in &initials {
                    let mut s = candidate.clone();
                    s.insert(decl.id.clone(), value.clone());
                    next_states.push(s);
                }
            }
            states = next_states;
        } else {
            states = states
                .into_iter()
                .map(|mut candidate| {
                    candidate.insert(
                        decl.id.clone(),
                        Value::String(UNMOUNTED.to_string()),
                    );
                    candidate
                })
                .collect();
        }
    }
    states
}
