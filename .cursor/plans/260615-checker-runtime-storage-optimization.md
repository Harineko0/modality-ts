# Checker Runtime Storage Optimization Plan

## Goal

Reduce checker memory use by avoiding unnecessary full-edge and duplicate parent-state storage in the existing TypeScript explicit-state checker.

This plan is the first half of the former runtime optimization plan. It focuses only on storage shape and graph retention. Run it after, or alongside, the state-space narrowing plan.

## Non-goals

- Do not rewrite the checker in Rust.
- Do not replace BFS with DFS by default.
- Do not change verdict semantics, trace contents, or property DSL behavior.
- Do not silently skip edges or sample states.
- Do not add framework-specific optimizations.
- Do not optimize canonical encoding or transition scanning here; those are covered by `260615-checker-runtime-hot-path-optimization.md`.
- Do not commit generated `dist/` output.

## Current-State Findings

- `src/check/engine/check-model.ts` performs layered BFS and stores:
  - `parents: Map<string, Parent>`
  - `states: Map<string, ModelState>`
  - `edges: Edge[]`
  - `frontier: ModelState[]`
- Every generated edge currently pushes `{ preCanon, postCanon, pre, post, transition, step }` into `edges`. This duplicates full state objects for dense graphs.
- `finalizeProperties(...)` needs `parents`, `states`, and `edges`, mainly for `reachableFrom` and bounded response processing.
- `observeEdge(...)` needs full `pre` and `post` while exploring for `alwaysStep` properties.
- `traceTo(...)` reconstructs traces from the parent map. The parent map currently stores full `pre` and `post` states as well as the parent canonical string.
- Normal `always` and `reachable` properties do not need all edges after edge observation.

## Exact File Paths and Relevant Symbols

- `src/check/engine/check-model.ts`
  - `checkModelCore`
  - `exploreDepth`
  - `seedFrontier`
  - `checkModelSliced`
  - `combineSlicedResults`
- `src/check/types.ts`
  - `Parent`
  - `Edge`
  - `CheckResult`
  - `CheckOptions`
- `src/check/properties/finalize.ts`
  - `finalizeProperties`
- `src/check/properties/observe.ts`
  - `observeStates`
  - `observeEdge`
- `src/check/properties/leads-to.ts`
  - `checkLeadsToWithin`
- `src/check/properties/reachable-from.ts`
  - reachable-from graph processing, if used by `finalizeProperties`
- `src/check/traces/trace.ts`
  - `traceTo`
  - `makeTraceStep`
  - `replayCheckedVerdict`
- `src/check/traces/step-facts.ts`
  - `facts`
- `test/checker/checker.test.ts`
- `test/checker/todo-hand-model.test.ts`
- `test/checker/checkout-hand-model.test.ts`

## Existing Patterns to Follow

- Preserve BFS minimality for `always`, `reachable`, and replayable counterexamples.
- Preserve `observeEdge(...)` before the visited check; `alwaysStep` must observe edges into already-visited states.
- Preserve `traceTo(...)` as the central trace reconstruction path unless replacing parent storage in a compatible way.
- Preserve deterministic trace step ids and state/edge counts.
- Keep optimization changes small and covered by parity tests.

## Atomic Implementation Steps

### 1. Add a storage-mode baseline test or profiling helper

Add a small synthetic model that makes storage behavior visible without timing assertions.

Implementation details:

- Use a model with several independent booleans/enums to generate a predictable graph.
- Assert semantics and deterministic counts, not wall-clock timing.
- If benchmark-style tests are not desired in CI, add a manual helper under `tools/` and only add semantic tests.

Files to edit:

- `test/checker/checker.test.ts`
- Optionally `tools/checker-profile.ts`

Stop and ask/report if:

- The repo avoids benchmark-like tests in CI. Keep profiling manual and add only semantic coverage.

### 2. Add property-kind helpers for graph storage needs

Introduce small helpers near `checkModelCore(...)`.

Recommended helpers:

- `needsRecordedEdges(properties)`
- `needsReverseGraph(properties)`
- `needsStepMonitoring(properties)`

Expected behavior:

- `always` and `reachable`: no full edge retention.
- `alwaysStep`: observe each edge during exploration; do not retain full graph unless another property needs it.
- `reachableFrom`: needs graph/reverse graph for finalization.
- `leadsToWithin`: inspect current implementation before deciding whether full edge retention is required.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/properties/finalize.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- `finalizeProperties(...)` uses full edge objects for more property kinds than expected. Document each dependency before optimizing.

### 3. Avoid storing full edge objects unless required

Refactor `exploreDepth(...)` so `edges.push(...)` happens only when a property kind needs recorded edges.

Implementation details:

- Always compute `step = facts(pre, post, transition)` because `observeEdge(...)` needs it.
- Always call `observeEdge(...)` before visited checks.
- If full edge recording is disabled, keep `edgeCount` but do not retain `{ pre, post }`.
- If only reverse reachability is needed, prefer compact graph storage in a later step instead of full `Edge[]`.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/types.ts` only if `Edge` storage mode needs a new type
- `test/checker/checker.test.ts`

Stop and ask/report if:

- A failing `alwaysStep` trace cannot be constructed without retaining the current edge. Keep the current edge locally until verdict recording.

### 4. Compact parent storage

Reduce duplication in `Parent`.

Current `Parent` stores:

- `parent`
- `transition`
- `pre`
- `post`

Recommended target:

- Store `parentCanon`.
- Store `transitionId` or transition index instead of the full transition object.
- Store full `post` state in `states`.
- Avoid storing `pre`; load it from `states.get(parentCanon)` during trace reconstruction.

Implementation details:

- Add a transition lookup table in the checker context:
  - `transitionsById: Map<string, Transition>`
  - or stable transition array index.
- Update `traceTo(...)` to reconstruct `pre` and `post` from `states`.
- If changing `traceTo(...)` is too invasive, add an internal adapter first.

Files to edit:

- `src/check/types.ts`
- `src/check/engine/check-model.ts`
- `src/check/traces/trace.ts`
- `src/check/properties/observe.ts`
- `src/check/properties/finalize.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Trace reconstruction loses pre/post state for any existing violation test.

### 5. Add compact graph storage for properties that need final graph analysis

After full-edge retention is conditional, handle graph-heavy properties deliberately.

Implementation details:

- For `reachableFrom`, store compact adjacency or reverse adjacency:
  - state canon strings
  - transition id/index if needed
  - no full `pre`/`post` states unless trace reconstruction requires them
- For `leadsToWithin`, preserve current semantics first. Prefer on-demand successor generation with memoization only if tests prove equivalence.
- Keep full `Edge[]` as a fallback mode for property kinds not yet optimized.

Files to edit:

- `src/check/properties/finalize.ts`
- `src/check/properties/reachable-from.ts`
- `src/check/properties/leads-to.ts`
- `src/check/engine/check-model.ts`
- `src/check/types.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- A property finalizer depends on mutable or full edge object identity. Remove that dependency or leave that property on full-edge mode.

### 6. Surface storage mode in diagnostics

If the state-space narrowing diagnostics plan has landed, expose storage mode there.

Recommended fields:

- `recordedEdges`
- `storedStates`
- `parentEntries`
- `edgeRecordingMode`: `none`, `full`, `reverse`, or `property-specific`

Keep exact heap values out of deterministic tests.

Files to edit:

- `src/check/types.ts`
- `src/check/engine/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`

Stop and ask/report if:

- Diagnostics become tightly coupled to internal implementation details. Keep fields high-level.

## Per-Step Files to Edit

- Step 1:
  - `test/checker/checker.test.ts`
  - Optionally `tools/checker-profile.ts`
- Step 2:
  - `src/check/engine/check-model.ts`
  - `src/check/properties/finalize.ts`
  - `test/checker/checker.test.ts`
- Step 3:
  - `src/check/engine/check-model.ts`
  - `src/check/types.ts`
  - `test/checker/checker.test.ts`
- Step 4:
  - `src/check/types.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/traces/trace.ts`
  - `src/check/properties/observe.ts`
  - `src/check/properties/finalize.ts`
  - `test/checker/checker.test.ts`
- Step 5:
  - `src/check/properties/finalize.ts`
  - `src/check/properties/reachable-from.ts`
  - `src/check/properties/leads-to.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/types.ts`
  - `test/checker/checker.test.ts`
- Step 6:
  - `src/check/types.ts`
  - `src/check/engine/check-model.ts`
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/command.test.ts`

## Acceptance Criteria

- For property sets without `reachableFrom` or `leadsToWithin`, the checker does not retain a full `Edge[]` graph after observing each edge.
- Parent storage no longer duplicates full `pre` and `post` states for every visited state.
- Trace reconstruction remains byte-for-byte or semantically equivalent for existing counterexample tests.
- `alwaysStep` still observes edges into already-visited states.
- `reachableFrom` and `leadsToWithin` tests still pass.
- State counts, edge counts, verdict statuses, and deterministic trace step ids remain stable for existing tests.
- Diagnostics expose whether full edge recording was required, if diagnostics have landed.
- No checker optimization uses framework-specific knowledge.
- No generated `dist/` files are committed.

## Tests to Add or Update

- `test/checker/checker.test.ts`
  - Add a regression proving `alwaysStep` still catches a violating edge into an already visited state.
  - Add a regression proving normal `always`/`reachable` runs can complete with edge recording disabled.
  - Add a regression proving trace reconstruction still includes the correct pre/post diffs after compact parent storage.
  - Add or update `reachableFrom` and `leadsToWithin` tests if compact graph storage changes internal data structures.
- `test/checker/todo-hand-model.test.ts`
  - Keep verdict stability checks passing.
- `test/checker/checkout-hand-model.test.ts`
  - Keep async/response property checks passing.
- `src/cli/features/check/command.test.ts`
  - Add diagnostics rendering/reporting assertions if storage mode is exposed.

## Verification Commands

Run commands with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- test/checker/todo-hand-model.test.ts test/checker/checkout-hand-model.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts
rtk pnpm architecture
```

For semantics-sensitive storage changes, also run:

```bash
rtk pnpm phase7
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Removing full edge storage can break `reachableFrom` or `leadsToWithin` if their finalizers depend on full edge objects. Optimize per property kind and keep tests close.
- Risk: Compact parent storage can break trace reconstruction. Keep transition lookup and state lookup deterministic.
- Risk: Memory diagnostics can become unstable if they expose exact heap values. Prefer structural modes and counts in tests.
- Ambiguity: It may be unclear whether `leadsToWithin` should reuse the main graph or regenerate successors. Preserve current semantics first.
- Stop and report if any change alters verdict status, reachable state count, or edge count on existing deterministic checker tests without an intentional semantic reason.
- Stop and report if an optimization requires weakening BFS minimal counterexample guarantees.
