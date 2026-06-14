# Fix leadsToWithin Slicing Soundness

## Goal

Prevent `leadsToWithin` properties from becoming unsound under per-property slicing when the trigger is a step predicate over explored edges.

The minimal sound fix is to make `leadsToWithin` use the full model when checker slicing is enabled, matching the existing full-model fallback for `alwaysStep`. Add a focused regression proving that a real bounded-response violation remains a violation with `{ slicing: true }` instead of becoming `vacuous-warning`.

## Non-goals

- Do not redesign the property DSL.
- Do not introduce a new public metadata field unless the minimal full-model fallback is rejected.
- Do not overload `enabledTransitions` to mean trigger transitions. It currently supports `enabled(model, transitionId)` dependencies.
- Do not change `leadsToWithin` semantics, budgets, scheduler constraints, trace construction, or vacuity message text except where tests need to assert existing behavior.
- Do not broaden or refactor the slicing algorithm beyond the eligibility rule for this bug.
- Do not edit generated `dist/` artifacts.
- Do not revert or overwrite unrelated working-tree changes from other agents.

## Current-State Findings

- `src/check/slicing/slice-model.ts` exports `canSliceProperty(property)`, which currently returns `property.kind !== "alwaysStep"`. This treats `leadsToWithin` as sliceable.
- `src/check/engine/check-model.ts` calls `canSliceProperty(property)` inside `checkModelSliced(...)`. If it returns false, that property is checked against the original full model.
- `src/core/props/index.ts` constructs `leadsToWithin(...)` with `reads: propertyReads(_model, options, goal)`. The trigger is not part of state-read inference because its primary input is `StepFacts`, not `ModelState`.
- `src/core/props/index.ts` also passes `trigger` into `propertyEnabledTransitions(options, trigger, goal)`, but that only infers calls shaped like `enabled(model, "transitionId")`; it does not infer arbitrary trigger edges such as `step.transition.id === "fire"` or `step.enqueued("POST")`.
- `src/check/properties/finalize.ts` implements `finalizeLeadsToWithin(...)` by filtering the explored `edges` with `property.trigger(edge.step)`. If slicing drops the trigger edge, `triggerEdges.length === 0` and the verdict becomes `vacuous-warning` with message `Trigger never fired within bounds`.
- `src/check/properties/leads-to.ts` evaluates the goal with `checkedState(model, property, state, "leadsToWithin goal")`, so the current read metadata protects goal reads but not trigger edge presence.
- Existing tests in `test/checker/checker.test.ts` already cover bounded-response behavior and sliced-vs-unsliced parity for state properties. Add the regression there instead of creating a new test framework.
- `docs/specs/03-checker.md` currently describes `alwaysStep` as full-model because step predicates observe edges broadly, but Section 4 lists `leadsToWithin` among state-like sliceable properties. That spec text should be aligned with the sound fallback.

## Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `canSliceProperty(property: Pick<Property, "kind">): boolean`
  - `sliceModelForProperty(model, property)`
  - `enabledTransitionVars(model, transitionIds)`
- `src/check/engine/check-model.ts`
  - `checkModel(...)`
  - `checkModelSliced(...)`
  - `sliceModelForProperty(...)` call site
  - `SliceSummary` construction
- `src/core/props/index.ts`
  - `Property` union member with `kind: "leadsToWithin"`
  - `leadsToWithin(...)`
  - `propertyReads(...)`
  - `propertyEnabledTransitions(...)`
  - `inferEnabledTransitions(...)`
- `src/check/properties/finalize.ts`
  - `finalizeProperties(...)`
  - `finalizeLeadsToWithin(...)`
  - `triggerEdges`
  - `Trigger never fired within bounds`
- `src/check/properties/leads-to.ts`
  - `failingSuffixWithin(...)`
  - `schedulerSuccessors(...)`
  - `schedulerAllows(...)`
- `src/check/properties/checked-state.ts`
  - `checkedState(...)`
  - `allowedPropertyReads(...)`
- `src/check/types.ts`
  - `SliceSummary`
  - `CheckDiagnostics`
- `docs/specs/03-checker.md`
  - Section 4, `Per-property slicing`
  - Section 5, `alwaysStep`
  - Section 6, `leadsToWithin`
- `test/checker/checker.test.ts`
  - Existing `leadsToWithin` tests near `includes the failing bounded-response suffix in leadsToWithin traces`
  - Existing slicing tests near `checks properties on conservative slices when reads are declared`
  - Existing sliced-vs-unsliced parity test near `preserves enabled() verdicts and witnesses when slicing is enabled`

## Existing Patterns to Follow

- Follow the existing full-model fallback pattern for `alwaysStep` in `canSliceProperty(...)`; `leadsToWithin` should be treated the same until trigger edge dependencies are soundly represented.
- Follow sliced-vs-unsliced parity assertions in `test/checker/checker.test.ts`: compute both `checkModel(m, props)` and `checkModel(m, props, { slicing: true })`, then compare verdict status and trace transition IDs when relevant.
- Follow existing `leadsToWithin` fixtures that use small hand-written `Model` objects, `lit(...)`, `read(...)`, and explicit `Property[]` arrays.
- Follow existing diagnostics assertions only lightly. The soundness acceptance criterion is verdict parity, not exact slice count formatting.
- Follow `checkedState(...)` as the safety pattern for state predicate reads. Do not try to make trigger predicates pass through this state-read proxy.

## Atomic Implementation Steps

### 1. Add a failing regression that captures the unsound slice

Add one focused test in `test/checker/checker.test.ts`.

Recommended test name:

```ts
it("does not slice leadsToWithin trigger edges away", () => {
  ...
});
```

Recommended fixture shape:

- A small `Model` with standard system vars used by other tests:
  - `sys:route`
  - `sys:history`
  - `sys:pending`
  - `done`, initially `false`
  - `triggered`, initially `false`
- One user transition:
  - `id: "fire"`
  - `guard: lit(true)`
  - `effect` writes only `triggered: true`
  - `reads: []`
  - `writes: ["triggered"]`
- No transition writes `done`.
- One `leadsToWithin` property:
  - trigger: `(step) => step.transition.id === "fire"`
  - goal: `(state) => state.done === true`
  - budget: `{ environment: 0 }`
  - name: `"fireEventuallyDone"`
  - let reads be inferred, or explicitly pass `reads: ["done"]` if the test should make the slicing precondition obvious.

Expected behavior:

- Unsliced `checkModel(m, props)` returns `violated` for `fireEventuallyDone`.
- Sliced `checkModel(m, props, { slicing: true })` also returns `violated`.
- The sliced verdict must not be `vacuous-warning`.
- If asserting the trace, the violating trace should contain `["fire"]`.

Why this fixture catches the bug:

- Current slicing starts from the goal read set `["done"]`.
- Since no transition writes `done`, the sliced model drops the `"fire"` edge.
- `finalizeLeadsToWithin(...)` then sees no trigger edges and reports `Trigger never fired within bounds`, masking the real violation.

Files to edit:

- `test/checker/checker.test.ts`

### 2. Make `leadsToWithin` non-sliceable for now

Update `canSliceProperty(...)` in `src/check/slicing/slice-model.ts` so it returns false for both `alwaysStep` and `leadsToWithin`.

Recommended minimal implementation:

```ts
export function canSliceProperty(property: Pick<Property, "kind">): boolean {
  return property.kind !== "alwaysStep" && property.kind !== "leadsToWithin";
}
```

Equivalent explicit switch is also acceptable if preferred by the surrounding style:

```ts
export function canSliceProperty(property: Pick<Property, "kind">): boolean {
  switch (property.kind) {
    case "alwaysStep":
    case "leadsToWithin":
      return false;
    default:
      return true;
  }
}
```

Do not change `sliceModelForProperty(...)` in this step.

Files to edit:

- `src/check/slicing/slice-model.ts`

### 3. Align checker spec text

Update `docs/specs/03-checker.md` to remove the statement that `leadsToWithin` can be sliced by state reads alone.

Minimal wording change:

- In Section 4, change the sentence that currently groups `leadsToWithin` with state properties whose reader-only transitions may be dropped.
- State that `leadsToWithin` currently uses full-model search when slicing is enabled because its trigger is a step predicate over explored edges, like `alwaysStep`.
- Add a short future note: `leadsToWithin` may become sliceable only after trigger transition dependencies are represented precisely and included in the slice.

Keep the semantics in Section 6 unchanged.

Files to edit:

- `docs/specs/03-checker.md`

### 4. Run focused verification

Run the smallest relevant tests first, then typecheck.

Commands:

```bash
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm typecheck
```

If the focused test command is not accepted by the project's Vitest setup, use:

```bash
rtk pnpm exec vitest run test/checker/checker.test.ts
rtk pnpm typecheck
```

### 5. Optional broader verification

If time permits, run:

```bash
rtk pnpm test
rtk pnpm architecture
```

Only run `rtk pnpm phase7` if the implementation changes checker semantics beyond the eligibility fallback described above.

## Per-Step Files to Edit

- Step 1:
  - `test/checker/checker.test.ts`
- Step 2:
  - `src/check/slicing/slice-model.ts`
- Step 3:
  - `docs/specs/03-checker.md`
- Step 4:
  - No file edits, verification only.
- Step 5:
  - No file edits, optional verification only.

Do not edit any other files for the minimal fix.

## Acceptance Criteria

- `canSliceProperty(...)` returns false for `leadsToWithin`.
- Existing sliceable property kinds remain unchanged:
  - `always` remains sliceable.
  - `reachable` remains sliceable.
  - `reachableFrom` remains sliceable.
  - `alwaysStep` remains non-sliceable.
- With `{ slicing: true }`, a `leadsToWithin` property is checked against a full model, preserving explored trigger edges.
- The new regression fails before the fix with a sliced `vacuous-warning` and passes after the fix with `violated`.
- The new regression proves sliced and unsliced verdicts match for the crafted trigger-edge case.
- Existing bounded-response tests continue to pass.
- `docs/specs/03-checker.md` no longer claims `leadsToWithin` is soundly sliceable from only goal reads.
- `rtk pnpm typecheck` passes.

## Tests to Add or Update

Add one test to `test/checker/checker.test.ts`:

- Name: `does not slice leadsToWithin trigger edges away`
- Purpose: prove a trigger-only transition that does not write goal-read variables is still explored when slicing is requested.
- Assertions:
  - Unsliced status is `violated`.
  - Sliced status is `violated`.
  - Sliced status is not `vacuous-warning`.
  - Optional: sliced violation trace transition IDs are `["fire"]`.

Do not add snapshot tests.

Do not add CLI tests unless the implementation changes diagnostics or reporting output, which the minimal fix should not.

## Verification Commands

Required:

```bash
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm typecheck
```

Fallback if the first command does not select the file correctly:

```bash
rtk pnpm exec vitest run test/checker/checker.test.ts
rtk pnpm typecheck
```

Recommended if time permits:

```bash
rtk pnpm test
rtk pnpm architecture
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Full-model fallback for `leadsToWithin` may reduce the performance benefit of slicing for bounded-response properties. This is acceptable for the minimal P1 soundness fix; correctness wins over state-space reduction.
- Risk: Existing dirty working-tree changes may already touch `src/check/slicing/slice-model.ts`, `docs/specs/03-checker.md`, or `test/checker/checker.test.ts`. Preserve those changes and make the smallest compatible edit.
- Ambiguity: Some trigger predicates might be simple enough to infer transition IDs from source, but arbitrary `StepFacts` predicates are not soundly covered today. Do not add partial inference as part of this fix.
- Ambiguity: `enabledTransitions` sounds like transition metadata, but in current code it means dependencies introduced by `enabled(model, transitionId)` inside predicates. Do not repurpose it for trigger edges without a separate design.
- Stop and ask/report if the project already introduced precise trigger dependency metadata such as `triggerTransitions`, `triggerReads`, or a changed `StepPredicate` metadata model. In that case, reassess whether `leadsToWithin` can be sliced soundly using that metadata.
- Stop and ask/report if tests reveal that `checkModelSliced(...)` groups full-model and sliced-model properties incorrectly after the fallback. The intended behavior is that non-sliceable properties use `model` unchanged.
- Stop and ask/report if the new regression cannot be expressed without changing public model or property types. The minimal fix should require no public API changes.
- Stop and ask/report before changing `finalizeLeadsToWithin(...)`, `failingSuffixWithin(...)`, scheduler behavior, replayability, or trace generation. Those are outside the minimal fix.
