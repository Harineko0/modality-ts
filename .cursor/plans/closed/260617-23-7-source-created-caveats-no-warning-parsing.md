# Source-Created Caveats and No Warning Parsing

Status: implementation plan.
Date: 2026-06-17.
Plan family: I - Trust Ledger and Documentation.
Depends on: `260617-23-6-model-slack-trust-ledger.md`.

## 1. Goal

Ensure trust data is created as structured caveats at the source of imprecision,
not recovered later by parsing warning strings.

The end state is:

- unextractable handlers, global taints, stale reads, unhandled rejections, and
  model slack are emitted as `ExtractionWarning.caveat` when they are created;
- production report-building code does not parse warning text for trust data;
- plain string warnings remain allowed only for informational messages that do
  not affect trust, confidence, or coverage;
- architecture tests prevent reintroducing warning-string parsing.

## 2. Non-goals

- Do not remove all human warning messages.
- Do not redesign `ExtractionWarning`.
- Do not change source plugin discovery or extraction semantics beyond adding
  structured caveats.
- Do not add new trust-ledger buckets beyond `modelSlack` from Plan 6.
- Do not edit generated `dist/`.

## 3. Current-State Findings

- `src/extract/engine/ts/types.ts#ExtractionWarning` supports `message` and an
  optional `caveat`.
- `src/cli/features/extract/command.ts#createExtractionCaveats()` already
  collects `warning.caveat`.
- `src/cli/features/extract/command.ts#dedupeUnextractableHandlers()` already
  consumes `warning.caveat?.kind === "unextractable"`.
- `unextractableHandlerFromWarning()` is not present in the current inspected
  `src/cli/features/extract/command.ts`, so do not ask Composer to delete it
  unless it reappears.
- `src/extract/engine/pipeline/index.ts` does not currently define
  `pluginSafetyWarning()` in the inspected code.
- Several extraction paths still emit warning text containing
  `Unextractable handler ...`; migrate these to structured
  `unextractable` caveats.
- Some source adapters already create structured `modelSlackCaveat()` entries.
- Current tests still assert warning strings in places; update them to assert
  structured caveats where the warning represents trust data.

## 4. Exact File Paths and Relevant Symbols

- `src/extract/engine/ts/types.ts`
  - `ExtractionWarning`
- `src/extract/engine/ts/caveats.ts`
  - `globalTaintCaveat()`
  - `unextractableHandlerCaveat()`
  - `unextractableEffectCaveat()`
  - `modelSlackCaveat()`
  - `caveatMessage()`
- `src/extract/engine/ts/react-source-transitions.ts`
  - warning objects with `Unextractable handler`
- `src/extract/engine/ts/transition/async.ts`
  - warning objects with `Unextractable handler`
- `src/extract/engine/ts/transition/handlers.ts`
  - warning objects with `Unextractable handler`
- `src/extract/engine/ts/transition/router-submit.ts`
  - warning objects with `Unextractable handler`
- Source adapters that may emit trust-relevant warnings:
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/hydration.ts`
  - `src/extract/sources/jotai/transitions.ts`
  - `src/extract/sources/zustand/writes.ts`
  - `src/extract/sources/zustand/discover.ts`
  - `src/extract/sources/zustand/transitions.ts`
  - `src/extract/sources/next/routes.ts`
  - `src/extract/sources/next/cache.ts`
  - `src/extract/sources/next/config.ts`
  - `src/extract/sources/next/server-effects.ts`
  - `src/extract/sources/router/server-effects.ts`
  - `src/extract/sources/swr/transitions.ts`
- Tests:
  - `test/extraction/architecture.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - focused source tests under `test/sources/*` and
    `src/extract/sources/*/*.test.ts`

## 5. Existing Patterns to Follow

- Use caveat constructors from `src/extract/engine/ts/caveats.ts`.
- Keep `ExtractionWarning.message` as human-readable text.
- Store machine-readable trust identity in `ExtractionWarning.caveat`.
- Sort caveats with `compareCaveats()` when reports assemble them.
- Use architecture tests to block fragile production patterns.

## 6. Atomic Implementation Steps

1. Search production source for warning parsing and trust-relevant warning text:

   ```bash
   rtk grep "Unextractable handler|Global taint|startsWith\\(\"Global taint|warning\\.message|\\.match\\(|\\.exec\\(" src
   ```

   Inspect matches manually. Do not flag regexes unrelated to warning parsing.

2. For each `Unextractable handler ...` warning object, add an
   `unextractableHandlerCaveat()` or `unextractableEffectCaveat()` with:

   - stable handler id;
   - specific category reason;
   - source anchor when available.

3. For source warnings that represent global taint, create
   `globalTaintCaveat()` at the source. Do not recreate old `"Global taint "`
   prefix parsing.

4. For bounded approximations that represent model slack, use
   `modelSlackCaveat()` with a stable id and specific reason.

5. Keep informational warnings as `{ message }` only when they do not affect
   trust, confidence, or coverage.

6. Add or update an architecture test in `test/extraction/architecture.test.ts`
   that fails on production warning-string trust parsing. Suggested checks:

   - no production function named `unextractableHandlerFromWarning`;
   - no production function named `pluginSafetyWarning`;
   - no `startsWith("Global taint")`;
   - no regex parsing of `warning.message` in report-building files.

7. Update tests to assert structured caveats. Keep at most one human-output
   assertion per warning family to ensure user-facing warning text still exists.

## 7. Per-Step Files to Edit

- Step 1:
  - no edits; inspect search output
- Step 2:
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/ts/transition/async.ts`
  - `src/extract/engine/ts/transition/handlers.ts`
  - `src/extract/engine/ts/transition/router-submit.ts`
- Step 3-4:
  - source warning/caveat producer files listed in section 4
  - `src/extract/engine/ts/caveats.ts` only if a missing constructor is needed
- Step 5:
  - source warning producers listed above
- Step 6:
  - `test/extraction/architecture.test.ts`
- Step 7:
  - `src/cli/features/extract/command.test.ts`
  - source-specific tests under `test/sources/*` and
    `src/extract/sources/*/*.test.ts`

## 8. Acceptance Criteria

- Production report code does not parse warning strings to create caveats or
  trust identities.
- Every unextractable handler that appears in extraction reports comes from a
  structured `unextractable` caveat.
- Every global taint in reports comes from a structured `global-taint` caveat.
- Existing human warnings still appear for users.
- Architecture tests fail if warning parsing is reintroduced.

## 9. Tests to Add or Update

- `test/extraction/architecture.test.ts`
  - No production trust-ledger regex parsing of warning strings.
  - No `unextractableHandlerFromWarning` or `pluginSafetyWarning`.
- `src/cli/features/extract/command.test.ts`
  - Unextractable handler report entries come from caveats.
  - Warning messages still include useful human text.
- Source-specific tests:
  - Jotai/Zustand global taint or approximation warnings include caveats.
  - Next cache/config approximations include `model-slack` where appropriate.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run test/extraction/architecture.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run test/sources/jotai/jotai-source.test.ts
rtk pnpm vitest run test/sources/zustand/zustand-source.test.ts
rtk pnpm vitest run src/extract/sources/next/cache.test.ts
rtk pnpm vitest run src/extract/sources/next/config.test.ts
```

Run broad validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if a warning lacks a stable handler id or source anchor. Add
  the missing structured data at the extraction source rather than parsing the
  message later.
- Stop and report if a regex over `warning.message` is informational and not
  trust-related. Keep the architecture test targeted to trust-ledger paths.
- Stop and report if a source plugin cannot emit structured caveats with the
  current SPI shape. Add the smallest SPI shape needed instead of preserving
  parser compatibility.

## 12. Must Not Change

- Do not remove human-readable warning messages.
- Do not preserve compatibility warning parsers once structured caveats exist.
- Do not encode trust identity only in strings.
- Do not add broad source-adapter refactors unrelated to caveat creation.
