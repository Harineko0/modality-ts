use crate::state::ModelState;
use crate::trace::Parent;
use std::collections::HashMap;

pub type StateId = u32;

#[derive(Debug, Clone)]
pub struct StateArena {
    states: Vec<ModelState>,
    canon_bytes: Vec<Vec<u8>>,
}

impl StateArena {
    pub fn new() -> Self {
        Self {
            states: Vec::new(),
            canon_bytes: Vec::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.states.len()
    }

    pub fn state(&self, id: StateId) -> &ModelState {
        &self.states[id as usize]
    }

    pub fn canon(&self, id: StateId) -> &[u8] {
        &self.canon_bytes[id as usize]
    }

    pub fn insert(&mut self, state: ModelState, canon: Vec<u8>) -> StateId {
        let id = self.states.len() as StateId;
        self.states.push(state);
        self.canon_bytes.push(canon);
        id
    }
}

#[derive(Debug, Clone)]
#[cfg(test)]
pub struct ParentRecord {
    pub parent: Option<StateId>,
    pub transition_id: Option<usize>,
}

pub struct VisitedSet {
    pub arena: StateArena,
    canon_to_id: HashMap<Vec<u8>, StateId>,
    #[cfg(test)]
    parents: Vec<ParentRecord>,
    shard_bits: u32,
    parents_by_canon: HashMap<Vec<u8>, Parent>,
    states_by_canon: HashMap<Vec<u8>, ModelState>,
}

impl VisitedSet {
    pub fn new(shard_bits: u32) -> Self {
        Self {
            arena: StateArena::new(),
            canon_to_id: HashMap::new(),
            #[cfg(test)]
            parents: Vec::new(),
            shard_bits,
            parents_by_canon: HashMap::new(),
            states_by_canon: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.canon_to_id.len()
    }

    pub fn contains_canon(&self, canon: &[u8]) -> bool {
        self.canon_to_id.contains_key(canon)
    }

    pub fn id_of(&self, canon: &[u8]) -> Option<StateId> {
        self.canon_to_id.get(canon).copied()
    }

    #[cfg(test)]
    pub fn parent_record(&self, id: StateId) -> &ParentRecord {
        &self.parents[id as usize]
    }

    pub fn parents_map(&self) -> &HashMap<Vec<u8>, Parent> {
        &self.parents_by_canon
    }

    pub fn states_map(&self) -> &HashMap<Vec<u8>, ModelState> {
        &self.states_by_canon
    }

    pub fn insert_seed(&mut self, state: ModelState, canon: Vec<u8>) -> StateId {
        if let Some(&id) = self.canon_to_id.get(&canon) {
            return id;
        }
        let id = self.arena.insert(state.clone(), canon.clone());
        self.canon_to_id.insert(canon.clone(), id);
        #[cfg(test)]
        self.parents.push(ParentRecord {
            parent: None,
            transition_id: None,
        });
        self.parents_by_canon.insert(
            canon.clone(),
            Parent {
                parent: None,
                transition_id: None,
            },
        );
        self.states_by_canon.insert(canon, state);
        id
    }

    pub fn insert_child(
        &mut self,
        compiled: &crate::model::CompiledModel,
        state: ModelState,
        canon: Vec<u8>,
        parent_id: StateId,
        transition_id: usize,
    ) -> StateId {
        let id = self.arena.insert(state.clone(), canon.clone());
        self.canon_to_id.insert(canon.clone(), id);
        #[cfg(test)]
        self.parents.push(ParentRecord {
            parent: Some(parent_id),
            transition_id: Some(transition_id),
        });
        let parent_canon = self.arena.canon(parent_id).to_vec();
        let transition_name = compiled.transition(transition_id).id.clone();
        self.parents_by_canon.insert(
            canon.clone(),
            Parent {
                parent: Some(parent_canon),
                transition_id: Some(transition_name),
            },
        );
        self.states_by_canon.insert(canon, state);
        id
    }

    pub fn shard_of(&self, canon: &[u8]) -> usize {
        let hash = crate::canon::canonical_identity_hash(canon);
        (hash >> (64 - self.shard_bits)) as usize
    }

    pub fn shard_count(&self) -> usize {
        1usize << self.shard_bits
    }
}

#[derive(Debug, Clone)]
pub struct MergeCandidate {
    pub parent_id: StateId,
    pub parent_frontier_position: u32,
    pub transition_id: usize,
    pub raw_post_branch: u32,
    pub stabilization_branch: u32,
    pub post_state: ModelState,
    pub post_canon: Vec<u8>,
}

/// Sort candidates for deterministic merge without inserting.
pub fn sort_merge_candidates(
    visited: &VisitedSet,
    candidates: Vec<MergeCandidate>,
) -> Vec<MergeCandidate> {
    let shard_count = visited.shard_count();
    let mut shards: Vec<Vec<MergeCandidate>> = vec![Vec::new(); shard_count];
    for candidate in candidates {
        let shard = visited.shard_of(&candidate.post_canon);
        shards[shard].push(candidate);
    }

    let mut sorted = Vec::new();
    for mut shard_candidates in shards {
        shard_candidates.sort_by(|a, b| {
            a.post_canon
                .cmp(&b.post_canon)
                .then_with(|| a.parent_frontier_position.cmp(&b.parent_frontier_position))
                .then_with(|| a.transition_id.cmp(&b.transition_id))
                .then_with(|| a.raw_post_branch.cmp(&b.raw_post_branch))
                .then_with(|| a.stabilization_branch.cmp(&b.stabilization_branch))
        });
        sorted.extend(shard_candidates);
    }
    sorted
}

/// Deterministic merge of worker candidates into visited set.
/// Returns newly inserted state IDs in discovery order (sorted by canon within shards).
#[cfg(test)]
pub fn merge_candidates(
    visited: &mut VisitedSet,
    compiled: &crate::model::CompiledModel,
    candidates: Vec<MergeCandidate>,
) -> Vec<StateId> {
    let sorted = sort_merge_candidates(visited, candidates);
    let mut inserted = Vec::new();
    for candidate in sorted {
        if visited.contains_canon(&candidate.post_canon) {
            continue;
        }
        let id = visited.insert_child(
            compiled,
            candidate.post_state,
            candidate.post_canon,
            candidate.parent_id,
            candidate.transition_id,
        );
        inserted.push(id);
    }

    inserted.sort_by_key(|&id| visited.arena.canon(id).to_vec());
    inserted
}
