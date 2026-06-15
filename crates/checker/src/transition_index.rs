use crate::expr::guard_holds;
use crate::model::{route_local_mounted, CompiledModel};
use crate::state::ModelState;

pub type TransitionId = usize;

/// Non-internal transition indexes sorted by transition ID (dense `TransitionId`).
pub struct TransitionIndexes {
    pub non_internal: Vec<TransitionId>,
    pub internal: Vec<TransitionId>,
    pub internal_by_triggered_var: std::collections::HashMap<usize, Vec<TransitionId>>,
    pub always_triggered_internal: Vec<TransitionId>,
}

impl TransitionIndexes {
    pub fn from_compiled(compiled: &CompiledModel) -> Self {
        Self {
            non_internal: compiled.non_internal.clone(),
            internal: compiled.internal.clone(),
            internal_by_triggered_var: compiled.internal_by_triggered_var.clone(),
            always_triggered_internal: compiled.always_triggered_internal.clone(),
        }
    }
}

pub fn enabled_non_internal(compiled: &CompiledModel, state: &ModelState) -> Vec<TransitionId> {
    compiled
        .non_internal
        .iter()
        .copied()
        .filter(|&idx| {
            route_local_mounted(compiled, idx, state)
                && guard_holds(compiled, compiled.transition(idx), state)
        })
        .collect()
}
