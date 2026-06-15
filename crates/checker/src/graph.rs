use crate::state::ModelState;
use crate::step::StepFacts;
use crate::model::Transition;
use crate::visited::StateId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeRecordingMode {
    None,
    Compact,
    Reverse,
    Full,
}

#[derive(Debug, Clone)]
pub struct ReverseEdge {
    pub pre_canon: Vec<u8>,
    pub post_canon: Vec<u8>,
    pub pre_id: Option<StateId>,
    pub post_id: Option<StateId>,
}

#[derive(Debug, Clone)]
pub struct CompactEdge {
    pub pre_canon: Vec<u8>,
    pub post_canon: Vec<u8>,
    pub pre_id: Option<StateId>,
    pub post_id: Option<StateId>,
    pub transition_id: String,
    pub triggered_properties: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct FullEdge {
    pub pre_canon: Vec<u8>,
    pub post_canon: Vec<u8>,
    pub pre_id: Option<StateId>,
    pub post_id: Option<StateId>,
    pub pre: ModelState,
    pub post: ModelState,
    pub transition: Transition,
    pub step: StepFacts,
}

pub struct GraphRecording {
    pub mode: EdgeRecordingMode,
    pub compact_edges: Vec<CompactEdge>,
    pub reverse_edges: Vec<ReverseEdge>,
    pub full_edges: Vec<FullEdge>,
}

impl GraphRecording {
    pub fn new(mode: EdgeRecordingMode) -> Self {
        Self {
            mode,
            compact_edges: Vec::new(),
            reverse_edges: Vec::new(),
            full_edges: Vec::new(),
        }
    }

    pub fn record(
        &mut self,
        properties: &[crate::model::PropertyIR],
        pre_canon: &[u8],
        post_canon: &[u8],
        pre: &ModelState,
        post: &ModelState,
        transition: &Transition,
        step: &StepFacts,
    ) {
        self.record_with_ids(
            properties,
            pre_canon,
            post_canon,
            None,
            None,
            pre,
            post,
            transition,
            step,
        );
    }

    pub fn record_with_ids(
        &mut self,
        properties: &[crate::model::PropertyIR],
        pre_canon: &[u8],
        post_canon: &[u8],
        pre_id: Option<StateId>,
        post_id: Option<StateId>,
        pre: &ModelState,
        post: &ModelState,
        transition: &Transition,
        step: &StepFacts,
    ) {
        match self.mode {
            EdgeRecordingMode::Full => {
                self.full_edges.push(FullEdge {
                    pre_canon: pre_canon.to_vec(),
                    post_canon: post_canon.to_vec(),
                    pre_id,
                    post_id,
                    pre: pre.clone(),
                    post: post.clone(),
                    transition: transition.clone(),
                    step: step.clone(),
                });
            }
            EdgeRecordingMode::Compact => {
                let triggered: Vec<String> = properties
                    .iter()
                    .filter_map(|p| match p {
                        crate::model::PropertyIR::LeadsToWithin { name, trigger, .. } => {
                            if crate::step::matches_step_predicate(step, pre, post, trigger) {
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
                    pre_id,
                    post_id,
                    transition_id: transition.id.clone(),
                    triggered_properties: triggered,
                });
            }
            EdgeRecordingMode::Reverse => {
                self.reverse_edges.push(ReverseEdge {
                    pre_canon: pre_canon.to_vec(),
                    post_canon: post_canon.to_vec(),
                    pre_id,
                    post_id,
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
        EdgeRecordingMode::Compact
    } else if properties
        .iter()
        .any(|p| matches!(p, crate::model::PropertyIR::ReachableFrom { .. }))
    {
        EdgeRecordingMode::Reverse
    } else {
        EdgeRecordingMode::None
    }
}
