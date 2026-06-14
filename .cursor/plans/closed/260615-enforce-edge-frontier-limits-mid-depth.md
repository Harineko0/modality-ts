# Enforce Edge and Frontier Limits Mid-Depth

## Goal

Enforce `maxEdges` and `maxFrontier` incrementally during a single BFS depth expansion in `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`, so high-branching layers stop near the configured limits instead of generating an entire oversized layer before diagnostics fire.

The implementation should be minimal, preserve existing breadth-first ordering and shortest-counterexample behavior as much as practical, and add focused regression tests for mid-depth interruption.

## Non-goals

- Do not refactor the checker architecture or replace the layered BFS search.
- Do not change public `CheckOptions`, `CheckDiagnostics`, `CheckResult`, `Edge`, or `Parent` shapes unless a focused type-only adjustment is unavoidable.
- Do not change slicing behavior, model validation, replay, trace construction, property DSL semantics, CLI option parsing, or report formats.
- Do not change the existing `maxStates` behavior except where shared helper extraction keeps behavior equivalent.
- Do not alter how `memoryGuard` is checked unless a tiny helper reuse makes it natural; memory checks are not the finding being fixed.
- Do not commit generated `dist/` output.
- Do not revert or overwrite unrelated uncommitted work already present in the repository.

## Current-state findings

- `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts` uses layered BFS in `checkModelCore(...)`.
- `checkModelCore(...)` calls `checkSearchLimits(...)` immediately before `exploreDepth(...)` and again after the entire depth expansion returns.
- `checkSearchLimits(...)` already knows how to produce diagnostics for `maxStates`, `maxEdges`, `maxFrontier`, and `memoryGuard`.
- `exploreDepth(...)` currently checks only `maxStates` inside the nested expansion loops, immediately after adding a new parent/state/next-frontier entry.
- `maxEdges` is incremented inside `exploreDepth(...)` as local `edgeCount`, but the limit is not checked until `exploreDepth(...)` returns and `checkModelCore(...)` adds `result.edges` to the cumulative `edgeCount`.
- `maxFrontier` is effectively checked only for the current depth's input `frontier` and the completed next `frontier`, not while `next` is being built.
- A high-branching state can therefore append many `edges` and many `next` entries before `maxEdges` or `maxFrontier` diagnostics are recorded.
- `observeEdge(...)` currently runs before the visited-state check. Preserve that order so `alwaysStep` properties still observe edges into already visited states.
- `applySearchLimitVerdicts(...)` preserves already decisive verdicts with status `violated`, `reachable`, `vacuous-warning`, or `error`. This helps preserve counterexamples found before a limit is hit.
- The worktree currently has unrelated uncommitted changes in checker, CLI, docs, and tests. The implementation agent must work with the current tree and must not revert those changes.

## Exact file paths and relevant symbols

- `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`
  - `checkModelCore(...)`
  - `checkSearchLimits(...)`
  - `applySearchLimitVerdicts(...)`
  - `seedFrontier(...)`
  - `exploreDepth(...)`
  - `SearchTracker`
  - local variables `frontier`, `edgeCount`, `edges`, `parents`, `states`, `tracker.limitHit`
- `/Users/hari/proj/modality-ts/src/check/types.ts`
  - `CheckOptions`
  - `CheckDiagnostics`
  - `CheckProgress`
  - `CheckResult`
  - `Edge`
  - `Parent`
- `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`
  - existing `"stops gracefully when maxStates is exceeded"` test
  - existing `"reports search diagnostics with frontier and depth stats"` test
  - local test helpers `lit(...)`, `read(...)`, and `model()`
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
  - `renderCheckResult(...)` limit summary logic, only if tests reveal displayed counts are misleading enough to require a minimal diagnostics update
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
  - existing `"reports search-limit diagnostics when configured"` test, only if CLI rendering is touched

## Existing patterns to follow

- Keep BFS depth layering: expand states in current `frontier`, collect `next`, sort `next` with `compareStates(model)`, then return it to `checkModelCore(...)`.
- Preserve deterministic transition and state ordering by leaving `enabledTransitions(...)`, `stabilize(...)`, `canonicalState(...)`, and `compareStates(...)` behavior unchanged.
- Preserve the current loop-break pattern in `exploreDepth(...)`: set `tracker.limitHit`, break the innermost loop, and let existing `if (tracker.limitHit !== null) break;` guards unwind nested loops.
- Preserve the existing `maxStates` diagnostic string shape: `search limit exceeded: maxStates=<value>`.
- Use the existing `checkSearchLimits(...)` diagnostic strings for `maxEdges` and `maxFrontier` rather than creating parallel message formats.
- Continue calling `observeEdge(...)` for an edge before limit interruption if that edge has already been generated and pushed.
- Continue adding a newly discovered state to `parents`, `states`, and `next` before checking whether the resulting frontier size reaches `maxFrontier`, mirroring the current `maxStates` pattern that records the boundary-crossing item.
- Keep tests in `test/checker/checker.test.ts` near the existing search-limit diagnostics tests unless the file has been reorganized.

## Atomic implementation steps

### 1. Confirm current helper signatures and dirty tree

Inspect the current versions of the relevant files before editing. The repository has active uncommitted changes, so do not assume line numbers or code exactly match this plan.

Files to edit:

- None.

Stop and ask/report if:

- `exploreDepth(...)`, `checkSearchLimits(...)`, or `SearchTracker` has already been substantially refactored in the current tree.
- The requested behavior appears already implemented.
- Existing uncommitted changes make it unclear which code path is authoritative.

### 2. Add a tiny internal helper for recording a search limit

In `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`, add a small helper near `checkSearchLimits(...)` or inside `exploreDepth(...)`'s vicinity to avoid duplicating diagnostic construction.

Recommended shape:

```ts
function hitSearchLimit(
  tracker: SearchTracker,
  options: CheckOptions,
  states: number,
  edges: number,
  frontier: number,
  depth: number,
): boolean {
  if (tracker.limitHit !== null) return true;
  const limit = checkSearchLimits(options, states, edges, frontier, depth);
  if (!limit) return false;
  tracker.limitHit = limit;
  return true;
}
```

Use this helper only where it keeps the diff smaller. It is acceptable to call `checkSearchLimits(...)` directly inside `exploreDepth(...)` if that produces a clearer minimal patch.

Files to edit:

- `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`

Stop and ask/report if:

- TypeScript inference becomes awkward or the helper encourages broad call-site churn. Prefer direct local checks over a larger refactor.

### 3. Track cumulative edges inside `exploreDepth(...)`

Modify `exploreDepth(...)` so it can check `maxEdges` immediately after each edge is appended.

Recommended minimal approach:

- Add a new parameter to `exploreDepth(...)`, for example `startingEdgeCount: number`, passed from `checkModelCore(...)` as the current cumulative `edgeCount`.
- Keep the existing returned `{ next, edges }` shape.
- After `edgeCount += 1` and `edges.push(...)`, compute cumulative edges as `startingEdgeCount + edgeCount`.
- Check limits at that point with:
  - `states`: `parents.size`
  - `edges`: `startingEdgeCount + edgeCount`
  - `frontier`: `next.length`
  - `depth`: the current depth passed from `checkModelCore(...)`
- To supply `depth`, either pass the current `depth` into `exploreDepth(...)` or pass a `limitDepth` value. Do not otherwise change depth accounting.

Important ordering:

- Keep `edgeCount += 1`, `edges.push(...)`, `facts(...)`, and `observeEdge(...)` together in the existing order.
- Check `maxEdges` after the edge exists and after `observeEdge(...)`, so a decisive property violation/reachability verdict caused by that edge is not lost.
- If the `maxEdges` limit is hit, set `tracker.limitHit` and break using the existing nested-loop guards before generating more raw posts or transitions.

Files to edit:

- `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`

Stop and ask/report if:

- Passing `depth` or `startingEdgeCount` causes many unrelated signature changes. `exploreDepth(...)` is local to this file, so the change should remain contained.

### 4. Check `maxFrontier` when `next` grows

Inside the existing `if (!parents.has(postCanon))` block in `exploreDepth(...)`, after `parents.set(...)`, `states.set(...)`, and `next.push(post)`, update/check frontier limits incrementally.

Recommended behavior:

- Update `tracker.maxFrontier = Math.max(tracker.maxFrontier, next.length)` after `next.push(post)`.
- Check limits using:
  - `states`: `parents.size`
  - `edges`: cumulative edges from Step 3
  - `frontier`: `next.length`
  - `depth`: the current depth value passed into `exploreDepth(...)`
- Preserve the current `maxStates` behavior. Either leave the existing `maxStates` block in place and add `maxFrontier`/`maxEdges` checks nearby, or replace it with the shared limit helper only if the resulting behavior is equivalent.
- If `maxFrontier` is hit, set `tracker.limitHit` and stop expansion immediately via existing break guards.

Acceptance detail:

- With `maxFrontier: 2` and a single high-branching initial state, `next.length` should stop at `2` or otherwise no greater than the configured limit. It should not build the entire high-branching next layer.

Files to edit:

- `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`

Stop and ask/report if:

- Existing code intentionally treats `maxFrontier` as a completed-layer-only diagnostic. The finding says it should be enforced incrementally, so this would be a product/semantics conflict to report.

### 5. Keep outer limit checks and diagnostics stable

Leave the pre- and post-`exploreDepth(...)` `checkSearchLimits(...)` checks in `checkModelCore(...)` unless they become redundant in a way that clearly simplifies the code.

Recommended minimal adjustments:

- Pass `edgeCount` and `depth` into `exploreDepth(...)`.
- After `exploreDepth(...)` returns, keep `frontier = result.next`, `edgeCount += result.edges`, `observeStates(...)`, `recordDominantVars(...)`, `depth += 1`, progress reporting, and post-limit check in the same relative order.
- If an incremental limit hit returns a partial `next`, allow the existing outer flow to observe states in that partial `frontier`, increment depth once for the partially expanded layer, and apply search-limit verdicts.
- Do not change `applySearchLimitVerdicts(...)`; it already preserves decisive verdicts found before the limit.

Files to edit:

- `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`

Stop and ask/report if:

- A focused test shows `depth` should not increment for a partially expanded layer. This plan assumes the least disruptive choice is to preserve the current outer control flow after `exploreDepth(...)` returns.

### 6. Add a high-branching checker fixture for limit tests

In `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`, add a small local fixture near the existing search-limit tests.

Recommended fixture:

- One enum variable, for example `choice`, with initial value `"start"` and many branch values like `"b0"` through `"b9"`.
- `bounds.maxDepth` at least `2`.
- Ten user transitions from `"start"` to each branch value.
- A simple property that will remain unresolved when the search stops early, such as `reachable(m, (state) => state.choice === "b9", { name: "lastBranchReachable", reads: ["choice"] })`, or an `always(...)` property that does not fail in the first generated edges.
- Keep the fixture deterministic and local to the test file; do not add shared test utilities unless the file already has a suitable pattern.

Files to edit:

- `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`

Stop and ask/report if:

- The current test file has been split or converted to separate fixtures. Place the new fixture in the closest checker-limit test file instead.

### 7. Add regression test for `maxEdges`

Add a test proving a high-branching layer stops during expansion when `maxEdges` is reached.

Recommended assertions:

- `const result = checkModel(highBranchingModel(), props, { maxEdges: 2 });`
- `result.diagnostics?.limits?.reason` contains `"maxEdges=2"`.
- `result.diagnostics?.limits?.maxEdges` is `2`.
- `result.stats.edges` is less than or equal to `2`.
- If the fixture has 10 possible first-depth transitions, assert `result.stats.edges` is less than `10` to prove no full-layer overshoot.
- At least one unresolved property verdict becomes `error` with a message containing `"search limit exceeded"`, unless a deliberate decisive verdict is found before the limit.

Files to edit:

- `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`

Stop and ask/report if:

- Existing checker semantics count attempted transitions differently from appended `Edge` records. In that case, align the assertion to the existing `stats.edges` meaning and document it in the test name.

### 8. Add regression test for `maxFrontier`

Add a test proving `maxFrontier` stops while `next` is being built.

Recommended assertions:

- `const result = checkModel(highBranchingModel(), props, { maxFrontier: 2 });`
- `result.diagnostics?.limits?.reason` contains `"maxFrontier=2"`.
- `result.diagnostics?.limits?.maxFrontier` is `2`.
- `result.diagnostics?.search?.maxFrontier` is less than or equal to `2`.
- `result.diagnostics?.search?.maxFrontier` is less than the full branch count, for example less than `10`.
- `result.stats.states` should be small enough to prove partial expansion, usually less than or equal to initial states plus `2` discovered branch states.

Files to edit:

- `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`

Stop and ask/report if:

- Existing `search.maxFrontier` intentionally reports only input frontiers, not partially built next frontiers. If so, either add a narrower assertion on `stats.states`/limit diagnostics or make the minimal diagnostics update in `check-model.ts` so `maxFrontier` reflects the observed partial frontier peak.

### 9. Preserve shortest-counterexample semantics in a focused test

Add or adjust one small test only if needed to protect the key ambiguity: if an edge generated before the limit produces a decisive verdict, `applySearchLimitVerdicts(...)` must not overwrite it.

Recommended approach:

- Use the high-branching fixture with a property that is reachable or violated on the first or second generated transition.
- Run with `maxEdges` or `maxFrontier` equal to the boundary where that decisive edge is generated.
- Assert the decisive verdict remains `reachable` or `violated`, not `error`.

Keep this test only if the implementation changes the ordering of `observeEdge(...)`, `observeStates(...)`, or `applySearchLimitVerdicts(...)`. If the diff only adds limit checks after existing observation points, the existing checker tests plus the two new limit tests may be enough.

Files to edit:

- `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`

Stop and ask/report if:

- The only way to make this test pass requires exploring past the configured limit. The configured limit should win after preserving already-observed decisive verdicts.

## Per-step files to edit

- Step 1:
  - None.
- Step 2:
  - `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`
- Step 4:
  - `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/check/engine/check-model.ts`
- Step 6:
  - `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`
- Step 7:
  - `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`
- Step 8:
  - `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`
- Step 9:
  - `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`
- Only if CLI rendering or public diagnostics are touched:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
- No edits expected:
  - `/Users/hari/proj/modality-ts/src/check/types.ts`

## Acceptance criteria

- `maxEdges` is checked during `exploreDepth(...)` soon after each edge is appended, not only after the whole depth expansion returns.
- `maxFrontier` is checked during `exploreDepth(...)` soon after each new state is pushed into `next`, not only after the whole next frontier is complete.
- High-branching tests show `stats.edges`, `stats.states`, and/or `diagnostics.search.maxFrontier` stay near the configured limits instead of reflecting the full branch count.
- Existing `maxStates` behavior and diagnostic message shape remain stable.
- Existing BFS ordering, deterministic sorting, and shortest-counterexample behavior are preserved for edges/states generated before a limit is hit.
- `observeEdge(...)` still runs for generated edges before visited-state filtering and before the limit break for that edge.
- `applySearchLimitVerdicts(...)` still preserves already decisive `violated` and `reachable` verdicts.
- Existing checker, CLI, architecture, and typecheck suites continue to pass.
- No unrelated files are modified and no uncommitted user/agent work is reverted.

## Tests to add or update

- `/Users/hari/proj/modality-ts/test/checker/checker.test.ts`
  - Add a local high-branching model fixture with a predictable branch count.
  - Add a regression test named along the lines of `"stops mid-depth when maxEdges is exceeded"`.
  - Add a regression test named along the lines of `"stops mid-depth when maxFrontier is exceeded"`.
  - Optionally add a focused verdict-preservation test if implementation touches observation or verdict overwrite ordering.
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
  - Update only if CLI rendering code is changed. No CLI test is required for the minimal checker-only fix because existing CLI limit rendering consumes `diagnostics.limits`.

## Verification commands

Run commands with `rtk` where practical:

```bash
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm typecheck
rtk pnpm test -- src/cli/features/check/command.test.ts
rtk pnpm architecture
```

If the implementation changes limit behavior in sliced checking or property finalization paths, also run:

```bash
rtk pnpm phase7
rtk pnpm test
```

Before finishing, inspect the diff without reverting unrelated work:

```bash
rtk git diff -- src/check/engine/check-model.ts test/checker/checker.test.ts
rtk git status --short
```

## Risks, ambiguities, and stop conditions

- Risk: Checking `maxEdges` before `observeEdge(...)` could hide a shortest counterexample that is exactly on the limit boundary. Check after the edge is recorded and observed.
- Risk: Checking `maxFrontier` before adding the boundary state could change behavior relative to `maxStates`, which currently records the boundary-crossing state and then stops. Prefer checking after `next.push(post)`.
- Risk: Updating `tracker.maxFrontier` for partial `next` frontiers may expose a slightly different diagnostic than previous completed-layer-only behavior. This is acceptable if scoped to the new incremental enforcement and covered by tests.
- Risk: If `finalFrontier` remains depth-boundary-oriented, CLI `search-limit` output may still show a stale frontier count. Do not broaden the fix unless tests or product expectations require it.
- Risk: Partial depth expansion may increment `stats.depth` for an incomplete layer because the outer flow currently increments after `exploreDepth(...)` returns. Preserve existing flow unless there is a clear failing test and product agreement.
- Ambiguity: The exact semantics of limits use `>=` today. Keep that boundary behavior for `maxEdges` and `maxFrontier` unless an existing test proves otherwise.
- Ambiguity: `memoryGuard` is included in `checkSearchLimits(...)`, but the finding is specifically about `maxEdges` and `maxFrontier`. It is acceptable for mid-loop helper reuse to check memory too, but do not spend time designing memory-specific behavior.
- Stop and report if implementing this requires changing public types, trace formats, property finalization semantics, or transition ordering.
- Stop and report if existing checker tests begin producing longer or different counterexample traces for cases that do not hit a search limit.
- Stop and report if unrelated dirty files conflict with the two intended edit targets for implementation.
