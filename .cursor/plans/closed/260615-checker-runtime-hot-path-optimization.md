# Checker Runtime Hot Path Optimization Plan

## Goal

Improve checker throughput by reducing repeated work in hot paths: canonicalization, transition scanning, stabilization, and changed-var computation.

This plan is the second half of the former runtime optimization plan. It should be done after the storage optimization plan or independently when profiling shows CPU/GC overhead dominates.

## Non-goals

- Do not rewrite the checker in Rust.
- Do not replace BFS with DFS by default.
- Do not change verdict semantics, trace contents, or property DSL behavior.
- Do not change graph storage or parent representation here; that is covered by `260615-checker-runtime-storage-optimization.md`.
- Do not use hash-only visited membership.
- Do not add framework-specific optimizations.
- Do not commit generated `dist/` output.

## Current-State Findings

- `canonicalState(...)` in `src/core/ir/canonical.ts` uses canonical JSON over declared vars. This is deterministic but may allocate heavily.
- `compareStates(...)` in `src/check/engine/state-utils.ts` calls `canonicalState(...)` during sorting, which can re-encode states repeatedly.
- `enabledTransitions(...)` in `src/check/engine/transitions.ts` filters all model transitions for every state.
- `stabilize(...)` in `src/check/engine/stabilize.ts` filters all transitions to find enabled internal transitions for every candidate state.
- `changedVars(pre, rawPost)` is called for every raw transition result and during stabilization.
- `docs/specs/03-checker.md` specifies domain-aware canonical encoding as a desired optimization, but this is larger than a local cache.

## Exact File Paths and Relevant Symbols

- `src/check/engine/check-model.ts`
  - `checkModelCore`
  - `exploreDepth`
  - `seedFrontier`
- `src/check/engine/state-utils.ts`
  - `compareStates`
  - `changedVars`
  - `uniqueStabilizingStates`
- `src/check/engine/transitions.ts`
  - `enabledTransitions`
  - `installEnabledHook`
- `src/check/engine/stabilize.ts`
  - `stabilize`
  - `stabilizingSequences`
  - `applyInternalSequence`
- `src/check/engine/model-api.ts`
  - model API successor helpers using `enabledTransitions`
- `src/check/diagnostics/bounds.ts`
  - bound diagnostics that call `enabledTransitions`
- `src/check/properties/leads-to.ts`
  - constrained successor exploration
- `src/core/ir/canonical.ts`
  - `canonicalState`
  - `canonicalJson`
- `src/core/ir/domains.ts`
  - domain enumeration and initial values used by canonical tests
- `test/checker/checker.test.ts`
- `test/kernel/kernel.test.ts`

## Existing Patterns to Follow

- Preserve deterministic ordering by sorted transition ids and canonical state ordering.
- Preserve state counts, edge counts, and verdict statuses.
- Keep `enabledTransitions(...)` compatible for existing callers unless adding a clearly internal indexed helper.
- Keep `canonicalState(model, state)` public behavior identical.
- Use profiling or targeted tests before replacing core canonical encoding.

## Atomic Implementation Steps

### 1. Add a hot-path profiling baseline

Add a manual profiling helper or a deterministic stress test before changing hot-path behavior.

Recommended approach:

- Use a synthetic model with many independent toggles or enum vars.
- In tests, assert deterministic state/edge counts only.
- In a manual `tools/` script, optionally print expansion count and elapsed time.

Files to edit:

- `test/checker/checker.test.ts`
- Optionally `tools/checker-profile.ts`

Stop and ask/report if:

- The repo does not want profiling scripts. Keep this as test-only semantic coverage.

### 2. Cache canonical strings during a check run

Avoid repeated `canonicalState(...)` calls for the same state object.

Implementation options:

- Carry `{ state, canon }` pairs in frontier arrays.
- Or keep a `WeakMap<ModelState, string>` canonical cache within `checkModelCore(...)`.

Recommended minimal path:

- Start with a local `WeakMap<ModelState, string>` and helper `canon(state)`.
- Use it in `seedFrontier(...)`, `exploreDepth(...)`, sorting, and diagnostics.
- If this remains clean, consider a local `SearchState` type later.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/engine/state-utils.ts` only if adding a comparator sibling
- `test/checker/checker.test.ts`

Stop and ask/report if:

- The cache cannot be threaded without broad changes. Keep `canonicalState(...)` calls and move to transition indexing first.

### 3. Sort frontier/next states by cached canonical strings

Reduce repeated canonical encoding in sort comparators.

Implementation details:

- Add a helper that maps states to `{ state, canon }`, sorts by `canon`, and maps back if public helper signatures must stay unchanged.
- Prefer local changes in `check-model.ts` over changing `compareStates(...)` globally.
- Keep trace ordering stable.

Files to edit:

- `src/check/engine/check-model.ts`
- Possibly `src/check/engine/state-utils.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Any deterministic trace step sequence changes unexpectedly.

### 4. Build transition indexes once per check

Avoid scanning all transitions in every hot path.

Recommended index:

- `nonInternalTransitions`
- `internalTransitions`
- `transitionsById`
- `internalByTriggeredVar` for transitions with `triggeredBy`
- `alwaysTriggeredInternal` for internal transitions without `triggeredBy`

Implementation details:

- Build the index in `checkModelCore(...)`.
- Pass it to internal helpers where practical.
- Keep the exported or widely used `enabledTransitions(model, state)` compatible.

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/engine/transitions.ts`
- `src/check/engine/stabilize.ts`
- `src/check/engine/model-api.ts`
- `src/check/diagnostics/bounds.ts`
- `src/check/properties/leads-to.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Updating every caller of `enabledTransitions(...)` becomes too invasive. Add a separate internal helper instead.

### 5. Use indexed candidates in `enabledTransitions(...)`

Use the non-internal transition index as the candidate list, then still evaluate per-state semantics.

Rules:

- Continue evaluating `routeLocalMounted(...)` per state.
- Continue evaluating `guardHolds(...)` per state.
- Continue sorting deterministically by transition id if candidate order is not already stable.
- Do not precompute guard truth.

Files to edit:

- `src/check/engine/transitions.ts`
- `src/check/engine/check-model.ts`
- `src/check/engine/model-api.ts`
- `src/check/diagnostics/bounds.ts`
- `src/check/properties/leads-to.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Candidate indexing skips any transition whose guard later becomes true.

### 6. Use indexed internal transitions in `stabilize(...)`

Avoid filtering all model transitions for internal candidates in every stabilization iteration.

Implementation details:

- For a candidate state and changed-var set:
  - include `alwaysTriggeredInternal`
  - include transitions from `internalByTriggeredVar` for each changed var
- Deduplicate candidates before guard/mount checks.
- Still apply `routeLocalMounted(...)`, `internalTriggered(...)`, and `guardHolds(...)` semantics.
- Preserve deterministic id sorting before applying sequences.

Files to edit:

- `src/check/engine/stabilize.ts`
- `src/check/engine/check-model.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Internal transitions without `triggeredBy` are accidentally skipped. They must remain candidates every stabilization pass.

### 7. Make `changedVars(...)` cheaper without changing equality semantics

Inspect `src/check/engine/state-utils.ts` and optimize only if straightforward.

Implementation details:

- If `changedVars(...)` iterates object keys, prefer declared model var order where the caller has model context.
- If no model context is available, avoid invasive signature changes unless profiling shows this matters.
- Consider returning a shared empty set for no-change transitions.
- Keep exact value comparison semantics unchanged.

Files to edit:

- `src/check/engine/state-utils.ts`
- `src/check/engine/check-model.ts`
- `src/check/engine/stabilize.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Values require deep equality rather than identity equality. Do not change equality semantics without dedicated tests.

### 8. Defer compiled/domain-aware canonical encoding until after local caching

Only replace `canonicalState(...)` internals if profiling still shows canonicalization dominates after caching and sort improvements.

If implementing compiled encoding:

- Keep `canonicalState(model, state)` public behavior identical.
- Add tests for:
  - bools
  - enums
  - records
  - tagged unions
  - bounded lists
  - tokens
  - `UNMOUNTED`
  - deterministic var order
- Do not use hash-only membership.

Files to edit:

- `src/core/ir/canonical.ts`
- `src/core/ir/domains.ts`
- `test/kernel/kernel.test.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Canonical encoding changes alter state counts, trace order, or JSON artifact expectations.

### 9. Surface hot-path mode in diagnostics

If diagnostics have landed, expose high-level optimization mode only.

Recommended fields:

- `canonicalCache: true`
- `transitionIndex: true`
- `internalTransitionIndex: true`

Avoid volatile timing/heap values in deterministic tests.

Files to edit:

- `src/check/types.ts`
- `src/check/engine/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`

Stop and ask/report if:

- Diagnostics become too tied to internal implementation. Keep this optional and high-level.

## Per-Step Files to Edit

- Step 1:
  - `test/checker/checker.test.ts`
  - Optionally `tools/checker-profile.ts`
- Step 2:
  - `src/check/engine/check-model.ts`
  - Possibly `src/check/engine/state-utils.ts`
  - `test/checker/checker.test.ts`
- Step 3:
  - `src/check/engine/check-model.ts`
  - Possibly `src/check/engine/state-utils.ts`
  - `test/checker/checker.test.ts`
- Step 4:
  - `src/check/engine/check-model.ts`
  - `src/check/engine/transitions.ts`
  - `src/check/engine/stabilize.ts`
  - `src/check/engine/model-api.ts`
  - `src/check/diagnostics/bounds.ts`
  - `src/check/properties/leads-to.ts`
  - `test/checker/checker.test.ts`
- Step 5:
  - `src/check/engine/transitions.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/engine/model-api.ts`
  - `src/check/diagnostics/bounds.ts`
  - `src/check/properties/leads-to.ts`
  - `test/checker/checker.test.ts`
- Step 6:
  - `src/check/engine/stabilize.ts`
  - `src/check/engine/check-model.ts`
  - `test/checker/checker.test.ts`
- Step 7:
  - `src/check/engine/state-utils.ts`
  - `src/check/engine/check-model.ts`
  - `src/check/engine/stabilize.ts`
  - `test/checker/checker.test.ts`
- Step 8:
  - `src/core/ir/canonical.ts`
  - `src/core/ir/domains.ts`
  - `test/kernel/kernel.test.ts`
  - `test/checker/checker.test.ts`
- Step 9:
  - `src/check/types.ts`
  - `src/check/engine/check-model.ts`
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/command.test.ts`

## Acceptance Criteria

- Repeated canonical encoding is reduced during BFS sorting and expansion.
- Transition candidate selection no longer scans all transitions for every non-internal expansion when an index is available.
- Stabilization no longer scans all transitions for every internal pass when an index is available.
- State counts, edge counts, verdict statuses, and deterministic trace step ids remain stable.
- `alwaysStep`, `reachableFrom`, and `leadsToWithin` tests still pass.
- No optimization precomputes state-dependent guard or mount results.
- No checker optimization uses framework-specific knowledge.
- No generated `dist/` files are committed.

## Tests to Add or Update

- `test/checker/checker.test.ts`
  - Keep deterministic state/edge count tests passing.
  - Add a regression where an indexed transition guard is initially false and later true.
  - Add a regression where an internal transition without `triggeredBy` still fires during stabilization.
  - Add a regression where an internal transition with `triggeredBy` fires only when the triggering var changes.
- `test/kernel/kernel.test.ts`
  - Add canonical encoding tests only if `canonicalState(...)` internals change.
- `src/cli/features/check/command.test.ts`
  - Add diagnostics rendering/reporting assertions only if hot-path diagnostics are exposed.

## Verification Commands

Run commands with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- test/checker/todo-hand-model.test.ts test/checker/checkout-hand-model.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts
rtk pnpm architecture
```

For canonicalization or transition-index semantics changes, also run:

```bash
rtk pnpm phase7
```

If a manual profiling script is added:

```bash
rtk tsx tools/checker-profile.ts
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Transition indexing can accidentally skip transitions if class, route mount, or guard semantics are baked into the index too early. Index candidates only; still evaluate guards and mount conditions per state.
- Risk: Internal transition indexing can skip always-triggered internals. Keep internals with no `triggeredBy` in every stabilization pass.
- Risk: Canonical encoding changes can affect ordering and trace presentation even when state counts are correct. Treat compiled canonical encoding as a later step.
- Risk: Caches can hide mutation bugs if states are mutated after canonicalization. Existing code appears to create new state objects; stop if a mutation pattern is found.
- Stop and report if any change alters verdict status, reachable state count, or edge count on existing deterministic checker tests without an intentional semantic reason.
- Stop and report if an optimization requires weakening BFS minimal counterexample guarantees.
