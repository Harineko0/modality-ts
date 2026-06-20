# 260620-05 — Incremental (Vitest-style) streaming output for extract / check / generate

> Part 2 of 3. Depends on `260620-04` (the `generate` command must exist).
> Precedes `260620-06` (colored statusline), which builds on the per-target /
> summary renderer split introduced here.

## 1. Goal

Print each target's result block **as soon as that target finishes** instead of
buffering all targets and flushing once at the end, so `extract`, `check`, and
`generate` stream progress like Vitest. Add an optional TTY-only transient
"running" indicator (on stderr) that the committed line overwrites.

Mechanism: split each aggregate renderer into a **per-target** renderer and a
**summary** renderer, then have `cli.ts` emit each target as its run completes,
and the summary once after the loop.

## 2. Non-goals

- No animated intra-file per-property counter (`5/10 → 6/10`). `checkModel`
  returns all verdicts synchronously with no per-property callback; that is a
  broad refactor and out of scope. A committed per-file line may show a final
  `passed/total`, but nothing animates mid-file.
- No coloring/format changes to the summary block — that is `260620-06`. This
  plan must keep the existing plain summary text byte-identical (it only changes
  *when* lines are printed and refactors the renderers into composable pieces).
- No change to extraction/check semantics, exit codes, or report output.

## 3. Current-state findings

- **Extract dispatch** (`src/cli/cli.ts:379-517`): collects every target into
  `extractTargets[]` (merged-output path `459-475` or
  `inferExtractTargetsFromProps` loop `476-493`), then calls
  `renderHumanExtractTargets(...)` **once** (`494-515`), `process.exit(0)`.
- **Check dispatch**: multi-target path loops `inferCheckTargetsFromProps`
  collecting `checkTargets[]` then `renderHumanCheckTargets(...)` once
  (`717-724`); single-target path renders once (`751-771`). Exit `2` if any
  violated/error (accumulated in `exitCode`).
- `emitLines(lines)` (`cli.ts:92-94`) just `console.log`s each line.
  `startedAt`/`startedMs` are captured once (`663-664`); per-target
  `targetStartedMs` already measured.
- **Extract output** (`src/cli/features/extract/output.ts`):
  `renderHumanExtractTargets(results, options)` — per-target rows in a loop
  (`63-85`); then, when `results.length > 0`, blank line + `Duration` + optional
  `Artifacts` (`86-98`).
- **Check output** (`src/cli/features/check/output.ts`): `renderTargetRows(target,
  options)` (`162-205`) already renders ONE target; `renderHumanCheckTargets`
  (`207-280`) loops targets, pushes `""`, then `Test Files`/`Tests`/`Start at`/
  `Duration` + optional `Artifacts`.
- **Generate output** (from `260620-04`): `renderHumanGenerateTargets` loops
  per-target rows then `Duration` + optional `Artifacts`.
- **Tests** call the aggregate renderers directly and assert ordering: e.g.
  `check/command.test.ts:1340-1375` ("aggregates multiple targets before the
  summary block") expects target rows before `Test Files`;
  `extract/command.output.test.ts` asserts the first row then `Duration`. The
  aggregate functions must keep returning the same lines.
- `process.stdout.isTTY` / `shouldUseColor()` already gate color
  (`cli.ts:81-90`); there is no existing transient/progress mechanism.

## 4. Exact file paths and relevant symbols

Edit:
- `src/cli/features/extract/output.ts` — add `renderHumanExtractTarget`,
  `renderExtractSummary`; reimplement `renderHumanExtractTargets` as their
  composition; add `startedAt` to `HumanExtractRenderOptions`.
- `src/cli/features/check/output.ts` — export `renderHumanCheckTarget` (from
  `renderTargetRows`), add `renderCheckSummary`; reimplement
  `renderHumanCheckTargets` as their composition.
- `src/cli/features/generate/output.ts` — add `renderHumanGenerateTarget` +
  `renderGenerateSummary`; reimplement aggregate as composition.
- `src/cli/features/{extract,check,generate}/index.ts` — export the new
  per-target + summary renderers.
- `src/cli/output.ts` — add `createRunProgress` transient-progress helper.
- `src/cli/cli.ts` — stream per target in extract, check, generate dispatch.

## 5. Existing patterns to follow

- Keep the aggregate `renderHuman*Targets` exported and byte-identical
  (`= results.flatMap(renderHuman*Target).concat(render*Summary(results))`), so
  existing tests pass unchanged.
- `emitLines` for stdout; transient progress writes only to stderr.
- Renderers stay plain unless `options.color`.

## 6. Atomic implementation steps

### Step 1 — `createRunProgress` (transient stderr indicator) in `src/cli/output.ts`
- `export function createRunProgress(options: OutputOptions): { start(label:
  string): void; done(): void }`. When `process.stderr.isTTY === true` and
  `useColor(options)`, `start` writes `◌ <label> running…\r`-style transient
  text to `process.stderr`; `done` clears it (`\r` + clear-to-EOL). Otherwise a
  no-op. Never touches stdout.

### Step 2 — Split the extract renderer
In `src/cli/features/extract/output.ts`:
- `export function renderHumanExtractTarget(target, options): string[]` = the
  per-target loop body (`63-85`) incl. the `propsErrors` block added in
  `260620-04`.
- `export function renderExtractSummary(results, options): string[]` = the
  trailing block (leading `""`, `Duration`, optional `Artifacts`) guarded by
  `results.length > 0`. (Plain text unchanged; `260620-06` adds `Extract Files`/
  `Start at` + coloring.)
- `renderHumanExtractTargets(results, options)` =
  `results.flatMap(t => renderHumanExtractTarget(t, options)).concat(
  renderExtractSummary(results, options))`.

### Step 3 — Split the check renderer
In `src/cli/features/check/output.ts`:
- `export function renderHumanCheckTarget(target, options)` = rename/export of
  `renderTargetRows`.
- `export function renderCheckSummary(results, options)` = the block at
  `215-277` (leading `""`, `Test Files`, `Tests`, `Start at`, `Duration`,
  optional `Artifacts`), plain text unchanged.
- `renderHumanCheckTargets` = flatMap targets + summary.

### Step 4 — Split the generate renderer
In `src/cli/features/generate/output.ts`: mirror Steps 2–3 with
`renderHumanGenerateTarget` + `renderGenerateSummary`, aggregate = composition.

### Step 5 — Stream in `cli.ts`
- **Extract block** (`379-517`): capture `startedAt`; in both the merged and
  inferred paths, after each `runExtractCommand`, build the entry (incl.
  `propsErrors`) and immediately
  `emitLines(renderHumanExtractTarget(entry, opts))`, wrapping the run with
  `createRunProgress(opts).start(label)` / `done()`. After the loop,
  `emitLines(renderExtractSummary(entries, { ...opts, startedAt,
  totalDurationMs, showArtifacts }))`. Keep `exit(0)`.
- **Check block**: multi-target loop and single-target path emit each target via
  `renderHumanCheckTarget(entry, { color })` as it completes; after, emit
  `renderCheckSummary(entries, { color, startedAt, totalDurationMs,
  showArtifacts })`. Preserve `exitCode` accumulation.
- **Generate block** (from `260620-04`): same pattern with
  `renderHumanGenerateTarget` + `renderGenerateSummary`.

## 8. Acceptance criteria

1. `extract`, `check`, `generate` print each target block as it completes, then
   one trailing summary; non-TTY/piped stdout preserves order and produces the
   same bytes as today's aggregate renderers (modulo nothing in this plan — the
   summary text is unchanged here).
2. `renderHuman*Targets` aggregate output is byte-identical to before (verified
   by the existing tests plus a composition test:
   `renderHuman*Target(...).concat(render*Summary(...)) === renderHuman*Targets(...)`).
3. The transient "running" indicator appears only when `stderr.isTTY` and color
   is on, is written to stderr, is cleared before the committed line, and never
   appears in captured stdout.
4. Exit codes unchanged (`extract`/`generate` → 0; `check` → 2 on
   violation/error).
5. `pnpm typecheck`, `pnpm test`, `pnpm fix`, `pnpm architecture` pass.

## 9. Tests to add or update

- Add a composition test per command asserting
  `flatMap(renderHuman*Target) + render*Summary` equals `renderHuman*Targets`
  for a 2-target input.
- Keep existing ordering tests (e.g. `check/command.test.ts:1340-1375`,
  `extract/command.output.test.ts`) green unchanged.
- No subprocess/stdout-capture test for streaming order is required; if added,
  assert target lines precede summary lines in captured stdout.
- Keep assertions color-agnostic; do not assert on stderr transient output.

## 10. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm fix
rtk pnpm architecture
# manual: confirm progressive output (TTY) and clean piped output
rtk pnpm --filter <example> exec modality check | cat   # no escape codes, target-before-summary
```

## 11. Risks, ambiguities, and stop conditions

- **Output-order regression**: the aggregate renderers must remain pure
  compositions — if a refactor changes any plain line, stop and restore. Run the
  existing output tests after Steps 2–4.
- **stderr/stdout mixing**: ensure transient progress never goes to stdout (it
  would corrupt piped/CI output and the subprocess tests). Treat any stdout
  escape leakage as a blocker.
- **Non-TTY**: `createRunProgress` must be a strict no-op when
  `!stderr.isTTY`, so CI logs are clean.
- **Interaction with `260620-06`**: that plan extends `render*Summary`; keep the
  summary functions the single seam so the two plans don't conflict.

