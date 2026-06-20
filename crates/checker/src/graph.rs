use crate::model::Transition;
use crate::state::ModelState;
use crate::step::StepFacts;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeRecordingMode {
    None,
    Compact,
    Reverse,
}

#[derive(Debug, Clone)]
pub struct ReverseEdge {
    pub pre_canon: Vec<u8>,
    pub post_canon: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct CompactEdge {
    pub pre_canon: Vec<u8>,
    pub post_canon: Vec<u8>,
    pub transition_id: String,
    pub triggered_properties: Vec<String>,
}

pub struct GraphRecording {
    pub mode: EdgeRecordingMode,
    pub compact_edges: Vec<CompactEdge>,
    pub reverse_edges: Vec<ReverseEdge>,
}

impl GraphRecording {
    pub fn new(mode: EdgeRecordingMode) -> Self {
        Self {
            mode,
            compact_edges: Vec::new(),
            reverse_edges: Vec::new(),
        }
    }

    pub fn record_with_ids(
        &mut self,
        compiled: &crate::model::CompiledModel,
        properties: &[crate::model::PropertyIR],
        pre_canon: &[u8],
        post_canon: &[u8],
        _pre_id: Option<crate::visited::StateId>,
        _post_id: Option<crate::visited::StateId>,
        pre: &ModelState,
        post: &ModelState,
        transition: &Transition,
        step: &StepFacts,
    ) {
        match self.mode {
            EdgeRecordingMode::Compact => {
                let triggered: Vec<String> = properties
                    .iter()
                    .filter_map(|p| match p {
                        crate::model::PropertyIR::LeadsToWithin { name, trigger, .. } => {
                            if crate::step::matches_step_predicate(
                                compiled,
                                step,
                                pre,
                                post,
                                trigger,
                                name,
                            )
                            .unwrap_or(false)
                            {
                                Some(name.clone())
                            } else {
                                None
                            }
                        }
                        _ => None,
                    })
                    .collect();
                self.compact_edges.push(CompactEdge {
                    pre_canon: pre_canon.to_vec(),
                    post_canon: post_canon.to_vec(),
                    transition_id: transition.id.clone(),
                    triggered_properties: triggered,
                });
                // Compact mode also records reverse edges so the CTL engine can use
                // them when Temporal properties coexist with leadsToWithin.
                self.reverse_edges.push(ReverseEdge {
                    pre_canon: pre_canon.to_vec(),
                    post_canon: post_canon.to_vec(),
                });
            }
            EdgeRecordingMode::Reverse => {
                self.reverse_edges.push(ReverseEdge {
                    pre_canon: pre_canon.to_vec(),
                    post_canon: post_canon.to_vec(),
                });
            }
            EdgeRecordingMode::None => {}
        }
    }
}

pub fn resolve_edge_mode(properties: &[crate::model::PropertyIR]) -> EdgeRecordingMode {
    if properties
        .iter()
        .any(|p| matches!(p, crate::model::PropertyIR::LeadsToWithin { .. }))
    {
        // Compact mode stores full edge info needed by leadsToWithin trigger matching
        // AND reverse edges, so it is a superset of Reverse.
        EdgeRecordingMode::Compact
    } else if properties.iter().any(|p| {
        matches!(
            p,
            crate::model::PropertyIR::Temporal { .. }
        )
    }) {
        // CTL labeling needs both forward and backward adjacency.
        EdgeRecordingMode::Reverse
    } else {
        EdgeRecordingMode::None
    }
}
