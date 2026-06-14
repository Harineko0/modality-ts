# Checker Runtime Optimization Plan

## Goal

Optimize the existing TypeScript explicit-state checker after state-space narrowing is in place. The target is lower memory use and better throughput for large but relevant state graphs, without changing model semantics, public IR behavior, or shortest-counterexample guarantees.

This plan covers direction 4 from the discussion. It intentionally avoids the Rust rewrite path.

## Non-goals

- Do not rewrite the checker in Rust.
- Do not replace BFS with DFS by default.
- Do not change verdict semantics, trace contents, or property DSL behavior.
- Do not silently skip edges or sample states.
- Do not add framework-specific optimizations.
- Do not make broad extraction changes here; this plan is checker-internal.
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
- `canonicalState(...)` in `src/core/ir/canonical.ts` uses canonical JSON over declared vars. This is deterministic but may allocate heavily.
- `enabledTransitions(...)` in `src/check/engine/transitions.ts` filters all model transitions for every state.
- `stabilize(...)` in `src/check/engine/stabilize.ts` filters all transitions to find enabled internal transitions for every candidate state.
- `compareStates(...)` in `src/check/engine/state-utils.ts` calls `canonicalState(...)` during sorting, which can re-encode states repeatedly.

## Exact File Paths and Relevant Symbols

- `src/check/engine/check-model.ts`
  - `checkModel`
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
  - reachable/reachability finalization logic
- `src/check/properties/observe.ts`
  - `observeStates`
  - `observeEdge`
- `src/check/properties/leads-to.ts`
  - `checkLeadsToWithin`
  - constrained successor exploration
- `src/check/properties/reachable-from.ts`
  - reachable-from graph processing, if used by `finalizeProperties`
- `src/check/traces/trace.ts`
  - `traceTo`
  - `makeTraceStep`
  - `replayCheckedVerdict`
- `src/check/traces/step-facts.ts`
  - `facts`
- `src/check/engine/transitions.ts`
  - `enabledTransitions`
  - `installEnabledHook`
- `src/check/engine/stabilize.ts`
  - `stabilize`
  - `stabilizingSequences`
  - `applyInternalSequence`
- `src/check/engine/state-utils.ts`
  - `compareStates`
  - `changedVars`
  - `uniqueStabilizingStates`
- `src/core/ir/canonical.ts`
  - `canonicalState`
  - `canonicalJson`
- `test/checker/checker.test.ts`
  - Broad checker behavior tests.
- `test/checker/todo-hand-model.test.ts`
  - Representative hand-model verdict stability.
- `test/checker/checkout-hand-model.test.ts`
  - Representative async/checker behavior.

## Existing Patterns to Follow

- Preserve deterministic ordering by sorted transition ids and canonical state ordering.
- Preserve BFS minimality for `always`, `reachable`, and replayable counterexamples.
- Preserve `observeEdge(...)` before the visited check; `alwaysStep` must observe edges into already-visited states.
- Preserve `traceTo(...)` as the central trace reconstruction path unless replacing parent storage in a compatible way.
- Preserve the public `CheckResult` shape except for additive diagnostics/options from the narrowing plan.
- Keep optimization changes small and covered by parity tests.

## Atomic Implementation Steps

### 1. Add a checker memory profile baseline

Before changing storage, add focused instrumentation or tests that can be run locally to compare behavior.

Recommended approach:

- Add a synthetic checker stress test helper in `test/checker/checker.test.ts` or a small internal test utility.
- Use a model with many independent booleans or enums to generate a predictable graph.
- Assert semantics and deterministic counts, not wall-clock timing.
- Optionally add a non-CI script under `tools/` for manual profiling if needed.

Files to edit:

- `test/checker/checker.test.ts`
- Optionally `tools/checker-profile.ts`

Stop and ask/report if:

- The repo avoids benchmark-like tests in CI. In that case, keep profiling as a manual `tools/` script and add only semantic tests.

### 2. Avoid storing full edge objects unless a property needs them

Refactor `src/check/engine/check-model.ts` so `edges: Edge[]` is allocated only when finalization requires a full graph edge list.

Reasoning:

- `always` and `reachable` do not need all edges after exploration.
- `alwaysStep` needs each edge during exploration but not necessarily after it has been observed, unless trace construction for a violation needs the current edge.
- `reachableFrom` needs reverse graph information.
- `leadsToWithin` may need successor exploration or recorded trigger states depending on current implementation.

Implementation details:

- Add helper predicates:
  - `needsRecordedEdges(properties)`
  - `needsReverseGraph(properties)`
  - `needsStepMonitoring(properties)`
- In `exploreDepth(...)`, always call `observeEdge(...)` before visited checks.
- Push into `edges` only if a property kind needs recorded edges for finalization.
- If only reverse reachability is needed, consider recording compact reverse edges instead of full `Edge`.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/types.ts`
- `src/check/properties/finalize.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- `finalizeProperties(...)` currently relies on full edge objects for more property kinds than expected. Document each dependency and optimize one property kind at a time.

### 3. Compact parent storage

Reduce duplication in `Parent`.

Current `Parent` stores:

- `parent`
- `transition`
- `pre`
- `post`

Recommended target:

- Store `parentCanon`
- Store `transitionId` or transition index instead of the full transition object.
- Store `postCanon` implicitly as the map key.
- Store full `post` state in `states`.
- Avoid storing `pre` because it can be loaded through `states.get(parentCanon)` when reconstructing a trace.

Implementation details:

- Keep trace reconstruction output identical.
- Add a transition lookup table in the checker context:
  - `transitionsById: Map<string, Transition>`
  - or stable transition array index.
- Update `traceTo(...)` to reconstruct `pre` and `post` from `states`.
- If changing `traceTo(...)` signature is too invasive, add a new internal parent representation and adapter.

Files to edit:

- `src/check/types.ts`
- `src/check/engine/check-model.ts`
- `src/check/traces/trace.ts`
- `src/check/properties/observe.ts`
- `src/check/properties/finalize.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- A trace path can no longer be reconstructed for a violating `alwaysStep` edge. Keep the violating edge's `pre`/`post` locally until the verdict is recorded.

### 4. Cache canonical strings per BFS layer

Avoid repeated `canonicalState(...)` calls for the same object in sorting and expansion.

Implementation options:

- Carry `{ state, canon }` pairs in frontier arrays.
- Or keep a `WeakMap<ModelState, string>` canonical cache within a check run.

Recommended minimal path:

- Introduce a small internal `SearchState` type in `check-model.ts`:
  - `{ state: ModelState; canon: string }`
- Convert frontier and next arrays to `SearchState[]`.
- Sort by `canon` directly.
- Keep external helper signatures unchanged where possible by mapping to states at boundaries.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/engine/state-utils.ts` only if `compareStates(...)` needs a sibling comparator.
- `test/checker/checker.test.ts`

Stop and ask/report if:

- The change spreads through too many files. Use a local WeakMap cache first as a lower-risk intermediate.

### 5. Index transitions by class and possible write/read relevance

Avoid scanning all transitions in hot paths.

Implementation details:

- Build a checker context once per `checkModelCore(...)`:
  - `nonInternalTransitions`
  - `internalTransitions`
  - `transitionsById`
  - maybe `transitionsByTriggeredVar` for internal transitions with `triggeredBy`
- Update `enabledTransitions(...)` to accept an optional precomputed index or add a new internal helper.
- Update `stabilize(...)` to use indexed internal transitions instead of filtering `model.transitions` every time.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/engine/transitions.ts`
- `src/check/engine/stabilize.ts`
- `src/check/engine/model-api.ts`
- `src/check/diagnostics/bounds.ts`
- `src/check/properties/leads-to.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Changing `enabledTransitions(...)` breaks the public-ish `model-api` helpers. Prefer adding an internal indexed helper and keeping the exported helper compatible.

### 6. Make state diffs cheaper

`changedVars(pre, rawPost)` is called for every raw transition result. Ensure it only checks declared vars and avoids unnecessary allocation.

Implementation details:

- Inspect `src/check/engine/state-utils.ts`.
- If `changedVars(...)` iterates object keys, switch to model var order where needed.
- Consider returning a frozen or interned empty set for no-change transitions.
- Keep exact equality semantics unchanged.

Files to edit:

- `src/check/engine/state-utils.ts`
- `src/check/engine/check-model.ts`
- `src/check/engine/stabilize.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Domain values require deep equality rather than identity equality. Do not change equality semantics without adding dedicated tests.

### 7. Compile or specialize canonical encoding only after profiling

`docs/specs/03-checker.md` specifies a domain-aware compiled encoder, while current `canonicalState(...)` uses canonical JSON. This can be a larger change.

Recommended path:

- First add a local per-check canonical cache from Step 4.
- Profile again.
- Only then replace `canonicalState(...)` internals with a domain-aware encoder if encoding still dominates.

If implementing compiled encoding:

- Keep `canonicalState(model, state)` public behavior identical.
- Add tests for records, tagged unions, lists, tokens, `UNMOUNTED`, route locals, and deterministic var order.
- Do not use hash-only membership.

Files to edit:

- `src/core/ir/canonical.ts`
- `src/core/ir/domains.ts`
- `test/kernel/kernel.test.ts` or `test/checker/checker.test.ts`

Stop and ask/report if:

- Canonical encoding changes alter state counts, trace order, or JSON artifact expectations.

### 8. Preserve full graph only for properties that need it

After compact edge/parent storage, revisit `finalizeProperties(...)`.

Implementation details:

- For normal `always` and `reachable`, finalization should not require edge arrays.
- For `reachableFrom`, store a compact adjacency/reverse adjacency:
  - state canon strings
  - transition id/index if needed for nearest-miss diagnostics
  - no full `pre`/`post` states unless trace reconstruction requires them
- For `leadsToWithin`, prefer on-demand successor generation with memoization over retaining every full edge, unless current semantics require the explored graph.

Files to edit:

- `src/check/properties/finalize.ts`
- `src/check/properties/reachable-from.ts`
- `src/check/properties/leads-to.ts`
- `src/check/engine/check-model.ts`
- `src/check/types.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- A property finalizer depends on edge object identity or mutable edge state. That should be removed or documented before optimizing.

### 9. Keep optimization observable through diagnostics

Use the diagnostics added by the narrowing plan to show that memory-heavy structures are avoided.

Recommended fields:

- `recordedEdges`
- `maxFrontier`
- `storedStates`
- `parentEntries`
- `edgeRecordingMode`: `none`, `full`, `reverse`, or `property-specific`

Files to edit:

- `src/check/types.ts`
- `src/check/engine/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`

Stop and ask/report if:

- Diagnostics become too coupled to internal implementation. Keep them high-level enough to remain stable.

### 10. Run parity and architecture verification

After each substantial storage change, run focused tests before moving to the next optimization.

Files to edit:

- None in this step unless tests reveal a regression.

Stop and ask/report if:

- Any sliced-vs-unsliced parity test changes verdict status.
- Any trace step sequence changes for an existing deterministic counterexample without a clear and intended ordering reason.
- Any architecture rule fails due to new imports between checker and core.

## Per-Step Files to Edit

- Step 1:
  - `test/checker/checker.test.ts`
  - Optionally `tools/checker-profile.ts`
- Step 2:
  - `src/check/engine/check-model.ts`
  - `src/check/types.ts`
  - `src/check/properties/finalize.ts`
  - `test/checker/checker.test.ts`
- Step 3:
  - `src/check/types.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/traces/trace.ts`
  - `src/check/properties/observe.ts`
  - `src/check/properties/finalize.ts`
  - `test/checker/checker.test.ts`
- Step 4:
  - `src/check/engine/check-model.ts`
  - Possibly `src/check/engine/state-utils.ts`
  - `test/checker/checker.test.ts`
- Step 5:
  - `src/check/engine/check-model.ts`
  - `src/check/engine/transitions.ts`
  - `src/check/engine/stabilize.ts`
  - `src/check/engine/model-api.ts`
  - `src/check/diagnostics/bounds.ts`
  - `src/check/properties/leads-to.ts`
  - `test/checker/checker.test.ts`
- Step 6:
  - `src/check/engine/state-utils.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/engine/stabilize.ts`
  - `test/checker/checker.test.ts`
- Step 7:
  - `src/core/ir/canonical.ts`
  - `src/core/ir/domains.ts`
  - `test/kernel/kernel.test.ts`
  - `test/checker/checker.test.ts`
- Step 8:
  - `src/check/properties/finalize.ts`
  - `src/check/properties/reachable-from.ts`
  - `src/check/properties/leads-to.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/types.ts`
  - `test/checker/checker.test.ts`
- Step 9:
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
- Diagnostics expose whether full edge recording was required.
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
  - Add diagnostics rendering/reporting assertions if Step 9 exposes optimization mode.

## Verification Commands

Run commands with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- test/checker/todo-hand-model.test.ts test/checker/checkout-hand-model.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts
rtk pnpm architecture
```

For semantics-sensitive storage or canonicalization changes, also run:

```bash
rtk pnpm phase7
```

If a manual profiling script is added:

```bash
rtk tsx tools/checker-profile.ts
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Removing full edge storage can break `reachableFrom` or `leadsToWithin` if their finalizers depend on full edge objects. Optimize per property kind and keep tests close.
- Risk: Compact parent storage can break trace reconstruction. Keep transition lookup and state lookup deterministic.
- Risk: Canonical encoding changes can affect ordering and trace minimality presentation even when state counts are correct. Treat compiled canonical encoding as a later step, not the first optimization.
- Risk: Transition indexing can accidentally skip transitions if class, route mount, or guard semantics are baked into the index too early. Index candidates only; still evaluate guards and mount conditions per state.
- Risk: Memory diagnostics can become unstable if they expose exact heap values. Prefer structural modes and counts in tests.
- Ambiguity: It may be unclear whether `leadsToWithin` should reuse the main graph or regenerate successors. Preserve current semantics first, then optimize with explicit tests.
- Stop and report if any change alters verdict status, reachable state count, or edge count on existing deterministic checker tests without an intentional semantic reason.
- Stop and report if an optimization requires weakening BFS minimal counterexample guarantees.
