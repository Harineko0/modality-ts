# Fix Drip2 Discovered-Model Property Failures

## Goal

Fix the Coffee DX Drip2 discovered-model check failure represented by:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality check .modality/models/app/_drip2/home.model.json app/_drip2/home.props.mjs \
  --max-states 50000 --max-edges 150000
```

The failing properties are:

- `drip2LaneSlotsRemainEmptyInExtractedModel`
- `drip2TimerResetAlwaysEnabled`

The implementation should make these properties robust against the current extracted model behavior without weakening checker soundness or relying on stale probe artifacts.

## Non-goals

- Do not change `leadsToWithin` trigger semantics. `drip2CancelClickImmediatelyOpensDialog` already verifies on the failing discovered model.
- Do not force transition ids to remain unsuffixed when multiple transitions share the same semantic base id; suffixes are currently how the extractor preserves uniqueness.
- Do not special-case Coffee DX names in the checker or extractor.
- Do not update generated `dist/`, `native/`, `docs/build/`, or Coffee DX `.modality` artifacts as part of the library fix.
- Do not hide real source behavior by changing checker verdict interpretation. If the model says an initial value is `"many"`, `always(eq(..., "0"))` should still fail.

## Current-State Findings

- The earlier in-repo route-local `leadsToWithin(stepTransitionId(...))` regression is not enough because the actual Drip2 discovered-model check fails for different reasons.
- Running the explicit probe model passes:
  - `.modality/probe-drip2.model.json + app/_drip2/home.props.mjs` passes all 17 properties.
- Running the discovered model fails:
  - `.modality/models/app/_drip2/home.model.json + app/_drip2/home.props.mjs` fails 2 properties, but `drip2CancelClickImmediatelyOpensDialog` still passes.
- In the discovered Drip2 model:
  - `local:DripHome.laneSlots` has domain `{ kind: "lengthCat" }` and initial `"many"`.
  - Coffee DX source initializes `laneSlots` with `Array.from({ length: LANE_COUNT }, buildIdleSlot)` in `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.tsx:244`.
  - Therefore `always(eq(readVar("local:DripHome.laneSlots"), lit("0")))` is semantically wrong for the current source/model. It should be updated to assert the intended non-empty fixed lane inventory, likely `"many"`, or replaced by a more precise property if the intent is different.
- In the discovered Drip2 model, `LaneTimer` produces four exact transitions:
  - `LaneTimer.onClick.draftSec.gpspae` for `+10秒`
  - `LaneTimer.onClick.draftSec.1ku31x` for `+1分`
  - `LaneTimer.onClick.draftSec.e4lq40` for `+3分`
  - `LaneTimer.onClick.draftSec.1sxiol` for reset to `0`
- The property file hard-codes `const resetTimer = "LaneTimer.onClick.draftSec"` and then checks `always(model, enabled(model, resetTimer), ...)`.
- `enabled(model, transitionId)` is exact-id based. It returns false for an id that is not present in the model, so `drip2TimerResetAlwaysEnabled` fails at the initial state.
- The extractor intentionally disambiguates duplicate transition ids in `src/extract/engine/ts/ids.ts` using stable hashes. This is correct for uniqueness but brittle for property authors who want to refer to a semantic action family.
- Existing simplified tests already cover desired LaneTimer extraction behavior:
  - `test/extraction/architecture.test.ts:401` checks numeric widening and exact setter extraction in a single-file pipeline.
  - `test/extraction/extraction.test.ts:4702` checks similar `LaneTimer` behavior through `extractUseStateSkeleton`.
- The current library lacks a state predicate equivalent of “some enabled transition matches this step predicate” or “some enabled transition has this base id before suffixing.” The public docs only expose exact `enabled(model, transitionId)`.

## Exact File Paths and Relevant Symbols

- Coffee DX source and generated artifacts for reproduction:
  - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs`
  - `/Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_drip2/home.model.json`
  - `/Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_drip2/home.report.json`
  - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.tsx:244`
  - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/components/LaneTimer.tsx:136`
  - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/components/LaneTimer.tsx:143`
  - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/components/LaneTimer.tsx:150`
  - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/components/LaneTimer.tsx:157`
- Modality public DSL:
  - `src/core/props/index.ts`
    - `enabled`
    - `stepTransitionId`
    - `propertyReads`
    - `propertyEnabledTransitions`
  - `src/core/ir/types.ts`
    - `ExprIR`
    - `StepPredicateFlat`
    - `Property`
  - `src/core/artifacts/index.ts`
    - expression/property validation for serialized artifacts
- Rust checker:
  - `crates/checker/src/model.rs`
    - `ExprIR`
  - `crates/checker/src/expr.rs`
    - `transitionEnabled` evaluation
    - allowed-read handling for enabled transitions
  - `crates/checker/src/step.rs`
    - `matches_step_predicate`
- Extraction and id behavior:
  - `src/extract/engine/ts/ids.ts`
    - `withStableTransitionIds`
    - `tagStableIdKey`
  - `src/extract/engine/pipeline/index.ts`
    - `runExtractionPipeline`
    - `widenNumericDomainsFromTransitions`
  - `src/cli/features/extract/command.ts`
    - `runProjectExtractionPipeline`
    - `mergeExtractionPipelineResults`
- Tests:
  - `test/checker/checker.test.ts`
  - `test/kernel/kernel.test.ts`
  - `test/kernel/artifacts.test.ts`
  - `test/extraction/architecture.test.ts`
  - `test/extraction/extraction.test.ts`
  - `test/cli/features/check/command.test.ts` if CLI report behavior changes
- Docs:
  - `docs/reference/property-api.md`
  - `docs/guides/writing-properties.md`

## Existing Patterns to Follow

- Add focused model-checker tests with hand-built `Model` fixtures in `test/checker/checker.test.ts`.
- Add DSL/kernel serialization tests when adding an `ExprIR` node or public helper.
- Keep exact `enabled(model, transitionId)` semantics intact for callers that need exact ids.
- Prefer adding a generic abstraction over Coffee DX-specific ids. The likely abstraction is a new enabledness predicate over transition identity families or step predicates.
- Preserve deterministic transition id suffixing in `withStableTransitionIds`.
- For Coffee DX property fixes, prefer properties that assert source-level behavior rather than generated artifact accidents.

## Recommended Design

Split the fix into two parts:

1. Treat `drip2LaneSlotsRemainEmptyInExtractedModel` as a stale/incorrect property.
   - The current source initializes a fixed number of lane slots, so a `lengthCat` initial of `"many"` is plausible and should not be “fixed” in the extractor.
   - Update the property intent to match source behavior: for example, `always(model, eq(readVar("local:DripHome.laneSlots"), lit("many")), { name: "drip2LaneSlotsRemainFixedInExtractedModel" })`.
   - If the intended invariant is “lane slots are fixed, not empty,” consider a clearer property name in Coffee DX.

2. Add a library affordance for enabledness over a transition family, then use it for `resetTimer`.
   - Add a new public helper such as `enabledMatching(model, stepPredicate)` or `enabledTransitionPrefix(model, idPrefix)`.
   - Prefer `enabledMatching(model, stepTransitionIdPrefix("LaneTimer.onClick.draftSec"))` only if a general step-predicate-based enabledness is too large.
   - The helper should mean “at this state, at least one enabled transition matches the predicate.”
   - This preserves exact-id `enabled(...)` while giving property authors a stable way to express “the reset action remains available” when ids are disambiguated.

If a general matcher helper is too broad for the current checker, implement the narrower `enabledTransitionPrefix(model, prefix)` with a clear name and docs. Do not overload `enabled(...)`.

## Atomic Implementation Steps

1. Add a failing in-repo regression for exact-id enabledness brittleness.
   - In `test/checker/checker.test.ts`, add a small model with a singleton numeric or boolean var and four user click transitions:
     - `LaneTimer.onClick.draftSec.gpspae`
     - `LaneTimer.onClick.draftSec.1ku31x`
     - `LaneTimer.onClick.draftSec.e4lq40`
     - `LaneTimer.onClick.draftSec.1sxiol`
   - Give the reset-like transition a guard that is true initially and effect assigning `draftSec` to `0`.
   - Add an `always` property using the new helper planned in step 2, not exact `enabled(...)`.
   - First commit the test after implementing the helper enough for TypeScript to compile, or keep it as the first red test if adding API scaffolding separately.

2. Add the new public DSL helper and IR.
   - Preferred broad option:
     - Add `ExprIR` variant `{ kind: "transitionEnabledMatching"; step: StepPredicateFlat }`.
     - Add `enabledMatching(_model: Model, step: StepPredicateFlat): ExprIR` to `src/core/props/index.ts`.
   - Narrow fallback:
     - Add `ExprIR` variant `{ kind: "transitionEnabledPrefix"; prefix: string }`.
     - Add `enabledTransitionPrefix(_model: Model, prefix: string): ExprIR`.
   - Update TypeScript artifact validation in `src/core/artifacts/index.ts`.
   - Update read/enabled-transition inference in `src/core/props/index.ts`.
     - For broad matching, infer `sys:route` and any exact transition ids if present.
     - For prefix matching, include `sys:route` and all model transitions whose id starts with the prefix in the allowed enabled-transition set.

3. Implement Rust evaluation for the new enabledness expression.
   - Extend `crates/checker/src/model.rs::ExprIR`.
   - Extend `crates/checker/src/expr.rs` to evaluate the predicate by scanning enabled transitions in the current state.
   - Reuse existing enabledness mechanics and route-local mount checks; do not duplicate guard semantics by hand if an existing helper is available.
   - For the broad helper, reuse `step::matches_step_predicate` where possible. Because matching needs a `StepFacts`, define matching for enabledness carefully:
     - `transitionId`, `transitionClass`, and `labelKind` can be evaluated on the transition directly.
     - `enqueued`, `resolved`, `navigated`, `navigatedTo`, `opId`, `continuation`, and `opArgs` require successor facts and should either be unsupported with a clear error or evaluated by applying effects. Prefer a clear error first to keep scope controlled.
   - For prefix helper, simply check whether any enabled transition id starts with the prefix.

4. Add serialization/kernel tests.
   - Add artifact validation tests in `test/kernel/artifacts.test.ts`.
   - Add a kernel/core test in `test/kernel/kernel.test.ts` or checker test asserting the helper emits the intended IR and verifies when a suffixed transition is enabled.

5. Update docs.
   - Document the helper in `docs/reference/property-api.md`.
   - Add a short note to `docs/guides/writing-properties.md`: use exact `enabled(model, id)` for stable exact ids; use the new family/matching helper when extraction disambiguates duplicate handler ids.

6. Add an extraction-focused regression for LaneTimer id families.
   - In `test/extraction/architecture.test.ts`, extend the existing LaneTimer test or add a new one asserting:
     - duplicate setter transitions get unique suffixed ids,
     - properties should not rely on the unsuffixed base id existing when multiple transitions write the same var.
   - This may be a docs/test-only reinforcement if the helper is implemented at the checker/DSL level.

7. Update or document Coffee DX Drip2 property changes.
   - Do not edit Coffee DX from this repo unless explicitly working in that workspace.
   - Provide the exact intended Coffee DX property changes in a note or issue:
     - Change `drip2LaneSlotsRemainEmptyInExtractedModel` to expect `"many"` or rename/rewrite it.
     - Change `drip2TimerResetAlwaysEnabled` to use the new family/matching helper for `LaneTimer.onClick.draftSec`.
   - If working directly in Coffee DX, update `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs` and rerun the discovered-model check.

8. Re-run targeted and broad validations.
   - Run focused checker/kernel tests first.
   - Run extraction tests touched by the plan.
   - Run the Coffee DX discovered-model check if that workspace is available.

## Per-Step Files to Edit

- Step 1:
  - `test/checker/checker.test.ts`
- Step 2:
  - `src/core/ir/types.ts`
  - `src/core/props/index.ts`
  - `src/core/artifacts/index.ts`
- Step 3:
  - `crates/checker/src/model.rs`
  - `crates/checker/src/expr.rs`
  - Possibly `crates/checker/src/step.rs` if using direct step predicate matching helpers
- Step 4:
  - `test/kernel/artifacts.test.ts`
  - `test/kernel/kernel.test.ts`
  - `test/checker/checker.test.ts`
- Step 5:
  - `docs/reference/property-api.md`
  - `docs/guides/writing-properties.md`
- Step 6:
  - `test/extraction/architecture.test.ts`
  - Possibly `test/extraction/extraction.test.ts`
- Step 7:
  - Optional external workspace file:
    - `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs`
  - Optional in-repo note:
    - `docs/_issues/...` if creating or updating a tracked issue

## Acceptance Criteria

- The library exposes a documented way to assert enabledness for a family/matcher of transitions without relying on a generated hash suffix.
- Exact `enabled(model, transitionId)` remains exact and unchanged.
- A checker regression verifies that a property can assert “some `LaneTimer.onClick.draftSec.*` transition is enabled” when only suffixed ids exist.
- The Drip2 lane-slot property is treated as stale source-specific property logic, not as an extractor/checker bug.
- After applying the corresponding Coffee DX property changes, this command passes:
  ```bash
  cd /Users/hari/proj/coffee-dx/apps/web
  rtk pnpm exec modality check .modality/models/app/_drip2/home.model.json app/_drip2/home.props.mjs \
    --max-states 50000 --max-edges 150000
  ```
- Existing checker, extraction, and property API tests still pass.

## Tests to Add or Update

- `test/checker/checker.test.ts`
  - Add a regression for enabledness over suffixed transition ids.
  - Keep a negative assertion that `enabled(model, "LaneTimer.onClick.draftSec")` remains false when the exact id is absent.
- `test/kernel/artifacts.test.ts`
  - Validate the new expression serializes/deserializes and rejects malformed shapes.
- `test/kernel/kernel.test.ts`
  - Validate the new helper returns the expected `ExprIR`.
- `test/extraction/architecture.test.ts`
  - Add or extend a LaneTimer duplicate-id test documenting suffixed ids and the stable-family property pattern.
- Optional Coffee DX validation only:
  - Update `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs` and rerun the discovered-model check.

## Verification Commands

Run from `/Users/hari/proj/modality-ts` unless noted.

```bash
rtk pnpm build:rust
rtk pnpm vitest run test/checker/checker.test.ts -t "enabled"
rtk pnpm vitest run test/kernel/kernel.test.ts test/kernel/artifacts.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts -t "LaneTimer"
rtk pnpm typecheck
rtk cargo test --manifest-path crates/checker/Cargo.toml
rtk pnpm test
rtk pnpm fix
```

If Coffee DX is available locally, also run:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality check .modality/models/app/_drip2/home.model.json app/_drip2/home.props.mjs \
  --max-states 50000 --max-edges 150000
```

## Risks, Ambiguities, and Stop Conditions

- Stop if the user wants this fixed only in Coffee DX properties and not in `modality-ts`; then the correct change is much smaller and belongs in `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs`.
- Stop if a broad `enabledMatching` implementation would require applying transition effects during state predicate evaluation. In that case, implement the narrower prefix helper first or ask for design confirmation.
- Stop if `local:DripHome.laneSlots` being `"many"` is not the intended source behavior. That would be a Coffee DX app/modeling question, not a checker bug.
- Do not change transition id suffix generation to make `LaneTimer.onClick.draftSec` refer to one arbitrary transition; that would make ids non-unique or order-dependent.
- Do not make `enabled(model, id)` silently perform prefix matching. That would break existing exact-id expectations.
- Keep the helper name explicit enough that property authors know whether they are matching exact ids, prefixes, or step predicates.
- Watch for allowed-read enforcement in Rust expression evaluation. The new enabledness expression must be included in read/allowed-transition inference or it may fail under sliced checks.
