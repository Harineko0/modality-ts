# Shared State-Space Economics Diagnostics

Status: implementation plan.
Date: 2026-06-17.
Plan family: H - State-Space Economics.
Depends on: none.

## 1. Goal

Create one shared implementation for state-space contributor economics and use
it from both extraction reports and sliced check diagnostics.

The end state is:

- extraction report `stateContributors` keeps the same semantics it has today;
- check slicing diagnostics expose retained/pruned contributor summaries for
  each slice group;
- contributor math is no longer duplicated in CLI report-building code;
- per-slice economics are computed from the actual full model and sliced model
  used by the checker.

## 2. Non-goals

- Do not change the checker search algorithm.
- Do not change `AbstractDomain` shapes or domain cardinality semantics.
- Do not implement property dependency inference in this plan.
- Do not add field-level pruning metadata in this plan.
- Do not edit generated `dist/`.
- Do not preserve compatibility if an existing private helper shape becomes
  misleading; this project is experimental.

## 3. Current-State Findings

- `src/cli/features/extract/command.ts#buildStateContributors()` computes
  full-model contributors directly inside the extract CLI command.
- `buildStateContributors()` uses `domainCardinality()` and reports
  `totalBits`, `topVars`, and `bySource`.
- `src/core/report/types.ts` already defines `StateSpaceContributor` and
  `StateSpaceContributors`.
- `src/check/check-model.ts#checkModelSliced()` groups identical property
  slices and builds `SliceSummary` entries with counts only.
- `src/check/types.ts#SliceSummary` has no retained/pruned bit counts or
  contributor fields.
- `src/core/report/types.ts#CheckReportDiagnostics.slicing.sliceSummaries`
  duplicates a narrower shape and currently omits `mode`.
- `src/cli/features/check/command.ts#createCheckReport()` copies
  `check.diagnostics` into the check report without transforming the shape.
- Extraction CLI human output already prints the top full-model contributor
  using `report.stateContributors`.

## 4. Exact File Paths and Relevant Symbols

- `src/cli/features/extract/command.ts`
  - `buildStateContributors()`
  - `createExtractionReport()`
  - `runExtractCommand()`
- `src/check/check-model.ts`
  - `checkModelSliced()`
  - `mergeSearchDiagnostics()`
- `src/check/types.ts`
  - `SliceSummary`
  - `CheckDiagnostics`
- `src/check/slicing/slice-model.ts`
  - `sliceModelForCheckProperty()`
- `src/core/report/types.ts`
  - `StateSpaceContributor`
  - `StateSpaceContributors`
  - `CheckReportDiagnostics`
- `src/core/ir/domains.ts`
  - `domainCardinality()`
- New file:
  - `src/check/slicing/contributors.ts`
- Tests:
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/check/command.test.ts`
  - `test/checker/checker.test.ts`

## 5. Existing Patterns to Follow

- Keep reusable IR/report helpers outside CLI feature modules.
- Keep slicing-specific helpers under `src/check/slicing/`.
- Use `domainCardinality()` as the single source of truth for state-space bit
  estimates.
- Keep contributor ordering deterministic: descending bits, then stable var or
  source key.
- Keep report schema types in `src/core/report/types.ts`; checker internals
  should import or mirror those public shapes intentionally.

## 6. Atomic Implementation Steps

1. Add `src/check/slicing/contributors.ts`.

   Export a helper such as:

   ```ts
   export interface ModelEconomics {
     contributors: StateSpaceContributors;
   }

   export interface SliceEconomics {
     retainedBits: number;
     prunedBits: number;
     topContributors: readonly StateSpaceContributor[];
     prunedTopContributors: readonly StateSpaceContributor[];
     retainedSystemVars: readonly string[];
     prunedSystemVars: readonly string[];
   }

   export function buildStateContributors(model: Model): StateSpaceContributors;
   export function compareModelEconomics(full: Model, slice: Model): SliceEconomics;
   ```

2. Move the existing contributor math from
   `src/cli/features/extract/command.ts#buildStateContributors()` into the new
   module. Preserve:

   - `bits = Math.log2(domainCardinality(domain))`;
   - `domainKind`;
   - `scope`;
   - `origin`;
   - top variable limiting behavior, unless tests reveal a different existing
     limit.

3. Implement `compareModelEconomics(full, slice)` by comparing var ids:

   - retained vars are vars present in both models;
   - pruned vars are vars present in `full` but absent from `slice`;
   - retained/pruned bits are the sums of the full-model contributor bits for
     those sets;
   - `retainedSystemVars` and `prunedSystemVars` are sorted ids for vars whose
     `origin === "system"` or `role` is present.

4. Update `src/cli/features/extract/command.ts` to import
   `buildStateContributors()` and delete its local implementation.

5. Extend `src/check/types.ts#SliceSummary` with optional fields:

   - `retainedBits`;
   - `prunedBits`;
   - `topContributors`;
   - `prunedTopContributors`;
   - `retainedSystemVars`;
   - `prunedSystemVars`.

6. Update `src/core/report/types.ts#CheckReportDiagnostics` so its
   `sliceSummaries` entry accepts the same added fields and includes `mode`.

7. In `src/check/check-model.ts#checkModelSliced()`, call
   `compareModelEconomics(model, group.model)` when building each
   `SliceSummary`.

8. Keep human check output unchanged in this plan unless tests need minor
   formatting updates. The primary deliverable is machine-readable diagnostics.

## 7. Per-Step Files to Edit

- Step 1-3:
  - `src/check/slicing/contributors.ts`
- Step 4:
  - `src/cli/features/extract/command.ts`
- Step 5:
  - `src/check/types.ts`
- Step 6:
  - `src/core/report/types.ts`
- Step 7:
  - `src/check/check-model.ts`
- Step 8:
  - `src/cli/features/check/output.ts` only if existing type checks require it

## 8. Acceptance Criteria

- Extraction report `stateContributors` remains present and semantically stable.
- Check diagnostics include per-slice retained/pruned bits and top contributors.
- Contributor code exists in one shared module, not duplicated between extract
  and check CLI code.
- Check report artifact types accept the extended slicing diagnostics.
- Existing tests that assert state contributor ordering still pass or are
  updated only for deterministic ordering improvements.

## 9. Tests to Add or Update

- `src/cli/features/extract/command.test.ts`
  - Assert `stateContributors` still reports top vars and `bySource`.
  - Assert ordering is deterministic.
- `src/cli/features/check/command.test.ts`
  - Add a sliced check report fixture and assert each slice summary includes
    `retainedBits`, `prunedBits`, `topContributors`, and
    `prunedTopContributors`.
- `test/checker/checker.test.ts`
  - Add a small model with one irrelevant high-cardinality var and assert the
    slice summary reports it as pruned.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run test/checker/checker.test.ts
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

- Stop and report if moving `buildStateContributors()` creates a dependency
  cycle between `src/check`, `src/core`, and `src/cli`. Move the helper to a
  more neutral existing core module instead of adding a cycle.
- Stop and report if `domainCardinality()` can throw for a domain shape used in
  normal extraction reports. Do not paper over this with `tokens` or `0` bits.
- Stop and report if slice diagnostics become nondeterministic because grouped
  slice ordering changes.
- Do not widen this plan into field-level or pending-queue pruning. Later plans
  rely on this contributor foundation.

## 12. Must Not Change

- Do not change domain cardinality math.
- Do not alter checker verdicts or search results.
- Do not add a second contributor implementation under CLI code.
- Do not modify docs in this plan except comments required by tests or types.
