# Route and Mount Pruning Diagnostics

Status: implementation plan.
Date: 2026-06-17.
Plan family: H - State-Space Economics.
Depends on:

- `260617-23-1-shared-state-space-economics-diagnostics.md`
- `260617-23-2-structured-property-dependency-slicing.md`

## 1. Goal

Make route and mount-scope pruning explainable in property-slice diagnostics.

The end state is:

- mount-local state retains only the mount guard dependencies needed for the
  property slice;
- route/history vars are pruned from unrelated slices when no retained
  transition or mount dependency requires them;
- slice diagnostics explain why route/mount dependencies were retained;
- route/mount pruning caveats are emitted only when the underlying extraction
  was approximate or bounded.

## 2. Non-goals

- Do not change navigation adapter APIs.
- Do not add new framework adapters.
- Do not implement pending queue pruning in this plan.
- Do not add field-pruning metadata in this plan.
- Do not weaken transition enabledness dependencies.

## 3. Current-State Findings

- `src/core/ir/types.ts#StateVarScope` supports `global` and `mount-local`.
- `src/check/slicing/slice-model.ts#addMountGuardVarsForNeededMountLocals()`
  adds mount guard reads when a mount-local var is needed.
- The same helper also adds mount-local vars when one of their guard reads is
  needed.
- Current diagnostics do not explain why a mount-local var or guard var was
  retained.
- The original combined plan referenced route-local vars, but the current IR
  has route state represented through system roles such as
  `location-current`, `location-history`, and `tree-slot`, not a separate
  `route-local` scope kind.
- `src/cli/features/extract/command.ts#applyMountScopesFromRouter()` applies
  mount scopes to local vars using the active navigation adapter.
- Plan 1 should already add retained/pruned system var lists in slice
  economics.

## 4. Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `addMountGuardVarsForNeededMountLocals()`
  - `sliceModelForProperty()`
  - `sliceModelForTargetedStepProperty()`
  - `enabledTransitionVars()`
- `src/check/types.ts`
  - `SliceSummary`
  - `CheckDiagnostics`
- `src/check/check-model.ts`
  - `checkModelSliced()`
- `src/core/report/types.ts`
  - `CheckReportDiagnostics`
- `src/core/ir/types.ts`
  - `StateVarScope`
  - `SystemVarRole`
- `src/cli/features/extract/command.ts`
  - `applyMountScopesFromRouter()`
- Tests:
  - `test/kernel/mounted-scope.test.ts`
  - `src/cli/features/check/command.test.ts`

## 5. Existing Patterns to Follow

- Keep dependency closure logic in `src/check/slicing/slice-model.ts`.
- Use `mountGuardForScope()` and `exprReads()` for mount guard dependencies.
- Keep diagnostics as structured data, not warning strings.
- Treat system route vars as ordinary vars in dependency closure, then explain
  them through `role` and contributor diagnostics.

## 6. Atomic Implementation Steps

1. Introduce a structured dependency reason type in `src/check/types.ts`, for
   example:

   ```ts
   export interface MountScopeDependency {
     varId: string;
     guardReads: readonly string[];
     retainedBecause: readonly string[];
   }
   ```

2. Add an internal accumulator to slicing helpers so
   `addMountGuardVarsForNeededMountLocals()` can record:

   - mount-local var id;
   - guard read var ids;
   - whether the mount-local var retained guard vars;
   - whether a guard var caused a mount-local var to be retained.

3. Return slice metadata from `sliceModelForCheckProperty()` in addition to the
   sliced model and mode. Suggested shape:

   ```ts
   {
     model: Model;
     mode: PropertySliceMode;
     diagnostics?: {
       mountScopeDependencies?: readonly MountScopeDependency[];
     };
   }
   ```

4. Thread the metadata through `src/check/check-model.ts#checkModelSliced()`.
   When multiple properties share a slice group, merge and dedupe dependency
   reasons deterministically.

5. Extend `SliceSummary` and `CheckReportDiagnostics.slicing.sliceSummaries`
   with `mountScopeDependencies`.

6. Add route/system contributor explanation by relying on Plan 1's
   `retainedSystemVars` and `prunedSystemVars`. Do not invent route-specific
   fields unless tests show users cannot identify route/history vars by role.

7. Add model-slack caveats only for approximate mount or route extraction data
   that already exists in model metadata. If no such extraction caveat exists,
   do not synthesize one in the checker.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/check/types.ts`
- Step 2-3:
  - `src/check/slicing/slice-model.ts`
- Step 4:
  - `src/check/check-model.ts`
- Step 5:
  - `src/core/report/types.ts`
- Step 6-7:
  - `src/check/check-model.ts`
  - `src/cli/features/check/command.ts` only if report assembly needs a type
    adjustment

## 8. Acceptance Criteria

- A property reading a mount-local var retains that var's mount guard reads and
  records why.
- A property unrelated to route/history vars can prune those vars when no
  retained transition needs them.
- Check report slice summaries include mount-scope dependency reasons.
- Route/history vars appear in retained/pruned system var diagnostics from Plan
  1.
- No exact route/mount pruning decision is represented as model slack.

## 9. Tests to Add or Update

- `test/kernel/mounted-scope.test.ts`
  - Property reading mount-local state retains only required guard vars.
  - Property reading a guard var retains the relevant mount-local state only
    when dependency closure requires it.
  - Slice diagnostics include `mountScopeDependencies`.
- `src/cli/features/check/command.test.ts`
  - Check report includes mount dependency reasons and retained/pruned system
    vars for a route/mount fixture.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run test/kernel/mounted-scope.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
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

- Stop and report if the current IR does not expose enough role data to
  identify route/history vars in diagnostics. Add a minimal role-based helper
  rather than adding a new scope kind.
- Stop and report if mount guard bidirectional retention changes an existing
  verdict. The likely fix is a missing dependency edge, not disabling pruning.
- Stop and report if diagnostics require changing checker native output. This
  plan should only annotate slice construction around existing native runs.

## 12. Must Not Change

- Do not change navigation semantics.
- Do not execute application code to decide mount membership.
- Do not silently drop mount guard reads.
- Do not add framework-specific fields to core IR.
