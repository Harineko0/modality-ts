# Add CLI Search Limit Options Plan

## Goal

Expose the checker's existing graceful search-limit controls through `modality check` so large searches stop with structured error verdicts and diagnostics instead of relying only on slicing or crashing with a raw V8 out-of-memory abort.

The implementation should:

- Add CLI flags for `maxStates`, `maxEdges`, `maxFrontier`, and `memoryGuard`.
- Apply conservative default CLI search limits for `modality check`.
- Preserve existing successful-check output and checker semantics.
- Report limit hits through existing `CheckResult.diagnostics.limits`, check reports, and compact terminal output.
- Add focused tests proving CLI parsing and `runCheckCommand` pass these options to `checkModel`.

## Non-goals

- Do not change the checker search algorithm, BFS ordering, trace construction, property semantics, slicing semantics, or IR schema.
- Do not rewrite CLI parsing with a new framework.
- Do not change extraction or model generation.
- Do not change report `schemaVersion`.
- Do not make normal successful checks noisier in stdout.
- Do not commit generated `dist/` output.
- Do not revert or overwrite unrelated local changes. The current worktree already has modified checker/CLI files; preserve other agents' work.

## Current-state findings

- `src/check/types.ts:77` defines `CheckOptions` with `maxStates`, `maxEdges`, `maxFrontier`, and `memoryGuard`.
- `src/check/engine/check-model.ts:261` implements `checkSearchLimits(...)`, returning `CheckDiagnostics["limits"]` with messages like `search limit exceeded: maxStates=...`.
- `src/check/engine/check-model.ts` already converts a hit limit into `error` verdicts for unfinished properties via `applySearchLimitVerdicts(...)`.
- `src/core/report/types.ts` already includes `CheckReportDiagnostics.limits`, so report JSON can carry limit details without a schema change.
- `src/cli/features/check/command.ts:26` has no search-limit fields on `CheckCommandOptions`.
- `src/cli/features/check/command.ts:64` calls `checkModel(model, properties, { slicing: canSlice })`, so all existing checker limit options are currently dropped.
- `src/cli/features/check/command.ts:208` already renders a compact `search-limit=...` line when `check.diagnostics?.limits` exists.
- `src/cli/cli.ts:62` usage for `modality check` only mentions `--report`.
- `src/cli/cli.ts:330` through `src/cli/cli.ts:373` parses check flags manually and does not recognize any search-limit flags.
- `src/cli/features/check/command.test.ts:594` tests limit rendering only by calling `checkModel(...)` directly, not through `runCheckCommand(...)` or the CLI.
- `test/modality/cli.test.ts:103` has end-to-end CLI coverage using `tsx src/cli/cli.ts`, which is the right pattern for user-visible check flags.
- `docs/issues/state-explosion-on-real-app-check.md` says configured limits should stop gracefully, but the CLI currently gives users no way to configure them.

## Exact file paths and relevant symbols

- `src/cli/features/check/command.ts`
  - `CheckCommandOptions`
  - `runCheckCommand`
  - `renderCheckResult`
  - New helper for resolving default and explicit check search limits.
- `src/cli/cli.ts`
  - `flagValue`
  - `positionals`
  - usage text in `main()`
  - final `check` branch beginning around `const reportPath = flagValue(args, "--report")`
  - New helper for parsing positive integer flags.
- `src/check/types.ts`
  - `CheckOptions`
  - `CheckDiagnostics["limits"]`
  - Should not need semantic changes.
- `src/check/engine/check-model.ts`
  - `checkModel`
  - `checkSearchLimits`
  - `applySearchLimitVerdicts`
  - Should not be edited unless tests show the existing limit hooks cannot protect the CLI path.
- `src/core/report/types.ts`
  - `CheckReportDiagnostics`
  - Should not need a schema change because `limits` already exists.
- `src/cli/features/check/command.test.ts`
  - `model()`
  - existing `runCheckCommand` tests
  - existing `"reports search-limit diagnostics when configured"` test.
- `test/modality/cli.test.ts`
  - `execFileAsync`
  - `tsxBin`
  - `cliPath`
  - `writeFixtureApp`
- `README.md`
  - Useful commands section, if documenting the new flags.
- `docs/issues/state-explosion-on-real-app-check.md`
  - Implemented notes mention configured limits; update only if the new CLI flags/defaults need clarification.

## Existing patterns to follow

- Follow `src/cli/cli.ts`'s existing manual flag style: `flagValue(...)`, `positionals(...)`, explicit missing-value checks, and `throw new Error(...)` for invalid CLI usage.
- Follow existing check command option plumbing: `runCheckCommand(...)` owns loading the model/properties, calling `checkModel(...)`, creating the report, writing artifacts, and returning `lines`.
- Follow existing report behavior: `createCheckReport(...)` copies `check.diagnostics` into `report.diagnostics`.
- Follow existing stdout behavior in `renderCheckResult(...)`: verdict lines first, then `states=...`, then optional compact diagnostic lines.
- Follow existing tests that create temporary model and props files under `mkdtemp(...)`.
- Follow `test/modality/cli.test.ts` for end-to-end CLI execution with `execFileAsync(tsxBin, [cliPath, ...])`.

## Atomic implementation steps

### 1. Define the CLI option names and defaults

Use these user-facing flags for `modality check`:

- `--max-states <count>`
- `--max-edges <count>`
- `--max-frontier <count>`
- `--memory-guard-mb <mb>`
- `--no-search-limits`

Recommended default behavior:

- Defaults apply only to `modality check` / `runCheckCommand`, not to public `checkModel(...)`.
- Default `maxStates`: `1_000_000`.
- Default `maxEdges`: `5_000_000`.
- Default `maxFrontier`: `250_000`.
- Default memory guard: derive from Node's heap limit using `node:v8` if practical, for example `min(heap_size_limit * 0.8, heap_size_limit - 256 MiB)`, rounded down to bytes and only used when positive.
- Explicit flags override their corresponding defaults.
- `--no-search-limits` disables all four defaults and must not be combined with explicit limit flags.

Rationale:

- The defaults are high enough that ordinary small checks keep their current behavior.
- The defaults give the CLI a last-resort graceful failure path when slicing is skipped or still leaves a huge graph.
- `--no-search-limits` gives users an escape hatch for intentionally huge runs or external memory tuning.

Stop and report if product direction says defaults must remain completely unbounded. In that case, still add the flags and tests, but make the plan's default-limit step an explicit product decision rather than silently shipping unbounded behavior.

### 2. Add limit option plumbing to `runCheckCommand`

In `src/cli/features/check/command.ts`:

- Extend `CheckCommandOptions` with a nested option, for example:

```ts
searchLimits?:
  | {
      maxStates?: number;
      maxEdges?: number;
      maxFrontier?: number;
      memoryGuardBytes?: number;
    }
  | false;
```

- Add small constants for the default numeric limits.
- Add a helper such as `resolveCheckSearchLimits(options.searchLimits)` that returns the subset of `CheckOptions` to pass to the checker.
- Preserve the existing slicing decision:

```ts
const check = checkModel(model, properties, {
  slicing: canSlice,
  ...resolveCheckSearchLimits(options.searchLimits),
});
```

- If `searchLimits` is `false`, return no max-state/max-edge/max-frontier/memory guard options.
- If `searchLimits` is `undefined`, return default limits.
- If `searchLimits` is an object, merge explicit values over defaults.
- Convert `memoryGuardBytes` into `memoryGuard: { maxHeapUsedBytes: ... }`.

Do not alter `createCheckReport(...)` unless TypeScript requires a type adjustment.

### 3. Parse the new flags in `src/cli/cli.ts`

In the final check branch of `src/cli/cli.ts`:

- Read values with `flagValue(args, "--max-states")`, `--max-edges`, `--max-frontier`, and `--memory-guard-mb`.
- Parse each provided value with a helper that rejects missing, non-numeric, non-integer, zero, or negative values.
- Convert `--memory-guard-mb` to bytes using `value * 1024 * 1024`.
- Add the new value flags to the `positionals(...)` value flag list so numeric values are not treated as props paths.
- Add missing-value checks following existing patterns, for example `Missing --max-states value`.
- Reject `--no-search-limits` when any explicit limit flag is present.
- Pass `searchLimits: false` to `runCheckCommand(...)` when `--no-search-limits` is present.
- Pass a partial `searchLimits` object when explicit flags are present.
- Leave `searchLimits` undefined when no flags are present so `runCheckCommand(...)` applies defaults.

Update the usage line at `src/cli/cli.ts:62` to mention the new check flags compactly.

### 4. Keep reporting compact and structured

Use the existing reporting path first:

- `CheckResult.diagnostics.limits` should be present when a search limit stops the checker.
- `createCheckReport(...)` should include `diagnostics.limits` in report JSON through the existing diagnostics copy.
- `renderCheckResult(...)` should emit the existing compact line:

```text
search-limit=maxStates states=... frontier=... depth=...
```

Only adjust `renderCheckResult(...)` if a test reveals an existing bug. If edited, keep the normal successful output unchanged and avoid adding a new line merely because defaults were configured.

Optional low-risk polish:

- In `renderCheckResult(...)`, detect limit kind by checking `!== undefined` instead of truthiness. The parser should reject zero, but `!== undefined` is clearer and matches the type.

### 5. Update focused command tests

In `src/cli/features/check/command.test.ts`:

- Replace or supplement the direct `checkModel(...)` limit-rendering test with a `runCheckCommand(...)` test that passes `searchLimits: { maxStates: 1 }`.
- Assert:
  - `result.exitCode` is `2`.
  - At least one verdict has `status: "error"`.
  - The error message contains `maxStates=1`.
  - `result.check.diagnostics?.limits?.maxStates` is `1`.
  - `result.report.diagnostics?.limits?.maxStates` is `1`.
  - `result.lines` contains a line starting with `search-limit=maxStates`.
- Keep the existing slicing-default test intact.
- Add a small test that `searchLimits: false` does not add `diagnostics.limits` on the existing tiny fixture, if useful.

Avoid heap-based tests that depend on actual memory pressure.

### 6. Add end-to-end CLI flag coverage

In `test/modality/cli.test.ts`:

- Add an end-to-end test that writes a tiny model and props file, then runs:

```bash
tsx src/cli/cli.ts check model.json props.mjs --max-states 1 --report report.json
```

- Because the command should exit `2`, catch the rejected `execFileAsync(...)` result and inspect `stdout`.
- Assert:
  - `stdout` contains `search-limit=maxStates`.
  - `report.json` exists.
  - `report.diagnostics.limits.maxStates === 1`.
  - The report verdict status is `error` for unfinished properties unless an earlier violation/reachable verdict was already found.
- Add one invalid-value test, for example `--max-states nope`, asserting `stderr` contains `Invalid --max-states value`.
- Add one conflict test for `--no-search-limits --max-states 1`, asserting `stderr` explains the conflict.

Keep the fixture synthetic and local to this repository. Do not depend on `/Users/hari/proj/gdgjp/tinyurl`.

### 7. Update docs/help after behavior lands

Minimum required docs:

- Update the `modality check` usage line in `src/cli/cli.ts`.

Recommended docs if the implementation changes user-facing defaults:

- Update `README.md` useful commands or add a short note near `modality check` explaining:
  - `--max-states`, `--max-edges`, `--max-frontier`, `--memory-guard-mb`.
  - `--no-search-limits` for intentionally unbounded runs.
- Update `docs/issues/state-explosion-on-real-app-check.md` implemented notes to say the CLI now exposes and defaults the graceful limits.

Do not broaden documentation beyond the new check flags.

### 8. Verify no checker semantic changes were introduced

After implementation, inspect the diff:

- `src/check/engine/check-model.ts` should ideally be unchanged.
- If it was edited, the diff must be limited to a clear bug fix needed by CLI pass-through tests, and the implementation agent should call that out.
- `src/check/types.ts` should ideally be unchanged because `CheckOptions` already contains the needed fields.
- No extraction, slicing, replay, or IR files should change for this task.

Stop and report if graceful CLI behavior cannot be achieved without changing checker semantics.

## Per-step files to edit

- Step 1:
  - No code required if decisions are implemented directly in Step 2 and Step 3.
- Step 2:
  - `src/cli/features/check/command.ts`
- Step 3:
  - `src/cli/cli.ts`
- Step 4:
  - `src/cli/features/check/command.ts` only if the existing renderer needs the optional truthiness polish.
- Step 5:
  - `src/cli/features/check/command.test.ts`
- Step 6:
  - `test/modality/cli.test.ts`
- Step 7:
  - `README.md`
  - `docs/issues/state-explosion-on-real-app-check.md`
  - `src/cli/cli.ts` usage text from Step 3
- Step 8:
  - No edits; review and verification only.

## Acceptance criteria

- `modality check` accepts `--max-states`, `--max-edges`, `--max-frontier`, `--memory-guard-mb`, and `--no-search-limits`.
- `runCheckCommand(...)` passes configured search limits through to `checkModel(...)`.
- With `--max-states 1`, the CLI exits with code `2`, writes a report, emits `search-limit=maxStates`, and does not crash.
- Report JSON contains `diagnostics.limits` with the exact hit limit.
- Normal successful check output remains unchanged except for behavior caused by an actual limit hit.
- Default CLI limits are active when no search-limit flags are provided.
- `--no-search-limits` disables the default limits.
- Invalid numeric values fail before checking with a clear CLI error.
- The implementation does not change checker reachability semantics, slicing semantics, trace semantics, or report schema version.
- No generated `dist/` files are changed.

## Tests to add or update

- `src/cli/features/check/command.test.ts`
  - Add/adjust a `runCheckCommand(...)` test for `searchLimits: { maxStates: 1 }`.
  - Assert error verdict, exit code `2`, stdout line, and report diagnostics.
  - Optionally assert `searchLimits: false` does not create a limit diagnostic on the tiny fixture.
- `test/modality/cli.test.ts`
  - Add an end-to-end `modality check ... --max-states 1` test.
  - Add invalid-value coverage for one numeric flag.
  - Add conflict coverage for `--no-search-limits` combined with an explicit limit.
- Do not add tests that intentionally drive real memory pressure.
- Do not use the TinyURL sibling repository in automated tests.

## Verification commands

Run commands with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test -- src/cli/features/check/command.test.ts
rtk pnpm test -- test/modality/cli.test.ts
rtk pnpm test
rtk pnpm architecture
```

If any checker internals are edited despite the non-goal, also run:

```bash
rtk pnpm phase7
```

Optional manual validation against the original issue shape:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk pnpm exec modality check --max-states 100000 --max-frontier 25000
rtk pnpm exec modality check .modality/model.json app/routes/analytics.props.mjs --max-states 100000 --max-frontier 25000
```

## Risks, ambiguities, and stop conditions

- Risk: Default limits can make a previously completing but very large CLI check return error verdicts. Mitigate with high defaults, clear diagnostics, and `--no-search-limits`.
- Risk: The current memory guard is checked at existing checker checkpoints, so a single enormous expansion layer may still exhaust memory before the guard runs. Stop and report if synthetic or manual validation still crashes; that should become a separate checker-internal limit-checking task.
- Risk: Dynamic memory guard defaults based on `node:v8` can vary by environment. Do not assert exact default bytes in tests.
- Risk: Too-low memory defaults could be disruptive in CI. Prefer heap-relative defaults with headroom, and allow explicit `--memory-guard-mb`.
- Ambiguity: Whether default state/edge/frontier limits should apply to programmatic `runCheckCommand(...)` calls as well as the CLI. Recommended answer: yes, because `runCheckCommand(...)` is the CLI feature boundary; public `checkModel(...)` remains unchanged.
- Stop and ask/report if maintainers prefer unbounded defaults. Implement explicit flags and opt-in tests first, then leave defaults as a product decision.
- Stop and report if implementing the CLI pass-through requires changes outside `src/cli/**`, tests, and docs.
- Stop and report if the worktree changes under the implementation agent in the same files; inspect and preserve the other changes rather than overwriting them.
