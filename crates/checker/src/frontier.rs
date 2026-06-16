use crate::visited::StateId;

/// Split frontier state IDs into deterministic contiguous chunks for parallel workers.
pub fn chunk_frontier(frontier: &[StateId], worker_count: usize) -> Vec<Vec<StateId>> {
    if frontier.is_empty() {
        return Vec::new();
    }
    let workers = worker_count.max(1).min(frontier.len());
    let chunk_size = (frontier.len() + workers - 1) / workers;
    frontier
        .chunks(chunk_size)
        .map(|chunk| chunk.to_vec())
        .collect()
}

pub fn sort_frontier_by_canon(frontier: &mut [StateId], canon: impl Fn(StateId) -> Vec<u8>) {
    frontier.sort_by(|&a, &b| canon(a).cmp(&canon(b)));
}
