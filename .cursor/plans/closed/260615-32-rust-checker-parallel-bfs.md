# Rust Checker Parallel BFS

## Goal

Implement the Rust checker search as parallel layered BFS from the start. The design must preserve shortest counterexample depth, deterministic traces, step observation on all edges, graph-dependent property finalization, and structured search-limit diagnostics.

## Non-goals

- Do not create a single-threaded architecture as the primary implementation.
- Do not add benchmark gates or Rust-vs-TypeScript comparisons.
- Do not add an engine selector.
- Do not implement on-disk frontier storage in this plan.
- Do not use hash-only state identity.

## Current-state findings

- TypeScript BFS is in `src/check/engine/check-model.ts`, especially `seedFrontier`, `exploreDepth`, and `checkSearchLimits`.
- Transition indexing is in `src/check/engine/transitions.ts`.
- Graph modes are typed in `src/check/types.ts`.
- Existing semantics require `alwaysStep` to observe edges into already-visited states.
- Existing search limits are `maxStates`, `maxEdges`, `maxFrontier`, and memory guard.

## Exact file paths and relevant symbols

- `crates/checker/src/search.rs`: parallel BFS orchestration.
- `crates/checker/src/frontier.rs`: frontier chunking, ordering, and merge.
- `crates/checker/src/visited.rs`: sharded visited set, state arena, parent records.
- `crates/checker/src/transition_index.rs`: enabled transition lookup.
- `crates/checker/src/graph.rs`: edge recording.
- `crates/checker/src/diagnostics.rs`: stats and limits.
- `crates/checker/src/property.rs`: monitor hooks.
- `crates/checker/src/report.rs`: final `CheckResult`.

## Existing patterns to follow

- Preserve layered BFS and deterministic output.
- Explore transitions in sorted transition ID order.
- Observe step properties before visited dedupe.
- Store parent only on first deterministic discovery.
- Avoid full edge/state storage unless the active property set requires it.

## Atomic implementation steps

1. Build transition indexes for parallel search.

   Files to edit:
   - `crates/checker/src/transition_index.rs`
   - `crates/checker/src/model.rs`

   Implementation:
   - Store non-internal transitions sorted by ID.
   - Store internal transitions sorted by ID and grouped by triggered var index.
   - Provide `enabled_non_internal(compiled_model, state) -> Vec<TransitionId>`.
   - Use dense transition IDs in worker outputs to avoid cloning transition structs.
   - Keep all index data immutable and shareable across workers.

2. Implement deterministic seed frontier.

   Files to edit:
   - `crates/checker/src/search.rs`
   - `crates/checker/src/frontier.rs`
   - `crates/checker/src/visited.rs`

   Implementation:
   - Enumerate initial states from domain initial values.
   - Stabilize each initial state with `initialChangedVars`.
   - Canonicalize and dedupe all stabilized initials.
   - Sort seed states by canonical bytes.
   - Insert each seed into visited with parent `null` and stable state arena ID.

3. Define worker expansion output.

   Files to edit:
   - `crates/checker/src/search.rs`
   - `crates/checker/src/frontier.rs`

   Implementation:
   - Define a worker result containing generated edges, candidate new states, bound hits, property witness candidates, and local edge count.
   - Each candidate new state must include pre state ID, transition ID, post state, post canonical bytes, and deterministic local sequence number.
   - Each edge record must exist even if the post state is already visited.
   - Worker output must not mutate global visited directly.
   - Keep worker result serialization-free inside Rust.

4. Expand each BFS layer in parallel.

   Files to edit:
   - `crates/checker/src/search.rs`

   Implementation:
   - Split the current frontier into deterministic contiguous chunks.
   - For each frontier state, iterate enabled transitions in sorted order.
   - Apply the transition effect, stabilize each raw post, canonicalize each stabilized post, and build step facts.
   - Run online property edge monitors before any visited check.
   - Collect output locally per worker and return it to the layer merge.

5. Merge candidates with sharded visited ownership.

   Files to edit:
   - `crates/checker/src/visited.rs`
   - `crates/checker/src/frontier.rs`
   - `crates/checker/src/search.rs`

   Implementation:
   - Partition candidates by stable hash prefix of canonical bytes.
   - Within each shard, sort by canonical bytes, parent depth order, transition ID, and worker local sequence.
   - Compare full canonical bytes for equality; never trust hash alone.
   - Insert only the deterministic first candidate for each unseen canonical state.
   - Assign parent record `(parent_state_id, transition_id)` and append inserted states to the next frontier.
   - Sort the final next frontier by canonical bytes before advancing depth.

6. Record graph data without unnecessary clones.

   Files to edit:
   - `crates/checker/src/graph.rs`
   - `crates/checker/src/search.rs`

   Implementation:
   - Choose graph mode from property needs: none, reverse, compact, or full.
   - Store reverse edges as `(pre_state_id, post_state_id or post_canon)` where possible.
   - Store compact edges as `(pre_state_id, post_state_id or post_canon, transition_id, triggered_property_ids)`.
   - Store full edges only when required, and prefer state IDs plus transition IDs over cloned JSON states.
   - Resolve post state IDs after visited merge for newly inserted states; keep canonical bytes for edges to already-known states when needed.

7. Apply limits and diagnostics at deterministic boundaries.

   Files to edit:
   - `crates/checker/src/diagnostics.rs`
   - `crates/checker/src/search.rs`
   - `crates/checker/src/report.rs`

   Implementation:
   - Track states, edges, depth, max frontier, final frontier, expanded depths, and bound hits.
   - Check limits before a layer starts and after a layer merge.
   - For mid-layer `maxEdges`, stop accepting further layer output in deterministic merged order, not worker completion order.
   - Convert limit hits into error verdicts for unresolved properties.
   - Report storage counts for state arena, parent records, and recorded edges.

8. Finalize search results.

   Files to edit:
   - `crates/checker/src/search.rs`
   - `crates/checker/src/property.rs`
   - `crates/checker/src/report.rs`

   Implementation:
   - After frontier exhaustion, depth bound, or limit hit, finalize unresolved properties.
   - Run `reachableFrom` and `leadsToWithin` finalizers using graph/state arena data.
   - Compute vacuity warnings for never-enabled transitions and uninhabited domain values.
   - Serialize the final `CheckResult` in the shape expected by TypeScript report creation.
   - Ensure repeated runs produce byte-identical canonical result ordering for verdicts, warnings, and bound hits.

## Acceptance criteria

- BFS expansion is parallel by design and does not rely on a single global mutable visited lock.
- Repeated runs on the same input produce identical traces and stats.
- `alwaysStep` observes all generated edges before dedupe.
- Parent records point to shortest-depth witnesses.
- Limits produce structured checker errors without silent truncation.

## Tests to add or update

- Rust tests for duplicate discovery across worker chunks.
- Rust tests for deterministic parent choice.
- Rust tests for edge observation into already-visited states.
- Rust tests for each search limit.
- Existing checker tests updated to the Rust-backed result shape.

## Verification commands

- `rtk cargo test -p modality-checker`
- `rtk pnpm test -- test/checker/checker.test.ts`
- `rtk pnpm test -- src/cli/features/check/command.test.ts`

## Risks, ambiguities, and stop conditions

- Stop and report if deterministic merge order cannot be maintained with the chosen parallel library.
- Stop and report if graph finalizers require data that the compact graph mode does not retain.
- Do not make the implementation single-threaded to avoid merge complexity; fix the data ownership model.
