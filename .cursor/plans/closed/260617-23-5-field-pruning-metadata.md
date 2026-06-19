# Field Pruning Metadata

Status: implementation plan.
Date: 2026-06-17.
Plan family: H - State-Space Economics.
Depends on:

- `260617-23-1-shared-state-space-economics-diagnostics.md`
- `260617-23-2-structured-property-dependency-slicing.md`

## 1. Goal

Add structured metadata for record-field pruning so reports can explain which
paths are kept or pruned without needing to change all domain shapes in the
same step.

The end state is:

- model metadata records field-pruning entries per state var;
- extraction can report kept and pruned record paths for nested object domains;
- property-slice contributor diagnostics can mention pruned field paths
  separately from whole-var pruning;
- any lossy field collapse or omission that may add behavior emits a structured
  `model-slack` caveat.

## 2. Non-goals

- Do not require full record-domain rewriting in this plan.
- Do not change checker state encoding unless field-domain pruning is small and
  fully validated.
- Do not infer reads from arbitrary runtime code.
- Do not add framework-specific field metadata to core IR.
- Do not weaken validator footprint checks.

## 3. Current-State Findings

- `ExprIR.read` and `ExprIR.readPre` support optional `path`.
- `EffectIR.assign` writes a whole var but may carry `updateField` expressions
  that expose nested path writes.
- `src/core/ir/types.ts#Model.metadata` currently supports source hashes,
  plugins, domain provenance, extraction caveats, and numeric reductions.
- `src/core/report/types.ts#StateSpaceContributor` is var-level only.
- `src/core/ir/domains.ts` has helpers such as `collectTokenDomainPaths()`.
- `src/cli/features/extract/command.ts` already reports `coarseDomains` using
  token domain paths.
- No current report schema exposes kept/pruned field paths.
- The original combined plan allows a metadata-only first pass if changing
  domain shapes is too large.

## 4. Exact File Paths and Relevant Symbols

- `src/core/ir/types.ts`
  - `Model.metadata`
  - `ExprIR`
  - `EffectIR`
  - `ExtractionCaveat`
- `src/core/report/types.ts`
  - `StateSpaceContributor`
  - `StateSpaceContributors`
  - `CheckReportDiagnostics`
  - `ExtractionReport`
- `src/core/ir/domains.ts`
  - `collectTokenDomainPaths()`
  - record domain helpers
- `src/extract/engine/ts/type-domains.ts`
- `src/extract/engine/ts/domains.ts`
- `src/extract/engine/ts/transition/expressions.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- `src/cli/features/extract/command.ts`
  - `createExtractionReport()`
  - `wideProductDomainReachabilityWarnings()`
- `src/cli/features/check/command.ts`
  - `createCheckReport()`
- Tests:
  - tests under `test/extract/`
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/check/command.test.ts`

## 5. Existing Patterns to Follow

- Keep domain and metadata types in `src/core/ir/types.ts`.
- Keep report schema types in `src/core/report/types.ts`.
- Reuse existing expression path information instead of parsing source text.
- Use `modelSlackCaveat()` for imprecision that can affect behavior.
- Prefer metadata-first delivery over a risky domain-shape rewrite.

## 6. Atomic Implementation Steps

1. Add field-pruning metadata types to `src/core/ir/types.ts`, for example:

   ```ts
   export interface FieldPruningEntry {
     varId: string;
     keptPaths: readonly string[][];
     prunedPaths: readonly string[][];
     reason: "unread" | "property-unrelated" | "bounded-record";
     source?: SourceAnchor;
     confidence: "exact" | "over-approx";
   }

   export interface FieldPruningMetadata {
     entries: readonly FieldPruningEntry[];
   }
   ```

   Add `fieldPruning?: FieldPruningMetadata` to `Model.metadata`.

2. Add report-facing field pruning types to `src/core/report/types.ts` if the
   IR metadata shape should not be exposed directly. Otherwise, re-export or
   reference `FieldPruningEntry`.

3. Add small helpers for field path collection:

   - collect paths read by `ExprIR.read` and `ExprIR.readPre`;
   - collect paths mentioned by `updateField`;
   - collect paths read by guards, effects, derived values, pending args, and
     mount guards.

4. During extraction, populate `model.metadata.fieldPruning.entries` for record
   vars where kept/pruned paths can be derived from structured IR. Start with
   a focused fixture path:

   - one nested object var;
   - a property or transition reads `session.user.id`;
   - unrelated paths such as `session.user.avatarUrl` are reported as pruned.

5. Keep current full-record domains if safe domain pruning would require large
   validator or checker changes. Metadata plus caveats is the minimum
   deliverable.

6. If a field is collapsed to token identity, omitted from a property slice, or
   approximated in a way that can add behavior, emit `modelSlackCaveat()` with a
   stable id such as `field:<varId>:<path>`.

7. Extend slice contributor diagnostics from Plan 1 with optional
   `prunedFieldPaths` or a similar field. Keep it additive and deterministic.

8. Include field-pruning metadata in extraction and check reports if report
   schemas expose it. If it remains only in model metadata, ensure reports at
   least expose relevant model-slack caveats.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/core/ir/types.ts`
- Step 2, 7-8:
  - `src/core/report/types.ts`
  - `src/check/types.ts`
  - `src/check/check-model.ts`
- Step 3-4:
  - `src/extract/engine/ts/type-domains.ts`
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/ts/transition/expressions.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - or a new focused helper under `src/extract/engine/ts/`
- Step 5-6:
  - `src/cli/features/extract/command.ts`
  - `src/extract/engine/ts/caveats.ts` only if a more specific constructor is
    needed
- Step 8:
  - `src/cli/features/check/command.ts`

## 8. Acceptance Criteria

- Model metadata identifies kept and pruned record paths for at least one
  nested object fixture.
- A property reading `session.user.id` keeps that path and can report unrelated
  fields such as `session.user.avatarUrl` as pruned.
- Any behavior-widening field collapse or omission has a structured
  `model-slack` caveat.
- Check/extraction report data does not imply exact field pruning when the
  implementation only records metadata.
- Validator and checker tests still pass.

## 9. Tests to Add or Update

- Tests under `test/extract/`
  - Nested object fixture with read path and unrelated path.
  - Assert `model.metadata.fieldPruning.entries` contains stable kept/pruned
    paths.
- `src/cli/features/extract/command.test.ts`
  - Assert extraction report or model metadata exposes field pruning.
  - Assert model-slack caveat appears for an over-approx field collapse.
- `src/cli/features/check/command.test.ts`
  - Assert per-slice diagnostics include pruned field paths when applicable.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run test/extract
```

Run broad validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if actual domain-shape pruning would require broad changes to
  checker validation or replay witness generation. Land metadata and caveats
  first.
- Stop and report if path collection cannot distinguish field reads from whole
  var reads. Treat whole-var reads as keeping all known paths.
- Stop and report if field metadata would require framework-specific concepts
  in core IR.
- Stop and report if a caveat id cannot be made stable across runs.

## 12. Must Not Change

- Do not change checker semantics without dedicated tests.
- Do not silently drop record fields from domains.
- Do not report approximate field pruning as exact.
- Do not parse TypeScript source text in report-building code to recover field
  paths.
