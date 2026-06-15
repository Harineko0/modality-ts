# Goal

Change checker property evaluation so properties that read route-local state are evaluated only while those route-local variables are mounted. This prevents route-specific properties from failing merely because a navigation transition sets their locals to `__modality_unmounted__`.

For the tinyurl case:

- `tagsOnlyOneDialogOpen` should not fail after navigating from `/tags` to `/analytics`.
- `editDraftVisibilityStaysValid` should not fail after navigating from `/links/:id` to `/analytics`.
- Route-specific properties continue to check all mounted states and mounted user steps for their route.

No backward-compatibility behavior is required.

# Non-goals

- Do not change extraction route scoping in this plan.
- Do not add exact callback extraction in this plan.
- Do not remove the runtime `UNMOUNTED` sentinel or navigation reset behavior.
- Do not expand navigation effects to explicitly write every route-local var.
- Do not keep old tests that depended on route-local properties observing unmounted sentinels unless they opt into a new explicit mode.

# Current-state findings

- `src/check/properties/observe.ts`
  - `observeStates()` evaluates every `always` and `reachable` state property against every candidate state.
  - `observeEdge()` evaluates every `alwaysStep` property against every edge.
  - Neither function checks whether route-local vars listed in `property.reads` are mounted.
- `src/check/properties/checked-state.ts`
  - Restricts property reads to declared `reads`, but does not interpret route-local mounted state.
- `src/check/runtime/navigation.ts`
  - `resetRouteLocals()` sets off-route route-local vars to `UNMOUNTED`.
  - Mounted route-local vars are reset to their initial values when their route becomes active.
- `src/core/ir/domains.ts`
  - Exports `UNMOUNTED = "__modality_unmounted__"`.
- `test/checker/checker.test.ts`
  - Contains tests such as `cannotTypeWhileUnmounted`, `offRouteLocalRemainsUnmounted`, and `panelStaysMounted` that intentionally observe unmounted route-local state.
  - Those tests should be changed or removed under the new semantics.
- Current tinyurl traces show state predicates receiving `UNMOUNTED` as if it were normal data, causing false violations.

# Exact file paths and relevant symbols

- `src/check/properties/observe.ts`
  - `observeStates()`
  - `observeEdge()`
- `src/check/properties/checked-state.ts`
  - `checkedState()`
  - `allowedPropertyReads()`
- `src/check/slicing/slice-model.ts`
  - `sliceModelForProperty()`
  - `addRouteVarsForNeededRouteLocals()`
- `src/check/runtime/navigation.ts`
  - `resetRouteLocals()`
  - `normalizeInitialRouteLocals()`
- `src/core/ir/domains.ts`
  - `UNMOUNTED`
- `src/core/props/index.ts`
  - `AlwaysProperty`
  - `AlwaysStepProperty`
  - `ReachableProperty`
  - `Property`
  - `always()`
  - `alwaysStep()`
  - `reachable()`
- Tests:
  - `test/checker/checker.test.ts`
  - `test/checker/checkout-hand-model.test.ts`
  - `test/checker/todo-hand-model.test.ts`

# Existing patterns to follow

- Keep property read discipline centralized around `property.reads`.
- Keep checker implementation small and deterministic; avoid adding report schema fields unless necessary.
- Add helper functions near the observer if they are only used there.
- Use existing hand-model style in tests: inline `Model` fixtures, `always()`, `reachable()`, `alwaysStep()`, and status assertions.
- Follow the existing `UNMOUNTED` import style from `modality-ts/core`.

# Atomic implementation steps

1. Define mounted applicability for route-local property reads.

   Files to edit:
   - `src/check/properties/observe.ts`

   Implementation:
   - Add helper functions:
     - `routeLocalReads(model, property): StateVarDecl[]`
     - `propertyMountedInState(model, property, state): boolean`
     - `propertyMountedForEdge(model, property, pre, post): boolean`
   - A property with no route-local reads is always applicable.
   - A property with route-local reads is applicable when every read route-local var:
     - has `state["sys:route"] === decl.scope.route`; and
     - has `state[decl.id] !== UNMOUNTED`.
   - For `alwaysStep`, require applicability in both `pre` and `post`. This skips route-leaving edges for route-local step properties.

2. Apply mounted applicability to state properties.

   Files to edit:
   - `src/check/properties/observe.ts`

   Implementation:
   - In `observeStates()`, before calling a `kind === "always"` or `kind === "reachable"` predicate, skip the property for that candidate if `propertyMountedInState(...)` is false.
   - Skipping an inactive property is not a pass and not an error.
   - Preserve current verdict behavior for active states.

3. Apply mounted applicability to step properties.

   Files to edit:
   - `src/check/properties/observe.ts`

   Implementation:
   - In `observeEdge()`, before calling an `alwaysStep` predicate, skip evaluation if `propertyMountedForEdge(...)` is false.
   - Continue to pass full `pre`, `step`, and `post` through `checkedState()` when active.

4. Decide whether to expose an opt-in for unmounted assertions.

   Files to inspect/edit:
   - `src/core/props/index.ts`
   - `test/checker/checker.test.ts`

   Implementation:
   - Prefer no opt-in unless existing internal tests need one to preserve important runtime coverage.
   - If opt-in is needed, add a property option such as `includeUnmounted?: true` and make mounted applicability bypassed only when that flag is set.
   - Do not default to old behavior.
   - If this option is added, add it to all property interfaces that evaluate states or edges.

5. Update checker tests that expected unmounted route-local predicates to fire.

   Files to edit:
   - `test/checker/checker.test.ts`

   Implementation:
   - Change tests that assert route-local invariants fail solely after unmount to assert verification within bounds under default mounted semantics.
   - Add new tests for route-local mounted behavior:
     - `always` route-local predicate fails while mounted when the mounted value is bad.
     - `always` route-local predicate is skipped after navigation away.
     - `reachable` route-local predicate only witnesses mounted route states.
     - `alwaysStep` route-local predicate skips a route-leaving edge but still checks mounted same-route edges.
   - If `includeUnmounted` is introduced, keep one focused opt-in test proving old-style unmounted assertions are still possible.

6. Add tinyurl-shaped regression models.

   Files to edit:
   - `test/checker/checker.test.ts`

   Test cases:
   - Tags shape:
     - route enum `["/tags", "/analytics"]`
     - initial route `"/tags"`
     - route-local `local:Tags.createOpen`, `local:Tags.editTarget`, `local:Tags.deleteTarget` scoped to `"/tags"`
     - navigation transition to `"/analytics"`
     - `always` property counting open dialogs with reads on those locals
     - Expect `verified-within-bounds` under default mounted semantics.
   - EditLink shape:
     - route enum `["/links/:id", "/analytics"]`
     - initial route `"/links/:id"`
     - route-local record `local:EditLink.draft`
     - navigation transition to `"/analytics"`
     - `always` property checking draft visibility
     - Expect `verified-within-bounds`.

7. Verify slicing still includes route dependencies.

   Files to inspect/edit only if tests fail:
   - `src/check/slicing/slice-model.ts`

   Implementation:
   - Route-local properties still need `sys:route` in slices so applicability can be evaluated correctly.
   - Confirm `addRouteVarsForNeededRouteLocals()` runs inside the slicing fixed point.
   - If missing, add or repair it in this plan because mounted applicability depends on `sys:route`.

# Per-step files to edit

- Step 1:
  - `src/check/properties/observe.ts`
- Step 2:
  - `src/check/properties/observe.ts`
- Step 3:
  - `src/check/properties/observe.ts`
- Step 4:
  - `src/core/props/index.ts`, only if an explicit opt-in is required
  - `test/checker/checker.test.ts`
- Step 5:
  - `test/checker/checker.test.ts`
- Step 6:
  - `test/checker/checker.test.ts`
- Step 7:
  - `src/check/slicing/slice-model.ts`, only if current slicing is insufficient

# Acceptance criteria

- A route-local `always` property is not evaluated in states where any declared route-local read is unmounted.
- A route-local `reachable` property does not get a witness from an unmounted off-route state.
- A route-local `alwaysStep` property is evaluated only on edges where all declared route-local reads are mounted in both pre and post states.
- Tinyurl-shaped tags and edit-link navigation-away models verify within bounds instead of producing unmounted-sentinel violations.
- Global properties with no route-local reads behave exactly as before.
- Properties with undeclared reads still throw the existing checked-state error.
- If an opt-in `includeUnmounted` is added, it is explicit and tested; default behavior remains mounted-only.

# Tests to add or update

- `test/checker/checker.test.ts`
  - Add mounted-only `always` skip-after-navigation test.
  - Add mounted same-route violation test to prove route-local predicates still run while active.
  - Add mounted-only `reachable` test.
  - Add mounted-only `alwaysStep` route-leaving skip test.
  - Add tinyurl-shaped `tagsOnlyOneDialogOpen` regression model.
  - Add tinyurl-shaped `editDraftVisibilityStaysValid` regression model.
  - Update or remove old tests expecting unmounted sentinels to make default `always` properties fail.
- Run existing hand-model tests to catch behavior changes in broader checker semantics.

# Verification commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- test/checker/checkout-hand-model.test.ts test/checker/todo-hand-model.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

Optional tinyurl check after route-target extraction and callback extraction plans land:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality check
```

# Risks, ambiguities, and stop conditions

- Stop and report if a property reads route-local vars from different routes. Default behavior should be to mark the property inactive everywhere or produce a clear property error; do not guess.
- Stop and report if slicing does not retain `sys:route` for route-local property reads; mounted applicability cannot be correct without `sys:route`.
- Risk: skipping route-leaving `alwaysStep` edges may hide a property that intentionally wants to assert cleanup behavior on unmount. Add an explicit opt-in only if a real internal test or documented use case requires it.
- Risk: `UNMOUNTED` may appear as a valid domain value only through runtime navigation. Use the exported constant rather than string literals.
- Do not update report schema unless tests force a new status or diagnostic. Inactive property evaluation is internal checker semantics, not a new report artifact.
