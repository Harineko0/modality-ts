# Enabled Transition Slicing

## Goal

Fix over-retention caused by `enabled(model, transitionId)` and `enabledTransitionPrefix(...)` in property predicates. Enabledness depends on whether a transition guard is true and whether its required reads are mounted/available; it should not pull transition writes, effect reads, or downstream writer closure into the slice.

This is currently the largest remaining source-level slice blow-up in Coffee `_customer/home`: the three always properties using `enabled(...)` form a `21 vars / 20 transitions` group retaining `sys:pending`, `printerStatusData`, order history vars, and every density transition.

## Non-goals

- Do not change the public `enabled()` property API.
- Do not change Rust evaluation of `transitionEnabled`.
- Do not change transition execution semantics.
- Do not force properties with `enabled()` to full slices.

## Current-State Findings

- `src/core/props/index.ts` infers `enabledTransitions` from `transitionEnabled` and `transitionEnabledPrefix`.
- `src/check/slicing/slice-model.ts` passes inferred enabled transitions into `dependencySliceInput()`.
- `src/check/slicing/dependency-graph.ts` uses `enabledTransitionSeedVars()`.
- `enabledTransitionSeedVars()` currently adds:
  - guard reads,
  - `effectReadsForModel(...)`,
  - all `transition.reads`,
  - all non-pending transition writes,
  - mount locals from guard reads.
- For a predicate like:
  - `or(printerStatus != "connected", enabled(setDensity1))`
  the slice should retain `printerStatus` and the guard dependencies for `setDensity1`, not `optimisticDensity`, `printerStatusData`, `sys:pending`, or unrelated transitions.

## Exact File Paths and Relevant Symbols

- `src/check/slicing/dependency-graph.ts`
  - `enabledTransitionSeedVars`
  - `expandMountGuardReads`
  - `expandMountLocalsFromGuardReads`
  - `computeStateSliceClosure`
  - `computeTargetedStepSliceClosure`
- `src/check/slicing/slice-model.ts`
  - `collectExprEnabledTransitions`
  - `collectEnabledTransitions`
  - `dependencySliceInput`
- `src/core/props/index.ts`
  - `enabled`
  - `enabledTransitionPrefix`
  - `propertyEnabledTransitions`
  - `inferEnabledTransitions`
- `test/checker/checker.test.ts`
  - existing enabled-slice tests
  - Coffee-like focused fixture tests
- `test/check/slicing-parity.test.ts`

## Existing Patterns to Follow

- Low-level slicing expectations belong in `test/check/slicing-parity.test.ts`.
- End-to-end checker parity and slice economics belong in `test/checker/checker.test.ts`.
- Existing tests assert pruned pending/history vars for targeted slices; extend that style.

## Atomic Implementation Steps

1. Add a failing enabled-slice fixture.
   - Model vars:
     - `status` enum,
     - `widePayload` product/record with many booleans/tokens,
     - `unrelated` bool,
     - `sys:pending`.
   - Transition `setDensity1`:
     - guard reads `status`,
     - writes `widePayload` or another wide var,
     - effect reads unrelated vars if needed to prove they are not retained.
   - Property:
     - `always(or(status != "connected", enabled(model, "setDensity1")))`.
   - Assert slice retains `status`.
   - Assert slice does not retain `widePayload`, `unrelated`, or `sys:pending`.
   - Assert transition set contains only what is needed to evaluate enabledness, or no executable transition if Rust enabled evaluation can resolve from transition metadata.

2. Split enabledness dependencies from execution dependencies.
   - Introduce a helper such as `enabledTransitionGuardVars(graph, transitionIds)`.
   - It should include:
     - vars read by the transition guard,
     - vars needed for mount guards of those vars,
     - possibly declared `transition.reads` only when the guard or enabled evaluator requires them.
   - It must not include transition writes or `effectReadsForModel()`.

3. Update `enabledTransitionSeedVars()`.
   - Use the new guard-only helper.
   - Remove `expandMountLocalsFromGuardReads()` from enabled seed calculation unless a test proves it is required for soundness.
   - Keep deterministic sorting.

4. Preserve execution dependencies for targeted steps.
   - Do not reuse guard-only enabled dependencies for actual target transition execution.
   - `computeTargetedStepSliceClosure()` should still add semantic vars for target transitions when checking postconditions.

5. Update slice grouping tests.
   - Add a Coffee-shaped fixture with three `enabled(...)` always properties that previously grouped into a full slice.
   - Assert the group prunes wide printer/order-history/pending equivalents.

## Per-Step Files to Edit

- Step 1: `test/check/slicing-parity.test.ts` or `test/checker/checker.test.ts`
- Step 2: `src/check/slicing/dependency-graph.ts`
- Step 3: `src/check/slicing/dependency-graph.ts`
- Step 4: `src/check/slicing/dependency-graph.ts`, `src/check/slicing/slice-model.ts`
- Step 5: `test/checker/checker.test.ts`, `src/cli/features/check/command.test.ts` if report diagnostics are asserted

## Acceptance Criteria

- `enabled(model, id)` predicates do not retain transition writes solely because enabledness was observed.
- Coffee-like enabled properties no longer produce a `21 vars / 20 transitions` slice.
- Existing enabled-transition checker semantics remain correct.
- Sliced and unsliced verdict parity remains intact for enabled properties.

## Tests to Add or Update

- Add guard-only enabled slicing test.
- Add prefix-enabled test if `enabledTransitionPrefix` has different behavior.
- Update existing enabled slice tests only if their old expectations relied on over-retention.

## Verification Commands

```bash
rtk pnpm test test/check/slicing-parity.test.ts
rtk pnpm test test/checker/checker.test.ts
rtk pnpm test src/cli/features/check/command.test.ts
rtk pnpm typecheck
```

Optional Coffee source-level probe after build:

```bash
rtk proxy pnpm exec tsx src/cli/cli.ts check /Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json /Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts --max-states 1000 --max-frontier 1000 --max-edges 10000 -A
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if Rust `transitionEnabled` evaluation uses effect semantics rather than guard metadata. The dependency model must match actual evaluation.
- Stop and report if a transition's `reads` are broader than guard reads and are required to evaluate enabledness; add a precise reasoned helper rather than reverting to writes/effects.
- Do not fix enabled blow-up by treating `enabled()` as opaque or full-slice.

