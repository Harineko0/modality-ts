# Directional Reachability and Step Slicing

## Goal

Reduce broad backward write-closure for reachable and targeted-step properties. Slicing should retain transitions that can contribute to the property objective, not every transition that writes any currently retained var and all of that transition’s other writes.

This targets the remaining Coffee source-level groups that still retain `sys:pending` and receipt/action-data state for simple phase/cart/reachability and targeted-step properties.

## Non-goals

- Do not implement symbolic model checking.
- Do not change property semantics.
- Do not remove conservative fallback for expressions that cannot be analyzed.
- Do not alter extraction output.

## Current-State Findings

- After source-level 0.0.26 slicing, Coffee `_customer/home` still has a group with:
  - `11 vars`,
  - `9 transitions`,
  - `sys:pending`,
  - order receipt fields,
  - `router:actionData`.
- Properties in this group include:
  - `customerCanReachConfirmPhase`,
  - `customerInitialCartIsEmpty`,
  - `customerCanConfirmFreeOrder`,
  - `customerCanConfirmPaidOrder`,
  - `customerCanReachCompletedOrderWithNumber`,
  - `confirmPhaseCanReturnToMenu`.
- `customerInitialCartIsEmpty` is true in the initial state but still explores the whole slice.
- `computeStateSliceClosure()` and `computeTargetedStepSliceClosure()` call `reachVarsThroughTransitions()`.
- `reachVarsThroughTransitions()` pulls in any transition writing a needed var, then adds all transition reads and all non-pending writes. This is sound but too coarse for goal-directed reachability and targeted step postconditions.

## Exact File Paths and Relevant Symbols

- `src/check/slicing/dependency-graph.ts`
  - `computeStateSliceClosure`
  - `computeTargetedStepSliceClosure`
  - `reachVarsThroughTransitions`
  - `addTransitionSemanticVars`
  - `addTransitionReadVars`
- `src/check/slicing/slice-model.ts`
  - `collectPropertyDependencyRequest`
  - `propertySliceMode`
  - `targetedAlwaysStepTransitionIds`
- `src/check/check-model.ts`
  - `checkModelSliced`
  - grouping by vars/transitions/mode
- `src/core/ir/types.ts`
  - `EffectIR`
  - `ExprIR`
- `test/checker/checker.test.ts`
- `test/check/slicing-parity.test.ts`

## Existing Patterns to Follow

- Keep conservative behavior for opaque properties.
- Existing tests compare sliced vs unsliced verdicts.
- Slice diagnostics should continue to report retained/pruned bits and top contributors.

## Atomic Implementation Steps

1. Add a Coffee-shaped directional slicing fixture.
   - Model:
     - `phase` enum with `menu`, `confirm`, `complete`.
     - `isFree` bool.
     - receipt vars.
     - `actionData`.
     - `sys:pending`.
     - transitions:
       - choose paid/free: write `phase=confirm` and `isFree`.
       - submit: enqueue pending.
       - resolve: write `actionData`.
       - effect: writes receipt vars and `phase=complete`.
       - acknowledge: writes receipt vars and `phase=menu`.
   - Properties:
     - reachable `phase == confirm`,
     - reachable initial cart/phase value,
     - targeted alwaysStep for choose paid/free.
   - Assert the reachable-confirm slice does not retain resolve/effect/receipt/pending transitions.
   - Assert targeted choose slices retain the target transition and needed pre/post vars only.

2. Add initial-state short-circuit before native search.
   - In `checkModelSliced()` or before calling `runRustCheck`, detect `reachable` properties whose predicate is true in the model initial state for their slice.
   - Emit a reachable verdict with empty trace without invoking Rust for that property.
   - Keep this limited to straightforward serializable state predicates using existing evaluator or a small shared evaluator.
   - If there is no TypeScript evaluator for full `ExprIR`, add a narrow helper and stop on unsupported expressions.

3. Introduce predicate-aware transition relevance for reachable state predicates.
   - For simple predicates over a var (`eq`, `neq`, conjunctions/disjunctions of reads/literals), inspect effects of transitions writing that var.
   - Include transitions that can move the var toward satisfying the predicate.
   - Do not include transitions that write the same var only away from the target unless needed for `reachableFrom` source states.
   - Keep conservative fallback to current closure for unsupported effect forms.

4. Make targeted-step slicing less backward-closed.
   - For targeted alwaysStep properties, seed execution vars from:
     - target transition guard reads,
     - target transition effect reads,
     - target transition non-pending writes that are mentioned by postcondition or step facts,
     - precondition reads,
     - postcondition reads.
   - Do not call broad `reachVarsThroughTransitions()` before adding target semantics.
   - Add internal stabilization transitions only when `triggeredBy` intersects retained execution vars and writes intersect vars read by the property or target effect.

5. Keep conservative fallback explicit.
   - If a property uses unsupported predicate/effect shapes, fall back to current closure.
   - Add diagnostics or test-only assertions so future work can see when fallback happens.

## Per-Step Files to Edit

- Step 1: `test/checker/checker.test.ts`
- Step 2: `src/check/check-model.ts`, possibly a new helper under `src/check/`
- Step 3: `src/check/slicing/dependency-graph.ts`, `src/check/slicing/slice-model.ts`
- Step 4: `src/check/slicing/dependency-graph.ts`
- Step 5: `src/check/types.ts` only if adding diagnostics; otherwise tests only

## Acceptance Criteria

- Initial-state reachable properties do not call Rust search.
- Reachable `phase == confirm` in the Coffee-shaped fixture prunes async submit/resolve/effect/receipt state.
- Targeted choose-step properties do not retain pending queues unless their step facts observe pending.
- Sliced and unsliced verdicts match existing parity tests.
- Conservative fallback remains available and tested.

## Tests to Add or Update

- Coffee-shaped directional slicing fixture.
- Initial-state reachable short-circuit test with empty trace.
- Targeted alwaysStep fixture proving async receipt state is pruned.
- Existing checker parity tests.

## Verification Commands

```bash
rtk pnpm test test/checker/checker.test.ts
rtk pnpm test test/check/slicing-parity.test.ts
rtk pnpm test src/cli/features/check/command.test.ts
rtk pnpm typecheck
```

Optional source-level Coffee probe:

```bash
rtk proxy pnpm exec tsx src/cli/cli.ts check /Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json /Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts --max-states 1000 --max-frontier 1000 --max-edges 10000 -A
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if predicate-aware relevance changes a sliced verdict versus unsliced parity.
- Stop and report if TypeScript initial-state evaluation would duplicate too much Rust evaluator behavior; keep the first pass narrow.
- Do not silently drop transitions with `havoc`, `opaque`, or complex `if` effects unless a sound relevance check exists.
- Do not replace all hard cases with full slices; report unsupported patterns and keep them narrow where possible.

