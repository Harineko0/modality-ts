# Goal

Replace the current `modality` CLI human output with a Vitest-like format that is compact, row-oriented, and easy to scan.

For `modality check`, do not print section headers such as `Properties`, `Stats`, or per-target `Target`. Instead, print one top-level row per checked props/model target, followed by a compact parenthesized stats line and one indented property line per property. After all targets, print a final Vitest-style summary block and then an `Artifacts` block.

Target `check` shape:

```text
 ✓ <prop-path> <t>ms
  (N tests, N passed, N failed, N errors, edges N, depth N, slices 1, vars 0, transitions 0, skipped 0)
  - <property-1> <result>
  - <property-2> <result>
 ✓ <prop-path> <t>ms
  (N tests, N passed, N failed, N errors, edges N, depth N, slices 1, vars 0, transitions 0, skipped 0)
  - <property-1> <result>

 Test Files  16 passed (16)
      Tests  134 passed (134)
   Start at  11:36:28
   Duration  1.27s
   Artifacts
     - (trace) <path>
     - (trace) <path>
     - (replayTest) <path>
     - (actionReplayTest) <path>
```

Make the other subcommands follow the same visual grammar: a leading status row, one or more indented detail rows, a Vitest-style summary where useful, and an indented `Artifacts` block only when artifacts are written.

# Non-goals

- Do not change checker semantics, extraction semantics, replay/conformance behavior, generated reports, trace artifacts, replay test artifacts, TLA output, or exit codes.
- Do not change JSON report schemas or artifact file names/directories.
- Do not update generated `dist/` files.
- Do not introduce a broad logging framework or a new dependency.
- Do not keep or add `Properties`, `Stats`, `Target`, `Extract`, `Replay`, `Conform`, `Export`, `CI`, or similar standalone section-title blocks in normal human output.
- Do not invent fake per-property timing. Target/file-level timing is acceptable; omit timing where it is not actually measured.

# Current-State Findings

- A previous check-output improvement is already partially present:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts` defines `renderHumanCheckResult`, `renderHumanCheckArtifacts`, `renderHumanCheckTargetHeader`, `symbolForStatus`, ANSI helpers, and `CheckOutputOptions`.
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts` accepts `output?: { emit?: (line: string) => void; color?: boolean; human?: boolean }` and emits human check output when requested.
  - `/Users/hari/proj/modality-ts/src/cli/cli.ts` already passes streamed human output for `check`.
- Current single-model `check` output is sectioned:
  - `Properties`
  - one line per verdict
  - `Stats`
  - optional diagnostics
  - `Artifacts`
  This is explicitly not the desired final format.
- Current no-arg multi-target `check` output loops in `/Users/hari/proj/modality-ts/src/cli/cli.ts`, prints a per-target `Target ...` header, then streams one full `runCheckCommand` block per target. This is also not desired.
- `runCheckCommand` returns one `CheckResult` and one `CheckReport`; multi-target aggregation currently happens in `cli.ts`.
- Other subcommands still return terse line arrays:
  - `init`: `config=/path/to/modality.config.ts`
  - `extract`: `extracted vars=N transitions=N`, `plugins=...`, `model=...`, `appModel=...`
  - `export`: `export=.modality/model.tla`, `format=tla`
  - `replay`: `replay: reproduced`, `mode=abstract`, `stepsRun=N`
  - `conform`: `conform: total=N reproduced=N ...`, `mode=...`, `passRate=...`
  - `ci`: `ci: passed`, `violations=N errors=N`, `determinism=...`, optional trust/source/conform lines.
- Tests currently assert both the older terse output and the newer sectioned `check` output:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/export/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/replay/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/conform/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.test.ts`
  - `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`
- `ci` composes `check` and optional `conform` internally. Preserve its deterministic reports and exit-code behavior; only CLI stdout should change unless tests are intentionally migrated.

# Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/cli/cli.ts`
  - `main()`
  - `shouldUseColor()`
  - `checkOutputOptions()`
  - no-arg multi-target `check` branch using `inferCheckTargetsFromProps()`
  - repeated `for (const line of result.lines) console.log(line)` blocks for non-check commands
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
  - `CheckCommandOptions`
  - `CheckCommandResult`
  - `runCheckCommand(options)`
  - `renderCheckResult(check)`
  - `writeTraceArtifacts(...)`
  - `writeReplayTestArtifacts(...)`
  - `writeActionReplayTestArtifacts(...)`
- `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
  - `CheckOutputOptions`
  - `ArtifactPathEntry`
  - `renderHumanCheckResult(check, options)`
  - `renderHumanCheckArtifacts(paths, options)`
  - `renderHumanCheckTargetHeader(modelPath, propsPath, options)`
  - `symbolForStatus(status)`
- `/Users/hari/proj/modality-ts/src/cli/features/check/index.ts`
  - check exports
- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `runExtractCommand(options)`
  - `ExtractCommandResult`
- `/Users/hari/proj/modality-ts/src/cli/features/export/command.ts`
  - `runExportTlaCommand(options)`
  - `ExportTlaCommandResult`
- `/Users/hari/proj/modality-ts/src/cli/features/replay/command.ts`
  - `runReplayCommand(options)`
  - `renderReplayReport(report)`
- `/Users/hari/proj/modality-ts/src/cli/features/conform/command.ts`
  - `runConformCommand(options)`
  - `renderConformReport(report)`
- `/Users/hari/proj/modality-ts/src/cli/features/ci/command.ts`
  - `runCiCommand(options)`
  - `runOptionalConformance(...)`
- `/Users/hari/proj/modality-ts/src/cli/features/init/command.ts`
  - `runInitCommand(options)`

# Existing Patterns to Follow

- Keep command functions returning structured results plus `lines: string[]` unless the migration explicitly updates every direct caller.
- Keep direct command tests under `src/cli/features/<feature>/`.
- Keep subprocess/user-facing tests under `test/modality/cli.test.ts`.
- Reuse the existing ANSI/color approach; colors must remain gated by `FORCE_COLOR`, `NO_COLOR`, and TTY.
- Preserve deterministic ordering of discovered props/model targets.
- Prefer small output helper modules over changing command execution semantics.

# Atomic Implementation Steps

1. Replace the section-title output model with Vitest-style primitives.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/output.ts` new file
   - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`

   Add a small shared formatter with:
   - ANSI constants and `colorize(...)`.
   - `statusSymbol(...)` returning `✓`, `×`, or `⚠`.
   - `formatMs(ms)` and `formatDuration(ms)` for real measured durations.
   - `formatSummaryLabel(label, value)` for aligned summary rows such as ` Test Files  16 passed (16)`.
   - `formatArtifactLine(kind, path)` returning `     - (kind) path`.

   Remove normal use of helpers that render standalone headers like `Properties` and `Stats`. Keeping old functions as wrappers during migration is fine, but tests should drive the new output.

2. Define check target render data.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/check/index.ts`

   Add:

   ```ts
   export interface HumanCheckTargetResult {
     modelPath: string;
     propsPath: string;
     check: CheckResult;
     reportPath?: string;
     artifacts: readonly ArtifactPathEntry[];
     durationMs?: number;
   }
   ```

   Extend `ArtifactPathEntry["kind"]` if needed:

   ```ts
   "report" | "trace" | "replayTest" | "actionReplayTest"
   ```

3. Implement the new check renderer.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`

   Add `renderHumanCheckTargets(results, options): string[]`.

   It must produce:
   - One row per target:
     - ` ✓ <propsPath> <duration>ms` when all verdicts for the target are non-error/non-violated.
     - ` × <propsPath> <duration>ms` when any verdict is `violated` or `error`.
     - ` ⚠ <propsPath> <duration>ms` when the target only has warnings/inconclusive-like statuses.
   - A second row with parenthesized stats:
     - `(N tests, N passed, N failed, N errors, edges N, depth N, slices N, vars N, transitions N, skipped N)`
     - Use `tests` as the number of properties/verdicts.
     - Count `passed` as `verified-within-bounds` plus `reachable`.
     - Count `failed` as `violated`.
     - Count `errors` as `error`.
     - Count warnings separately only if present: append `, warnings N`.
     - Include `states N` too if useful; the user example includes status/edges/depth/slicing and the existing checker reports states. Prefer `(N tests, N passed, N failed, N errors, states N, edges N, depth N, ...)`.
   - One property row per verdict:
     - `  - <property> <status>`
     - For `violated` and `reachable`, add an indented trace continuation row only if the trace is important and not too noisy: `    trace: a -> b`.
     - For `error` and `vacuous-warning`, add the message as `    <message>`.
   - A blank line after all targets.
   - Summary rows:
     - ` Test Files  <passed> passed (<total>)` when all target files pass.
     - ` Test Files  <failed> failed | <passed> passed (<total>)` when any target fails.
     - `      Tests  <passed> passed (<total>)` or include failed/error/warning counts when nonzero.
     - `   Start at  HH:mm:ss` using the command start time.
     - `   Duration  <duration>` using real total elapsed time.
   - Artifact rows only after summary:
     - `   Artifacts`
     - `     - (trace) <path>`
     - `     - (replayTest) <path>`
     - `     - (actionReplayTest) <path>`
     - optionally `     - (report) <path>` if report paths should be visible.

   Do not output `Properties`, `Stats`, `Target`, or standalone `Artifacts` at the top level. The only allowed `Artifacts` label is the indented summary-block label shown above.

4. Refactor no-arg multi-target `modality check` to aggregate before printing.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/cli.ts`

   In the no-arg multi-target branch:
   - Stop printing `renderHumanCheckTargetHeader(...)`.
   - Stop passing `output: checkOutputOptions()` to each target because that streams the old per-target block.
   - Capture `const startedAt = new Date()` and `const startedMs = performance.now()` or `Date.now()` for the whole command.
   - For each target:
     - Capture per-target elapsed time.
     - Call `runCheckCommand` without human streaming.
     - Determine `reportPath`, traces dir, replay test dir, and action replay test dir exactly as today.
     - Collect artifact paths from `result.lines` prefixes or from a new structured field if Step 5 adds one.
   - After all targets complete, call `renderHumanCheckTargets(...)` once and print those lines.
   - Preserve exit code behavior.

5. Add structured artifact paths to check results if needed.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`

   Prefer adding a non-breaking field:

   ```ts
   artifacts: readonly ArtifactPathEntry[];
   ```

   Populate it from report/traces/replay/action replay outputs. Keep legacy `lines` unchanged unless tests intentionally migrate them.

   This avoids reparsing `result.lines` in `cli.ts` and makes the renderer less brittle.

6. Align single-model `modality check` with the same row format.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/cli.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`

   Prefer routing single-model CLI output through `renderHumanCheckTargets([target])` so it matches multi-target output exactly.

   If existing direct tests depend on the optional `output.emit` streaming path, keep that path for programmatic usage but stop using it from `cli.ts`.

7. Create matching renderers for other subcommands.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/init/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/export/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/replay/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/conform/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/output.ts`

   Use the same visual grammar and avoid section-title blocks.

   Suggested shapes:

   `init`:

   ```text
    ✓ modality.config.ts 2ms
     - config created
   ```

   `extract`:

   ```text
    ✓ <source-or-target-1> 12ms
     (vars N, transitions N, routes configured N, modeled N, omitted N)
     - plugin state-source:use-state@0.1.0
     - state-space≈12.3bits top:flag(1.0),count(1.0)
    ✓ <source-or-target-2> 8ms
     (vars N, transitions N, routes configured N, modeled N, omitted N)
     - plugin state-source:use-state@0.1.0

    Duration  20ms
    Artifacts
      - (model) .modality/models/src/App.model.json
      - (appModel) .modality/models/src/App.props.ts
      - (model) .modality/models/src/HomePage.model.json
      - (appModel) .modality/models/src/HomePage.props.ts
      - (report) extraction-report.json
   ```

   Important: `extract` must follow the same aggregation rule as `check`.
   When `modality extract` discovers or receives multiple source/props targets,
   do not print a complete output block per model. Print the full list of
   `✓ <source-or-target> <duration>ms` rows first, then print one final
   `Duration` line and one final `Artifacts` block containing artifacts from
   all extracted targets.

   `export`:

   ```text
    ✓ .modality/model.tla 3ms
     - format tla
     - module extracted_model_Model

    Duration  3ms
    Artifacts
      - (export) .modality/model.tla
   ```

   `replay`:

   ```text
    ✓ <trace.json> 4ms
     (mode abstract, steps 3)
     - reproduced

    Duration  4ms
    Artifacts
      - (report) .modality/replay-report.json
   ```

   Use `×` for `not-reproduced`; use `⚠` for `inconclusive` and add reason/divergence rows.

   `conform`:

   ```text
    ✓ conformance 8ms
     (8 walks, 8 reproduced, 0 not-reproduced, 0 inconclusive, passRate 1)
     - mode abstract

    Duration  8ms
    Artifacts
      - (report) .modality/conform-report.json
   ```

   `ci`:

   ```text
    ✓ ci 43ms
     - check 0 violations, 0 errors
     - determinism passed
     - source-freshness passed
     - conform passRate 1 min 1

    Duration  43ms
    Artifacts
      - (report) .modality/report.json
      - (traces) .modality/traces
   ```

   Include detailed failure lines below the relevant bullet, not as separate section headings.

8. Wire CLI stdout to human renderers.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/cli.ts`

   Replace CLI-only printing of `result.lines` with command-specific human renderers. Keep direct command-function return values stable if possible.

   For commands that can operate on multiple targets, especially no-arg
   `extract`, collect all target results first and render once. The output must
   list all target rows first, then one final duration/summary and one final
   artifacts block. Do not separate output by model/source target.

   Do not print standalone command names as section titles.

9. Update tests to enforce the new format and reject the old one.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/export/command.test.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/replay/command.test.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/conform/command.test.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.test.ts`
   - `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`
   - `/Users/hari/proj/modality-ts/test/modality/demo-acceptance.test.ts`

   Add assertions:
   - `stdout` does not contain `Properties\n`, `Stats\n`, or `Target ` for `check`.
   - Multi-target `check` property bullets appear under their target rows before the final `Test Files` summary.
   - Final `Artifacts` appears after `Duration`.
   - Artifact lines use `- (kind) path`.
   - Summary lines align with labels like `Test Files`, `Tests`, `Start at`, and `Duration`.
   - Non-check CLI tests assert row-oriented output rather than `key=value` top-level output.

   If direct command `result.lines` remain legacy-compatible, add renderer tests separately rather than removing all direct `result.lines` assertions.

10. Update docs only where CLI output examples appear.

   Files to inspect/edit:
   - `/Users/hari/proj/modality-ts/README.md`
   - `/Users/hari/proj/modality-ts/docs/specs/03-checker.md`
   - `/Users/hari/proj/modality-ts/docs/specs/04-conformance.md`
   - `/Users/hari/proj/modality-ts/docs/specs/05-architecture.md`

   Update examples from `property: status`, `model=...`, or sectioned output to the row-oriented format. Do not rewrite unrelated prose.

# Per-Step Files to Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/src/cli/output.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
- Step 2:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/check/index.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
- Step 4:
  - `/Users/hari/proj/modality-ts/src/cli/cli.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
- Step 6:
  - `/Users/hari/proj/modality-ts/src/cli/cli.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
- Step 7:
  - `/Users/hari/proj/modality-ts/src/cli/features/init/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/export/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/replay/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/conform/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/output.ts`
- Step 8:
  - `/Users/hari/proj/modality-ts/src/cli/cli.ts`
- Step 9:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/export/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/replay/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/conform/command.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.test.ts`
  - `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`
  - `/Users/hari/proj/modality-ts/test/modality/demo-acceptance.test.ts`
- Step 10:
  - `/Users/hari/proj/modality-ts/README.md`
  - relevant files under `/Users/hari/proj/modality-ts/docs/specs/`

# Acceptance Criteria

- `modality check` output has no `Properties`, `Stats`, or per-target `Target` section titles.
- `modality check` prints one row per props/model target, followed by parenthesized target stats and indented property bullets.
- Multi-target `modality check` prints all target rows before the final summary.
- The final `check` summary includes `Test Files`, `Tests`, `Start at`, `Duration`, and then an indented `Artifacts` block when artifacts exist.
- Artifact lines use the exact visual style `     - (kind) path`.
- Other subcommands use the same row/detail/artifact visual grammar and avoid top-level `key=value` output.
- Exit codes remain unchanged.
- Reports, traces, replay tests, action replay tests, app model files, and TLA output remain schema-compatible and deterministic.
- Color remains gated and testable with `FORCE_COLOR=1`.
- Programmatic command APIs remain usable; if `result.lines` changes, tests document the new contract.

# Tests to Add or Update

- In `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`:
  - Add renderer tests for one target and multiple targets.
  - Assert output starts with a status row, not `Properties`.
  - Assert property bullets are formatted as `  - name status`.
  - Assert summary and artifacts appear after all target rows.

- In `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`:
  - Update no-arg multi-target check tests to assert row-oriented output.
  - Assert `stdout` does not contain `Properties`, `Stats`, or `Target`.
  - Assert `Test Files`, `Tests`, `Start at`, `Duration`, and artifact rows are present.
  - Update default `extract`, `export`, `conform`, `replay`, `init`, and `ci` stdout expectations to the new style.

- In feature command tests:
  - Add renderer tests for each subcommand.
  - Preserve direct `result.lines` tests only if legacy line arrays remain part of the command-function contract.

# Verification Commands

Run these from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- src/cli/features/check/command.test.ts test/modality/cli.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts src/cli/features/export/command.test.ts src/cli/features/replay/command.test.ts src/cli/features/conform/command.test.ts src/cli/features/ci/command.test.ts
rtk pnpm typecheck
rtk pnpm fix
rtk pnpm test
rtk pnpm architecture
```

If README/docs or example behavior changes, also run:

```bash
rtk pnpm ci:examples
```

# Risks, Ambiguities, and Stop Conditions

- Ambiguity: The example uses `status N`; implement explicit counts as `N passed`, `N failed`, `N errors`, and optionally `N warnings` because those are clearer and testable.
- Risk: Multi-target check aggregation means stdout is printed after all checks complete, not streamed per target. This is necessary for a coherent Vitest-style final summary.
- Risk: Existing tests and callers may rely on `result.lines` as terse `key=value` output. Prefer CLI-only human rendering and keep `result.lines` stable where possible.
- Risk: `ci` composes other commands internally. Do not let human renderers leak into determinism checks or report comparisons.
- Risk: Unicode symbols may be awkward in some logs. Keep symbols because the desired format depends on them; keep color gated.
- Stop and ask/report if:
  - preserving legacy `result.lines` requires too much duplicate logic,
  - implementing real durations would make tests flaky,
  - any change would alter artifact schemas or generated outputs,
  - generated `dist/` files become modified.
