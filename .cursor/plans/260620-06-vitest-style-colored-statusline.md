# 260620-06 — Standardized, Vitest-style colored statusline for extract / check / generate

> Part 3 of 3. Depends on `260620-05` (the per-target / summary renderer split)
> and `260620-04` (the `generate` command). This plan only restyles the summary
> blocks; it does not change what is computed or streamed.

## 1. Goal

Standardize and colorize the final statusline of `extract`, `check`, and
`generate` through one shared summary renderer, matching Vitest's scheme:

```
 Test Files  86 passed (86)
      Tests  1081 passed (1081)
   Start at  19:15:14
   Duration  99.82s (transform 11.87s, …)
```

- Labels (`Test Files`, `Tests`, `Start at`, `Duration`, …) → gray.
- Counts: `N passed` → green, `M failed` / `E errors` → red, `W warnings` →
  yellow.
- `(total)` and other parentheticals (e.g. the duration breakdown) → dark gray.
- Times and durations (`19:15:14`, `99.82s`) → white.

Apply the same `Start at` + `* Files` count rows to `extract` and `generate` so
all three commands share the format.

## 2. Non-goals

- No change to what the summaries report (counts, durations, artifacts) or to
  streaming/order (`260620-05`) or command structure (`260620-04`).
- Color must remain gated by `shouldUseColor()`; with color off, plain text is
  unchanged except for the newly-added `Extract Files` / `Generate Files` /
  `Start at` rows.
- Do not change `formatSummaryLabel`'s signature or plain output — it is shared
  by `ci`, `replay`, `conform`, `export`; add new helpers instead.
- No new color/formatting dependency; keep the hand-rolled `ANSI` approach.

## 3. Current-state findings

- **`src/cli/output.ts`**: `ANSI` has `reset,bold,green,red,yellow,cyan,dim` —
  **no gray/white**. `formatSummaryLabel(label, value)` (`76-80`) pads label to
  width 11 and joins with value, **no color**; used by
  `ci/replay/conform/export/extract/check`. `colorize`, `formatStatusSymbol`,
  `statusColor`, `formatMs`, `formatDuration`, `formatTime`,
  `formatArtifactLine` exist.
- **Check summary** (`src/cli/features/check/output.ts:215-277`, now
  `renderCheckSummary` after `260620-05`): builds `testFilesValue`
  (`"M failed | N passed (T)"` or `"N passed (T)"`, `222-225`) and `testsValue`
  (`"N passed[, M failed][, E errors][, W warnings] (T)"`, `248-256`) as plain
  strings, then `formatSummaryLabel("Test Files"/"Tests"/"Start at"/"Duration",
  …)`. `Start at` uses `formatTime`, `Duration` uses `formatDuration`.
- **Extract summary** (`renderExtractSummary` after `260620-05`): currently only
  `Duration` + optional `Artifacts`; no `Extract Files`/`Start at`.
- **Generate summary** (`renderGenerateSummary`): `Duration` + optional
  `Artifacts`.
- **Color gating**: `cli.ts:81-90`; renderers plain unless `options.color`. Many
  tests assert exact plain substrings (`Test Files`, `Tests`, `Duration`,
  `(model)`, `2 passed (2)`); these run with color off.

## 4. Exact file paths and relevant symbols

Edit:
- `src/cli/output.ts` — add `ANSI.gray`, `ANSI.white`; add `formatSummaryRow`,
  `formatCountValue`, `formatTimeValue`, `formatDurationValue`. Keep
  `formatSummaryLabel` unchanged.
- `src/cli/features/check/output.ts` — `renderCheckSummary` builds values via the
  new helpers.
- `src/cli/features/extract/output.ts` — `renderExtractSummary` adds
  `Extract Files` + `Start at`, via the new helpers; add `startedAt` to
  `HumanExtractRenderOptions` (if not already added in `260620-05`).
- `src/cli/features/generate/output.ts` — `renderGenerateSummary` adds
  `Generate Files` + `Start at`.
- `src/cli/cli.ts` — pass `startedAt` into extract/generate summary options.

## 5. Existing patterns to follow

- Use `colorize(text, ANSI.x, options)`; never raw escapes at call sites.
- Build a plain value string first, colorize per-segment only when
  `options.color`, so the color-off path keeps today's exact text.
- Keep `formatSummaryLabel` for the other commands; route only extract/check/
  generate through `formatSummaryRow`.

## 6. Atomic implementation steps

### Step 1 — Shared helpers in `src/cli/output.ts`
- Add `ANSI.gray = "[90m"` (bright-black / dark gray) and
  `ANSI.white = "[37m"`.
- `export function formatSummaryRow(label: string, value: string, options:
  OutputOptions): string` — pad `label` to width 11 (reuse
  `SUMMARY_LABEL_WIDTH`), colorize the **label** with `ANSI.gray` when
  `useColor`, then `  ${value}`.
- `export function formatCountValue(counts: { passed: number; failed?: number;
  errors?: number; warnings?: number }, total: number, options): string` —
  produce the Vitest value: green `N passed`, red `M failed`, red `E errors`,
  yellow `W warnings`, joined to preserve today's exact plain strings, then
  ` ` + gray `(total)`. Provide a `{ leadFailed?: boolean }` option so the check
  `Test Files` row can render `"M failed | N passed (T)"` ordering unchanged.
- `export function formatTimeValue(text: string, options): string` — white when
  color on.
- `export function formatDurationValue(text: string, paren: string | undefined,
  options): string` — white main + gray `(paren)` when color on.
- All helpers must return today's exact plain text when `options.color` is
  falsy.

### Step 2 — Check summary
In `renderCheckSummary` (`check/output.ts`): replace `formatSummaryLabel(...)`
calls with `formatSummaryRow(label, value, options)` where:
- `Test Files` value = `formatCountValue({ passed: passedTargets, failed:
  failedTargets }, totalTargets, { ...options, leadFailed: true })`,
- `Tests` value = `formatCountValue({ passed, failed, errors, warnings },
  totalTests, options)`,
- `Start at` value = `formatTimeValue(formatTime(startedAt), options)`,
- `Duration` value = `formatDurationValue(formatDuration(totalDurationMs),
  undefined, options)`.
Preserve exact plain strings for the color-off path.

### Step 3 — Extract summary
In `renderExtractSummary` (`extract/output.ts`): prepend (after the leading
`""`) `formatSummaryRow("Extract Files", formatCountValue({ passed:
succeededCount, failed: propsErroredCount }, totalTargets, { ...options,
leadFailed: true }), options)` and `formatSummaryRow("Start at",
formatTimeValue(formatTime(options.startedAt), options), options)`, then the
existing `Duration` (via `formatSummaryRow` + `formatDurationValue`) and
`Artifacts`. `succeeded` vs `propsErrored` is derived from each target's
`propsErrors.length`.

### Step 4 — Generate summary
In `renderGenerateSummary` (`generate/output.ts`): add `Generate Files`
(`formatCountValue({ passed: targetCount }, targetCount, options)`) and
`Start at`, then `Duration`/`Artifacts`, all via `formatSummaryRow`.

### Step 5 — `cli.ts`
Pass `startedAt` into the extract and generate summary option objects (check
already passes it). No other dispatch changes.

## 7. Per-step files to edit

- **1**: `src/cli/output.ts`.
- **2**: `src/cli/features/check/output.ts`.
- **3**: `src/cli/features/extract/output.ts`.
- **4**: `src/cli/features/generate/output.ts`.
- **5**: `src/cli/cli.ts`.
- **Tests**: `output.ts` helper unit tests; updates to extract/generate summary
  expectations for the new rows.

## 8. Acceptance criteria

1. With color enabled, all three summaries render: gray labels; green `passed`;
   red `failed`/`errors`; yellow `warnings`; dark-gray `(total)` and
   parentheticals; white times/durations.
2. With color disabled, summary text equals today's, plus the new
   `Extract Files` / `Generate Files` / `Start at` rows.
3. `formatSummaryLabel` is unchanged; `ci`/`replay`/`conform`/`export` output is
   unaffected.
4. Check summary keeps exact plain strings (`Test Files`, `Tests`,
   `M failed | N passed (T)`, `N passed (T)`) — existing tests pass unchanged.
5. No color escape codes leak into piped/non-TTY stdout.
6. `pnpm typecheck`, `pnpm test`, `pnpm fix`, `pnpm architecture` pass.

## 9. Tests to add or update

- **New** `src/cli/output.test.ts` (or extend existing): with `{ color: true }`,
  assert `formatSummaryRow`/`formatCountValue`/`formatTimeValue`/
  `formatDurationValue` wrap segments in the expected `ANSI` codes; with color
  off, assert byte-identical plain strings.
- **Update** `extract/command.output.test.ts`: assert the new `Extract Files`
  and `Start at` rows (color off) and that `Duration` still appears.
- **New/Update** `generate/command.test.ts`: assert `Generate Files` + `Start at`
  + `Duration` rows.
- Keep `check/command.test.ts` summary assertions green unchanged (plain path).

## 10. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm fix
rtk pnpm architecture
# manual: visually confirm colors in a TTY and clean output when piped
FORCE_COLOR=1 rtk pnpm --filter <example> exec modality check
rtk pnpm --filter <example> exec modality check | cat   # no escape codes
```

## 11. Risks, ambiguities, and stop conditions

- **Backward-compat**: do not change `formatSummaryLabel`; five commands depend
  on it. Add `formatSummaryRow` instead. If tempted to refactor the shared
  helper, stop and keep the additive path.
- **Plain-text drift**: the check summary strings are pinned by tests
  (`Test Files`, `Tests`, count phrasings). `formatCountValue` must reproduce
  them exactly with color off; run `pnpm test` after Step 2.
- **Color leakage**: gate every colorization with `useColor(options)` and ensure
  `shouldUseColor()` drives it from `cli.ts`; any escape codes in piped stdout
  are a blocker.
- **`leadFailed` ordering**: the check `Test Files` row uses
  `failed | passed` ordering while `Tests` uses `passed, failed`; keep both via
  the `leadFailed` flag rather than hard-coding, to match current output.
```
