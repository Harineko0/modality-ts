use crate::expr::guard_holds;
use crate::model::{route_local_mounted, CompiledModel};
use crate::state::ModelState;

pub type TransitionId = usize;

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
