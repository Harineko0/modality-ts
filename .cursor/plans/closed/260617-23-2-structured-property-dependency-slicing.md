# Structured Property Dependency Slicing

Status: implementation plan.
Date: 2026-06-17.
Plan family: H - State-Space Economics.
Depends on: `260617-23-1-shared-state-space-economics-diagnostics.md`.

## 1. Goal

Generalize property-focused slicing so serializable property IR can provide its
own dependency reads, instead of requiring every property to manually set
`property.reads`.

The end state is:

- state predicates, reachable goals, `leadsToWithin` goals, and step predicate
  `pre`/`post` expressions contribute structured reads;
- transition-enabled expressions contribute enabled transition dependencies;
- `leadsToWithin` and non-targeted `alwaysStep` properties can use property
  slices when their dependencies are known;
- opaque or function-based property shapes remain unsliceable with explicit
  diagnostics.

## 2. Non-goals

- Do not change Rust checker property semantics.
- Do not infer dependencies from JavaScript functions.
- Do not guess reads when an expression kind is unsupported.
- Do not implement route, mount, pending, or field-specific diagnostics in this
  plan.
- Do not add heuristic slicing for properties that are not structurally
  inspectable.

## 3. Current-State Findings

- `src/check/check-model.ts#checkModel()` enables slicing only when every
  property has `property.reads !== undefined`.
- `src/check/slicing/slice-model.ts#propertySliceMode()` returns `"full"` for
  every `leadsToWithin` property.
- `propertySliceMode()` returns `"full"` for `alwaysStep` unless
  `canUseTargetedStepSlice()` recognizes a narrow negated target transition
  shape.
- `sliceModelForProperty()` only receives `reads` and `enabledTransitions`.
- `sliceModelForTargetedStepProperty()` already adds step fact vars through
  `stepFactVars()`.
- `src/core/ir/types.ts` defines serializable `Property`, `ExprIR`,
  `StepPredicateIR`, and `StepPredicateFlat`.
- `src/core/ir/eval.ts` has expression evaluation but not a public dependency
  collection helper.
- `src/check/slicing/slice-model.ts` already imports `exprReads()`,
  `effectReads()`, and `effectWrites()` from `modality-ts/core`.

## 4. Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `PropertySliceMode`
  - `propertySliceMode()`
  - `sliceModelForCheckProperty()`
  - `sliceModelForProperty()`
  - `sliceModelForTargetedStepProperty()`
  - `targetedAlwaysStepTransitionIds()`
  - `stepFactVars()`
  - `enabledTransitionVars()`
  - `canSliceProperty()`
- `src/check/check-model.ts`
  - `checkModel()`
  - `buildSlicingRequestDiagnostics()`
- `src/core/ir/types.ts`
  - `Property`
  - `ExprIR`
  - `StepPredicateIR`
  - `StepPredicateFlat`
- `src/core/ir/eval.ts` or the existing core export that contains `exprReads()`
- Tests:
  - `test/checker/checker.test.ts`
  - `test/kernel/kernel.test.ts`

## 5. Existing Patterns to Follow

- Keep property dependency logic near slicing in `src/check/slicing/`.
- Use structured IR walkers such as `exprReads()` rather than string parsing.
- Treat explicit `property.reads` as an additive override, not as the only
  source of truth.
- Prefer explicit skip reasons in diagnostics over silently disabling slicing.
- Keep property mode names stable: `"state"`, `"targetedStep"`, and `"full"`.

## 6. Atomic Implementation Steps

1. Add an internal structured helper in `src/check/slicing/slice-model.ts`,
   such as:

   ```ts
   interface PropertyDependencyRequest {
     stateReads: readonly string[];
     enabledTransitions: readonly string[];
     targetTransitionIds: readonly string[];
     stepFactVars: readonly string[];
     mode: PropertySliceMode;
     unsliceableReason?: string;
   }
   ```

2. Implement dependency collection by property kind:

   - `always` and `reachable`: `property.reads` plus `exprReads(predicate)`.
   - `reachableFrom`: `property.reads` plus `exprReads(when)` and
     `exprReads(goal)`.
   - `leadsToWithin`: `property.reads`, `exprReads(goal)`, trigger step fact
     vars, and trigger transition vars when `trigger.transitionId` is present.
   - `alwaysStep`: `property.reads`, composite `pre` and `post` expression
     reads, step fact vars, and target transition vars when present.

3. Collect transition-enabled dependencies from expression IR:

   - `transitionEnabled` should add that exact transition id.
   - `transitionEnabledPrefix` should add all transition ids in the model with
     that prefix. If the helper does not have a model parameter yet, pass the
     model into dependency collection.

4. Replace `propertySliceMode(property)` internals so `"full"` is used only
   for properties whose dependency request is unsliceable, not merely because
   of property kind.

5. Update `sliceModelForCheckProperty()` to call the dependency helper and pass
   the inferred reads/enabled transitions into `sliceModelForProperty()` or
   `sliceModelForTargetedStepProperty()`.

6. Update `sliceModelForTargetedStepProperty()` to receive dependency data
   rather than relying only on `property.reads`.

7. Update `canSliceProperty()` and
   `src/check/check-model.ts#buildSlicingRequestDiagnostics()`:

   - serializable properties without explicit `reads` should be sliceable when
     all dependencies can be walked;
   - skip reason `property missing reads` should be replaced with a reason that
     identifies opaque or unsupported property dependencies.

8. Update CLI check slicing enablement in `src/cli/features/check/command.ts`.
   Today `runCheckCommand()` computes `canSlice` from explicit `reads`; replace
   that with the checker-level `canSliceProperty()` or a new exported helper.

## 7. Per-Step Files to Edit

- Step 1-6:
  - `src/check/slicing/slice-model.ts`
- Step 7:
  - `src/check/check-model.ts`
  - `src/check/slicing/slice-model.ts`
- Step 8:
  - `src/cli/features/check/command.ts`
- Tests:
  - `test/checker/checker.test.ts`
  - `test/kernel/kernel.test.ts`
  - `src/cli/features/check/command.test.ts` if CLI slicing behavior is tested

## 8. Acceptance Criteria

- Serializable `always`, `reachable`, `reachableFrom`, `leadsToWithin`, and
  `alwaysStep` properties can slice without explicit `property.reads` when
  their IR is walkable.
- `leadsToWithin` no longer forces full-model checking solely because of its
  property kind.
- Non-targeted `alwaysStep` can use a state slice when its dependencies are
  known.
- Function-based or unsupported property shapes remain unsliceable and report a
  clear skip reason.
- Existing targeted `alwaysStep` behavior still works.

## 9. Tests to Add or Update

- `test/checker/checker.test.ts`
  - Add a serializable `always` property without `reads` and assert slicing is
    enabled.
  - Add a `leadsToWithin` property with a transition trigger and goal reads and
    assert it uses a non-full slice.
  - Add a non-targeted `alwaysStep` with `pre`/`post` reads and assert it can
    slice.
- `test/kernel/kernel.test.ts`
  - Update property builder tests that previously required explicit `reads`.
- `src/cli/features/check/command.test.ts`
  - Add or update a CLI report assertion showing slicing is enabled for
    serializable property artifacts without manual reads.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run test/checker/checker.test.ts
rtk pnpm vitest run test/kernel/kernel.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
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

- Stop and report if a property expression kind cannot be walked soundly. Add
  an explicit unsliceable reason rather than guessing.
- Stop and report if `transitionEnabledPrefix` expansion would require a model
  but the current API cannot pass one without invasive changes. Make the
  smallest signature change needed.
- Stop and report if removing the explicit `property.reads` gate causes
  properties with runtime function predicates to pass slicing. Function
  predicates must remain unsliceable.
- Stop and report if generalized slicing changes verdicts for an existing
  fixture. Fix missing dependency edges rather than disabling slicing globally.

## 12. Must Not Change

- Do not change how predicates are evaluated.
- Do not change Rust checker validation.
- Do not treat missing dependencies as exact.
- Do not introduce broad property-kind exceptions once structured dependency
  data is available.
