# Model Slack Trust Ledger

Status: implementation plan.
Date: 2026-06-17.
Plan family: I - Trust Ledger and Documentation.
Depends on: none.

## 1. Goal

Make `model-slack` a first-class typed caveat bucket in extraction reports,
check reports, artifact validation, and CI trust-ledger comparisons.

The end state is:

- `partitionCaveats()` returns `modelSlack`;
- extraction reports include `modelSlack`;
- check report trust ledgers include `modelSlack`;
- artifact parsers validate the new bucket;
- CI trust comparisons detect added model-slack caveats;
- warning strings remain human text only.

## 2. Non-goals

- Do not migrate all source warnings to structured caveats in this plan.
- Do not add property-level confidence in this plan.
- Do not change caveat severity semantics.
- Do not remove existing warning text output.
- Do not edit generated `dist/`.

## 3. Current-State Findings

- `src/core/ir/types.ts#CaveatKind` already includes `"model-slack"`.
- `src/extract/engine/ts/caveats.ts#modelSlackCaveat()` already constructs
  model-slack caveats.
- `src/extract/engine/ts/caveats.ts#partitionCaveats()` currently ignores
  `model-slack`.
- `src/cli/features/extract/command.ts` creates model-slack caveats for wide
  numeric and product domains.
- `src/cli/features/extract/command.ts#createExtractionReport()` uses
  `partitionCaveats()` and therefore drops model slack from typed report
  buckets.
- `src/cli/features/check/command.ts#createCheckReport()` writes typed caveat
  buckets to `trustLedger` through `partitionExtractionCaveats()`, but there is
  no `modelSlack` field.
- `src/core/artifacts/index.ts` validates typed caveat buckets but not
  `modelSlack`.
- `src/cli/features/ci/command.ts#compareTrustLedger()` compares existing
  caveat buckets but not model slack.

## 4. Exact File Paths and Relevant Symbols

- `src/extract/engine/ts/caveats.ts`
  - `modelSlackCaveat()`
  - `partitionCaveats()`
  - `compareCaveats()`
- `src/core/report/types.ts`
  - `ReportTrustLedger`
  - `ExtractionReport`
  - `CheckReport`
- `src/core/artifacts/index.ts`
  - `parseCheckReportArtifact()`
  - `parseExtractionReportArtifact()`
- `src/cli/features/extract/command.ts`
  - `createExtractionReport()`
  - `wideNumericReachabilityWarnings()`
  - `wideProductDomainReachabilityWarnings()`
- `src/cli/features/check/command.ts`
  - `createCheckReport()`
  - `partitionExtractionCaveats()`
- `src/cli/features/ci/command.ts`
  - `compareTrustLedger()`
  - `caveatKeys()`
- Tests:
  - `test/kernel/artifacts.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/ci/command.test.ts`

## 5. Existing Patterns to Follow

- Keep typed caveat partitioning in `src/extract/engine/ts/caveats.ts`.
- Sort caveats with `compareCaveats()`.
- Validate report artifacts by checking required arrays in
  `src/core/artifacts/index.ts`.
- Compare caveats in CI by stable `id`, `reason`, and optional source data.

## 6. Atomic Implementation Steps

1. Extend `partitionCaveats()` return type with:

   ```ts
   modelSlack: ExtractionCaveat[];
   ```

   Push `entry.kind === "model-slack"` into that bucket instead of ignoring it.

2. Add `modelSlack` to `ReportTrustLedger` in `src/core/report/types.ts`.

3. Add `modelSlack` to `ExtractionReport` in `src/core/report/types.ts`.

4. Update `src/cli/features/extract/command.ts#createExtractionReport()` to
   include `modelSlack: partitioned.modelSlack`.

5. Update `src/cli/features/check/command.ts#createCheckReport()` to include
   `trustLedger.modelSlack`.

6. Avoid repeated partitioning in `createCheckReport()` if practical:

   - compute `const caveats = partitionExtractionCaveats(model)` once;
   - use `caveats.globalTaints`, `caveats.modelSlack`, etc.

7. Update artifact parsers:

   - `parseCheckReportArtifact()` requires
     `value.trustLedger.modelSlack` as an array;
   - `parseExtractionReportArtifact()` requires `value.modelSlack` as an
     array.

8. Update CI trust-ledger comparison to include `modelSlack`.

9. Update tests and snapshots to include empty `modelSlack: []` where reports
   are constructed manually.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/extract/engine/ts/caveats.ts`
- Step 2-3:
  - `src/core/report/types.ts`
- Step 4:
  - `src/cli/features/extract/command.ts`
- Step 5-6:
  - `src/cli/features/check/command.ts`
- Step 7:
  - `src/core/artifacts/index.ts`
- Step 8:
  - `src/cli/features/ci/command.ts`
- Step 9:
  - `test/kernel/artifacts.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/ci/command.test.ts`

## 8. Acceptance Criteria

- Extraction reports contain `modelSlack`, including caveats from wide numeric
  and wide product domains.
- Check report trust ledgers contain `modelSlack` from
  `model.metadata.extractionCaveats`.
- Artifact parsers reject reports missing the new required `modelSlack` bucket.
- CI trust comparison reports added or increased `modelSlack` caveats.
- No production report code parses warning strings to identify model slack.

## 9. Tests to Add or Update

- `test/kernel/artifacts.test.ts`
  - Check report parser requires `trustLedger.modelSlack`.
  - Extraction report parser requires `modelSlack`.
- `src/cli/features/extract/command.test.ts`
  - Wide numeric or product domain emits typed `modelSlack`.
- `src/cli/features/check/command.test.ts`
  - Check report includes model slack from model metadata.
- `src/cli/features/ci/command.test.ts`
  - CI detects an added model-slack caveat between baseline and current report.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run test/kernel/artifacts.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/ci/command.test.ts
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

- Stop and report if any report fixture is intentionally schema-versioned as an
  older artifact. This project does not require backward compatibility, but
  tests should not accidentally mix schemas.
- Stop and report if model slack caveats are too broad to compare usefully.
  They need stable ids and specific reasons.
- Stop and report if adding required fields breaks external generated artifacts
  under `dist/`; do not edit generated artifacts.

## 12. Must Not Change

- Do not remove human warnings.
- Do not change caveat severity values.
- Do not downgrade verdicts in this plan.
- Do not parse warning strings for model-slack identities.
