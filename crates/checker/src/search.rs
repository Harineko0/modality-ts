use crate::canon::canonical_identity;
use crate::diagnostics::{record_max_depth_bound_hits, vacuity_warnings};
use crate::domain::{initial_changed_var_indexes, initial_states};
use crate::effect::{apply_effect, effect_contains_enqueue};
use crate::graph::{resolve_edge_mode, GraphRecording};
use crate::model::{CheckOptionsIR, CheckRequest, CompiledModel, Model};
use crate::property::{finalize_properties, observe_edge, observe_states};
use crate::report::{build_check_result, invalid_model_result};
use crate::state::ModelState;
use crate::step::facts;
use crate::stabilize::{enabled_transitions, sort_states_by_canon, stabilize};
use crate::trace::{Parent, TraceContext};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

pub fn check_model_request(request: CheckRequest) -> Result<Value, String> {
    let sliced = request
        .options
        .as_ref()
        .and_then(|options| options.sliced_model)
        .unwrap_or(false);
    match CompiledModel::compile(request.model, sliced) {
        Ok(compiled) => {
            check_model_compiled(&compiled, &request.properties, request.options.as_ref())
        }
        Err(errors) => Ok(invalid_model_result(&request.properties, &errors)),
    }
}

pub fn check_model_compiled(
    compiled: &CompiledModel,
    properties: &[crate::model::PropertyIR],
    options: Option<&CheckOptionsIR>,
) -> Result<Value, String> {
    let options = options.cloned().unwrap_or(CheckOptionsIR {
        slicing: None,
        sliced_model: None,
        max_states: None,
        max_edges: None,
        max_frontier: None,
        track_elapsed: None,
    });

    let started = if options.track_elapsed == Some(true) {
        Some(Instant::now())
    } else {
        None
    };

    let mut parents: HashMap<Vec<u8>, crate::trace::Parent> = HashMap::new();
    let mut states: HashMap<Vec<u8>, ModelState> = HashMap::new();
    let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    let mut canon_fn = |state: &ModelState| -> Vec<u8> {
        let identity = canonical_identity(compiled, state);
        canon_cache
            .entry(identity.bytes.clone())
            .or_insert_with(|| identity.bytes.clone());
        identity.bytes
    };

    let graph_mode = resolve_edge_mode(properties);
    let mut graph = GraphRecording::new(graph_mode);
    let mut enabled_transition_ids = HashSet::new();
    let mut bound_hits = HashSet::new();
    let mut verdicts: HashMap<String, Value> = HashMap::new();

    let mut max_frontier = 0u32;
    let mut final_frontier = 0u32;
    let mut expanded_depths = 0u32;
    let mut limit_hit: Option<Value> = None;
    let mut dominant_vars: HashMap<String, HashSet<String>> = compiled
        .model
        .vars
        .iter()
        .map(|v| (v.id.clone(), HashSet::new()))
        .collect();

    let mut frontier = seed_frontier(compiled, &mut parents, &mut states, &mut canon_fn);
    max_frontier = max_frontier.max(frontier.len() as u32);
    final_frontier = frontier.len() as u32;

    let trace_ctx = TraceContext {
        compiled,
        parents: &parents,
        states: &states,
    };
    observe_states(compiled, properties, &frontier, &trace_ctx, &mut verdicts);
    record_dominant_vars(compiled, &frontier, &mut dominant_vars);

    let mut depth = 0u32;
    let mut edge_count = 0u32;

    while !frontier.is_empty()
        && depth < compiled.model.bounds.max_depth
        && limit_hit.is_none()
    {
        max_frontier = max_frontier.max(frontier.len() as u32);
        final_frontier = frontier.len() as u32;

        if let Some(limit) = check_search_limits(
            &options,
            parents.len() as u32,
            edge_count,
            frontier.len() as u32,
        ) {
            limit_hit = Some(limit);
            break;
        }

        let explore = explore_depth(
            compiled,
            properties,
            &frontier,
            &mut parents,
            &mut states,
            &mut graph,
            &mut verdicts,
            &mut enabled_transition_ids,
            &mut bound_hits,
            &options,
            edge_count,
            depth,
            &mut canon_fn,
        )?;
        frontier = explore.next;
        edge_count += explore.edges;

        let trace_ctx = TraceContext {
            compiled,
            parents: &parents,
            states: &states,
        };
        observe_states(compiled, properties, &frontier, &trace_ctx, &mut verdicts);
        record_dominant_vars(compiled, &frontier, &mut dominant_vars);
        depth += 1;
        expanded_depths = depth;

        if let Some(limit) = check_search_limits(
            &options,
            parents.len() as u32,
            edge_count,
            frontier.len() as u32,
        ) {
            limit_hit = Some(limit);
            break;
        }
    }

    record_max_depth_bound_hits(
        &compiled.model,
        &frontier,
        &mut enabled_transition_ids,
        &mut bound_hits,
        compiled,
    );

    let trace_ctx = TraceContext {
        compiled,
        parents: &parents,
        states: &states,
    };

    if let Some(limit) = &limit_hit {
        apply_search_limit_verdicts(properties, &mut verdicts, limit);
    } else {
        finalize_properties(compiled, properties, &trace_ctx, &graph, &mut verdicts);
    }

    let mut bound_hit_list: Vec<String> = bound_hits.into_iter().collect();
    bound_hit_list.sort();

    let dominant: Vec<Value> = {
        let mut entries: Vec<_> = dominant_vars
            .into_iter()
            .map(|(var_id, values)| (var_id, values.len()))
            .filter(|(_, count)| *count > 0)
            .collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        entries
            .into_iter()
            .take(5)
            .map(|(var_id, distinct_values)| {
                json!({ "varId": var_id, "distinctValues": distinct_values })
            })
            .collect()
    };

    let mut search_diag = json!({
        "maxFrontier": max_frontier,
        "finalFrontier": final_frontier,
        "expandedDepths": expanded_depths,
    });
    if let Some(started) = started {
        search_diag
            .as_object_mut()
            .unwrap()
            .insert("elapsedMs".into(), json!(started.elapsed().as_millis()));
    }

    let storage = json!({
        "recordedEdges": match graph.mode {
            crate::graph::EdgeRecordingMode::None => 0,
            crate::graph::EdgeRecordingMode::Reverse => graph.reverse_edges.len(),
            crate::graph::EdgeRecordingMode::Compact => graph.compact_edges.len(),
            crate::graph::EdgeRecordingMode::Full => graph.full_edges.len(),
        },
        "storedStates": states.len(),
        "parentEntries": parents.len(),
        "edgeRecordingMode": match graph.mode {
            crate::graph::EdgeRecordingMode::None => "none",
            crate::graph::EdgeRecordingMode::Reverse => "reverse",
            crate::graph::EdgeRecordingMode::Compact => "compact",
            crate::graph::EdgeRecordingMode::Full => "full",
        },
    });

    let mut diagnostics = json!({
        "search": search_diag,
        "storage": storage,
        "hotPath": {
            "canonicalCache": true,
            "transitionIndex": true,
            "internalTransitionIndex": !compiled.internal.is_empty(),
        },
        "slicing": {
            "enabled": options.slicing == Some(true),
        },
    });
    if let Some(limit) = limit_hit {
        diagnostics
            .as_object_mut()
            .unwrap()
            .insert("limits".into(), limit);
    }
    if !dominant.is_empty() {
        diagnostics
            .as_object_mut()
            .unwrap()
            .insert("dominantVars".into(), Value::Array(dominant));
    }

    Ok(build_check_result(
        properties,
        &verdicts,
        json!({ "states": parents.len(), "edges": edge_count, "depth": depth }),
        vacuity_warnings(&compiled.model, &states, &enabled_transition_ids),
        bound_hit_list,
        Some(diagnostics),
    ))
}

struct ExploreResult {
    next: Vec<ModelState>,
    edges: u32,
}

fn seed_frontier(
    compiled: &CompiledModel,
    parents: &mut HashMap<Vec<u8>, crate::trace::Parent>,
    states: &mut HashMap<Vec<u8>, ModelState>,
    canon: &mut dyn FnMut(&ModelState) -> Vec<u8>,
) -> Vec<ModelState> {
    let changed = initial_changed_var_indexes(compiled);
    let frontier = sort_states_by_canon(
        initial_states(compiled)
            .into_iter()
            .flat_map(|state| stabilize(compiled, state, changed.clone(), canon).unwrap_or_default())
            .collect(),
        canon,
    );
    for state in &frontier {
        let key = canon(state);
        if !parents.contains_key(&key) {
            parents.insert(
                key.clone(),
                Parent {
                    parent: None,
                    transition_id: None,
                },
            );
            states.insert(key, state.clone());
        }
    }
    frontier
}

fn explore_depth(
    compiled: &CompiledModel,
    properties: &[crate::model::PropertyIR],
    frontier: &[ModelState],
    parents: &mut HashMap<Vec<u8>, crate::trace::Parent>,
    states: &mut HashMap<Vec<u8>, ModelState>,
    graph: &mut GraphRecording,
    verdicts: &mut HashMap<String, Value>,
    enabled_transition_ids: &mut HashSet<String>,
    bound_hits: &mut HashSet<String>,
    options: &CheckOptionsIR,
    starting_edge_count: u32,
    depth: u32,
    canon: &mut dyn FnMut(&ModelState) -> Vec<u8>,
) -> Result<ExploreResult, String> {
    let mut next = Vec::new();
    let mut edge_count = 0u32;
    let mut limit_hit = false;

    for pre in frontier {
        if limit_hit {
            break;
        }
        let pre_canon = canon(pre);
        for transition in enabled_transitions(compiled, pre) {
            enabled_transition_ids.insert(transition.id.clone());
            let mut bound_callback = |hit: &str| {
                let msg = if hit.starts_with("token cap exhausted") {
                    format!("token cap exhausted at {}", transition.id)
                } else {
                    format!("{hit} at {}", transition.id)
                };
                bound_hits.insert(msg);
            };
            let posts = apply_effect(
                compiled,
                pre,
                &transition.effect,
                &mut crate::expr::EvalOptions {
                    on_bound_hit: Some(&mut bound_callback),
                },
            )?;
            if posts.is_empty() && effect_contains_enqueue(&transition.effect) {
                bound_hits.insert(format!("pending cap saturated at {}", transition.id));
            }
            for raw_post in posts {
                let changed = crate::state::changed_var_indexes(pre, &raw_post);
                let stabilized = stabilize(compiled, raw_post, changed, canon).unwrap_or_default();
                for post in stabilized {
                    edge_count += 1;
                    let post_canon = canon(&post);
                    let step = facts(compiled, pre, &post, transition);
                    graph.record(
                        properties,
                        &pre_canon,
                        &post_canon,
                        pre,
                        &post,
                        transition,
                        &step,
                    );
                    let trace_ctx = TraceContext {
                        compiled,
                        parents,
                        states,
                    };
                    observe_edge(
                        compiled,
                        properties,
                        pre,
                        &post,
                        transition,
                        &step,
                        &trace_ctx,
                        verdicts,
                    );
                    if hit_search_limit(
                        options,
                        parents.len() as u32,
                        starting_edge_count + edge_count,
                        next.len(),
                    ) {
                        limit_hit = true;
                        break;
                    }
                    if !parents.contains_key(&post_canon) {
                        parents.insert(
                            post_canon.clone(),
                            Parent {
                                parent: Some(pre_canon.clone()),
                                transition_id: Some(transition.id.clone()),
                            },
                        );
                        states.insert(post_canon.clone(), post.clone());
                        next.push(post);
                        if hit_search_limit(
                            options,
                            parents.len() as u32,
                            starting_edge_count + edge_count,
                            next.len(),
                        ) {
                            limit_hit = true;
                            break;
                        }
                    }
                }
                if limit_hit {
                    break;
                }
            }
            if limit_hit {
                break;
            }
        }
    }
    Ok(ExploreResult {
        next: sort_states_by_canon(next, canon),
        edges: edge_count,
    })
}

fn hit_search_limit(
    options: &CheckOptionsIR,
    states: u32,
    edges: u32,
    frontier: usize,
) -> bool {
    check_search_limits(options, states, edges, frontier as u32).is_some()
}

fn check_search_limits(
    options: &CheckOptionsIR,
    states: u32,
    edges: u32,
    frontier: u32,
) -> Option<Value> {
    if let Some(max) = options.max_states {
        if states >= max {
            return Some(json!({
                "reason": format!("search limit exceeded: maxStates={max}"),
                "maxStates": max,
            }));
        }
    }
    if let Some(max) = options.max_edges {
        if edges >= max {
            return Some(json!({
                "reason": format!("search limit exceeded: maxEdges={max}"),
                "maxEdges": max,
            }));
        }
    }
    if let Some(max) = options.max_frontier {
        if frontier >= max {
            return Some(json!({
                "reason": format!("search limit exceeded: maxFrontier={max}"),
                "maxFrontier": max,
            }));
        }
    }
    let _ = frontier;
    None
}

fn apply_search_limit_verdicts(
    properties: &[crate::model::PropertyIR],
    verdicts: &mut HashMap<String, Value>,
    limit: &Value,
) {
    let reason = limit
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("search limit exceeded");
    for property in properties {
        let name = match property {
            crate::model::PropertyIR::Always { name, .. }
            | crate::model::PropertyIR::Reachable { name, .. }
            | crate::model::PropertyIR::AlwaysStep { name, .. }
            | crate::model::PropertyIR::ReachableFrom { name, .. }
            | crate::model::PropertyIR::LeadsToWithin { name, .. } => name,
        };
        if let Some(verdict) = verdicts.get(name) {
            let status = verdict.get("status").and_then(|v| v.as_str()).unwrap_or("");
            if matches!(
                status,
                "violated" | "reachable" | "vacuous-warning" | "error"
            ) {
                continue;
            }
        }
        verdicts.insert(
            name.clone(),
            json!({
                "status": "error",
                "property": name,
                "message": reason,
            }),
        );
    }
}

fn record_dominant_vars(
    compiled: &CompiledModel,
    frontier: &[ModelState],
    tracker: &mut HashMap<String, HashSet<String>>,
) {
    for state in frontier {
        for (idx, decl) in compiled.model.vars.iter().enumerate() {
            if let Some(values) = tracker.get_mut(&decl.id) {
                values.insert(serde_json::to_string(&state.values[idx]).unwrap_or_default());
            }
        }
    }
}

pub fn model_initial_states(model: Model) -> Result<Vec<serde_json::Map<String, Value>>, String> {
    let compiled = CompiledModel::compile(model, false)?;
    let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    let mut canon_fn = |state: &ModelState| -> Vec<u8> {
        let identity = canonical_identity(&compiled, state);
        canon_cache
            .entry(identity.bytes.clone())
            .or_insert_with(|| identity.bytes.clone());
        identity.bytes
    };
    let changed = initial_changed_var_indexes(&compiled);
    Ok(sort_states_by_canon(
        initial_states(&compiled)
            .into_iter()
            .flat_map(|state| {
                stabilize(&compiled, state, changed.clone(), &mut canon_fn).unwrap_or_default()
            })
            .collect(),
        &mut canon_fn,
    )
    .into_iter()
    .map(|state| state.to_json(&compiled))
    .collect())
}

pub fn model_successors(
    model: Model,
    pre: serde_json::Map<String, Value>,
) -> Result<Vec<Value>, String> {
    let compiled = CompiledModel::compile(model, false)?;
    let pre = ModelState::from_json(&compiled, &pre)?;
    let mut out = Vec::new();
    for transition in enabled_transitions(&compiled, &pre) {
        for raw_post in apply_effect(
            &compiled,
            &pre,
            &transition.effect,
            &mut crate::expr::EvalOptions::default(),
        )
        .unwrap_or_default()
        {
            let changed = crate::state::changed_var_indexes(&pre, &raw_post);
            let mut canon_fn =
                |s: &ModelState| canonical_identity(&compiled, s).bytes;
            if let Ok(posts) = stabilize(&compiled, raw_post, changed, &mut canon_fn) {
                for post in posts {
                    out.push(crate::trace::make_trace_step(&compiled, &pre, &post, transition));
                }
            }
        }
    }
    Ok(out)
}
