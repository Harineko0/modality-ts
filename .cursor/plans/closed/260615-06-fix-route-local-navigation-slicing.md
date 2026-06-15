# Goal

Fix the slicing soundness bug where a property over a route-local state var can drop navigation transitions that reset that var through mount semantics. A sliced run must keep route-changing transitions that can affect any route-local var in the property's cone, so sliced and full-model verdicts stay equivalent for route-local properties.

# Non-goals

- Do not refactor the checker, runtime navigation, extractor, property DSL, or report diagnostics beyond what is needed for this soundness fix.
- Do not make `effectWrites()` model-dependent or change the IR contract so every `navigate` transition must explicitly declare every route-local var as a write.
- Do not include all system vars in every slice. Preserve the current design that `sys:*` enters a slice only when explicitly needed.
- Do not change `alwaysStep` slicing behavior; it already uses the full model.
- Do not overwrite unrelated uncommitted work. This repo currently has dirty files in the affected area; inspect and merge with the current contents before editing.

# Current-state findings

- `src/check/slicing/slice-model.ts` builds `neededVars` from property reads and `enabled(...)` dependencies, then reaches a transition fixed point by keeping transitions whose declared `writes` intersect `neededVars`.
- In that file, route-local vars add `sys:route` only after the transition fixed point. Because transitions are filtered only by `neededTransitions`, adding `sys:route` late does not cause navigation transitions writing `sys:route` to be reconsidered.
- `src/check/runtime/navigation.ts` changes route-local state during navigation in `resetRouteLocals()`: when `previousRoute !== currentRoute`, mounted route-local vars are reset to initial values and non-mounted route-local vars are set to `UNMOUNTED`.
- `src/core/ir/validator.ts` `effectWrites()` intentionally reports `navigate` effects as writing only `sys:route` and `sys:history`. That is enough for IR validation, but slicing must account for the fact that `sys:route` changes also semantically affect route-local vars present in the slice.
- `docs/specs/03-checker.md` already says system vars enter a slice when required by "kept transition's mount/navigation semantics" and that transitions writing into the cone are kept. The implementation is currently behind that spec for route-local navigation.
- Existing route-local slicing coverage in `test/checker/checker.test.ts` checks that `sys:route` is present for route-local properties, but it does not assert that navigation transitions are retained or that sliced verdicts match full-model verdicts when navigation unmounts a route-local var.

# Exact file paths and relevant symbols

- `src/check/slicing/slice-model.ts`
  - `sliceModel()`
  - `sliceModelForProperty()`
  - `enabledTransitionVars()`
  - `neededVars`
  - `neededTransitions`
- `src/check/runtime/navigation.ts`
  - `navigate()`
  - `normalizeInitialRouteLocals()`
  - `resetRouteLocals()`
- `src/core/ir/validator.ts`
  - `effectWrites()`
  - `validateTransition()`
  - `validateRouteLocalWrites()`
  - `validateRouteLocalWriteOrder()`
- `test/checker/checker.test.ts`
  - existing `sliceModel()` tests around route-local and reader-only transitions
  - helpers `bool`, `twoRoutes`, `pendingOp`, `lit()`, `read()`
  - `always()` and `checkModel()` verdict assertions
- `src/core/ir/domains.ts`
  - `UNMOUNTED`, exported through `modality-ts/core`

# Existing patterns to follow

- Keep slicing logic as a small fixed-point computation in `sliceModelForProperty()`.
- Preserve deterministic ordering by continuing to filter `model.vars` and `model.transitions` in original model order.
- Keep tests in `test/checker/checker.test.ts` near the existing slicing tests around `sliceModel(m, ["local:/a.panel"])`.
- Follow existing hand-model test style: inline `Model` objects, `lit()`, `read()`, concise `expect(...).toEqual(...)` status comparisons.
- For navigation effects in tests, use current IR shape:
  - `effect: { kind: "navigate", mode: "push", to: lit("/b") }`
  - `reads: ["sys:route", "sys:history"]`
  - `writes: ["sys:route", "sys:history"]`

# Atomic implementation steps

1. Inspect the current dirty working tree.
   - Run `rtk git status --short`.
   - Run `rtk git diff -- src/check/slicing/slice-model.ts test/checker/checker.test.ts`.
   - If the existing edits already address this exact bug, preserve them and only add missing tests or adjustments.

2. Add route-local mount/navigation dependencies during the slicing fixed point.
   - In `src/check/slicing/slice-model.ts`, add a small helper such as `addRouteVarsForNeededRouteLocals(model, neededVars): boolean`.
   - The helper should scan `model.vars`; when a decl's id is already in `neededVars` and `decl.scope.kind === "route-local"`, add `"sys:route"` to `neededVars` and return whether it changed the set.
   - Call this helper inside the fixed-point loop before scanning transitions, and use its return value to update `changed`.
   - Keep or simplify the current post-loop route-local block only if it remains useful. Avoid having two subtly different route-local dependency paths.
   - This makes `sys:route` available before transition filtering, so navigation transitions whose existing writes include `sys:route` are retained when any route-local var is in the cone.

3. Ensure forced transitions still behave as before.
   - Do not remove `enabledTransitionVars()` behavior.
   - Do not require forced transitions to pull in every route-local var. The fix is for properties whose cone already contains a route-local var.
   - If refactoring helper placement, keep `enabledTransitionVars()` exported because `src/check/properties/checked-state.ts` imports it.

4. Add a structural regression test for the slice contents.
   - In `test/checker/checker.test.ts`, add a test near `"keeps minimum route var for route-local properties with mount semantics"`.
   - Build a minimal model with:
     - `sys:route` enum `["/a", "/b"]`, initial `"/a"`
     - `sys:history` bounded list over the same route domain
     - route-local `local:/a.panel`, route `"/a"`, initial `true`
     - a user transition `navigateAway` with a `navigate` effect to `"/b"`, declared reads/writes only `sys:route` and `sys:history`
   - Assert `sliceModel(m, ["local:/a.panel"]).transitions.map((t) => t.id)` includes `navigateAway`.
   - Assert the sliced vars include `local:/a.panel`, `sys:route`, and `sys:history`.
   - Assert the test would fail on the old implementation because `navigateAway` was omitted.

5. Add an end-to-end verdict regression test.
   - Use the same or a similar model.
   - Add an `always()` property such as:
     - name: `"panelStaysMounted"`
     - predicate: `state["local:/a.panel"] === true`
     - reads: `["local:/a.panel"]`
   - Full-model checking should find a violation after `navigateAway` because runtime navigation sets `local:/a.panel` to `UNMOUNTED` when route changes to `"/b"`.
   - Assert `checkModel(m, props).verdicts` and `checkModel(m, props, { slicing: true }).verdicts` have the same status, and specifically that the property status is `"violated"`.
   - Prefer asserting status parity plus `"violated"` over comparing whole trace objects.

6. Run focused verification.
   - Run the checker test file first.
   - Run typecheck.
   - Run the full test suite only if the focused test or typecheck exposes broader interactions.

# Per-step files to edit

- Step 2 and Step 3:
  - `src/check/slicing/slice-model.ts`
- Step 4 and Step 5:
  - `test/checker/checker.test.ts`
- No other files should be edited for this bug unless a verification failure directly proves another file must change.

# Acceptance criteria

- A property slice containing a route-local var adds `sys:route` during the transition fixed point, not only after it.
- Navigation transitions declared as writing `sys:route`/`sys:history` are retained when they can reset a route-local var in the slice.
- Sliced checking and full-model checking agree on a route-local invariant falsified by navigation unmounting/resetting the route-local var.
- Existing reader-only transition behavior remains unchanged: transitions that only read a cone var and write unrelated vars are still dropped for state properties.
- Existing `enabled(...)` behavior and `alwaysStep` full-model behavior remain unchanged.
- No broad route-local write expansion is added to `effectWrites()`.

# Tests to add or update

- Add a new structural test in `test/checker/checker.test.ts`:
  - suggested name: `"keeps navigation transitions that reset route-local vars"`
  - verifies `sliceModel()` retains `navigateAway` for `["local:/a.panel"]`.
- Add a new verdict regression test in `test/checker/checker.test.ts`:
  - suggested name: `"keeps sliced route-local verdicts sound when navigation unmounts state"`
  - verifies full and sliced checks both report `"violated"` for an invariant over a route-local var that becomes `UNMOUNTED` after navigation.
- If an existing route-local slicing test becomes redundant, keep it unless it directly conflicts; small overlapping coverage is acceptable for this P1 bug.

# Verification commands

Run commands with `rtk` where practical:

```bash
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm typecheck
rtk pnpm test
```

If only the focused checker test is needed during iteration, use:

```bash
rtk pnpm test -- test/checker/checker.test.ts -t "route-local"
```

# Risks, ambiguities, and stop conditions

- Stop and report if `src/check/slicing/slice-model.ts` has already been substantially rewritten in the dirty working tree and the fixed-point structure described here no longer exists.
- Stop and report if navigation transition declarations no longer include `sys:route` in `writes`; this plan relies on the existing IR validation contract that `navigate` writes `sys:route`.
- Stop and report if tests use a changed `EffectIR` shape for navigation. The current shape is `{ kind: "navigate", mode: "push" | "replace" | "back", to?: ExprIR }`.
- Be careful not to make route-local properties pull in unrelated route-local vars. The intended minimal fix is to pull in `sys:route`, then let existing transition footprints pull in only what kept transitions actually declare.
- Adding `sys:route` earlier may keep more transitions that write `sys:route` for route-local properties. That is expected and conservative. If this causes unacceptable slice growth in existing diagnostics, report it with counts rather than weakening the soundness fix.
- If a new test fails because `sys:history` is absent from the slice for a retained `navigate` transition, inspect the transition's declared `writes`; do not add `sys:history` globally.
