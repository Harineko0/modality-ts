use crate::canon::canonical_identity;
use crate::diagnostics::{record_max_depth_bound_hits, vacuity_warnings};
use crate::domain::{initial_changed_var_indexes, initial_states};
use crate::effect::{apply_effect, effect_contains_enqueue};
use crate::frontier::{chunk_frontier, sort_frontier_by_canon};
use crate::graph::{resolve_edge_mode, GraphRecording};
use crate::model::{CheckOptionsIR, CheckRequest, CompiledModel, Model};
use crate::por::{
    build_por_context, select_enabled_transitions, PorContext, PorMode, PorRunStats,
};
use crate::property::{all_properties_terminal, finalize_properties, observe_edge, observe_states};
use crate::report::{build_check_result, invalid_model_result};
use crate::stabilize::{sort_states_by_canon, stabilize};
use crate::state::ModelState;
use crate::step::facts;
use crate::trace::TraceContext;
use crate::transition_index::enabled_non_internal;
use crate::visited::{sort_merge_candidates, MergeCandidate, StateId, VisitedSet};
use rayon::prelude::*;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
    let result = check_model_compiled_once(compiled, properties, options)?;
    let options = options.cloned().unwrap_or(default_check_options());
    let por_context = build_por_context(compiled, properties, &options);
    if por_context.mode == PorMode::Active && result_has_violation(&result) {
        let mut rerun_options = options;
        rerun_options.partial_order_reduction = Some(false);
        let mut rerun = check_model_compiled_once(compiled, properties, Some(&rerun_options))?;
        if let Some(diagnostics) = rerun.get_mut("diagnostics").and_then(|v| v.as_object_mut()) {
            let mut por_diag = result
                .pointer("/diagnostics/partialOrderReduction")
                .cloned()
                .unwrap_or_else(|| {
                    json!({
                        "requested": true,
                        "enabled": true,
                        "fullExplorationStates": 0,
                        "reducedStates": 0,
                        "fullEnabledTransitions": 0,
                        "exploredTransitions": 0,
                        "skippedTransitions": 0,
                        "cycleFallbackStates": 0,
                        "reasonCounts": [],
                    })
                });
            if let Some(por_obj) = por_diag.as_object_mut() {
                por_obj.insert("violationRerun".into(), json!(true));
            }
            diagnostics.insert("partialOrderReduction".into(), por_diag);
        }
        return Ok(rerun);
    }
    Ok(result)
}

fn result_has_violation(result: &Value) -> bool {
    result
        .pointer("/verdicts")
        .and_then(|v| v.as_array())
        .is_some_and(|verdicts| {
            verdicts.iter().any(|verdict| {
                verdict.get("status").and_then(|v| v.as_str()) == Some("violated")
            })
        })
}

fn default_check_options() -> CheckOptionsIR {
    CheckOptionsIR {
        slicing: None,
        sliced_model: None,
        partial_order_reduction: None,
        max_states: None,
        max_edges: None,
        max_frontier: None,
        track_elapsed: None,
        memory_guard_bytes: None,
    }
}

fn check_model_compiled_once(
    compiled: &CompiledModel,
    properties: &[crate::model::PropertyIR],
    options: Option<&CheckOptionsIR>,
) -> Result<Value, String> {
    let options = options.cloned().unwrap_or_else(default_check_options);
    let por_context = build_por_context(compiled, properties, &options);
    let por_requested = options.partial_order_reduction == Some(true);
    let mut por_stats = PorRunStats::default();

    let started = if options.track_elapsed == Some(true) {
        Some(Instant::now())
    } else {
        None
    };

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
    let mut final_frontier;
    let mut expanded_depths = 0u32;
    let mut limit_hit: Option<Value> = None;
    let mut dominant_vars: HashMap<String, HashSet<String>> = compiled
        .model
        .vars
        .iter()
        .map(|v| (v.id.clone(), HashSet::new()))
        .collect();

    let mut visited = VisitedSet::new(8);
    let mut frontier = seed_frontier(compiled, &mut visited, &mut canon_fn);
    max_frontier = max_frontier.max(frontier.len() as u32);
    final_frontier = frontier.len() as u32;

    let trace_ctx = trace_context(compiled, &visited);
    observe_states(
        compiled,
        properties,
        &frontier_states(&visited, &frontier),
        &trace_ctx,
        &mut verdicts,
    );
    record_dominant_vars(
        compiled,
        &frontier_states(&visited, &frontier),
        &mut dominant_vars,
    );

    let mut depth = 0u32;
    let mut edge_count = 0u32;

    if all_properties_terminal(properties, &verdicts) {
        // All properties already have decisive verdicts; skip search.
    } else {
        while !frontier.is_empty()
            && depth < compiled.model.bounds.max_depth
            && limit_hit.is_none()
            && !all_properties_terminal(properties, &verdicts)
        {
        max_frontier = max_frontier.max(frontier.len() as u32);
        final_frontier = frontier.len() as u32;

        if let Some(limit) = check_search_limits(
            &options,
            visited.len() as u32,
            edge_count,
            frontier.len() as u32,
            "frontier",
        )
        .or_else(|| check_memory_guard(&options))
        {
            limit_hit = Some(limit);
            break;
        }

        let explore = explore_depth_parallel(
            compiled,
            properties,
            &frontier,
            &mut visited,
            &mut graph,
            &mut verdicts,
            &mut enabled_transition_ids,
            &mut bound_hits,
            &options,
            edge_count,
            &mut canon_fn,
            &por_context,
            &mut por_stats,
        )?;

        if let Some(limit) = explore.limit_hit {
            limit_hit = Some(limit);
        }
        if explore.all_terminal {
            frontier.clear();
        } else {
            frontier = explore.next;
        }
        edge_count += explore.edges;

        let trace_ctx = trace_context(compiled, &visited);
        observe_states(
            compiled,
            properties,
            &frontier_states(&visited, &frontier),
            &trace_ctx,
            &mut verdicts,
        );
        record_dominant_vars(
            compiled,
            &frontier_states(&visited, &frontier),
            &mut dominant_vars,
        );
        depth += 1;
        expanded_depths = depth;

        if limit_hit.is_none() {
            if let Some(limit) = check_search_limits(
                &options,
                visited.len() as u32,
                edge_count,
                frontier.len() as u32,
                "frontier",
            )
            .or_else(|| check_memory_guard(&options))
            {
                limit_hit = Some(limit);
            }
        }
        }
    }

    record_max_depth_bound_hits(
        &compiled.model,
        &frontier_states(&visited, &frontier),
        &mut enabled_transition_ids,
        &mut bound_hits,
        compiled,
    );

    let trace_ctx = trace_context(compiled, &visited);

    if let Some(limit) = &limit_hit {
        apply_search_limit_verdicts(properties, &mut verdicts, limit);
    } else {
        // Collect initial state canonical bytes for the CTL engine
        let initial_canons: Vec<Vec<u8>> = {
            let changed = crate::domain::initial_changed_var_indexes(compiled);
            crate::domain::initial_states(compiled)
                .into_iter()
                .flat_map(|state| {
                    crate::stabilize::stabilize(compiled, state, changed.clone(), &mut |s| {
                        crate::canon::canonical_key(compiled, s)
                    })
                    .unwrap_or_default()
                })
                .map(|state| crate::canon::canonical_key(compiled, &state))
                .collect()
        };
        let exhaustive = frontier.is_empty();
        finalize_properties(compiled, properties, &trace_ctx, &graph, &mut verdicts, &initial_canons, exhaustive);
    }

    let mut bound_hit_list: Vec<String> = bound_hits.into_iter().collect();
    bound_hit_list.sort();

    let dominant: Vec<Value> = {
        let mut entries: Vec<_> = dominant_vars
            .into_iter()
            .map(|(var_id, values)| (var_id, values.len()))
            .filter(|(_, count)| *count > 0)
            .collect();
        entries.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
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
        },
        "storedStates": visited.arena.len(),
        "parentEntries": visited.len(),
        "edgeRecordingMode": match graph.mode {
            crate::graph::EdgeRecordingMode::None => "none",
            crate::graph::EdgeRecordingMode::Reverse => "reverse",
            crate::graph::EdgeRecordingMode::Compact => "compact",
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
    if por_requested {
        let por_enabled = por_context.mode == PorMode::Active;
        let por_skipped = por_context.mode == PorMode::Skipped;
        diagnostics.as_object_mut().unwrap().insert(
            "partialOrderReduction".into(),
            por_stats.to_diagnostics_value(
                por_requested,
                por_enabled,
                por_skipped,
                por_context.skip_reason.as_deref(),
            ),
        );
    }

    Ok(build_check_result(
        properties,
        &verdicts,
        json!({ "states": visited.len(), "edges": edge_count, "depth": depth }),
        vacuity_warnings_from_visited(compiled, &visited, &enabled_transition_ids),
        bound_hit_list,
        Some(diagnostics),
    ))
}

struct ExploreResult {
    next: Vec<StateId>,
    edges: u32,
    limit_hit: Option<Value>,
    all_terminal: bool,
}

#[derive(Debug)]
struct ExpansionBudget<'a> {
    options: &'a CheckOptionsIR,
    starting_edge_count: u32,
    starting_state_count: u32,
    generated_edges: AtomicU32,
    generated_new_states: AtomicU32,
    stop: AtomicBool,
}

impl<'a> ExpansionBudget<'a> {
    fn new(
        options: &'a CheckOptionsIR,
        starting_edge_count: u32,
        starting_state_count: u32,
    ) -> Self {
        Self {
            options,
            starting_edge_count,
            starting_state_count,
            generated_edges: AtomicU32::new(0),
            generated_new_states: AtomicU32::new(0),
            stop: AtomicBool::new(false),
        }
    }

    fn should_stop(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }

    fn note_generated_edge(&self) {
        if self.should_stop() {
            return;
        }
        let generated = self.generated_edges.fetch_add(1, Ordering::Relaxed) + 1;
        if check_search_limits(
            self.options,
            self.starting_state_count
                + self.generated_new_states.load(Ordering::Relaxed),
            self.starting_edge_count + generated,
            0,
            "generation",
        )
        .is_some()
        {
            self.stop.store(true, Ordering::Relaxed);
        }
    }

    fn note_new_state_candidate(&self) {
        if self.should_stop() {
            return;
        }
        let generated = self.generated_new_states.fetch_add(1, Ordering::Relaxed) + 1;
        if let Some(max) = self.options.max_states {
            if self.starting_state_count + generated >= max {
                self.stop.store(true, Ordering::Relaxed);
            }
        }
    }

    fn limit_hit(&self) -> Option<Value> {
        if !self.should_stop() {
            return None;
        }
        let generated_edges = self.generated_edges.load(Ordering::Relaxed);
        let generated_states = self.generated_new_states.load(Ordering::Relaxed);
        check_search_limits(
            self.options,
            self.starting_state_count + generated_states,
            self.starting_edge_count + generated_edges,
            0,
            "generation",
        )
        .or_else(|| {
            self.options.max_states.and_then(|max| {
                if self.starting_state_count + generated_states >= max {
                    Some(json!({
                        "reason": format!("search limit exceeded: maxStates={max}"),
                        "maxStates": max,
                        "phase": "generation",
                    }))
                } else {
                    None
                }
            })
        })
    }
}

#[derive(Debug, Clone)]
struct GeneratedEdge {
    pre_id: StateId,
    post_canon: Vec<u8>,
    post_state: ModelState,
    transition_id: usize,
    sort_key: (Vec<u8>, usize, Vec<u8>),
}

struct WorkerOutput {
    edges: Vec<GeneratedEdge>,
    candidates: Vec<MergeCandidate>,
    bound_hits: HashSet<String>,
    enabled_transition_ids: HashSet<String>,
    por_stats: PorRunStats,
}

fn seed_frontier(
    compiled: &CompiledModel,
    visited: &mut VisitedSet,
    canon: &mut dyn FnMut(&ModelState) -> Vec<u8>,
) -> Vec<StateId> {
    let changed = initial_changed_var_indexes(compiled);
    let stabilized = sort_states_by_canon(
        initial_states(compiled)
            .into_iter()
            .flat_map(|state| {
                stabilize(compiled, state, changed.clone(), canon).unwrap_or_default()
            })
            .collect(),
        canon,
    );
    let mut frontier = Vec::new();
    for state in stabilized {
        let key = canon(&state);
        let id = visited.insert_seed(state, key);
        frontier.push(id);
    }
    sort_frontier_by_canon(&mut frontier, |id| visited.arena.canon(id).to_vec());
    frontier
}

fn explore_depth_parallel(
    compiled: &CompiledModel,
    properties: &[crate::model::PropertyIR],
    frontier: &[StateId],
    visited: &mut VisitedSet,
    graph: &mut GraphRecording,
    verdicts: &mut HashMap<String, Value>,
    enabled_transition_ids: &mut HashSet<String>,
    bound_hits: &mut HashSet<String>,
    options: &CheckOptionsIR,
    starting_edge_count: u32,
    _canon: &mut dyn FnMut(&ModelState) -> Vec<u8>,
    por_context: &PorContext,
    por_stats: &mut PorRunStats,
) -> Result<ExploreResult, String> {
    let worker_count = rayon::current_num_threads();
    let frontier_positions: HashMap<StateId, u32> = frontier
        .iter()
        .enumerate()
        .map(|(index, &id)| (id, index as u32))
        .collect();
    let chunks = chunk_frontier(frontier, worker_count);

    let budget = ExpansionBudget::new(
        options,
        starting_edge_count,
        visited.len() as u32,
    );
    let worker_outputs: Vec<WorkerOutput> = {
        let visited_ref: &VisitedSet = &*visited;
        let budget_ref = &budget;
        chunks
            .par_iter()
            .map(|chunk| {
                expand_chunk(
                    compiled,
                    chunk,
                    &frontier_positions,
                    visited_ref,
                    Some(budget_ref),
                    por_context,
                )
            })
            .collect::<Result<Vec<_>, String>>()?
    };

    let mut all_edges = Vec::new();
    let mut all_candidates = Vec::new();
    for output in worker_outputs {
        enabled_transition_ids.extend(output.enabled_transition_ids);
        bound_hits.extend(output.bound_hits);
        all_edges.extend(output.edges);
        all_candidates.extend(output.candidates);
        por_stats.merge(&output.por_stats);
    }

    all_edges.sort_by(|a, b| a.sort_key.cmp(&b.sort_key));

    let mut edge_count = 0u32;
    let mut limit_hit = budget.limit_hit();
    let mut all_terminal = false;
    let trace_ctx = trace_context(compiled, visited);

    for edge in &all_edges {
        if limit_hit.is_some() || all_terminal {
            break;
        }
        edge_count += 1;
        let pre = visited.arena.state(edge.pre_id);
        let pre_canon = visited.arena.canon(edge.pre_id);
        let transition = compiled.transition(edge.transition_id);
        enabled_transition_ids.insert(transition.id.clone());
        let step = facts(compiled, pre, &edge.post_state, transition);
        let post_id = visited.id_of(&edge.post_canon);
        graph.record_with_ids(
            compiled,
            properties,
            pre_canon,
            &edge.post_canon,
            Some(edge.pre_id),
            post_id,
            pre,
            &edge.post_state,
            transition,
            &step,
        );
        observe_edge(
            compiled,
            properties,
            pre,
            &edge.post_state,
            transition,
            &step,
            &trace_ctx,
            verdicts,
        );
        if all_properties_terminal(properties, verdicts) {
            all_terminal = true;
            break;
        }
        if let Some(limit) = check_search_limits(
            options,
            visited.len() as u32,
            starting_edge_count + edge_count,
            0,
            "edge-recording",
        ) {
            limit_hit = Some(limit);
        }
    }

    let mut next = Vec::new();
    if limit_hit.is_none() && !all_terminal {
        let sorted = sort_merge_candidates(visited, all_candidates);
        for candidate in sorted {
            if visited.contains_canon(&candidate.post_canon) {
                continue;
            }
            if let Some(limit) = check_search_limits(
                options,
                visited.len() as u32,
                starting_edge_count + edge_count,
                next.len() as u32,
                "candidate-merge",
            ) {
                limit_hit = Some(limit);
                break;
            }
            let id = visited.insert_child(
                compiled,
                candidate.post_state,
                candidate.post_canon,
                candidate.parent_id,
                candidate.transition_id,
            );
            next.push(id);
        }
        sort_frontier_by_canon(&mut next, |id| visited.arena.canon(id).to_vec());
    }

    Ok(ExploreResult {
        next,
        edges: edge_count,
        limit_hit,
        all_terminal,
    })
}

fn expand_chunk(
    compiled: &CompiledModel,
    chunk: &[StateId],
    frontier_positions: &HashMap<StateId, u32>,
    visited: &VisitedSet,
    budget: Option<&ExpansionBudget<'_>>,
    por_context: &PorContext,
) -> Result<WorkerOutput, String> {
    let mut edges = Vec::new();
    let mut candidates = Vec::new();
    let mut bound_hits = HashSet::new();
    let mut enabled_transition_ids = HashSet::new();
    let mut por_stats = PorRunStats::default();
    let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    let mut canon = |state: &ModelState| -> Vec<u8> {
        let identity = canonical_identity(compiled, state);
        canon_cache
            .entry(identity.bytes.clone())
            .or_insert_with(|| identity.bytes.clone());
        identity.bytes
    };

    'chunk: for &pre_id in chunk {
        if budget.is_some_and(|budget| budget.should_stop()) {
            break;
        }
        let parent_frontier_position = frontier_positions.get(&pre_id).copied().unwrap_or(u32::MAX);
        let pre = visited.arena.state(pre_id);
        let pre_canon = visited.arena.canon(pre_id).to_vec();
        let enabled = enabled_non_internal(compiled, pre);
        let decision = select_enabled_transitions(
            compiled,
            por_context,
            &mut por_stats,
            &enabled,
            pre,
            visited,
            &pre_canon,
        );
        for transition_id in decision.transitions {
            if budget.is_some_and(|budget| budget.should_stop()) {
                break 'chunk;
            }
            let transition = compiled.transition(transition_id);
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
                    step_ctx: None,
                    pre_state: None,
                    resolving_op_args: None,
                },
            )?;
            if posts.is_empty() && effect_contains_enqueue(&transition.effect) {
                bound_hits.insert(format!("pending cap saturated at {}", transition.id));
            }
            for (raw_post_branch, raw_post) in posts.into_iter().enumerate() {
                if budget.is_some_and(|budget| budget.should_stop()) {
                    break 'chunk;
                }
                let changed = crate::state::changed_var_indexes(pre, &raw_post);
                let stabilized =
                    stabilize(compiled, raw_post, changed, &mut canon).unwrap_or_default();
                for (stabilization_branch, post) in stabilized.into_iter().enumerate() {
                    if budget.is_some_and(|budget| budget.should_stop()) {
                        break 'chunk;
                    }
                    let post_canon = canon(&post);
                    let sort_key = (pre_canon.clone(), transition_id, post_canon.clone());
                    if let Some(budget) = budget {
                        budget.note_generated_edge();
                        if budget.should_stop() {
                            break 'chunk;
                        }
                    }
                    edges.push(GeneratedEdge {
                        pre_id,
                        post_canon: post_canon.clone(),
                        post_state: post.clone(),
                        transition_id,
                        sort_key,
                    });
                    if !visited.contains_canon(&post_canon) {
                        if let Some(budget) = budget {
                            budget.note_new_state_candidate();
                        }
                        candidates.push(MergeCandidate {
                            parent_id: pre_id,
                            parent_frontier_position,
                            transition_id,
                            raw_post_branch: raw_post_branch as u32,
                            stabilization_branch: stabilization_branch as u32,
                            post_state: post,
                            post_canon,
                        });
                    }
                }
            }
        }
    }

    Ok(WorkerOutput {
        edges,
        candidates,
        bound_hits,
        enabled_transition_ids,
        por_stats,
    })
}

fn frontier_states(visited: &VisitedSet, frontier: &[StateId]) -> Vec<ModelState> {
    frontier
        .iter()
        .map(|&id| visited.arena.state(id).clone())
        .collect()
}

fn trace_context<'a>(compiled: &'a CompiledModel, visited: &'a VisitedSet) -> TraceContext<'a> {
    TraceContext {
        compiled,
        parents: visited.parents_map(),
        states: visited.states_map(),
    }
}

fn vacuity_warnings_from_visited(
    compiled: &CompiledModel,
    visited: &VisitedSet,
    enabled_transition_ids: &HashSet<String>,
) -> Vec<String> {
    vacuity_warnings(
        &compiled.model,
        visited.states_map(),
        enabled_transition_ids,
    )
}

fn check_search_limits(
    options: &CheckOptionsIR,
    states: u32,
    edges: u32,
    frontier: u32,
    phase: &str,
) -> Option<Value> {
    if let Some(max) = options.max_states {
        if states >= max {
            return Some(json!({
                "reason": format!("search limit exceeded: maxStates={max}"),
                "maxStates": max,
                "phase": phase,
            }));
        }
    }
    if let Some(max) = options.max_edges {
        if edges >= max {
            return Some(json!({
                "reason": format!("search limit exceeded: maxEdges={max}"),
                "maxEdges": max,
                "phase": phase,
            }));
        }
    }
    if let Some(max) = options.max_frontier {
        if frontier >= max {
            return Some(json!({
                "reason": format!("search limit exceeded: maxFrontier={max}"),
                "maxFrontier": max,
                "phase": phase,
            }));
        }
    }
    None
}

fn check_memory_guard(options: &CheckOptionsIR) -> Option<Value> {
    let max = options.memory_guard_bytes?;
    let used = crate::memory::current_process_memory_bytes()?;
    if used >= max {
        return Some(json!({
            "reason": format!("search limit exceeded: memoryGuardBytes={max}"),
            "memoryGuardBytes": max,
        }));
    }
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
            crate::model::PropertyIR::Temporal { name, .. }
            | crate::model::PropertyIR::AlwaysStep { name, .. }
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
    for transition_id in enabled_non_internal(&compiled, &pre) {
        let transition = compiled.transition(transition_id);
        for raw_post in apply_effect(
            &compiled,
            &pre,
            &transition.effect,
            &mut crate::expr::EvalOptions::default(),
        )
        .unwrap_or_default()
        {
            let changed = crate::state::changed_var_indexes(&pre, &raw_post);
            let mut canon_fn = |s: &ModelState| canonical_identity(&compiled, s).bytes;
            if let Ok(posts) = stabilize(&compiled, raw_post, changed, &mut canon_fn) {
                for post in posts {
                    out.push(crate::trace::make_trace_step(
                        &compiled, &pre, &post, transition,
                    ));
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, EffectIR, ExprIR, InitialValue, Model, PropertyIR, Scope,
        StateVarDecl, Transition,
    };
    use crate::visited::merge_candidates;
    use serde_json::json;
    use std::collections::HashMap;

    fn toggle_model() -> CompiledModel {
        CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "toggle".into(),
                vars: vec![
                    StateVarDecl {
                        id: "sys:route".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/")),

                        role: None,
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

                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:pending".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),

                        role: None,
                    },
                    StateVarDecl {
                        id: "x".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("test"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),

                        role: None,
                    },
                ],
                transitions: vec![Transition {
                    id: "t-set".into(),
                    cls: "user".into(),
                    label: json!({"kind": "click"}),
                    source: vec![],
                    guard: ExprIR::Lit { value: json!(true) },
                    effect: EffectIR::Assign {
                        var: "x".into(),
                        expr: ExprIR::Lit { value: json!(true) },
                    },
                    reads: vec![],
                    writes: vec!["x".into()],
                    confidence: "exact".into(),
                    triggered_by: None,
                    phase: None,
                }],
                bounds: Bounds {
                    max_depth: 3,
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
    fn parallel_bfs_finds_shortest_parent() {
        let compiled = toggle_model();
        let mut visited = VisitedSet::new(8);
        let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        let mut canon_fn = |state: &ModelState| -> Vec<u8> {
            let identity = canonical_identity(&compiled, state);
            canon_cache
                .entry(identity.bytes.clone())
                .or_insert_with(|| identity.bytes.clone());
            identity.bytes
        };
        let frontier = seed_frontier(&compiled, &mut visited, &mut canon_fn);
        assert_eq!(frontier.len(), 1);
        let mut graph = GraphRecording::new(crate::graph::EdgeRecordingMode::None);
        let mut verdicts = HashMap::new();
        let mut enabled = HashSet::new();
        let mut bound_hits = HashSet::new();
        let options = default_check_options();
        let por_context = build_por_context(&compiled, &[], &options);
        let mut por_stats = PorRunStats::default();
        let result = explore_depth_parallel(
            &compiled,
            &[],
            &frontier,
            &mut visited,
            &mut graph,
            &mut verdicts,
            &mut enabled,
            &mut bound_hits,
            &options,
            0,
            &mut canon_fn,
            &por_context,
            &mut por_stats,
        )
        .unwrap();
        assert_eq!(result.edges, 1);
        assert_eq!(result.next.len(), 1);
        let child = result.next[0];
        let parent = visited.parent_record(child);
        assert_eq!(parent.parent, Some(frontier[0]));
        assert_eq!(parent.transition_id, Some(0));
    }

    #[test]
    fn duplicate_discovery_picks_deterministic_parent() {
        let compiled = toggle_model();
        let mut visited = VisitedSet::new(8);
        let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        let mut canon_fn = |state: &ModelState| -> Vec<u8> {
            let identity = canonical_identity(&compiled, state);
            canon_cache
                .entry(identity.bytes.clone())
                .or_insert_with(|| identity.bytes.clone());
            identity.bytes
        };
        let frontier = seed_frontier(&compiled, &mut visited, &mut canon_fn);
        let pre_id = frontier[0];
        let pre = visited.arena.state(pre_id).clone();
        let pre_canon = visited.arena.canon(pre_id).to_vec();
        let transition_id = 0usize;
        let transition = compiled.transition(transition_id);
        let raw_post = apply_effect(
            &compiled,
            &pre,
            &transition.effect,
            &mut crate::expr::EvalOptions::default(),
        )
        .unwrap()
        .pop()
        .unwrap();
        let changed = crate::state::changed_var_indexes(&pre, &raw_post);
        let post = stabilize(&compiled, raw_post, changed, &mut canon_fn)
            .unwrap()
            .pop()
            .unwrap();
        let post_canon = canon_fn(&post);
        let candidates = vec![
            MergeCandidate {
                parent_id: pre_id,
                parent_frontier_position: 1,
                transition_id: 0,
                raw_post_branch: 0,
                stabilization_branch: 0,
                post_state: post.clone(),
                post_canon: post_canon.clone(),
            },
            MergeCandidate {
                parent_id: pre_id,
                parent_frontier_position: 0,
                transition_id: 0,
                raw_post_branch: 0,
                stabilization_branch: 0,
                post_state: post,
                post_canon,
            },
        ];
        let inserted = merge_candidates(&mut visited, &compiled, candidates);
        assert_eq!(inserted.len(), 1);
        let child = inserted[0];
        assert_eq!(visited.parent_record(child).parent, Some(pre_id));
        assert_eq!(visited.parent_record(child).transition_id, Some(0));
        let _ = pre_canon;
    }

    fn dual_parent_model() -> CompiledModel {
        CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "dual-parent".into(),
                vars: vec![
                    StateVarDecl {
                        id: "sys:route".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/")),

                        role: None,
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

                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:pending".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),

                        role: None,
                    },
                    StateVarDecl {
                        id: "a".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("test"),
                        scope: Scope::Global,
                        initial: InitialValue::Many(vec![json!(false), json!(true)]),

                        role: None,
                    },
                    StateVarDecl {
                        id: "out".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("test"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),

                        role: None,
                    },
                ],
                transitions: vec![Transition {
                    id: "t-finish".into(),
                    cls: "user".into(),
                    label: json!({"kind": "click"}),
                    source: vec![],
                    guard: ExprIR::Lit { value: json!(true) },
                    effect: EffectIR::Seq {
                        effects: vec![
                            EffectIR::Assign {
                                var: "out".into(),
                                expr: ExprIR::Lit { value: json!(true) },
                            },
                            EffectIR::Assign {
                                var: "a".into(),
                                expr: ExprIR::Lit {
                                    value: json!(false),
                                },
                            },
                        ],
                    },
                    reads: vec![],
                    writes: vec!["out".into(), "a".into()],
                    confidence: "exact".into(),
                    triggered_by: None,
                    phase: None,
                }],
                bounds: Bounds {
                    max_depth: 2,
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
    fn duplicate_discovery_prefers_lower_frontier_position_parent() {
        let compiled = dual_parent_model();
        let mut visited = VisitedSet::new(8);
        let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
        let mut canon_fn = |state: &ModelState| -> Vec<u8> {
            let identity = canonical_identity(&compiled, state);
            canon_cache
                .entry(identity.bytes.clone())
                .or_insert_with(|| identity.bytes.clone());
            identity.bytes
        };
        let mut frontier = seed_frontier(&compiled, &mut visited, &mut canon_fn);
        assert_eq!(frontier.len(), 2);
        sort_frontier_by_canon(&mut frontier, |id| visited.arena.canon(id).to_vec());
        let parent_low = frontier[0];
        let parent_high = frontier[1];
        let transition_id = 0usize;
        let transition = compiled.transition(transition_id);
        let make_post = |pre_id: StateId| {
            let pre = visited.arena.state(pre_id).clone();
            let raw_post = apply_effect(
                &compiled,
                &pre,
                &transition.effect,
                &mut crate::expr::EvalOptions::default(),
            )
            .unwrap()
            .pop()
            .unwrap();
            let changed = crate::state::changed_var_indexes(&pre, &raw_post);
            let mut local_canon = |state: &ModelState| canonical_identity(&compiled, state).bytes;
            stabilize(&compiled, raw_post, changed, &mut local_canon)
                .unwrap()
                .pop()
                .unwrap()
        };
        let post = make_post(parent_low);
        let post_canon = canon_fn(&post);
        assert_eq!(canon_fn(&make_post(parent_high)), post_canon);
        let candidates = vec![
            MergeCandidate {
                parent_id: parent_high,
                parent_frontier_position: 1,
                transition_id,
                raw_post_branch: 0,
                stabilization_branch: 0,
                post_state: post.clone(),
                post_canon: post_canon.clone(),
            },
            MergeCandidate {
                parent_id: parent_low,
                parent_frontier_position: 0,
                transition_id,
                raw_post_branch: 0,
                stabilization_branch: 0,
                post_state: post,
                post_canon,
            },
        ];
        let inserted = merge_candidates(&mut visited, &compiled, candidates);
        assert_eq!(inserted.len(), 1);
        let child = inserted[0];
        assert_eq!(visited.parent_record(child).parent, Some(parent_low));
        assert_eq!(
            visited.parent_record(child).transition_id,
            Some(transition_id)
        );
    }

    fn temporal_always_true_property() -> PropertyIR {
        PropertyIR::Temporal {
            name: "p".into(),
            formula: crate::model::TemporalFormulaIR::AG {
                arg: Box::new(crate::model::TemporalFormulaIR::Atom {
                    predicate: ExprIR::Lit { value: json!(true) },
                }),
            },
            reads: None,
            enabled_transitions: None,
            include_unmounted: None,
            fairness: None,
        }
    }

    #[test]
    fn max_edges_limit_stops_in_deterministic_edge_order() {
        let compiled = toggle_model();
        let properties = vec![temporal_always_true_property()];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
            sliced_model: None,
            partial_order_reduction: None,
            max_states: None,
                max_edges: Some(1),
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        let limits = result
            .pointer("/diagnostics/limits/reason")
            .and_then(|v| v.as_str());
        assert!(limits.unwrap_or("").contains("maxEdges=1"));
    }

    #[test]
    fn always_step_observes_edges_into_visited_states() {
        let compiled = toggle_model();
        let properties = vec![PropertyIR::AlwaysStep {
            name: "step".into(),
            predicate: crate::model::StepPredicateSpec::Flat(crate::model::StepPredicateIR {
                transition_id: None,
                transition_class: None,
                label_kind: None,
                enqueued: None,
                resolved: None,
                changed: None,
                changed_to: None,
                op_id: None,
                continuation: None,
                op_args: None,
            }),
            reads: None,
            enabled_transitions: None,
            include_unmounted: None,
        }];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
            sliced_model: None,
            partial_order_reduction: None,
            max_states: None,
                max_edges: None,
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        let edges = result.pointer("/stats/edges").and_then(|v| v.as_u64());
        assert!(edges.unwrap_or(0) >= 2);
        let status = result
            .pointer("/verdicts/0/status")
            .and_then(|v| v.as_str());
        assert_eq!(status, Some("verified-within-bounds"));
    }

    #[test]
    fn max_states_limit_produces_structured_error() {
        let compiled = toggle_model();
        let properties = vec![temporal_always_true_property()];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
                sliced_model: None,
                partial_order_reduction: None,
                max_states: Some(1),
                max_edges: None,
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        let limits = result
            .pointer("/diagnostics/limits/reason")
            .and_then(|v| v.as_str());
        assert!(limits.unwrap_or("").contains("maxStates=1"));
        let status = result
            .pointer("/verdicts/0/status")
            .and_then(|v| v.as_str());
        assert_eq!(status, Some("error"));
    }

    #[test]
    fn max_frontier_limit_produces_structured_error() {
        let compiled = toggle_model();
        let properties = vec![temporal_always_true_property()];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
            sliced_model: None,
            partial_order_reduction: None,
            max_states: None,
                max_edges: None,
                max_frontier: Some(1),
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        let limits = result
            .pointer("/diagnostics/limits/reason")
            .and_then(|v| v.as_str());
        assert!(limits.unwrap_or("").contains("maxFrontier=1"));
    }

    #[test]
    fn memory_guard_limit_produces_structured_error() {
        let compiled = toggle_model();
        let properties = vec![temporal_always_true_property()];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
            sliced_model: None,
            partial_order_reduction: None,
            max_states: None,
                max_edges: None,
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: Some(1),
            }),
        )
        .unwrap();
        let limits = result
            .pointer("/diagnostics/limits/reason")
            .and_then(|v| v.as_str());
        assert!(limits.unwrap_or("").contains("memoryGuardBytes=1"));
        let memory_guard = result
            .pointer("/diagnostics/limits/memoryGuardBytes")
            .and_then(|v| v.as_u64());
        assert_eq!(memory_guard, Some(1));
    }

    fn wide_havoc_model(branch_count: usize) -> CompiledModel {
        let values: Vec<String> = (0..branch_count).map(|i| format!("v{i}")).collect();
        CompiledModel::compile(
            Model {
                schema_version: 1,
                id: "wide-havoc".into(),
                vars: vec![
                    StateVarDecl {
                        id: "sys:route".into(),
                        domain: AbstractDomain::Enum {
                            values: vec!["/".into()],
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!("/")),

                        role: None,
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

                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:pending".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Record {
                                fields: HashMap::new(),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),

                        role: None,
                    },
                    StateVarDecl {
                        id: "wide".into(),
                        domain: AbstractDomain::Enum {
                            values: values.clone(),
                        },
                        origin: json!("test"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(values[0])),

                        role: None,
                    },
                ],
                transitions: vec![Transition {
                    id: "havoc-wide".into(),
                    cls: "user".into(),
                    label: json!({"kind": "click"}),
                    source: vec![],
                    guard: ExprIR::Lit { value: json!(true) },
                    effect: EffectIR::Havoc { var: "wide".into() },
                    reads: vec![],
                    writes: vec!["wide".into()],
                    confidence: "exact".into(),
                    triggered_by: None,
                    phase: None,
                }],
                bounds: Bounds {
                    max_depth: 4,
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
    fn wide_havoc_respects_max_edges_during_generation() {
        let compiled = wide_havoc_model(500);
        let properties = vec![temporal_always_true_property()];
        let started = Instant::now();
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
            sliced_model: None,
            partial_order_reduction: None,
            max_states: None,
                max_edges: Some(8),
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        assert!(
            started.elapsed().as_millis() < 5_000,
            "wide havoc should stop quickly under maxEdges"
        );
        let limits = result.pointer("/diagnostics/limits").unwrap();
        assert!(limits
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .contains("maxEdges=8"));
        assert_eq!(
            limits.get("phase").and_then(|v| v.as_str()),
            Some("generation")
        );
        let edges = result.pointer("/stats/edges").and_then(|v| v.as_u64());
        assert!(edges.unwrap_or(0) <= 8);
    }

    #[test]
    fn temporal_ag_false_is_violated_after_full_bfs() {
        // AG(false) should be violated: the initial state itself falsifies it.
        let compiled = toggle_model();
        let properties = vec![PropertyIR::Temporal {
            name: "agFalse".into(),
            formula: crate::model::TemporalFormulaIR::AG {
                arg: Box::new(crate::model::TemporalFormulaIR::Atom {
                    predicate: ExprIR::Lit { value: json!(false) },
                }),
            },
            reads: None,
            enabled_transitions: None,
            include_unmounted: None,
            fairness: None,
        }];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
                sliced_model: None,
                partial_order_reduction: None,
                max_states: None,
                max_edges: None,
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        let status = result
            .pointer("/verdicts/0/status")
            .and_then(|v| v.as_str());
        assert_eq!(status, Some("violated"));
    }

    #[test]
    fn temporal_ef_true_is_verified_after_full_bfs() {
        // EF(true) should be verified: every initial state is in EF(true).
        let compiled = toggle_model();
        let properties = vec![PropertyIR::Temporal {
            name: "efTrue".into(),
            formula: crate::model::TemporalFormulaIR::EF {
                arg: Box::new(crate::model::TemporalFormulaIR::Atom {
                    predicate: ExprIR::Lit { value: json!(true) },
                }),
            },
            reads: None,
            enabled_transitions: None,
            include_unmounted: None,
            fairness: None,
        }];
        let result = check_model_compiled(
            &compiled,
            &properties,
            Some(&CheckOptionsIR {
                slicing: None,
                sliced_model: None,
                partial_order_reduction: None,
                max_states: None,
                max_edges: None,
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            }),
        )
        .unwrap();
        let status = result
            .pointer("/verdicts/0/status")
            .and_then(|v| v.as_str());
        // Initial state satisfies atom(true), so EF(true) holds.
        assert!(matches!(status, Some("verified") | Some("verified-within-bounds")));
    }
}
