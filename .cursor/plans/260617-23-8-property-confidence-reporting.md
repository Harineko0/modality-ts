# Property Confidence Reporting

Status: implementation plan.
Date: 2026-06-17.
Plan family: I - Trust Ledger and Documentation.
Depends on:

- `260617-23-1-shared-state-space-economics-diagnostics.md`
- `260617-23-2-structured-property-dependency-slicing.md`
- `260617-23-6-model-slack-trust-ledger.md`

## 1. Goal

Add property-level confidence metadata to check results and reports so a
verified property is not presented as plain exact verification when it depends
on approximations, model slack, numeric reductions, manual transitions, or
bound hits.

The end state is:

- each report verdict can carry structured confidence metadata;
- exact properties remain uncluttered in human output;
- non-exact properties show compact confidence reasons;
- confidence is derived from existing model, property, slice, and check result
  data without rerunning extraction.

## 2. Non-goals

- Do not add AI or probabilistic confidence.
- Do not weaken verdict statuses for actual violations.
- Do not rerun extraction during checking.
- Do not hide existing numeric reduction downgrades.
- Do not make search-limit errors look exact.

## 3. Current-State Findings

- `src/core/report/types.ts#ReportPropertyVerdict` has no confidence field.
- `src/check/types.ts#PropertyVerdict` has no confidence field.
- `src/cli/features/check/command.ts#reportVerdict()` downgrades verified
  verdicts only through numeric reductions.
- `downgradeVerdictForReductions()` and `reductionsAffectingProperty()` already
  exist in numeric abstraction code.
- `src/cli/features/check/command.ts#collectCheckNumericReductions()` computes
  property-related dropped reductions using `sliceModelForProperty()`.
- `createCheckReport()` has access to the model, check result, and properties.
- Plan 1 should add per-slice retained/pruned contributors.
- Plan 6 should expose `modelSlack` in the trust ledger.
- `src/cli/features/check/output.ts#renderTargetRows()` prints one line per
  property verdict.

## 4. Exact File Paths and Relevant Symbols

- `src/core/report/types.ts`
  - `ReportPropertyVerdict`
  - `ReportVerdictStatus`
  - `ReportTrustLedger`
- `src/check/types.ts`
  - `PropertyVerdict`
  - `CheckDiagnostics`
  - `SliceSummary`
- `src/check/check-model.ts`
  - `checkModelSliced()`
- `src/cli/features/check/command.ts`
  - `createCheckReport()`
  - `collectCheckNumericReductions()`
  - `reportVerdict()`
  - `renderCheckResult()`
- `src/cli/features/check/output.ts`
  - `renderTargetRows()`
  - `verdictStatusKind()`
- Numeric helpers:
  - `downgradeVerdictForReductions()`
  - `reductionsAffectingProperty()`
  - `numericCoiDroppedReductions()`
- Tests:
  - `src/cli/features/check/command.test.ts`
  - `test/checker/checker.test.ts`

## 5. Existing Patterns to Follow

- Keep report schema shapes in `src/core/report/types.ts`.
- Keep checker internals independent from CLI rendering.
- Reuse numeric reduction claim semantics.
- Derive relevance through property dependency/slice data, not warning text.
- Keep human output compact and only show confidence when not exact.

## 6. Atomic Implementation Steps

1. Add a report confidence type to `src/core/report/types.ts`, for example:

   ```ts
   export type ReportPropertyConfidenceLevel =
     | "exact"
     | "property-preserving"
     | "over-approx"
     | "manual"
     | "bounded"
     | "heuristic";

   export interface ReportPropertyConfidence {
     level: ReportPropertyConfidenceLevel;
     reasons: readonly string[];
     caveatIds: readonly string[];
     affectedTransitions: readonly string[];
     affectedVars: readonly string[];
   }
   ```

   Add `confidence?: ReportPropertyConfidence` to
   `ReportPropertyVerdict`.

2. Decide whether `src/check/types.ts#PropertyVerdict` also needs confidence.
   Prefer adding confidence only at report assembly first, unless human output
   from raw `CheckResult` needs it.

3. Add a helper in `src/cli/features/check/command.ts`, such as
   `propertyConfidence(model, check, property, numericReductions)`, that
   considers:

   - relevant numeric reductions and their claims;
   - retained over-approx transitions;
   - retained manual transitions;
   - relevant `modelSlack` caveats;
   - actual bound hits;
   - search limit diagnostics for the run.

4. Reuse structured dependency data from Plan 2:

   - compute the property slice;
   - inspect transitions retained in that slice;
   - inspect vars retained in that slice;
   - match model-slack caveats by affected var id where possible.

5. Define confidence level precedence deterministically. Suggested order from
   strongest concern to weakest:

   - `heuristic`;
   - `manual`;
   - `over-approx`;
   - `bounded`;
   - `property-preserving`;
   - `exact`.

6. Update `reportVerdict()` to attach confidence metadata. Keep existing
   numeric reduction downgrade behavior:

   - if numeric reductions already downgrade to `vacuous-warning`, preserve
     that status and include confidence reasons;
   - if verdict is violated/reachable, include confidence only when useful for
     replay/trust context.

7. Update `src/cli/features/check/output.ts` and deprecated
   `renderCheckResult()` only enough to show compact non-exact confidence, for
   example:

   ```text
   confidence=over-approx reasons:2
   ```

8. Update report artifact parser tests. Artifact parser implementation may not
   need deep validation unless this repo validates optional nested shapes
   elsewhere.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/core/report/types.ts`
- Step 2:
  - `src/check/types.ts` only if needed
- Step 3-6:
  - `src/cli/features/check/command.ts`
  - `src/check/slicing/slice-model.ts` only if a public dependency helper is
    needed
- Step 7:
  - `src/cli/features/check/output.ts`
  - `src/cli/features/check/command.ts` deprecated renderer if tests cover it
- Step 8:
  - `test/kernel/artifacts.test.ts`
  - `src/cli/features/check/command.test.ts`

## 8. Acceptance Criteria

- Check report verdicts can carry confidence metadata.
- Exact properties either omit `confidence` or report `level: "exact"` based on
  a documented consistent choice.
- Properties affected by model slack, numeric reductions, manual transitions,
  over-approx transitions, bound hits, or search limits are visibly annotated.
- Human output remains compact and only shows confidence when non-exact.
- No report code parses warning strings to compute confidence.

## 9. Tests to Add or Update

- `src/cli/features/check/command.test.ts`
  - Report verdict includes confidence for over-approx transition.
  - Report verdict includes confidence for manual transition.
  - Report verdict includes confidence for relevant model-slack caveat.
  - Numeric reduction downgrade still happens and confidence reasons are
    included.
  - Human output shows compact non-exact confidence.
- `test/checker/checker.test.ts`
  - Bound-hit or search-limit fixture produces confidence metadata if that is
    computed at checker level.
- `test/kernel/artifacts.test.ts`
  - Optional confidence shape is accepted in check report artifacts.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run test/checker/checker.test.ts
rtk pnpm vitest run test/kernel/artifacts.test.ts
```

Run broad validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm phase7
rtk pnpm fix
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if confidence cannot be computed from model, property, slice,
  and check result data. Do not rerun extraction.
- Stop and report if model-slack caveats cannot be matched to affected vars or
  properties. Include caveat ids at global confidence scope only if the
  behavior is documented and tested.
- Stop and report if confidence metadata conflicts with existing numeric
  downgrade semantics. Preserve existing downgrade behavior and layer
  confidence on top.
- Stop and report if human output becomes noisy for exact properties.

## 12. Must Not Change

- Do not change violation/reachable trace semantics.
- Do not claim heuristic or model-slack proofs are exact.
- Do not use warning text to compute confidence.
- Do not add AI-assisted confidence.
