# Fix Coffee DX Near-Full Slices

## Goal

Fix the slicing blow-up described in `docs/_issues/coffee-dx-check-retains-near-full-slices.md` so Coffee DX customer-home properties such as `densityOneRequiresConnectedPrinter`, `densitySevenDisabledWhenPrinterDisconnected`, and `loadMoreOrdersEnabledOnlyWithCursorAndIdleDialog` no longer retain near-full slices.

The concrete target is that properties whose predicates mention printer density enabledness or order-history/load-more enablement retain only the state needed to evaluate the property and the relevant transition guards. They must not pull unrelated route/history state, pending queues, broad printer/order payloads, or every transition merely because those systems share route guards, enabled transition IDs, or internal effects.

## Non-goals

- Do not change public property APIs such as `enabled(...)`, `enabledTransitionPrefix(...)`, `always(...)`, `reachable(...)`, or `alwaysStep(...)`.
- Do not change extraction output for Coffee DX.
- Do not change Rust transition execution semantics or checker verdict semantics.
- Do not add wall-clock assertions as the main regression gate.
- Do not implement broad state-space optimizations unrelated to slicing.
- Do not fall back to full slices for supported state properties or targeted bad-step properties.
- Do not modify generated artifacts or `dist/`.

## Current-state findings

- `src/check/slicing/dependency-graph.ts` already has a first-class graph-shaped slicer via `buildModelDependencyGraph`, `computeStateSliceClosure`, and `computeTargetedStepSliceClosure`.
- `enabledTransitionSeedVars()` is already guard-only and delegates to `enabledTransitionGuardVars()`.
- `computeStateSliceClosure()` still forces enabled transition IDs into the slice and then calls `addEnabledObservationMountLocals()`. That helper adds mount-local vars from the observed transition's `reads` and `writes` even though enabledness only needs guard and mount-condition evaluation.
- `computeTargetedStepSliceClosure()` also calls `addEnabledObservationMountLocals()` for enabled transitions that are observed in predicates.
- `expandMountGuardDependencies()` still has reverse expansion from a guard read to mount-local vars when the guard read is in `seedVars`. This is currently covered by a positive test in `test/kernel/mounted-scope.test.ts` named `retains mount-local state when a guard var is needed`, but the Coffee issue indicates this rule is too broad for route guards.
- `reachVarsThroughTransitions()` remains write-closure based: once a var is needed, every transition writing it can add all transition reads and all non-pending writes. Directional relevance narrows simple reachable predicates, but unsupported effect forms, including `havoc`, conservatively keep broad dependencies.
- `finalizeSlicedTransitions()` strips pending effects only when no pending queue var is retained, then `stripToEnabledObservationTransition()` strips a transition only if some execution vars are missing from the retained vars. If enabled-observation logic has already retained all mount-local reads/writes, the transition can remain executable even when it should be an observation-only stub.
- Existing regression coverage is helpful but split across small cases:
  - `test/check/slicing-parity.test.ts` has enabled guard-only and route-local sibling pruning tests.
  - `test/check/slicing-dependency-graph.test.ts` has focused graph closure tests.
  - `test/checker/checker.test.ts` has Coffee-shaped directional fixtures and route-local slice economics gates.
- There is no single composite fixture that mirrors the Coffee customer-home failure group with printer status, density enabledness, order-history load-more enablement, route/history vars, pending queue, mount-local siblings, and internal wide payload updates.

## Exact file paths and relevant symbols

- `docs/_issues/coffee-dx-check-retains-near-full-slices.md`
  - Reproduction data and target property names.
- `src/check/check-model.ts`
  - `checkModelSliced`
  - slice grouping key
  - `SliceSummary` construction
  - `mergePendingQueueDependencies`
- `src/check/slicing/dependency-graph.ts`
  - `computeStateSliceClosure`
  - `computeTargetedStepSliceClosure`
  - `enabledTransitionGuardVars`
  - `enabledTransitionSeedVars`
  - `reachVarsThroughTransitions`
  - `expandMountGuardDependencies`
  - `addEnabledObservationMountLocals`
  - `seedTargetTransitionVars`
  - `addTransitionSemanticVars`
- `src/check/slicing/slice-model.ts`
  - `sliceModelForCheckProperty`
  - `sliceModelForProperty`
  - `sliceModelForTargetedStepProperty`
  - `collectPropertyDependencyRequest`
  - `dependencySliceInput`
  - `finalizeSlicedTransitions`
  - `stripToEnabledObservationTransition`
  - `collectPendingQueueDependencies`
- `src/check/slicing/predicate-relevance.ts`
  - `analyzeDirectionalPredicate`
  - `isTransitionDirectionallyRelevant`
  - `collectStaticAssignValues`
- `src/check/types.ts`
  - `SliceSummary`
  - `MountScopeDependency`
  - `PendingQueueDependency`
- `test/check/slicing-parity.test.ts`
  - `enabled transition guard-only slicing`
  - `prunes sibling route-local vars sharing the same mount guard`
- `test/check/slicing-dependency-graph.test.ts`
  - `routeLocalEconomyModel`
  - graph closure tests
- `test/checker/checker.test.ts`
  - Coffee-shaped enabled and directional fixtures
  - route-local slice economics gates
- `test/kernel/mounted-scope.test.ts`
  - mount-scope dependency semantics, especially reverse guard-read retention
- `src/cli/features/check/command.test.ts`
  - report-level slice diagnostics assertions
- Optional external canary inputs:
  - `/Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json`
  - `/Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts`

## Existing patterns to follow

- Add low-level dependency closure tests in `test/check/slicing-dependency-graph.test.ts`.
- Add `sliceModelForCheckProperty(...)` tests in `test/check/slicing-parity.test.ts` when testing exact retained vars/transitions.
- Add end-to-end sliced-vs-unsliced parity and slice-summary economics tests in `test/checker/checker.test.ts`.
- Keep diagnostics deterministic by sorting IDs and reasons.
- Use structural budgets for performance gates: retained vars, retained transitions, retained/pruned system vars, and top contributors. Avoid timing-only gates.
- Preserve conservative behavior only where semantics are unsupported; make fallback explicit and visible in diagnostics/tests.

## Atomic implementation steps

1. Add a composite failing Coffee-shaped fixture.
   - Put the reusable model builder in `test/checker/checker.test.ts` near the existing Coffee-shaped fixtures unless it becomes too large; if it does, move only the fixture builder to a local test helper under `test/check/`.
   - Include:
     - `sys:route`, `sys:history`, and `sys:pending`.
     - printer connection status, density value(s), optimistic density locals, printer status payload/data with a wide domain.
     - order-history cursor/dialog/load-more state with a broad order-history payload.
     - several mount-local sibling vars sharing the customer-home route guard.
     - user transitions for density buttons whose guards read connection/status and whose effects write density or optimistic density.
     - a load-more transition whose guard reads cursor/dialog/loading state and whose effect enqueues or touches order payload.
     - internal/env transitions that update wide printer/order payloads and are triggered by unrelated state.
   - Add properties named after the issue:
     - `densityOneRequiresConnectedPrinter`
     - `densitySevenDisabledWhenPrinterDisconnected`
     - `loadMoreOrdersEnabledOnlyWithCursorAndIdleDialog`
   - First assert the current bad shape: before fixing, at least one of these should retain near-full vars/transitions. After fixing, update expectations to the acceptance budgets below.

2. Split enabled observation from transition execution.
   - Replace `addEnabledObservationMountLocals()` with a guard-only helper, for example `addEnabledObservationGuardVars(graph, vars, transitionId)`.
   - The helper should add only:
     - `exprReads(transition.guard)`
     - mount guard reads for mount-local vars directly read by the guard, via `expandMountGuardReads`
   - It must not add transition writes, effect reads, broad `transition.reads`, or mount-local refs that are only execution reads/writes.
   - In `computeStateSliceClosure()`, keep forced enabled transition IDs in `neededTransitions` so the Rust predicate evaluator can find the transition by ID, but do not let those IDs seed execution closure.
   - In `computeTargetedStepSliceClosure()`, use guard-only enabled observation for non-target enabled observations. Target transitions must still use execution semantics through `seedTargetTransitionVars()`.

3. Make observation-only transitions explicit during finalization.
   - Add an internal way to pass observation-only transition IDs from dependency closure to `finalizeSlicedTransitions()`, such as:
     - `observationOnlyTransitions: Set<string>` on closure results, or
     - a small metadata object returned alongside `neededTransitions`.
   - For observation-only transitions, strip execution unconditionally:
     - preserve `id`, `cls`, `label`, `source`, `guard`, `confidence`, and any metadata needed for enabled evaluation.
     - set `effect` to `{ kind: "seq", effects: [] }`.
     - set `writes` to `[]`.
     - set `reads` to the sorted guard reads if Rust or diagnostics require `reads`; otherwise use `[]` only if tests prove Rust `enabled(...)` evaluates from `guard` and mount scope rather than `reads`.
   - Stop and report if Rust `transitionEnabled` evaluation requires original transition `reads`/`writes` or effect metadata for enabled predicates.

4. Narrow reverse mount-guard expansion.
   - Revisit the second loop in `expandMountGuardDependencies()`, which currently adds mount-local vars when a seed guard var is needed.
   - Replace broad reverse expansion with a reasoned rule:
     - If the property directly reads a mount-local var, keep that var plus its guard reads.
     - If a retained transition needs a mount-local var for execution, keep that var plus its guard reads.
     - If a property only reads `sys:route` or another guard var, do not retain every mount-local whose guard reads that var.
   - Update or replace `test/kernel/mounted-scope.test.ts` case `retains mount-local state when a guard var is needed`. The new expected behavior should retain no route-local sibling merely because `sys:route` is a property read, unless there is a concrete retained transition/property read requiring that local.
   - Preserve soundness for properties that explicitly mention route-local `UNMOUNTED` semantics; if those properties need a local var, they should read that local var explicitly through property read inference.

5. Prevent internal `havoc` and wide effects from entering unrelated state slices.
   - In `reachVarsThroughTransitions()`, distinguish transitions retained to produce a property var from transitions retained only because of broad internal/effect infrastructure.
   - For `havoc` effects:
     - If the havoc target is the property var or a post/step fact var, keep it.
     - If the havoc target is an unrelated wide abstraction and the transition only came through an enabled observation, do not add it.
     - If the static relevance is unknown for a reachable predicate, keep the existing conservative behavior and expose `closureFallback`.
   - Extend `predicate-relevance.ts` only for local relevance decisions; do not hide unsupported cases by pretending they are irrelevant.

6. Make pending queue retention reason-based in the composite path.
   - Keep pending queues only when:
     - the property reads the pending queue,
     - a step fact observes enqueue/resolve/op/args/continuation,
     - a retained executable transition semantically requires queue mutation to preserve the property,
     - or a target transition execution writes the queue and the step predicate observes that fact.
   - Enabled observations must never retain `sys:pending`.
   - Ensure `finalizeSlicedTransitions()` continues stripping enqueue/dequeue effects when no pending queue var is retained.

7. Add diagnostics that explain retained high-bit vars.
   - Do this only if needed to debug or assert the fix; keep it small.
   - Prefer extending existing diagnostics (`mountScopeDependencies`, `pendingQueueDependencies`, `closureFallback`) over adding a new public report shape.
   - If a new field is necessary, update `src/check/types.ts`, `src/core/report/types.ts`, and the CLI report tests together.

8. Add or update report-level tests.
   - In `test/checker/checker.test.ts`, assert the composite Coffee-shaped fixture:
     - creates one or more slices far below full model size,
     - prunes `sys:pending` for enabled-only properties,
     - prunes `sys:history` unless route history is directly relevant,
     - prunes wide printer/order payload contributors for density enabledness properties,
     - keeps only guard vars needed by `enabled(...)`.
   - In `test/check/slicing-parity.test.ts`, add a focused test proving enabled observation of a mount-local transition does not retain that transition's mount-local writes/effect reads.
   - In `test/check/slicing-dependency-graph.test.ts`, add a closure test where `propertyReads: ["sys:route"]` does not reverse-expand every route-local sibling.

9. Run the external Coffee DX probe as a manual canary if the path exists.
   - Do not make the unit tests depend on `/Users/hari/proj/coffee-dx`.
   - Run the local source-level check with aggressive limits and inspect slice summaries for the three named properties.
   - If the Coffee DX model shape differs from the synthetic fixture, update the synthetic fixture to capture the missing dependency pattern before changing slicer behavior further.

## Per-step files to edit

- Step 1:
  - `test/checker/checker.test.ts`
  - optionally new `test/check/coffee-like-fixtures.ts`
- Step 2:
  - `src/check/slicing/dependency-graph.ts`
  - `test/check/slicing-parity.test.ts`
  - `test/check/slicing-dependency-graph.test.ts`
- Step 3:
  - `src/check/slicing/dependency-graph.ts`
  - `src/check/slicing/slice-model.ts`
  - `test/check/slicing-parity.test.ts`
- Step 4:
  - `src/check/slicing/dependency-graph.ts`
  - `test/kernel/mounted-scope.test.ts`
  - `test/check/slicing-dependency-graph.test.ts`
  - `test/check/slicing-parity.test.ts`
- Step 5:
  - `src/check/slicing/dependency-graph.ts`
  - `src/check/slicing/predicate-relevance.ts`
  - `test/checker/checker.test.ts`
- Step 6:
  - `src/check/slicing/dependency-graph.ts`
  - `src/check/slicing/slice-model.ts`
  - `test/check/slicing-parity.test.ts`
  - `test/checker/checker.test.ts`
- Step 7, only if diagnostics shape changes:
  - `src/check/types.ts`
  - `src/core/report/types.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/check/output.ts` if human output changes
- Step 9:
  - No committed code changes unless the probe reveals a missing fixture pattern.

## Acceptance criteria

- For the composite Coffee-shaped fixture:
  - `densityOneRequiresConnectedPrinter` retains fewer than half the model vars and transitions.
  - `densitySevenDisabledWhenPrinterDisconnected` retains fewer than half the model vars and transitions.
  - `loadMoreOrdersEnabledOnlyWithCursorAndIdleDialog` retains only its cursor/dialog/load-more guard dependencies plus any directly required route mount guards.
  - No enabled-only density property retains `sys:pending`.
  - No enabled-only density property retains broad order-history payload vars.
  - No enabled-only density property retains unrelated route-local sibling vars solely because they share the customer-home route guard.
- `enabled(model, transitionId)` and `enabledTransitionPrefix(...)` still evaluate correctly in sliced checks.
- Sliced and unsliced verdicts match for the composite fixture and existing slicing parity tests.
- Existing route-local mount semantics remain sound: properties that explicitly read mount-local vars still retain the needed mount guard vars.
- Slice summaries remain deterministic and continue to include economics fields.
- No new full-slice fallback is introduced for the supported property shapes in the issue.

## Tests to add or update

- Add a composite Coffee-shaped regression in `test/checker/checker.test.ts` for the three issue property names.
- Add a focused enabled-observation mount-local test in `test/check/slicing-parity.test.ts`:
  - observed transition reads/writes a mount-local wide var,
  - property only checks `enabled(...)` plus a small status var,
  - slice keeps guard vars and an observation-only transition stub,
  - slice prunes wide mount-local writes/effect reads.
- Add a dependency graph test in `test/check/slicing-dependency-graph.test.ts` proving guard-var reads do not reverse-expand route-local siblings.
- Update `test/kernel/mounted-scope.test.ts` expectations for guard-var-only properties.
- Add a pending queue assertion to an existing enabled-prefix test or the new composite fixture.
- If diagnostics change, update `src/cli/features/check/command.test.ts`.

## Verification commands

```bash
rtk pnpm test test/check/slicing-dependency-graph.test.ts
rtk pnpm test test/check/slicing-parity.test.ts
rtk pnpm test test/kernel/mounted-scope.test.ts
rtk pnpm test test/checker/checker.test.ts
rtk pnpm test src/cli/features/check/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
```

Optional broader regression:

```bash
rtk pnpm phase7
rtk pnpm test
```

Optional Coffee DX canary, only if the external paths exist:

```bash
rtk proxy pnpm exec tsx src/cli/cli.ts check /Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json /Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts --max-states 10000 --max-edges 50000 --max-frontier 10000 -A
```

## Risks, ambiguities, and stop conditions

- Stop and report if Rust `transitionEnabled` needs transition `reads`, `writes`, or effects rather than only `guard` plus mount availability. Do not guess by stripping metadata until a parity test proves it.
- Stop and report if removing reverse mount-guard expansion changes verdict parity for route-local `UNMOUNTED` semantics; the replacement must be reasoned, not merely smaller.
- Stop and report if a pending queue mutation is observable by a property after being stripped.
- Stop and report if a `havoc` transition writes a property var or a postcondition var and relevance cannot be proven safely.
- Do not resolve the Coffee DX slowdown by lowering bounds, changing property definitions, deleting transitions, or hiding properties from slicing.
- Do not make tests depend on the private Coffee DX checkout; keep that as a manual canary and encode the behavior in synthetic fixtures.
