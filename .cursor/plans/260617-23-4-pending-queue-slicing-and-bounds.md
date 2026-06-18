# Pending Queue Slicing and Bound Diagnostics

Status: implementation plan.
Date: 2026-06-17.
Plan family: H - State-Space Economics.
Depends on:

- `260617-23-1-shared-state-space-economics-diagnostics.md`
- `260617-23-2-structured-property-dependency-slicing.md`

## 1. Goal

Allow property slices that do not observe async operations to prune the pending
queue, while keeping pending queue retention and bounds visible when async facts
matter.

The end state is:

- `sys:pending` disappears from unrelated property slices;
- step predicates involving `enqueued`, `resolved`, `opId`, `continuation`, or
  `opArgs` retain the pending queue and explain why;
- enqueue/dequeue transitions retain pending state when they participate in the
  dependency closure;
- extraction reports list configured pending queue bounds as assumptions;
- check reports keep actual pending bound hits in `boundHits`.

## 2. Non-goals

- Do not split `sys:pending` into op-specific vars in this plan.
- Do not change async transition semantics.
- Do not change Rust bound-hit detection.
- Do not implement field-level pruning of pending args in this plan.
- Do not report pending bounds as actual hits unless the checker reports them.

## 3. Current-State Findings

- `src/cli/features/extract/command.ts#pendingVars()` synthesizes one
  `sys:pending` var with role `{ kind: "pending-queue" }`.
- The pending domain is a bounded list with `maxLen = bounds.maxPending`.
- `src/check/slicing/slice-model.ts#stepFactVars()` already maps step facts
  involving `enqueued`, `resolved`, `opId`, or `continuation` to the sole
  pending queue var.
- `stepFactVars()` does not currently consider `opArgs`.
- `enabledTransitionVars()` includes `effectReads()` and `effectWrites()`, so
  transitions with enqueue/dequeue effects can pull pending vars into a slice
  if those effects are reflected by effect read/write helpers.
- `src/check/types.ts#CheckResult.boundHits` exists and
  `src/cli/features/check/command.ts#createCheckReport()` writes it to the
  trust ledger.
- There is no structured pending retention diagnostic.
- `ReportTrustLedger.assumptions` currently includes source hashes only through
  `sourceHashAssumptions()`.

## 4. Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `stepFactVars()`
  - `solePendingQueueVarId()`
  - `sliceModelForProperty()`
  - `sliceModelForTargetedStepProperty()`
  - `enabledTransitionVars()`
- `src/check/types.ts`
  - `SliceSummary`
  - `CheckDiagnostics`
  - `CheckResult.boundHits`
- `src/check/check-model.ts`
  - `checkModelSliced()`
- `src/cli/features/extract/command.ts`
  - `pendingVars()`
  - `synthesizeSystemVars()`
  - `createExtractionReport()`
- `src/cli/features/check/command.ts`
  - `createCheckReport()`
  - `sourceHashAssumptions()`
  - `renderCheckResult()`
- `src/cli/features/check/output.ts`
  - `formatTargetStats()`
  - `renderTargetRows()`
- Tests:
  - `test/checker/checker.test.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/extract/command.test.ts`

## 5. Existing Patterns to Follow

- Keep pending queue identity role-based, not hard-coded only to
  `"sys:pending"`.
- Use existing `SystemVarRole.kind === "pending-queue"` to find queue vars.
- Keep configured bounds in trust-ledger assumptions and actual runtime hits in
  `boundHits`.
- Keep CLI human output compact.

## 6. Atomic Implementation Steps

1. Extend pending fact detection in `stepFactVars()` to include `opArgs`.

2. Add structured pending retention reasons, for example:

   ```ts
   export interface PendingQueueDependency {
     varId: string;
     reasons: readonly string[];
     opIds?: readonly string[];
     continuations?: readonly string[];
   }
   ```

3. Update property dependency collection from Plan 2 so a step predicate with
   pending facts records pending reasons:

   - `enqueued`;
   - `resolved`;
   - `opId`;
   - `continuation`;
   - `opArgs`.

4. Thread pending dependency metadata through `sliceModelForCheckProperty()` and
   `checkModelSliced()` into `SliceSummary`.

5. In `sliceModelForProperty()`, ensure pending queue vars are retained only
   when they appear in the dependency closure or were explicitly required by
   pending step facts. Do not special-case `sys:pending` as always retained.

6. Audit `effectReads()` and `effectWrites()` behavior for `enqueue` and
   `dequeue`. If they do not mark the pending queue, update them in the core
   effect helper module so enqueue/dequeue transitions participate in closure
   soundly.

7. Add configured pending bound assumptions to extraction and check reports.
   Suggested stable string: `bound:maxPending=<n>`.

8. Keep check `boundHits` unchanged. If a check hits a pending bound, the
   existing native checker result should continue to populate
   `CheckResult.boundHits`.

9. Update check human output only to show compact bound information if tests
   already cover a line for bound hits. Otherwise, leave human output focused
   on existing `search-limit` and stats lines.

## 7. Per-Step Files to Edit

- Step 1, 3-5:
  - `src/check/slicing/slice-model.ts`
- Step 2, 4:
  - `src/check/types.ts`
  - `src/check/check-model.ts`
  - `src/core/report/types.ts`
- Step 6:
  - core IR effect helper file that exports `effectReads()` / `effectWrites()`
    from `modality-ts/core`
- Step 7-8:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/check/command.ts`
- Step 9:
  - `src/cli/features/check/output.ts` only if needed

## 8. Acceptance Criteria

- Properties unrelated to async operations slice away the pending queue.
- Properties using `resolved`, `opId`, `continuation`, `enqueued`, or `opArgs`
  retain the pending queue and report why.
- Enqueue/dequeue transitions that matter to a property retain pending state
  through normal dependency closure.
- Extraction and check reports include configured pending bounds as assumptions.
- Actual bound hits remain represented only by `CheckResult.boundHits` and
  `trustLedger.boundHits`.

## 9. Tests to Add or Update

- `test/checker/checker.test.ts`
  - Property unrelated to async state prunes the pending queue.
  - Property with `resolved` or `opId` retains the pending queue.
  - Property with `opArgs` retains the pending queue.
- `src/cli/features/check/command.test.ts`
  - Check report slice summary includes pending queue dependency reasons.
  - Check report trust ledger includes `bound:maxPending=<n>` assumption.
- `src/cli/features/extract/command.test.ts`
  - Extraction report trust data or assumptions include configured pending
    bounds if extraction reports expose assumptions after this plan.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run test/checker/checker.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
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

- Stop and report if `effectReads()`/`effectWrites()` cannot identify pending
  queue effects without model context. Add a minimal model-aware bridge rather
  than hard-coding only `sys:pending` in multiple places.
- Stop and report if pruning pending state changes behavior for a property that
  observes async facts. Fix dependency tracking before continuing.
- Stop and report if extraction reports do not currently have an assumptions
  field. Either add one intentionally to report schema or limit assumptions to
  check reports and document the follow-up.

## 12. Must Not Change

- Do not split pending queues per op in this plan.
- Do not suppress bound hits.
- Do not treat configured bounds as failures.
- Do not retain pending state globally just to avoid adding diagnostics.
