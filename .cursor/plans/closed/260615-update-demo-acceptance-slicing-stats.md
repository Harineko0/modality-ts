# Update Demo Acceptance Slicing Stats Plan

## Goal

Make `test/modality/demo-acceptance.test.ts` pass after the default CLI check path started using per-property slicing, while preserving meaningful acceptance coverage for:

- Extracted fixture coverage and caveats.
- CLI check exit codes.
- Property verdict order and statuses.
- Counterexample trace steps.
- Trace/replay artifact generation.
- Concrete model versus hand-model equivalence where that equivalence is still semantically meaningful.

The implementation must first confirm whether the new sliced aggregate stats are intended. If they are intended, update or refactor only the brittle stats assertions so the acceptance test encodes the new sliced behavior deliberately instead of blindly replacing numbers.

## Non-goals

- Do not change checker, slicing, extractor, replay, CLI, report, docs, or fixture semantics as part of this task.
- Do not disable default CLI slicing.
- Do not loosen or remove verdict, trace, replay, CI, extraction coverage, or hand-model behavioral assertions.
- Do not update generated `dist/` artifacts.
- Do not clean up unrelated dirty worktree files.
- Do not rewrite the whole acceptance test; keep the diff small and local to the failing stats expectations unless investigation proves the checker behavior is wrong.

## Current-State Findings

- Focused command `rtk pnpm exec vitest run test/modality/demo-acceptance.test.ts` currently fails 3 of 6 tests.
- The only observed failures are exact `checked.check.stats` assertions in `test/modality/demo-acceptance.test.ts`.
- Failing assertion at `test/modality/demo-acceptance.test.ts:107`:
  - Expected `{ states: 1422, edges: 7382, depth: 12 }`.
  - Received `{ states: 643, edges: 2885, depth: 11 }`.
  - Test: `extracts and checks the three seeded MVP bugs`.
- Failing assertion at `test/modality/demo-acceptance.test.ts:234`:
  - Expected `{ states: 864, edges: 5766, depth: 12 }`.
  - Received `{ states: 1728, edges: 11532, depth: 12 }`.
  - Test: `keeps the concrete ToDo fixture equivalent to its hand model`.
- Failing assertion at `test/modality/demo-acceptance.test.ts:428`:
  - Expected `{ states: 277, edges: 1600, depth: 16 }`.
  - Received `{ states: 554, edges: 3200, depth: 16 }`.
  - Test: `keeps the concrete checkout fixture equivalent to its hand model`.
- `src/cli/features/check/command.ts` now computes `canSlice` when all properties have `reads`, then calls `checkModel(model, properties, { slicing: canSlice })`.
- `src/check/engine/check-model.ts` combines sliced results by summing `states` and `edges` across slice groups and taking max `depth`.
- `src/check/engine/check-model.ts` exposes per-slice diagnostics under `check.diagnostics?.slicing.sliceSummaries`.
- The acceptance test already asserts high-value behavior after the failing stats checks:
  - Demo verdicts and traces.
  - Replay statuses and generated replay test count.
  - CI output and CI report verdicts.
  - ToDo verdict summaries and hand-model verdict-summary equivalence.
  - Checkout verdict summaries, `reviewCanReachSuccess`, and hand-model stats/verdict equivalence.
- Existing dirty worktree files are present outside this task, including checker, slicing, CLI, docs, and tests. Treat them as other agents' work and do not overwrite them.

## Exact File Paths and Relevant Symbols

- `test/modality/demo-acceptance.test.ts`
  - `describe("demo app acceptance fixture", ...)`
  - `it("extracts and checks the three seeded MVP bugs", ...)`
  - `it("keeps the concrete ToDo fixture equivalent to its hand model", ...)`
  - `it("keeps the concrete checkout fixture equivalent to its hand model", ...)`
  - `verdictSummary(...)`
  - Current exact stats assertions around lines 107, 234, and 428.
  - Existing hand-model comparison at line 510: `expect(handChecked.check.stats).toEqual(checked.check.stats)`.
- `src/cli/features/check/command.ts`
  - `runCheckCommand(...)`
  - `canSlice`
  - `checkModel(model, properties, { slicing: canSlice })`
  - `renderCheckResult(...)`
- `src/check/engine/check-model.ts`
  - `checkModel(...)`
  - `checkModelSliced(...)`
  - `combineSlicedResults(...)`
  - `sliceSummaries`
- `src/check/slicing/slice-model.ts`
  - `sliceModelForProperty(...)`
  - `canSliceProperty(...)`
- `examples/demo-app/app.props.mjs`
  - `properties()`
  - Properties all declare `reads`.
- `examples/todo-app/app.props.mjs`
  - `properties()`
  - Properties all declare `reads`.
- `examples/checkout-app/app.props.mjs`
  - `properties()`
  - Properties all declare `reads`.
- `test/checker/checker.test.ts`
  - Existing patterns for sliced versus unsliced verdict/trace parity.
  - Existing diagnostics assertions for `result.diagnostics?.slicing`.

## Existing Patterns to Follow

- Keep acceptance assertions direct and behavior-oriented, as the file already does with `expect(...).toEqual(...)` for verdict summaries and trace steps.
- Prefer small local helpers inside `test/modality/demo-acceptance.test.ts` if repeated stats/diagnostics assertions would otherwise duplicate intent.
- Follow `test/checker/checker.test.ts` for semantic slicing coverage:
  - Compare sliced and unsliced verdict statuses/traces where checker parity matters.
  - Assert diagnostics structurally with `toMatchObject` or `expect.any(Number)` when exact numbers are less important than behavior.
- Follow current acceptance-test style:
  - Use fixed dates for deterministic command output.
  - Keep fixture-specific expectations near the fixture's test.
  - Preserve exact trace arrays for seeded violations.
- For aggregate stats, prefer documenting the measurement semantics in the assertion name/helper rather than leaving unexplained magic numbers.

## Atomic Implementation Steps

### 1. Confirm stats semantics before editing

Inspect the current code and test output to decide whether the received stats are the intended new sliced stats.

Checks to perform:

- Re-run `rtk pnpm exec vitest run test/modality/demo-acceptance.test.ts` and confirm the only failures are the three exact stats assertions listed above.
- Inspect `runCheckCommand(...)` in `src/cli/features/check/command.ts` and confirm the default path intentionally passes `{ slicing: canSlice }`.
- Inspect each fixture props file and confirm every property declares `reads`, making slicing eligible.
- Inspect `checked.check.diagnostics?.slicing` for the three fixture checks, either by temporarily logging during local investigation or by using a small throwaway script. Do not commit investigation logging.

Stop and ask/report if:

- Additional acceptance failures appear.
- `canSlice` is false for any of the three fixture checks.
- Diagnostics show slicing is skipped.
- The changed stats are caused by an unexpected checker error, missing property `reads`, or an unrelated extraction change.

### 2. Decide assertion strategy

Choose the narrowest assertion strategy that preserves meaningful coverage.

Recommended strategy if sliced stats are intended:

- Replace the three legacy exact unsliced stats expectations with a helper that asserts the intended sliced aggregate stats and the fact that slicing is active.
- Name the helper to make the semantics explicit, for example `expectSlicedStats(...)` or `expectSlicedCheckStats(...)`.
- The helper should assert:
  - `check.stats` equals the intended sliced aggregate number.
  - `check.diagnostics?.slicing` reports `{ enabled: true }`.
  - `check.diagnostics?.slicing.slices` is greater than zero or equals the expected slice count if stable.
  - `check.diagnostics?.slicing.sliceSummaries` is present and non-empty.
- Keep exact fixture-level aggregate stats only if the team considers them a useful regression signal for the sliced search space.

Alternative strategy if exact aggregate stats are judged too brittle:

- Replace exact `states`/`edges` checks with structural checks:
  - `states > 0`
  - `edges > 0`
  - `depth` equals the expected bound-relevant depth where meaningful.
  - Slicing diagnostics are enabled and include non-empty slice summaries.
- Preserve exact verdict and trace assertions as the primary behavioral coverage.

Do not:

- Delete stats assertions without replacement.
- Assert only that the command exits.
- Move broad checker semantics into this acceptance file.

### 3. Update demo fixture stats assertion

In `test/modality/demo-acceptance.test.ts`, update the first failing check in `extracts and checks the three seeded MVP bugs`.

If using exact sliced stats, assert:

```ts
expectSlicedStats(checked.check, {
  states: 643,
  edges: 2885,
  depth: 11,
});
```

Keep all following assertions unchanged:

- `checked.exitCode` is `2`.
- Verdict summary equals the three seeded violations.
- Trace steps for `noDoubleSubmit`, `guestCannotReachAdmin`, and `guestDoesNotSeeUserCache`.
- Hand-model verdict-summary equivalence.
- Replay status checks.
- CI checks and CI report checks.

Stop and ask/report if:

- The new stats differ from `{ states: 643, edges: 2885, depth: 11 }` after confirming the current branch state has not changed.
- Any verdict or trace assertion must be changed to make this test pass.

### 4. Update ToDo fixture stats assertion

In `test/modality/demo-acceptance.test.ts`, update the stats check in `keeps the concrete ToDo fixture equivalent to its hand model`.

If using exact sliced stats, assert:

```ts
expectSlicedStats(checked.check, {
  states: 1728,
  edges: 11532,
  depth: 12,
});
```

Keep all following assertions unchanged:

- Extraction coverage and caveats.
- Four violated verdict summaries and trace steps.
- Hand-model verdict-summary equivalence.

Important nuance:

- Do not add a `handChecked.check.stats` equality assertion here unless it is intentionally desired. The current test only compares hand-model verdict summaries for ToDo.

Stop and ask/report if:

- The new stats differ from `{ states: 1728, edges: 11532, depth: 12 }`.
- The new sliced stats appear to be exactly duplicated slice groups due to an unintended grouping bug rather than intended combined sliced measurement.
- Any ToDo verdict or trace assertion must be changed.

### 5. Update checkout fixture stats assertion

In `test/modality/demo-acceptance.test.ts`, update the stats check in `keeps the concrete checkout fixture equivalent to its hand model`.

If using exact sliced stats, assert:

```ts
expectSlicedStats(checked.check, {
  states: 554,
  edges: 3200,
  depth: 16,
});
```

Keep the existing hand-model stats equivalence:

```ts
expect(handChecked.check.stats).toEqual(checked.check.stats);
```

This remains meaningful because the concrete and hand checkout models should still produce identical combined sliced stats through `runCheckCommand(...)`.

Stop and ask/report if:

- The new stats differ from `{ states: 554, edges: 3200, depth: 16 }`.
- The hand checkout model no longer matches concrete checkout stats.
- Any checkout verdict or trace assertion must be changed.

### 6. Add a small local stats helper if useful

If two or more updated assertions need the same diagnostics checks, add a local helper near `verdictSummary(...)` in `test/modality/demo-acceptance.test.ts`.

Suggested shape:

```ts
function expectSlicedStats(
  check: {
    stats: { states: number; edges: number; depth: number };
    diagnostics?: {
      slicing?: {
        enabled: boolean;
        slices?: number;
        sliceSummaries?: readonly unknown[];
      };
    };
  },
  stats: { states: number; edges: number; depth: number },
) {
  expect(check.stats).toEqual(stats);
  expect(check.diagnostics?.slicing).toMatchObject({ enabled: true });
  expect(check.diagnostics?.slicing?.slices ?? 0).toBeGreaterThan(0);
  expect(check.diagnostics?.slicing?.sliceSummaries?.length ?? 0).toBeGreaterThan(0);
}
```

Adjust the type to use the real imported checker result type if that is already exported and ergonomic. Otherwise keep the structural local type small.

Do not:

- Import broad internal checker types only for this helper if that creates new architecture churn.
- Assert full `sliceSummaries` contents unless they are intentionally stable and reviewed.

### 7. Verify focused acceptance behavior

Run the focused acceptance test:

```bash
rtk pnpm exec vitest run test/modality/demo-acceptance.test.ts
```

Expected result:

- All 6 tests pass.
- No verdict, trace, replay, or CI assertions were loosened.

Stop and ask/report if:

- The focused test still fails anywhere other than exact stats expectations.
- Runtime grows unexpectedly close to or above the existing `60_000` ms guard.

### 8. Run relevant broader checks

Run the smallest broader checks needed for confidence:

```bash
rtk pnpm exec vitest run test/checker/checker.test.ts
rtk pnpm exec vitest run src/cli/features/check/command.test.ts
rtk pnpm typecheck
```

If there is time or if stats/diagnostics helper typing touched exported types, also run:

```bash
rtk pnpm test
```

Stop and ask/report if:

- Checker slicing tests fail.
- CLI check command tests fail.
- Typecheck fails due to the local helper type or changed checker diagnostics shape.

## Per-Step Files to Edit

- Step 1:
  - No committed file edits. Temporary investigation logs or scripts must be removed before finishing.
- Step 2:
  - No file edits unless the chosen strategy is documented as comments in the test. Prefer no comments unless necessary.
- Step 3:
  - `test/modality/demo-acceptance.test.ts`
- Step 4:
  - `test/modality/demo-acceptance.test.ts`
- Step 5:
  - `test/modality/demo-acceptance.test.ts`
- Step 6:
  - `test/modality/demo-acceptance.test.ts`
- Step 7:
  - No additional file edits expected.
- Step 8:
  - No additional file edits expected.

## Acceptance Criteria

- `rtk pnpm exec vitest run test/modality/demo-acceptance.test.ts` passes.
- The acceptance test still asserts all existing verdict statuses and trace-step arrays.
- Demo replay artifact checks still assert three reproduced violations and three replay tests.
- CI acceptance checks still assert `violations=3 errors=0`, determinism, source freshness, CI report verdicts, and trace artifact shape.
- ToDo and checkout hand-model comparisons remain at least as strong as before for verdict summaries.
- Checkout hand-model stats equality remains in place unless there is a clear, reported reason it is no longer meaningful.
- Updated stats assertions explicitly reflect sliced stats or are replaced by structural stats plus slicing-diagnostics assertions.
- No source files outside `test/modality/demo-acceptance.test.ts` are changed by the implementation.
- No unrelated dirty worktree changes are reverted or overwritten.

## Tests to Add or Update

- Update only `test/modality/demo-acceptance.test.ts`.
- No new test file is needed.
- Do not add snapshot tests.
- Do not add checker unit tests unless investigation shows the sliced stats are not intended and an actual slicing/checker bug must be fixed in a separate task.

Specific expected updates if exact sliced stats are accepted:

- Demo fixture expected stats become `{ states: 643, edges: 2885, depth: 11 }`.
- ToDo fixture expected stats become `{ states: 1728, edges: 11532, depth: 12 }`.
- Checkout fixture expected stats become `{ states: 554, edges: 3200, depth: 16 }`.
- Add slicing diagnostics assertions through a local helper or inline checks.

## Verification Commands

Run commands with `rtk`:

```bash
rtk pnpm exec vitest run test/modality/demo-acceptance.test.ts
rtk pnpm exec vitest run test/checker/checker.test.ts
rtk pnpm exec vitest run src/cli/features/check/command.test.ts
rtk pnpm typecheck
```

Optional full-suite verification:

```bash
rtk pnpm test
```

Useful investigation commands before editing:

```bash
rtk git status --short
rtk grep "checkModel(model, properties" src/cli/features/check/command.ts
rtk grep "diagnostics?.slicing\\|sliceSummaries\\|slicing" test/checker/checker.test.ts src/check/engine/check-model.ts
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Exact aggregate sliced stats may still be brittle because `combineSlicedResults(...)` sums per-slice searches, so adding, removing, or regrouping properties can change stats without changing user-visible behavior.
- Risk: ToDo and checkout stats doubled relative to the old numbers, which may be intended combined sliced measurement or may indicate duplicate equivalent slice groups. Confirm with `sliceSummaries` before blessing the numbers.
- Risk: Demo stats decreased and depth changed from 12 to 11, which is plausible for slicing but should be confirmed against unchanged verdicts and traces.
- Ambiguity: The product decision may be that acceptance tests should track exact sliced stats as performance/regression sentinels, or that exact states/edges are too implementation-specific for demo acceptance. Use the helper strategy that matches that decision.
- Stop and ask/report if the new sliced stats cannot be explained by enabled slicing diagnostics.
- Stop and ask/report if any property lacks `reads` or slicing is skipped.
- Stop and ask/report if fixing the test requires changing expected verdicts, trace steps, replay statuses, or CI output.
- Stop and ask/report if the implementation agent sees additional modified files in `test/modality/demo-acceptance.test.ts` that conflict with these instructions.
- Stop and ask/report if a checker or slicing source change appears necessary; that is outside this test-plan task and should be split out.
