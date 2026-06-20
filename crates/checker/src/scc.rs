/// Tarjan's strongly-connected components algorithm.
///
/// Takes a generic node type `N: Clone + Eq + Hash` and a successor
/// function, returns all SCCs in reverse topological order (sinks first).
/// Only nodes reachable from `roots` are visited.
use std::collections::HashMap;
use std::hash::Hash;

pub struct TarjanState<N> {
    index_counter: u32,
    stack: Vec<N>,
    on_stack: HashMap<N, bool>,
    indices: HashMap<N, u32>,
    lowlinks: HashMap<N, u32>,
    pub sccs: Vec<Vec<N>>,
}

impl<N: Clone + Eq + Hash> TarjanState<N> {
    fn new() -> Self {
        Self {
            index_counter: 0,
            stack: Vec::new(),
            on_stack: HashMap::new(),
            indices: HashMap::new(),
            lowlinks: HashMap::new(),
            sccs: Vec::new(),
        }
    }

    fn strongconnect<F>(&mut self, v: N, successors: &F)
    where
        F: Fn(&N) -> Vec<N>,
    {
        let index = self.index_counter;
        self.index_counter += 1;
        self.indices.insert(v.clone(), index);
        self.lowlinks.insert(v.clone(), index);
        self.stack.push(v.clone());
        self.on_stack.insert(v.clone(), true);

        for w in successors(&v) {
            if !self.indices.contains_key(&w) {
                self.strongconnect(w.clone(), successors);
                let w_low = self.lowlinks[&w];
                let v_low = self.lowlinks.get_mut(&v).unwrap();
                if w_low < *v_low {
                    *v_low = w_low;
                }
            } else if *self.on_stack.get(&w).unwrap_or(&false) {
                let w_idx = self.indices[&w];
                let v_low = self.lowlinks.get_mut(&v).unwrap();
                if w_idx < *v_low {
                    *v_low = w_idx;
                }
            }
        }

        if self.lowlinks[&v] == self.indices[&v] {
            let mut scc = Vec::new();
            loop {
                let w = self.stack.pop().unwrap();
                self.on_stack.insert(w.clone(), false);
                scc.push(w.clone());
                if w == v {
                    break;
                }
            }
            self.sccs.push(scc);
        }
    }
}

/// Compute all SCCs reachable from `roots` via `successors`.
///
/// Returns SCCs in reverse topological order (sinks first).
/// Each SCC is a non-empty `Vec<N>`.
pub fn tarjan_sccs<N, F>(roots: &[N], successors: F) -> Vec<Vec<N>>
where
    N: Clone + Eq + Hash,
    F: Fn(&N) -> Vec<N>,
{
    let mut state = TarjanState::<N>::new();
    for root in roots {
        if !state.indices.contains_key(root) {
            state.strongconnect(root.clone(), &successors);
        }
    }
    state.sccs
}

/// Filter SCCs to those that are non-trivial (size > 1) or have a self-loop.
/// These are the SCCs with an infinite path within the given node set.
pub fn non_trivial_sccs<N, F>(sccs: Vec<Vec<N>>, has_self_loop: F) -> Vec<Vec<N>>
where
    N: Eq + Hash,
    F: Fn(&N) -> bool,
{
    sccs.into_iter()
        .filter(|scc| scc.len() > 1 || has_self_loop(&scc[0]))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{HashMap, HashSet};

    fn edges_to_adj(edges: &[(usize, usize)], n: usize) -> HashMap<usize, Vec<usize>> {
        let mut adj: HashMap<usize, Vec<usize>> = (0..n).map(|i| (i, vec![])).collect();
        for &(u, v) in edges {
            adj.entry(u).or_default().push(v);
        }
        adj
    }

    #[test]
    fn single_node_no_self_loop() {
        let adj = edges_to_adj(&[], 1);
        let sccs = tarjan_sccs(&[0usize], |v| adj[v].clone());
        assert_eq!(sccs.len(), 1);
        assert_eq!(sccs[0], vec![0]);
    }

    #[test]
    fn single_node_self_loop() {
        let adj = edges_to_adj(&[(0, 0)], 1);
        let sccs = tarjan_sccs(&[0usize], |v| adj[v].clone());
        assert_eq!(sccs.len(), 1);
        let nontrivial = non_trivial_sccs(sccs, |v| adj[v].contains(v));
        assert_eq!(nontrivial.len(), 1);
    }

    #[test]
    fn two_cycle() {
        // 0 -> 1 -> 0  (one SCC of size 2)
        let adj = edges_to_adj(&[(0, 1), (1, 0)], 2);
        let sccs = tarjan_sccs(&[0usize], |v| adj[v].clone());
        assert_eq!(sccs.len(), 1);
        let scc_set: HashSet<_> = sccs[0].iter().cloned().collect();
        assert!(scc_set.contains(&0) && scc_set.contains(&1));
    }

    #[test]
    fn dag_has_singleton_sccs() {
        // 0 -> 1 -> 2 (DAG, no cycles)
        let adj = edges_to_adj(&[(0, 1), (1, 2)], 3);
        let sccs = tarjan_sccs(&[0usize], |v| adj[v].clone());
        // Each node is its own SCC, returned in reverse topo order: [2],[1],[0]
        assert_eq!(sccs.len(), 3);
        let nontrivial = non_trivial_sccs(sccs, |v| adj[v].contains(v));
        assert_eq!(nontrivial.len(), 0);
    }

    #[test]
    fn two_sccs() {
        // 0 -> 1 -> 0, 1 -> 2, 2 -> 3 -> 2
        let adj = edges_to_adj(&[(0, 1), (1, 0), (1, 2), (2, 3), (3, 2)], 4);
        let sccs = tarjan_sccs(&[0usize], |v| adj[v].clone());
        // Two non-trivial SCCs: {0,1} and {2,3}
        let nontrivial = non_trivial_sccs(sccs, |v| adj[v].contains(v));
        assert_eq!(nontrivial.len(), 2);
        let first: HashSet<_> = nontrivial[0].iter().cloned().collect();
        let second: HashSet<_> = nontrivial[1].iter().cloned().collect();
        // Sinks first: {2,3} should come before {0,1}
        assert!(first.contains(&2) && first.contains(&3));
        assert!(second.contains(&0) && second.contains(&1));
    }
}
