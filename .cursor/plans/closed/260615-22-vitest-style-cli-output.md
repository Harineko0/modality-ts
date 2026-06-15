# Goal

Improve human readability of the `modality` CLI output, especially `modality check`, with a Vitest-like style:

- Colored status symbols such as `✓`, `×`, `⚠`, `i`.
- Indented, structured sections instead of flat `key=value` lines.
- For `modality check`, print all property verdicts first, then print stats such as `states=1954 edges=10200 depth=7`.
- Stream output as work completes instead of only printing a completed `result.lines` array after command execution.

# Non-goals

- Do not change checker semantics, exit codes, generated reports, trace artifacts, replay test artifacts, or CI determinism checks.
- Do not refactor all CLI commands at once. Scope streaming and Vitest-style formatting to `modality check` first.
- Do not change JSON report shape or `CheckReport` schema.
- Do not update generated `dist/` artifacts.
- Do not add broad logging infrastructure unless a tiny local helper is enough.

# Current-State Findings

- `src/cli/cli.ts` is the executable entrypoint. It calls feature command functions and then prints `result.lines` with `console.log`.
- `src/cli/features/check/command.ts` owns `runCheckCommand`, `createCheckReport`, and `renderCheckResult`.
- `runCheckCommand` currently:
  - loads model and properties,
  - runs `checkModel(...)`,
  - writes optional report/traces/replay artifacts,
  - returns `{ check, report, exitCode, lines }`.
- `renderCheckResult(check)` currently returns flat strings:
  - `${property}: ${status}`
  - `  trace steps: ...`
  - `states=${states} edges=${edges} depth=${depth}`
  - optional `slicing=...`, `search-limit=...`, `storage=...`, `hotPath=...`.
- Existing CLI integration tests in `test/modality/cli.test.ts` assert legacy substrings such as:
  - `states=`
  - `rootFlagCanBecomeTrue: reachable`
  - `homeFlagAlwaysFalse: violated`
  - `checkTarget=.modality/models/... props=...`
- Existing check command tests in `src/cli/features/check/command.test.ts` assert legacy line array contents/prefixes such as:
  - `flagStartsFalseOnly: violated`
  - `slicing=slices:`
  - `search-limit=maxStates`
  - `storage=mode:none`
  - `hotPath=canonicalCache:true`
- `src/check/types.ts` already has `CheckOptions.onProgress?: (snapshot: CheckProgress) => void`, but `runCheckCommand` does not expose it through `CheckCommandOptions`.
- `package.json` has no color library dependency. Dependencies are currently minimal: `jsdom` and `typescript`; dev dependencies include `vitest`, `tsx`, Biome, etc.
- `src/cli/features/ci/command.ts` imports `runCheckCommand` and relies on deterministic reports and returned lines. CI should not receive colorized output unless explicitly requested later.

# Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/cli/cli.ts`
  - `main()`
  - single-target `check` branch near the final `runCheckCommand(...)`
  - no-arg multi-target `check` branch that prints `checkTarget=... props=...`
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
  - `CheckCommandOptions`
  - `CheckCommandResult`
  - `runCheckCommand(options)`
  - `renderCheckResult(check)`
  - `writeTraceArtifacts(check, tracesDir)`
  - `writeReplayTestArtifacts(check, replayTestsDir)`
  - `writeActionReplayTestArtifacts(check, replayTestsDir)`
- `/Users/hari/proj/modality-ts/src/cli/features/check/index.ts`
  - exports for `runCheckCommand` and `renderCheckResult`
- `/Users/hari/proj/modality-ts/src/check/types.ts`
  - `PropertyVerdict`
  - `CheckProgress`
  - `CheckOptions.onProgress`
- `/Users/hari/proj/modality-ts/src/cli/features/ci/command.ts`
  - `runCiCommand(options)`, which calls `runCheckCommand`
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
  - direct unit coverage for `runCheckCommand` and line rendering
- `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`
  - CLI subprocess coverage for user-visible stdout

# Existing Patterns to Follow

- Keep feature command APIs returning structured results plus `lines: string[]`.
- Keep tests focused under the affected subsystem:
  - command-level tests in `src/cli/features/check/command.test.ts`
  - subprocess/user-facing tests in `test/modality/cli.test.ts`
- Use strict TypeScript, NodeNext ESM imports, two-space indentation, double quotes, and semicolons.
- Avoid extra dependencies unless the helper becomes complex. A small internal ANSI helper is enough for this task.
- Preserve existing artifact path line data somewhere in `result.lines`, even if the human CLI gets nicer formatting.

# Atomic Implementation Steps

1. Add a tiny check output formatter module.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts` new file
   - `/Users/hari/proj/modality-ts/src/cli/features/check/index.ts`

   Implement:
   - `type CheckOutputMode = "plain" | "color"`
   - `interface CheckOutputOptions { color?: boolean }`
   - ANSI helper functions gated by `color`.
   - `symbolForStatus(status)`:
     - `verified-within-bounds` -> `✓`
     - `reachable` -> `✓` or `●`; prefer `✓` if reachable is success for reachable properties.
     - `violated` -> `×`
     - `error` -> `×`
     - `vacuous-warning` -> `⚠`
   - `renderHumanCheckResult(check, options): string[]`
   - `renderHumanCheckArtifacts(paths, options): string[]` if useful.

   Output shape should be stable and testable. Suggested plain snapshot:

   ```text
   Properties
     × flagStartsFalseOnly violated
       trace: setFlag
     ✓ flagCanBecomeTrue reachable
       trace: setFlag

   Stats
     states=2 edges=1 depth=2
     slicing slices=1 vars=1 transitions=1 skipped=0
     storage mode=none recordedEdges=0 storedStates=2 parentEntries=2
     hotPath canonicalCache=true transitionIndex=true internalTransitionIndex=false

   Artifacts
     trace /tmp/.../flagStartsFalseOnly.violated.trace.json
     replayTest /tmp/.../flagStartsFalseOnly.replay.test.ts
   ```

   Important: property result lines must come before the stats line.

2. Preserve the existing machine-ish renderer for compatibility.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`

   Keep `renderCheckResult(check): string[]` available and behavior-compatible for callers/tests that inspect `result.lines`.

   Add the new formatter alongside it rather than replacing it immediately. This minimizes breakage in CI and command tests.

3. Add an optional streaming emitter to `runCheckCommand`.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`

   Extend `CheckCommandOptions` with an optional callback, for example:

   ```ts
   output?: {
     emit?: (line: string) => void;
     color?: boolean;
     human?: boolean;
   };
   ```

   Behavior:
   - Default remains unchanged: no streaming, return `lines` as today.
   - When `output?.emit` and `output.human` are provided:
     - call `checkModel` first, then emit formatted property verdict lines and stats immediately after the checker returns.
     - write report/traces/replay artifacts after verdicts/stats, emitting artifact lines as each artifact path becomes available.
   - Keep returned `lines` as legacy `renderCheckResult(check)` plus legacy artifact lines to avoid breaking current library tests and `runCiCommand`.

   Stop and report if making artifact writes stream one-by-one requires invasive rewrites. It is acceptable to emit artifact groups immediately after each existing helper returns; the main user requirement is to avoid waiting until the entire command, including all artifact writes, finishes.

4. Stream artifact output in coarse phases.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`

   Minimal approach:
   - After `writeTraceArtifacts(...)` resolves, emit its formatted artifact lines.
   - After `writeReplayTestArtifacts(...)` resolves, emit its formatted artifact lines.
   - After `writeActionReplayTestArtifacts(...)` resolves, emit its formatted artifact lines.

   Better but still small approach:
   - Add optional per-path callbacks to the artifact writing helpers:
     - `writeTraceArtifacts(check, tracesDir, onPath?)`
     - `writeReplayTestArtifacts(check, replayTestsDir, onPath?)`
     - `writeActionReplayTestArtifacts(check, replayTestsDir, onPath?)`
   - Invoke `onPath(kind, path)` immediately after each `writeFile`.

   Do not change file names, directories, or write order.

5. Wire human streaming into the actual `modality check` CLI branches.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/cli.ts`

   In both check branches:
   - Replace the final `for (const line of result.lines) console.log(line)` only for check calls where `output.emit` is passed.
   - Pass:

   ```ts
   output: {
     emit: (line) => console.log(line),
     human: true,
     color: shouldUseColor(),
   }
   ```

   Add `shouldUseColor()` locally or in a small shared CLI utility:
   - true when `process.stdout.isTTY` and `NO_COLOR` is not set.
   - true when `FORCE_COLOR` is set.
   - false in normal subprocess tests unless `FORCE_COLOR` is set.

   For no-arg multi-target check mode, replace `checkTarget=... props=...` with a human target header only in streamed human output, for example:

   ```text
   Target .modality/models/app/root.model.json
     props app/root.props.mjs
   ```

   Keep the old `checkTarget=... props=...` available only if a compatibility test still needs it, or update tests to assert the new human target header.

6. Update tests for the new human output while keeping library compatibility tests.

   Files to edit:
   - `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
   - `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`

   Add command-level tests:
   - `renderHumanCheckResult` prints a `Properties` section before `Stats`.
   - all verdict statuses map to the expected symbols in plain mode.
   - color mode includes ANSI escape sequences and plain mode does not.
   - `runCheckCommand({ output: { human: true, emit } })` calls `emit` before artifact lines are emitted.
   - returned `result.lines` remains legacy-compatible.

   Update subprocess CLI tests:
   - Replace expectations for `rootFlagCanBecomeTrue: reachable` with checks for symbol/structured output, for example `✓ rootFlagCanBecomeTrue reachable`.
   - Keep `states=` expectation, but assert it appears after property verdicts.
   - Add a `FORCE_COLOR=1` subprocess test for `modality check` that expects ANSI color and status symbols.
   - Add or update no-arg multi-target checks to expect the target header format.

7. Keep CI command behavior stable.

   Files to inspect/edit only if tests fail:
   - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.ts`
   - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.test.ts`

   Do not pass `output.emit` from `runCiCommand`. Its current `lines` should stay deterministic and uncolored.

8. Update docs only if this repo has user-facing CLI output examples.

   Files to inspect:
   - `/Users/hari/proj/modality-ts/README.md`
   - `/Users/hari/proj/modality-ts/docs/specs/`

   If examples show old `property: status` output for `modality check`, update those examples to the new structured output. Do not update unrelated docs.

# Per-Step Files to Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/output.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/check/index.ts`
- Step 2:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
- Step 4:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/cli/cli.ts`
- Step 6:
  - `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`
  - `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`
- Step 7:
  - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/ci/command.test.ts`
- Step 8:
  - `/Users/hari/proj/modality-ts/README.md`
  - relevant files under `/Users/hari/proj/modality-ts/docs/specs/`

# Acceptance Criteria

- `modality check` stdout is structured and readable:
  - property verdicts are grouped first,
  - stats are printed after all property verdicts,
  - diagnostics and artifacts are indented under clear sections,
  - symbols are present in normal plain output,
  - colors appear when stdout supports color or `FORCE_COLOR=1`.
- `modality check` streams output through `console.log` as phases complete:
  - no final-only loop over `result.lines` in the check CLI path,
  - property/stats output is emitted before trace/replay artifact writing completes where practical.
- `runCheckCommand` remains usable as a library function:
  - existing callers can ignore streaming,
  - returned `lines` remains deterministic and uncolored unless a deliberate follow-up changes it.
- `modality ci` output and reports do not change except for unavoidable internal type additions.
- JSON reports, traces, replay tests, and action replay tests remain byte-for-byte deterministic for existing deterministic tests.
- Exit codes remain unchanged:
  - check violations/errors still exit `2`,
  - passing checks still exit `0`.

# Tests to Add or Update

- In `/Users/hari/proj/modality-ts/src/cli/features/check/command.test.ts`:
  - Add direct tests for `renderHumanCheckResult`.
  - Add a test asserting property section order before stats.
  - Add a test asserting color gating.
  - Add a test asserting `runCheckCommand` calls `output.emit` while still returning legacy `lines`.
  - Update any brittle legacy output assertions only if they intentionally switch to the new human renderer.

- In `/Users/hari/proj/modality-ts/test/modality/cli.test.ts`:
  - Update `checks, exports, and conforms using default artifacts` to assert structured `check` output and `states=` ordering.
  - Update no-arg multi-target check tests to assert target headers and symbol verdicts.
  - Add a color subprocess test:

    ```ts
    const { stdout } = await execFileAsync(tsxBin, [cliPath, "check"], {
      cwd: dir,
      env: { ...process.env, FORCE_COLOR: "1" },
    });
    expect(stdout).toContain("\u001b[");
    expect(stdout).toContain("✓");
    ```

  - Ensure existing artifact/report assertions stay intact.

# Verification Commands

Run these from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- src/cli/features/check/command.test.ts test/modality/cli.test.ts
rtk pnpm typecheck
rtk pnpm fix
rtk pnpm test
rtk pnpm architecture
```

If docs/examples were changed, also run:

```bash
rtk pnpm ci:examples
```

# Risks, Ambiguities, and Stop Conditions

- Ambiguity: “like Vitest” can mean snapshots, summary layout, live progress, or full reporter behavior. Implement only a small readable formatter for `check`; stop and ask before introducing a general reporter system across all commands.
- Ambiguity: `reachable` verdicts may be success-like for reachable properties but counterexample-like in other contexts. If the existing semantics are unclear while assigning colors, use neutral cyan/blue for `reachable` and reserve green for `verified-within-bounds`.
- Risk: `✓` and other Unicode symbols may be undesirable in some CI logs. Keep symbols always on per request, but keep colors gated. Stop and report if maintainers want a `--no-symbols` flag; do not add it preemptively.
- Risk: Streaming inside `runCheckCommand` can make tests order-sensitive. Keep the callback optional and make CLI the only default streamed path.
- Risk: True live progress during `checkModel` may require plumbing `onProgress` and deciding how to redraw terminal lines. Do not implement dynamic spinners or carriage-return redraws in this task. If asked for live progress later, use `CheckOptions.onProgress` in a separate plan.
- Risk: Artifact path emission currently happens after helper functions resolve. If per-file streaming requires invasive helper rewrites, use coarse phase streaming and report the limitation.
- Stop and ask/report if:
  - tests reveal external callers depend on exact `result.lines` becoming human-formatted,
  - adding color without a dependency grows beyond a tiny helper,
  - `modality ci` snapshots change,
  - generated `dist/` files appear modified,
  - implementing streaming would require changing checker internals or asyncifying `checkModel`.
