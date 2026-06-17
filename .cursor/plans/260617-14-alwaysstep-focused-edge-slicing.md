# Focused alwaysStep Edge Slicing

## 1. Goal

Fix `docs/_issues/alwaysstep-focused-properties-still-hit-search-limits.md` by making explicitly transition-targeted `alwaysStep` properties avoid full-model search and avoid dragging unrelated `sys:pending`, navigation, and history behavior into the checked slice.

The desired behavior is:

- `alwaysStep` properties whose predicate syntactically targets a concrete transition with `stepTransitionId(...)` should run on a targeted edge slice when normal property slicing is enabled.
- The targeted edge slice should keep enough state-space behavior to reach relevant pre-states and execute the target edge, but should not recursively pull in unrelated transitions merely because the target transition reads or writes broad infrastructure variables such as `sys:pending`.
- Untargeted `alwaysStep` properties, broad step matchers, and `leadsToWithin` should keep their current full-model behavior unless/until a separate sound slicing design exists.
- Search-limit diagnostics and slice summaries should make it obvious that the focused properties used small targeted slices.

## 2. Non-goals

- Do not change Rust checker step semantics: `alwaysStep` must still observe edges before the visited-state check.
- Do not change the meaning of positive `alwaysStep` predicates in this fix. Add documentation/validation guidance only; do not silently reinterpret positive postcondition predicates as implications.
- Do not implement partial-order reduction, scheduler reduction, or a general `leadsToWithin` slicing design.
- Do not tune default CLI limits to hide the issue.
- Do not depend on the private Meiwa app being present in this repository. The fix must be covered by small in-repo models.
- Do not preserve backward compatibility if an internal type/helper shape needs to change; this package is experimental.

## 3. Current-State Findings

- `src/check/check-model.ts` enables slicing only when all properties have `reads`, then groups per-property runs before calling `runRustCheck(...)`.
- `src/check/check-model.ts` currently calls `canSliceProperty(property)` and falls back to the full model for all `alwaysStep` and `leadsToWithin` properties.
- `src/check/slicing/slice-model.ts` implements the current cone of influence:
  - seed from property `reads`
  - union `enabledTransitionVars(...)`
  - repeatedly add transitions that write any needed var and add their reads/writes
  - finally force `property.enabledTransitions`
- `src/check/slicing/slice-model.ts` currently treats target transition reads and writes as ordinary dependency seeds via `enabledTransitionVars(...)`. For a target transition that touches `sys:pending`, this can pull in every other transition that writes `sys:pending`.
- `src/check/check-model.ts` groups slices by `slice.vars.map(...).join("\0")` only. This is already too weak for forced-transition slices because two properties can have identical var sets but require different transition sets.
- `src/core/props/index.ts` already infers `enabledTransitions` from `stepTransitionId(...)`, but that loses the distinction between syntactic step targets and `enabled(...)` expressions in `pre`/`post`.
- `crates/checker/src/property.rs` evaluates `alwaysStep` via `matches_step_spec(...)` on every explored edge. A negated bad-step pattern is robust on dependency edges; a positive target+post predicate can still fail on dependency edges.
- `docs/_specs/03-checker.md` and `docs/architecture/checker.md` currently state that `alwaysStep` uses full-model search.
- `docs/guides/writing-properties.md` already recommends `alwaysStep` for action invariants and shows a negated bad-step example, but it does not explain that positive target+post predicates are not implications and can produce unrelated-transition counterexamples.

## 4. Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `sliceModel(...)`
  - `sliceModelForProperty(...)`
  - `enabledTransitionVars(...)`
  - `canSliceProperty(...)`
  - new helper to add: `targetedAlwaysStepTransitionIds(...)` or equivalent
  - new helper to add: `sliceModelForTargetedStepProperty(...)` or equivalent
- `src/check/check-model.ts`
  - `checkModel(...)`
  - `checkModelSliced(...)`
  - slice grouping key construction
  - `SliceSummary` population
- `src/check/types.ts`
  - `SliceSummary` if adding optional diagnostic fields such as slice mode
- `src/core/ir/types.ts`
  - `StepPredicateFlat`
  - `StepPredicateComposite`
  - `Property`
- `src/core/props/index.ts`
  - `alwaysStep(...)`
  - `propertyEnabledTransitions(...)`
  - `inferEnabledTransitions(...)`
- `crates/checker/src/property.rs`
  - `observe_edge(...)`
  - use as semantic reference; avoid changing unless validation shows a native issue
- `crates/checker/src/step.rs`
  - `matches_step_predicate(...)`
  - `matches_step_spec(...)`
  - use as semantic reference for target-id detection
- `test/checker/checker.test.ts`
  - existing slicing tests around `sliceModel(...)`
  - existing `alwaysStep` tests around edge observation and targeted step predicates
- `docs/_specs/03-checker.md`
- `docs/architecture/checker.md`
- `docs/guides/writing-properties.md`
- `docs/guides/diagnostics-and-search-limits.md`
- `docs/reference/property-api.md`
- `docs/_issues/alwaysstep-focused-properties-still-hit-search-limits.md`

## 5. Existing Patterns to Follow

- Keep TypeScript-side slicing as model-to-model preprocessing; Rust receives an ordinary sliced `Model` with `options.slicedModel: true`.
- Preserve deterministic ordering by sorting var IDs, transition IDs, and generated diagnostic arrays.
- Keep checker diagnostics additive and schema-version-compatible; optional fields are acceptable.
- Prefer small, direct unit models in `test/checker/checker.test.ts` over relying on external app fixtures.
- Follow the existing cone-of-influence rule for state properties, but introduce a separate targeted-step slice mode rather than overloading the current state-property algorithm.
- Keep docs source files updated; do not edit generated `docs/build/**`.

## 6. Atomic Implementation Steps

### Step 1: Add target-id detection for `alwaysStep`

Files to edit:

- `src/check/slicing/slice-model.ts`
- `test/checker/checker.test.ts`

Implementation:

- Add a helper that returns concrete target transition IDs only when `property.kind === "alwaysStep"` and the step predicate itself contains `transitionId`.
- For a flat predicate, read `property.predicate.transitionId`.
- For a composite predicate, read `property.predicate.step.transitionId`.
- Return an empty array for:
  - untargeted `alwaysStep`
  - predicates that rely only on `enabledTransitions`
  - `stepEnqueued(...)`, `stepResolved(...)`, `stepAny()`, transition class, label kind, navigation, op id, or continuation matchers without a concrete transition id
- Do not infer target IDs from `property.enabledTransitions`; those can also come from `enabled(...)` references in pre/post predicates and are not equivalent to edge targeting.

Tests:

- Add direct tests for the helper if exported, or cover it through `canSliceProperty(...)`/slice behavior.
- Verify an `alwaysStep` with `stepTransitionId("target")` is sliceable.
- Verify an `alwaysStep` with only `enabledTransitions: ["target"]` but no predicate `transitionId` is not treated as targeted.

### Step 2: Introduce targeted-step slicing

Files to edit:

- `src/check/slicing/slice-model.ts`
- `test/checker/checker.test.ts`

Implementation:

- Add a targeted-step slice path used only for syntactically targeted `alwaysStep` properties.
- Model it as a distinct algorithm from state-property slicing:
  - `dependencyVars`: vars needed to reach and enable target pre-states.
  - `executionVars`: vars needed to execute the target transition and evaluate target step facts/post predicates.
  - `neededTransitions`: transitions kept for reaching pre-states plus the target transitions.
- Seed `dependencyVars` from:
  - property `reads`
  - target transition guard/read dependencies needed for enablement
  - route/mount vars needed for target transition mount semantics
- Seed `executionVars` from:
  - `dependencyVars`
  - target transition reads and writes
  - vars needed to derive step facts for the targeted predicate shape, especially `sys:pending` for enqueue/resolve/op facts and `sys:route` for navigation facts
- Run the existing backwards writer closure only from `dependencyVars`, not from target-only execution writes. This is the critical fix: if a target transition writes `sys:pending` only because it enqueues, keep `sys:pending` in the slice so the target edge can execute, but do not pull in every unrelated transition that also writes `sys:pending`.
- Add route-local and mount-local handling equivalent to the existing `addRouteVarsForNeededRouteLocals(...)`.
- After the dependency closure stabilizes, add target transitions and their execution vars.
- Retain internal transitions needed by stabilization if they write a needed dependency or execution var. If an internal transition is `triggeredBy` a target-written var and writes an execution var, include it; otherwise do not include unrelated always-triggered internals just because the full model had them.
- Sort output according to original model order, as the current implementation does by filtering `model.vars` and `model.transitions`.

Important soundness constraint:

- Dependency closure must include transitions that can change target guard/pre-read vars, because those transitions can create target pre-states.
- Target writes that are not read by the property and not needed to enable future target pre-states must not become recursive dependency roots.

Tests:

- Add a model with:
  - `sys:pending` bounded list
  - target transition `submit` that writes or reads/writes `sys:pending` and resets `draft`
  - many unrelated transitions that also write `sys:pending`, `sys:history`, or unrelated route vars
  - focused property: negated bad-step `alwaysStep` with `stepTransitionId("submit")`, `post` expressing the bad reset condition, and `enabledTransitions: ["submit"]`
- Assert `sliceModelForProperty(model, property)` keeps `submit` and relevant draft dependencies but excludes unrelated pending/navigation/history transitions.
- Assert `checkModel(model, [property], { slicing: true, maxEdges: smallNumber })` verifies within bounds while `checkModel(model, [property], { slicing: false, maxEdges: sameSmallNumber })` hits `maxEdges`, if this can be made deterministic without making the test slow.
- Add a second property whose target transition writes the same var set but has a different transition ID; use it later to validate the grouping key fix.

### Step 3: Update slicing eligibility

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/check/check-model.ts`
- `test/checker/checker.test.ts`

Implementation:

- Replace `canSliceProperty(property: Pick<Property, "kind">)` with a helper that has enough information to distinguish:
  - state-property slice: `always`, `reachable`, `reachableFrom`
  - targeted-step slice: `alwaysStep` with syntactic target IDs
  - unsliceable: untargeted `alwaysStep`, all `leadsToWithin`
- Either return a discriminated mode such as `"state" | "targetedStep" | "none"` or add a new `sliceModelForCheckProperty(...)` wrapper that hides the mode choice.
- Keep existing state-property behavior unchanged for non-step properties.
- For unsliceable properties, continue using the full model.

Tests:

- Existing slicing parity tests for `always`, `reachable`, and `reachableFrom` must still pass.
- Add an untargeted `alwaysStep(stepAny())` test showing `checkModel(..., { slicing: true })` still uses the full model or at least keeps all transitions in its slice summary.
- Add a targeted `alwaysStep(stepTransitionId("..."))` test showing the slice summary transition count is smaller than the full model.

### Step 4: Fix slice grouping keys

Files to edit:

- `src/check/check-model.ts`
- `test/checker/checker.test.ts`

Implementation:

- Change the grouping key from only var IDs to include both var IDs and transition IDs.
- Use a stable format such as:
  - vars joined with `\0`
  - separator `\1`
  - transitions joined with `\0`
- Include slice mode if the same model subset could have different semantics in the future; this is optional but cheap.
- Do not group properties requiring different forced target transitions if their transition sets differ.

Tests:

- Create two focused `alwaysStep` properties with identical vars but different target transitions.
- Assert `checkModel(..., { slicing: true }).diagnostics?.slicing?.sliceSummaries` has separate summaries or at least a combined summary whose transition list includes both targets. Prefer separate summaries because the models are different.
- Assert both properties receive correct verdicts.

### Step 5: Improve diagnostics for slice modes

Files to edit:

- `src/check/types.ts`
- `src/check/check-model.ts`
- `src/cli/features/check/command.ts` only if human output needs to show the new mode
- `src/cli/features/check/output.ts` only if the richer human renderer duplicates the same summary logic
- `test/checker/checker.test.ts`
- `src/cli/features/check/command.test.ts` if CLI text changes

Implementation:

- Add an optional `mode?: "state" | "targetedStep" | "full"` to `SliceSummary`, or a similarly named optional field.
- Populate it from the slicing decision in `checkModelSliced(...)`.
- Keep existing CLI one-line `slicing=slices:... vars:... transitions:... skipped:0` stable unless there is a strong reason to change it.
- If adding mode to human output, update tests deliberately; otherwise leave human output unchanged and rely on report JSON for mode detail.

Tests:

- Assert the targeted `alwaysStep` slice summary reports `mode: "targetedStep"` if the field is added.
- Existing CLI output tests should keep passing or be updated with minimal expectations.

### Step 6: Add property-author guidance for positive postconditions

Files to edit:

- `docs/guides/writing-properties.md`
- `docs/reference/property-api.md`

Implementation:

- Clarify that a composite `alwaysStep` predicate is checked on every explored edge.
- Document the preferred focused postcondition idiom as a negated bad-step:

```ts
alwaysStep(
  model,
  {
    negate: true,
    step: stepTransitionId("Component.onSubmit"),
    post: /* bad post-state condition */,
  },
  {
    name: "submitDoesNotLeaveDraftDirty",
    enabledTransitions: ["Component.onSubmit"],
  },
);
```

- Explain that `step: stepTransitionId(id), post: goodCondition` is not an implication; it requires every observed edge to be that target edge with that postcondition.
- Do not add runtime warnings in this step unless the implementation already has a clean property-validation path. If adding warnings looks invasive, leave stricter predicate validation as a separate issue.

Tests:

- No runtime tests required for docs-only guidance.

### Step 7: Update checker docs/specs

Files to edit:

- `docs/_specs/03-checker.md`
- `docs/architecture/checker.md`
- `docs/guides/diagnostics-and-search-limits.md`
- `docs/_issues/alwaysstep-focused-properties-still-hit-search-limits.md`

Implementation:

- Replace the blanket statement that `alwaysStep` always uses full-model search.
- State the new rule:
  - untargeted `alwaysStep` uses full-model search
  - syntactically transition-targeted `alwaysStep` can use targeted edge slicing
  - `leadsToWithin` remains full-model search
- Mention that targeted edge slicing treats target-transition execution vars differently from dependency vars to avoid unrelated `sys:pending`/navigation/history exploration.
- In the issue file, add an “Implemented Notes” section or move it under `docs/_issues/closed/` following the repository’s issue convention only after tests pass.

Tests:

- No docs build required for the minimal fix, but run docs build if docs table/markdown syntax is uncertain.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/check/slicing/slice-model.ts`
  - `test/checker/checker.test.ts`
- Step 2:
  - `src/check/slicing/slice-model.ts`
  - `test/checker/checker.test.ts`
- Step 3:
  - `src/check/slicing/slice-model.ts`
  - `src/check/check-model.ts`
  - `test/checker/checker.test.ts`
- Step 4:
  - `src/check/check-model.ts`
  - `test/checker/checker.test.ts`
- Step 5:
  - `src/check/types.ts`
  - `src/check/check-model.ts`
  - optionally `src/cli/features/check/command.ts`
  - optionally `src/cli/features/check/output.ts`
  - optionally `src/cli/features/check/command.test.ts`
- Step 6:
  - `docs/guides/writing-properties.md`
  - `docs/reference/property-api.md`
- Step 7:
  - `docs/_specs/03-checker.md`
  - `docs/architecture/checker.md`
  - `docs/guides/diagnostics-and-search-limits.md`
  - `docs/_issues/alwaysstep-focused-properties-still-hit-search-limits.md` or `docs/_issues/closed/alwaysstep-focused-properties-still-hit-search-limits.md`

## 8. Acceptance Criteria

- A focused `alwaysStep` property using `stepTransitionId("submit")` and `enabledTransitions: ["submit"]` is sliced instead of using the full model.
- The targeted slice keeps the target transition and direct execution vars but does not recursively include unrelated transitions solely because they also write `sys:pending`, `sys:history`, or unrelated route/history vars.
- Untargeted `alwaysStep` still uses full-model search.
- `leadsToWithin` still uses full-model search.
- Sliced and unsliced verdicts match for the added focused-step test models when limits are disabled.
- With a deliberately low edge limit, the focused-step sliced run completes where the unsliced run would exceed the edge limit, using a deterministic in-repo test.
- Slice grouping cannot drop forced transitions when two properties have identical var sets but different target transitions.
- Report diagnostics include enough slice summary information to identify targeted-step slicing.
- Docs accurately describe the new targeted-step exception and the negated bad-step authoring pattern.

## 9. Tests to Add or Update

- `test/checker/checker.test.ts`
  - targeted `alwaysStep` is sliceable only when the predicate has a syntactic `transitionId`
  - targeted-step slice excludes unrelated `sys:pending` writers
  - targeted-step slice preserves verdict parity with full search under no search limits
  - targeted-step slice avoids a low `maxEdges` failure on the small regression model
  - untargeted `alwaysStep` remains full-model
  - grouping key includes transitions, not just vars
- `src/cli/features/check/command.test.ts`
  - update only if CLI human output changes
- Existing tests expected to continue passing:
  - state-property slicing tests in `test/checker/checker.test.ts`
  - search-limit tests in `test/checker/checker.test.ts`
  - CLI search-limit tests in `test/modality/cli.test.ts`

## 10. Verification Commands

Run targeted checks first:

```bash
rtk pnpm exec vitest run test/checker/checker.test.ts
```

If CLI output changes:

```bash
rtk pnpm exec vitest run src/cli/features/check/command.test.ts test/modality/cli.test.ts
```

Run repository checks before considering the issue fixed:

```bash
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
rtk pnpm test
```

If documentation changes are nontrivial:

```bash
rtk pnpm docs:build
```

Optional external validation, only if the Meiwa app is available locally:

```bash
cd /Users/hari/proj/magica/curoco/frontend/tenant-meiwa
rtk npx modality check .modality/models/settings-attributes/AttributesSettingsPage.model.json src/app/settings/attributes/AttributesSettingsPage.props.ts --report .modality/models/settings-attributes/check-report.json --max-states 50000 --max-edges 150000
```

The three issue properties should no longer error with `search limit exceeded: maxEdges=150000`.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if target transition IDs cannot be recovered syntactically from `Property.predicate`; do not use `enabledTransitions` alone as a proxy for edge targeting.
- Stop and report if the focused Meiwa properties use `stepEnqueued(...)` or `stepResolved(...)` without `stepTransitionId(...)`; that is a broader matching/slicing problem and should not be solved by this targeted transition-id fix.
- Stop and report if the target transition’s guard/effect depends on `sys:pending` in a way that makes excluding unrelated pending writers unsound for the property. In that case, add a narrower rule that distinguishes guard/pre dependencies from append/dequeue implementation details before proceeding.
- Stop and report if targeted-step slicing causes a verdict mismatch against full search with `--no-search-limits` on any in-repo regression model.
- Stop and report if adding slice mode diagnostics would require changing the public report schema version; prefer optional additive fields instead.
- Stop and report if the Rust checker needs semantic changes to support this. The intended fix is TypeScript-side slicing plus docs/tests.
- Be careful with positive `alwaysStep` postcondition predicates. Do not make targeted slicing mask their current semantics unless a separate validation/doc change is explicitly accepted.
