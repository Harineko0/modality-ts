use crate::expr::expr_state_read_vars;
use crate::graph::resolve_edge_mode;
use crate::graph::EdgeRecordingMode;
use crate::model::{CheckOptionsIR, CompiledModel, CompiledTransition, PropertyIR};
use crate::state::ModelState;
use crate::visited::VisitedSet;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub const REASON_VISIBLE: &str = "visible-to-property";
pub const REASON_READ_WRITE: &str = "read-write-conflict";
pub const REASON_WRITE_WRITE: &str = "write-write-conflict";
pub const REASON_TRIGGERED_BY: &str = "triggered-by-conflict";
pub const REASON_PENDING_QUEUE: &str = "pending-queue";
pub const REASON_ROUTE_HISTORY: &str = "route-history";
pub const REASON_MOUNT_LOCAL: &str = "mount-local";
pub const REASON_EFFECT_CONTEXT: &str = "effect-context";
pub const REASON_NONDETERMINISTIC: &str = "nondeterministic-effect";
pub const REASON_UNSUPPORTED_FEATURE: &str = "unsupported-feature";
pub const REASON_CYCLE_PROVISO: &str = "cycle-proviso";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PorMode {
    Off,
    Skipped,
    Active,
}

#[derive(Debug, Clone)]
pub struct PorContext {
    pub mode: PorMode,
    pub skip_reason: Option<String>,
    pub visible_transition_indexes: HashSet<usize>,
    pub visible_var_indexes: HashSet<usize>,
}

#[derive(Debug, Default, Clone)]
pub struct PorRunStats {
    pub full_exploration_states: u64,
    pub reduced_states: u64,
    pub full_enabled_transitions: u64,
    pub explored_transitions: u64,
    pub skipped_transitions: u64,
    pub cycle_fallback_states: u64,
    pub violation_rerun: bool,
    pub reason_counts: HashMap<String, u64>,
}

impl PorRunStats {
    pub fn record_reason(&mut self, reason: &str) {
        *self.reason_counts.entry(reason.to_string()).or_insert(0) += 1;
    }

    pub fn merge(&mut self, other: &PorRunStats) {
        self.full_exploration_states += other.full_exploration_states;
        self.reduced_states += other.reduced_states;
        self.full_enabled_transitions += other.full_enabled_transitions;
        self.explored_transitions += other.explored_transitions;
        self.skipped_transitions += other.skipped_transitions;
        self.cycle_fallback_states += other.cycle_fallback_states;
        self.violation_rerun |= other.violation_rerun;
        for (reason, count) in &other.reason_counts {
            *self.reason_counts.entry(reason.clone()).or_insert(0) += count;
        }
    }

    pub fn to_diagnostics_value(
        &self,
        requested: bool,
        enabled: bool,
        skipped: bool,
        skip_reason: Option<&str>,
    ) -> Value {
        let mut reason_counts: Vec<_> = self
            .reason_counts
            .iter()
            .map(|(reason, count)| json!({ "reason": reason, "count": count }))
            .collect();
        reason_counts.sort_by(|a, b| {
            let left = a.get("reason").and_then(|v| v.as_str()).unwrap_or("");
            let right = b.get("reason").and_then(|v| v.as_str()).unwrap_or("");
            left.cmp(right)
        });
        let mut value = json!({
            "requested": requested,
            "enabled": enabled,
            "fullExplorationStates": self.full_exploration_states,
            "reducedStates": self.reduced_states,
            "fullEnabledTransitions": self.full_enabled_transitions,
            "exploredTransitions": self.explored_transitions,
            "skippedTransitions": self.skipped_transitions,
            "cycleFallbackStates": self.cycle_fallback_states,
            "reasonCounts": reason_counts,
        });
        if skipped {
            value
                .as_object_mut()
                .unwrap()
                .insert("skipped".into(), json!(true));
            if let Some(reason) = skip_reason {
                value
                    .as_object_mut()
                    .unwrap()
                    .insert("skipReason".into(), json!(reason));
            }
        }
        if self.violation_rerun {
            value
                .as_object_mut()
                .unwrap()
                .insert("violationRerun".into(), json!(true));
        }
        value
    }
}

#[derive(Debug, Clone)]
pub struct PorDecision {
    pub transitions: Vec<usize>,
    pub reduced: bool,
    pub cycle_fallback: bool,
}

pub fn build_por_context(
    compiled: &CompiledModel,
    properties: &[PropertyIR],
    options: &CheckOptionsIR,
) -> PorContext {
    let requested = options.partial_order_reduction == Some(true);
    if !requested {
        return PorContext {
            mode: PorMode::Off,
            skip_reason: None,
            visible_transition_indexes: HashSet::new(),
            visible_var_indexes: HashSet::new(),
        };
    }

    if properties.is_empty() {
        return skipped("no properties");
    }

    for property in properties {
        match property {
            // Temporal (CTL) properties require edge recording, so POR will be
            // disabled below by the edge-mode check. Mark explicitly as unsupported
            // to surface a clear diagnostic rather than silently proceeding.
            PropertyIR::Temporal { .. } => return skipped("unsupported-property-kind"),
            PropertyIR::AlwaysStep { .. } => return skipped("unsupported-property-kind"),
            PropertyIR::LeadsToWithin { .. } => return skipped("unsupported-property-kind"),
        }
    }

    if resolve_edge_mode(properties) != EdgeRecordingMode::None {
        return skipped("unsupported-edge-recording");
    }

    let mut visible_var_indexes = HashSet::new();
    let mut visible_transition_indexes = HashSet::new();

    for property in properties {
        let PropertyIR::Temporal {
            reads,
            enabled_transitions,
            ..
        } = property
        else {
            continue;
        };
        if let Some(reads) = reads {
            for id in reads {
                if let Some(&idx) = compiled.var_index.get(id) {
                    visible_var_indexes.insert(idx);
                }
            }
        }
        if let Some(ids) = enabled_transitions {
            for tid in ids {
                if let Some(&idx) = compiled.transition_index.get(tid) {
                    visible_transition_indexes.insert(idx);
                }
            }
        }
    }

    for property in properties {
        let PropertyIR::Temporal {
            reads,
            enabled_transitions,
            ..
        } = property
        else {
            continue;
        };
        let allowed = crate::expr::allowed_reads(
            reads.as_deref(),
            enabled_transitions.as_deref(),
            compiled,
        );
        for id in allowed {
            if let Some(&idx) = compiled.var_index.get(&id) {
                visible_var_indexes.insert(idx);
            }
        }
    }

    loop {
        let before = visible_transition_indexes.len();
        for (idx, transition) in compiled.transitions.iter().enumerate() {
            if visible_transition_indexes.contains(&idx) {
                continue;
            }
            if transition
                .write_indexes
                .iter()
                .any(|var_idx| visible_var_indexes.contains(var_idx))
            {
                visible_transition_indexes.insert(idx);
            }
        }
        if visible_transition_indexes.len() == before {
            break;
        }
    }

    PorContext {
        mode: PorMode::Active,
        skip_reason: None,
        visible_transition_indexes,
        visible_var_indexes,
    }
}

fn skipped(reason: &str) -> PorContext {
    PorContext {
        mode: PorMode::Skipped,
        skip_reason: Some(reason.to_string()),
        visible_transition_indexes: HashSet::new(),
        visible_var_indexes: HashSet::new(),
    }
}

fn predicate_has_state_reads(predicate: &crate::model::ExprIR) -> bool {
    !expr_state_read_vars(predicate).is_empty()
}

pub fn transition_visible_to_properties(context: &PorContext, transition_idx: usize) -> bool {
    context.visible_transition_indexes.contains(&transition_idx)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionPairRelation {
    Independent,
    Dependent(&'static str),
}

pub fn classify_transition_pair(
    compiled: &CompiledModel,
    context: &PorContext,
    left: usize,
    right: usize,
) -> TransitionPairRelation {
    if left == right {
        return TransitionPairRelation::Dependent(REASON_UNSUPPORTED_FEATURE);
    }
    let left_t = &compiled.transitions[left];
    let right_t = &compiled.transitions[right];
    let left_meta = &compiled.sorted_transitions[left];
    let right_meta = &compiled.sorted_transitions[right];

    if transition_visible_to_properties(context, left)
        || transition_visible_to_properties(context, right)
    {
        return TransitionPairRelation::Dependent(REASON_VISIBLE);
    }

    if left_meta.cls == "internal" || right_meta.cls == "internal" {
        return TransitionPairRelation::Dependent(REASON_UNSUPPORTED_FEATURE);
    }

    if footprint_barrier(left_t) {
        return barrier_reason(left_t);
    }
    if footprint_barrier(right_t) {
        return barrier_reason(right_t);
    }

    if indexes_conflict(&left_t.read_indexes, &right_t.write_indexes) {
        return TransitionPairRelation::Dependent(REASON_READ_WRITE);
    }
    if indexes_conflict(&right_t.read_indexes, &left_t.write_indexes) {
        return TransitionPairRelation::Dependent(REASON_READ_WRITE);
    }
    if indexes_conflict(&left_t.write_indexes, &right_t.write_indexes) {
        return TransitionPairRelation::Dependent(REASON_WRITE_WRITE);
    }
    if triggered_by_conflict(left_t, right_t) || triggered_by_conflict(right_t, left_t) {
        return TransitionPairRelation::Dependent(REASON_TRIGGERED_BY);
    }

    TransitionPairRelation::Independent
}

fn footprint_barrier(transition: &CompiledTransition) -> bool {
    transition.touches_pending_queue
        || transition.touches_route_or_history
        || transition.touches_mount_local
        || transition.uses_read_pre
        || transition.uses_read_op_arg
        || transition.uses_fresh_token
        || transition.has_havoc_or_opaque_like_effect
        || transition.may_branch
}

fn barrier_reason(transition: &CompiledTransition) -> TransitionPairRelation {
    if transition.touches_pending_queue {
        return TransitionPairRelation::Dependent(REASON_PENDING_QUEUE);
    }
    if transition.touches_route_or_history {
        return TransitionPairRelation::Dependent(REASON_ROUTE_HISTORY);
    }
    if transition.touches_mount_local {
        return TransitionPairRelation::Dependent(REASON_MOUNT_LOCAL);
    }
    if transition.uses_read_pre || transition.uses_read_op_arg {
        return TransitionPairRelation::Dependent(REASON_EFFECT_CONTEXT);
    }
    if transition.uses_fresh_token
        || transition.has_havoc_or_opaque_like_effect
        || transition.may_branch
    {
        return TransitionPairRelation::Dependent(REASON_NONDETERMINISTIC);
    }
    TransitionPairRelation::Dependent(REASON_UNSUPPORTED_FEATURE)
}

fn indexes_conflict(reads: &[usize], writes: &[usize]) -> bool {
    reads.iter().any(|idx| writes.contains(idx))
}

fn triggered_by_conflict(
    source: &CompiledTransition,
    target: &CompiledTransition,
) -> bool {
    if source.triggered_by_indexes.is_empty() {
        return false;
    }
    source
        .triggered_by_indexes
        .iter()
        .any(|idx| target.write_indexes.contains(idx))
}

pub fn select_enabled_transitions(
    compiled: &CompiledModel,
    context: &PorContext,
    stats: &mut PorRunStats,
    enabled: &[usize],
    pre: &ModelState,
    visited: &VisitedSet,
    pre_canon: &[u8],
) -> PorDecision {
    stats.full_enabled_transitions += enabled.len() as u64;

    if context.mode != PorMode::Active {
        stats.full_exploration_states += 1;
        stats.explored_transitions += enabled.len() as u64;
        return PorDecision {
            transitions: enabled.to_vec(),
            reduced: false,
            cycle_fallback: false,
        };
    }

    if enabled.is_empty() {
        return PorDecision {
            transitions: Vec::new(),
            reduced: false,
            cycle_fallback: false,
        };
    }

    if enabled
        .iter()
        .any(|&idx| transition_visible_to_properties(context, idx))
    {
        stats.full_exploration_states += 1;
        stats.explored_transitions += enabled.len() as u64;
        stats.record_reason(REASON_VISIBLE);
        return PorDecision {
            transitions: enabled.to_vec(),
            reduced: false,
            cycle_fallback: false,
        };
    }

    let mut dominant_reason: Option<&'static str> = None;
    let mut candidate: Option<usize> = None;
    'outer: for &idx in enabled {
        for &other in enabled {
            if idx == other {
                continue;
            }
            match classify_transition_pair(compiled, context, idx, other) {
                TransitionPairRelation::Independent => {}
                TransitionPairRelation::Dependent(reason) => {
                    dominant_reason = Some(dominant_reason.unwrap_or(reason));
                    continue 'outer;
                }
            }
        }
        candidate = Some(idx);
        break;
    }

    let Some(selected) = candidate else {
        stats.full_exploration_states += 1;
        stats.explored_transitions += enabled.len() as u64;
        if let Some(reason) = dominant_reason {
            stats.record_reason(reason);
        }
        return PorDecision {
            transitions: enabled.to_vec(),
            reduced: false,
            cycle_fallback: false,
        };
    };

    let selected_set = vec![selected];
    if enabled.len() > 1
        && successors_all_visited(compiled, pre, visited, &selected_set, pre_canon)
    {
        stats.full_exploration_states += 1;
        stats.cycle_fallback_states += 1;
        stats.explored_transitions += enabled.len() as u64;
        stats.record_reason(REASON_CYCLE_PROVISO);
        return PorDecision {
            transitions: enabled.to_vec(),
            reduced: false,
            cycle_fallback: true,
        };
    }

    stats.reduced_states += 1;
    stats.explored_transitions += selected_set.len() as u64;
    stats.skipped_transitions += (enabled.len() - selected_set.len()) as u64;
    PorDecision {
        transitions: selected_set,
        reduced: true,
        cycle_fallback: false,
    }
}

fn successors_all_visited(
    compiled: &CompiledModel,
    pre: &ModelState,
    visited: &VisitedSet,
    transition_ids: &[usize],
    pre_canon: &[u8],
) -> bool {
    let _ = pre_canon;
    let mut canon_cache: HashMap<Vec<u8>, Vec<u8>> = HashMap::new();
    let mut canon = |state: &ModelState| -> Vec<u8> {
        let identity = crate::canon::canonical_identity(compiled, state);
        canon_cache
            .entry(identity.bytes.clone())
            .or_insert_with(|| identity.bytes.clone());
        identity.bytes
    };
    let mut saw_successor = false;
    for &transition_id in transition_ids {
        let transition = compiled.transition(transition_id);
        let posts = match crate::effect::apply_effect(
            compiled,
            pre,
            &transition.effect,
            &mut crate::expr::EvalOptions::default(),
        ) {
            Ok(posts) => posts,
            Err(_) => return false,
        };
        if posts.is_empty() {
            return false;
        }
        for (_branch, raw_post) in posts.into_iter().enumerate() {
            let changed = crate::state::changed_var_indexes(pre, &raw_post);
            let stabilized = crate::stabilize::stabilize(compiled, raw_post, changed, &mut canon)
                .unwrap_or_default();
            if stabilized.is_empty() {
                return false;
            }
            for post in stabilized {
                saw_successor = true;
                let post_canon = canon(&post);
                if !visited.contains_canon(&post_canon) {
                    return false;
                }
            }
        }
    }
    saw_successor
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        AbstractDomain, Bounds, EffectIR, ExprIR, InitialValue, Model, Scope, StateVarDecl,
        Transition,
    };
    use serde_json::json;
    use std::collections::HashMap;

    fn bool_model(transitions: Vec<Transition>) -> CompiledModel {
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
                        role: None,
                    },
                    StateVarDecl {
                        id: "sys:history".into(),
                        domain: AbstractDomain::BoundedList {
                            inner: Box::new(AbstractDomain::Enum {
                                values: vec!["/".into()],
                            }),
                            max_len: 1,
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
                                fields: HashMap::from([
                                    (
                                        "opId".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["op".into()],
                                        },
                                    ),
                                    (
                                        "continuation".into(),
                                        AbstractDomain::Enum {
                                            values: vec!["c".into()],
                                        },
                                    ),
                                    (
                                        "args".into(),
                                        AbstractDomain::Record {
                                            fields: HashMap::new(),
                                        },
                                    ),
                                ]),
                            }),
                            max_len: 0,
                        },
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!([])),
                        role: Some(crate::model::SystemVarRole {
                            kind: crate::model::SystemVarRoleKind::PendingQueue,
                            group: None,
                        }),
                    },
                    StateVarDecl {
                        id: "a".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),
                        role: None,
                    },
                    StateVarDecl {
                        id: "b".into(),
                        domain: AbstractDomain::Bool,
                        origin: json!("system"),
                        scope: Scope::Global,
                        initial: InitialValue::Single(json!(false)),
                        role: None,
                    },
                ],
                transitions,
                bounds: Bounds {
                    max_depth: 4,
                    max_pending: 0,
                    max_internal_steps: 4,
                },
                metadata: None,
            },
            false,
        )
        .unwrap()
    }

    fn flip(id: &str, var: &str) -> Transition {
        Transition {
            id: id.into(),
            cls: "user".into(),
            label: json!({ "kind": "click" }),
            source: vec![],
            guard: ExprIR::Not {
                args: vec![ExprIR::Read {
                    var: var.into(),
                    path: None,
                }],
            },
            effect: EffectIR::Assign {
                var: var.into(),
                expr: ExprIR::Lit {
                    value: json!(true),
                },
            },
            reads: vec![var.into()],
            writes: vec![var.into()],
            confidence: "exact".into(),
            triggered_by: None,
            phase: None,
        }
    }

    #[test]
    fn disjoint_invisible_transitions_are_independent() {
        let compiled = bool_model(vec![flip("flipA", "a"), flip("flipB", "b")]);
        let context = PorContext {
            mode: PorMode::Active,
            skip_reason: None,
            visible_transition_indexes: HashSet::new(),
            visible_var_indexes: HashSet::new(),
        };
        assert_eq!(
            classify_transition_pair(&compiled, &context, 0, 1),
            TransitionPairRelation::Independent
        );
    }

    #[test]
    fn write_write_conflict_is_dependent() {
        let compiled = bool_model(vec![
            Transition {
                id: "writeA1".into(),
                cls: "user".into(),
                label: json!({ "kind": "click" }),
                source: vec![],
                guard: ExprIR::Lit {
                    value: json!(true),
                },
                effect: EffectIR::Assign {
                    var: "a".into(),
                    expr: ExprIR::Lit {
                        value: json!(true),
                    },
                },
                reads: vec![],
                writes: vec!["a".into()],
                confidence: "exact".into(),
                triggered_by: None,
                phase: None,
            },
            Transition {
                id: "writeA2".into(),
                cls: "user".into(),
                label: json!({ "kind": "click" }),
                source: vec![],
                guard: ExprIR::Lit {
                    value: json!(true),
                },
                effect: EffectIR::Assign {
                    var: "a".into(),
                    expr: ExprIR::Lit {
                        value: json!(false),
                    },
                },
                reads: vec![],
                writes: vec!["a".into()],
                confidence: "exact".into(),
                triggered_by: None,
                phase: None,
            },
        ]);
        let context = PorContext {
            mode: PorMode::Active,
            skip_reason: None,
            visible_transition_indexes: HashSet::new(),
            visible_var_indexes: HashSet::new(),
        };
        assert!(matches!(
            classify_transition_pair(&compiled, &context, 0, 1),
            TransitionPairRelation::Dependent(REASON_WRITE_WRITE)
        ));
    }

    #[test]
    fn visible_transition_blocks_independence() {
        let compiled = bool_model(vec![flip("flipA", "a"), flip("flipB", "b")]);
        let context = PorContext {
            mode: PorMode::Active,
            skip_reason: None,
            visible_transition_indexes: HashSet::from([0]),
            visible_var_indexes: HashSet::new(),
        };
        assert!(matches!(
            classify_transition_pair(&compiled, &context, 0, 1),
            TransitionPairRelation::Dependent(REASON_VISIBLE)
        ));
    }

    #[test]
    fn always_step_skips_por() {
        let compiled = bool_model(vec![flip("flipA", "a")]);
        let context = build_por_context(
            &compiled,
            &[PropertyIR::AlwaysStep {
                name: "p".into(),
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
                reads: Some(vec![]),
                enabled_transitions: None,
                include_unmounted: None,
            }],
            &CheckOptionsIR {
                slicing: None,
                sliced_model: None,
                partial_order_reduction: Some(true),
                max_states: None,
                max_edges: None,
                max_frontier: None,
                track_elapsed: None,
                memory_guard_bytes: None,
            },
        );
        assert_eq!(context.mode, PorMode::Skipped);
        assert_eq!(
            context.skip_reason.as_deref(),
            Some("unsupported-property-kind")
        );
    }
}
