# Plan: `modality check` output — per-property symbols + optional Artifacts block

## 1. Goal

Enhance the human-readable output of the `modality check` command:

1. **Optional Artifacts block** — the `Artifacts` summary section (and its per-path
   lines) must print **only** when the user passes `--artifact` or `-A`. By default it is
   suppressed.
2. **Per-property status symbols** — each property verdict row must lead with the verdict's
   status symbol (`✓` / `×` / `⚠`) instead of the current literal `-` bullet. Example target
   output:

   ```
    × app/routes/ingest.$sessionId.props.mjs 26ms
     (7 tests, 4 passed, 3 failed, 0 errors, states 27, edges 198, depth 6, slices 2, vars 31, transitions 20, skipped 0)
     × clarificationSubmitIsSerialized violated
   ```

## 2. Non-goals

- Do **not** change artifact *generation/writing* to disk. `runCheckCommand` continues to
  write reports/traces/replay-tests exactly as today. This task only gates whether the
  `Artifacts` block is **printed** in the human summary.
- Do **not** touch the deprecated streaming path (`renderHumanCheckResult` /
  `renderHumanCheckArtifacts` invoked from `src/cli/features/check/command.ts` when
  `options.output.emit` + `human` are set). It is not used by the CLI entrypoint. Leave it
  unchanged.
- Do **not** change the `ci`, `conform`, `replay`, `export`, or `extract` output paths.
- Do **not** change the legacy machine line output produced by `renderCheckResult`.
- Do **not** restructure flag parsing helpers (`flagValue`, `positionals`) beyond the
  minimal `-A` handling described below.

## 3. Current-state findings

- The CLI `check` handler lives in `src/cli/cli.ts`. It is the fall-through block after the
  `init`/`ci`/`conform`/`export`/`extract`/`replay` command guards (starts at the
  `const reportPath = flagValue(args, "--report");` line, ~`src/cli/cli.ts:548`, and ends at
  `process.exit(result.exitCode);` ~`src/cli/cli.ts:748`).
- Two call sites render human output via `renderHumanCheckTargets`:
  - multi-target (no model path) branch: `src/cli/cli.ts:697-703`
  - single-target branch: `src/cli/cli.ts:729-747`
- `renderHumanCheckTargets` is defined in `src/cli/features/check/output.ts:164-237`.
  - Per-property rows are emitted in `renderTargetRows` at
    `src/cli/features/check/output.ts:152-160`, currently:
    ```ts
    lines.push(`  - ${verdict.property} ${verdict.status}`);
    ```
  - The `Artifacts` block is emitted unconditionally (when `artifacts.length > 0`) at
    `src/cli/features/check/output.ts:220-234`.
- `HumanCheckRenderOptions` (`src/cli/features/check/output.ts:31-34`) extends
  `OutputOptions` with `startedAt` and `totalDurationMs`. There is currently no flag for
  artifact visibility.
- `symbolForStatus(status)` exists at `src/cli/features/check/output.ts:36-47` and returns
  the plain symbol string (no color). Per-target rows already use the color-aware
  `formatStatusSymbol(kind, options)` from `src/cli/output.ts:54-59`.
- `formatStatusSymbol` and `statusSymbol`/`statusColor` map a `StatusKind`
  (`"pass" | "fail" | "warn"`) to `✓ / × / ⚠` (`src/cli/output.ts:28-59`).
- Flag parsing:
  - `flagValue` (`src/cli/cli.ts:48-51`) reads `--flag value`.
  - Boolean flags are detected with `args.includes("--flag")` (see `--no-search-limits` at
    `src/cli/cli.ts:552`).
  - `positionals` (`src/cli/cli.ts:61-79`) filters out args that `startsWith("--")` and args
    that follow a value flag. **A single-dash short flag like `-A` does NOT start with `--`,
    so it would leak through and be misread as the positional `modelPath`.** This must be
    handled explicitly (see step 4).
- The check usage/help line is at `src/cli/cli.ts:114-116`.
- Tests for the renderer: `src/cli/features/check/command.test.ts:748-870`
  (`describe("renderHumanCheckTargets", ...)`). The existing test
  `"prints a status row instead of Properties"` (`:749-799`) asserts:
  - `lines.some((line) => line === "  - flagStartsFalseOnly violated")` (the `-` bullet) →
    must change to the symbol form.
  - The `Artifacts` block + `(trace)` line are present by default → must change because
    artifacts are now hidden unless requested.

## 4. Exact file paths and relevant symbols

- `src/cli/features/check/output.ts`
  - `HumanCheckRenderOptions` (add `showArtifacts?`)
  - `renderTargetRows` (per-property symbol)
  - `renderHumanCheckTargets` (gate Artifacts block on `options.showArtifacts`)
  - new local helper `verdictStatusKind` (status → `StatusKind`)
- `src/cli/cli.ts`
  - check handler: parse `--artifact` / `-A`, pass `showArtifacts` to both
    `renderHumanCheckTargets` calls, strip `-A` from positional parsing
  - help text line (`:114-116`)
- `src/cli/features/check/command.test.ts`
  - update `"prints a status row instead of Properties"` test
  - add a test asserting Artifacts hidden by default + shown with `showArtifacts: true`

## 5. Existing patterns to follow

- Color-aware symbols: use `formatStatusSymbol(kind, options)` (already used for the
  per-target row at `output.ts:147`), not the raw `statusSymbol`/`symbolForStatus`.
- Boolean CLI flags: detect with `args.includes(...)` (mirror `--no-search-limits`).
- Two-space indentation, double quotes, semicolons, NodeNext ESM imports (`.js` suffixes).
- Keep options object spreading consistent with existing call sites.

## 6. Atomic implementation steps

### Step A — add `verdictStatusKind` helper + per-property symbol (output.ts)

In `src/cli/features/check/output.ts`, add a status→kind mapping helper near
`symbolForStatus` (do not remove `symbolForStatus`; it is part of the public exports and
covered by a test):

```ts
function verdictStatusKind(status: PropertyVerdict["status"]): "pass" | "fail" | "warn" {
  switch (status) {
    case "verified-within-bounds":
    case "reachable":
      return "pass";
    case "violated":
    case "error":
      return "fail";
    case "vacuous-warning":
      return "warn";
  }
}
```

In `renderTargetRows`, replace the bullet line (`output.ts:153`):

```ts
// before
lines.push(`  - ${verdict.property} ${verdict.status}`);
// after
lines.push(
  `  ${formatStatusSymbol(verdictStatusKind(verdict.status), options)} ${verdict.property} ${verdict.status}`,
);
```

Leave the subsequent `trace:` / message detail lines (`output.ts:154-159`) unchanged.

### Step B — gate the Artifacts block on a new option (output.ts)

Extend `HumanCheckRenderOptions` (`output.ts:31-34`):

```ts
export interface HumanCheckRenderOptions extends OutputOptions {
  startedAt: Date;
  totalDurationMs: number;
  showArtifacts?: boolean;
}
```

In `renderHumanCheckTargets`, change the artifacts block guard (`output.ts:229`):

```ts
// before
if (artifacts.length > 0) {
// after
if (options.showArtifacts === true && artifacts.length > 0) {
```

Keep the artifact-collection loop above it as-is (cheap; harmless when not printed). Default
(`showArtifacts` undefined/false) ⇒ block omitted.

### Step C — parse `--artifact` / `-A` and thread it through (cli.ts)

In the check handler, after the existing flag reads (near `src/cli/cli.ts:548-551`), add:

```ts
const showArtifacts = args.includes("--artifact") || args.includes("-A");
```

Ensure `-A` is not mistaken for a positional. Update the `positionals(...)` call
(`src/cli/cli.ts:593-604`) to operate on args with `-A` removed:

```ts
const positional = positionals(
  args.filter((arg) => arg !== "-A"),
  [
    "--report",
    "--overlay",
    "--traces",
    "--replay-tests",
    "--action-replay-tests",
    "--states",
    "--max-states",
    "--max-edges",
    "--max-frontier",
    "--memory-guard-mb",
  ],
);
```

(`--artifact` already starts with `--`, so `positionals` filters it; only `-A` needs the
explicit filter.)

Pass `showArtifacts` into **both** `renderHumanCheckTargets` option objects:

- multi-target branch (`src/cli/cli.ts:698-702`):
  ```ts
  renderHumanCheckTargets(checkTargets, {
    color,
    startedAt,
    totalDurationMs: performance.now() - startedMs,
    showArtifacts,
  }),
  ```
- single-target branch (`src/cli/cli.ts:741-745`):
  ```ts
  {
    color,
    startedAt,
    totalDurationMs: performance.now() - startedMs,
    showArtifacts,
  },
  ```

### Step D — update help text (cli.ts)

Update the check usage line (`src/cli/cli.ts:114-116`) to advertise the flag, e.g. append
`[--artifact|-A]`:

```
"       modality check [model.json] [props.mjs ...] [--report .modality/report.json] [--max-states N] [--max-edges N] [--max-frontier N] [--memory-guard-mb N] [--no-search-limits] [--artifact|-A]",
```

### Step E — update / add tests (command.test.ts)

Update `"prints a status row instead of Properties"` (`:749-799`):
- Add `showArtifacts: true` to the render options object so the existing `Artifacts`/`(trace)`
  assertions remain valid.
- Change the per-property assertion from the `-` bullet to the symbol form:
  ```ts
  expect(
    lines.some((line) => line === "  × flagStartsFalseOnly violated"),
  ).toBe(true);
  ```
  (Render options here have no `color`, so the plain `×` symbol is emitted.)

Add a new test in the same `describe`:
- Render the same target **without** `showArtifacts` and assert no line trims to start with
  `Artifacts` and no `(trace)` line is present.
- Render **with** `showArtifacts: true` and assert the `Artifacts` line + `(trace)` line are
  present.

## 7. Per-step files to edit

| Step | Files |
|------|-------|
| A | `src/cli/features/check/output.ts` |
| B | `src/cli/features/check/output.ts` |
| C | `src/cli/cli.ts` |
| D | `src/cli/cli.ts` |
| E | `src/cli/features/check/command.test.ts` |

## 8. Acceptance criteria

- `modality check` (no flag) prints per-target rows, the `(... stats ...)` line, per-property
  rows each prefixed with `✓`/`×`/`⚠`, and the summary block (`Test Files`, `Tests`,
  `Start at`, `Duration`) — **without** an `Artifacts` section.
- `modality check --artifact` and `modality check -A` additionally print the `Artifacts`
  section with the per-path lines (`(report)`, `(trace)`, `(replayTest)`,
  `(actionReplayTest)`), exactly as before this change.
- Per-property line format is `  <symbol> <property> <status>` (color symbol in TTY/color
  mode, plain symbol otherwise). The leading `-` bullet is gone.
- Artifacts are still written to disk regardless of the flag (no behavior change to
  generation).
- `-A` is never interpreted as the `model.json` positional.
- `pnpm typecheck`, `pnpm test`, `pnpm fix`, and `pnpm architecture` pass.

## 9. Tests to add or update

- Update: `src/cli/features/check/command.test.ts` →
  `"prints a status row instead of Properties"` (symbol assertion + `showArtifacts: true`).
- Add: `src/cli/features/check/command.test.ts` → a test verifying the `Artifacts` block is
  hidden by default and shown when `showArtifacts: true`.
- Add (recommended): a per-property-symbol assertion covering a passing verdict (`✓`) in
  addition to the existing violated (`×`) case, to lock the symbol mapping.

## 10. Verification commands

Prefix with `rtk` per repo convention:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm fix
rtk pnpm architecture
```

Manual smoke (optional, against an example app under `examples/`):

```bash
# default: no Artifacts block
rtk node dist/cli/cli.js check <model.json> <props.mjs>
# with artifacts printed
rtk node dist/cli/cli.js check <model.json> <props.mjs> --artifact
rtk node dist/cli/cli.js check <model.json> <props.mjs> -A
```

## 11. Risks, ambiguities, and stop conditions

- **Ambiguity — scope of "Artifacts optional":** this plan gates only the *printed* block,
  not artifact writing. If the intent is to also stop *writing* artifacts to disk unless
  `--artifact`/`-A` is set, **stop and ask** — that is a larger change touching
  `runCheckCommand` defaults (`tracesDir`/`replayTestsDir`/`reportPath`) and the `ci`/example
  integration flows (`pnpm ci:examples`), and risks breaking downstream consumers that read
  `.modality/report.json`.
- **`-A` collision:** confirm no other `check` subcommand option already uses `-A`. Current
  code uses only long flags for `check`; if a short flag scheme is introduced elsewhere,
  reconcile before proceeding.
- **`symbolForStatus` retention:** keep the exported `symbolForStatus` and its test
  (`command.test.ts:844-850`) intact; the new per-property rendering uses the color-aware
  `formatStatusSymbol` path via `verdictStatusKind`, but removing `symbolForStatus` would
  break the public export surface in `src/cli/features/check/index.ts:12`.
- **Streaming path drift:** `command.ts`'s `renderHumanCheckArtifacts`/`renderHumanCheckResult`
  path is intentionally untouched. If a test or caller depends on streaming printing the
  Artifacts block, do not “fix” it here — report it.
- **If the check handler in `src/cli/cli.ts` has been refactored** (e.g. extracted to a
  dedicated module) so the line ranges above no longer match, locate the two
  `renderHumanCheckTargets` call sites by symbol and apply the same option threading; if the
  structure differs materially from this description, **stop and report** before editing.
