# Plan 4: Slicing Improvements

## Goal

Reduce remaining unnecessary state space after Plans 1, 2, and 3 by improving per-property slicing rules in ways that are measurable from extract-side slice artifacts and sound by construction.

This plan assumes the following earlier phases are already implemented:

- Extract can emit per-property slice models and a `*.slices.json` manifest.
- Extract and check reports include slice diagnostics and economics.
- `enabled(model, transitionId)` dependencies are guard/mount-only and retained transitions are observation-only.

The concrete target is to shrink large retained contributors that remain visible in `PropertySliceManifestEntry.topRetainedContributors`, especially record-shaped local state, route/mount-related system vars, pending-queue role vars, and transitions retained only by conservative directional closure.

## Non-goals

- Do not add partial-order reduction.
- Do not add CTL operators or change property semantics.
- Do not replace the Rust checker or change native search behavior unless a TypeScript slice change exposes a validator mismatch that must be mirrored.
- Do not make `modality check` load persisted extract-side slice artifacts in this phase.
- Do not introduce property-name-specific or Coffee-DX-specific pruning.
- Do not silently fall back to full-model checking for sliceable state properties.
- Do not remove existing check-side slicing while extract-side slice artifacts are still used as diagnostics and parity evidence.
- Do not broaden dependencies in order to make tests pass unless the broader dependency is documented as required for soundness.

## Current-state findings

- src/check/slicing/slice-model.ts is the shared slicing entry point for check-side slicing and extract-side slice artifact planning. Important symbols:
  - `sliceModelForCheckProperty(model, property)`
  - `sliceModelForProperty(model, property, options)`
  - `sliceModelForTargetedStepProperty(model, property, deps)`
  - `collectPropertyDependencyRequest(model, property)`
  - `propertySlicingSkipReason(model, property)`
  - `finalizeSlicedTransitions(...)`
- src/check/slicing/dependency-graph.ts computes dependency closure. Important symbols:
  - `buildModelDependencyGraph(model)`
  - `computeStateSliceClosure(graph, input)`
  - `computeTargetedStepSliceClosure(graph, input)`
  - `reachVarsThroughTransitions(...)`
  - `expandMountGuardDependencies(...)`
  - `enabledTransitionGuardVars(...)`
  - `enabledTransitionSeedVars(...)`
  - `shouldSkipUnrelatedHavocTransition(...)`
- src/check/slicing/predicate-relevance.ts already prunes some transitions for simple directional predicates. Important symbols:
  - `analyzeDirectionalPredicate(expr)`
  - `isTransitionDirectionallyRelevant(transition, neededWrittenVars, analysis)`
  - Current support is simple `eq` and `neq` clauses over whole-variable `read(...)` and literal values, with `and` and `or` accepted only when every nested clause is simple.
- src/core/ir/field-pruning.ts already computes record field usage metadata and per-property pruned field paths for economics. Important symbols:
  - `buildFieldPruningMetadata(model)`
  - `collectExprReadFieldPaths(expr, varId?)`
  - `collectUpdateFieldPaths(expr)`
  - `exprReadsWholeVar(expr, varId)`
  - `propertyPrunedFieldPaths(model, property)`
  - `prunedFieldPathsForSlice(full, slice, properties)`
- src/cli/features/extract/model-postprocess.ts attaches field-pruning metadata through `attachFieldPruning(model)`, but the current slice model still retains whole vars and whole domains.
- src/check/slicing/contributors.ts reports retained and pruned bit economics with optional `prunedFieldPaths`, but these are currently diagnostic only.
- src/cli/features/extract/command.ts builds extract-side property slice manifests through `buildPropertySlicePlan(...)` and writes:
  - emitted slice model artifacts
  - `PropertySliceManifestEntry.varIds`
  - `PropertySliceManifestEntry.transitionIds`
  - retained/pruned bits
  - top retained/pruned contributors
  - retained/pruned system vars
  - pending-queue dependencies
  - mount-scope dependencies
  - closure fallback reasons
- src/core/artifacts/index.ts validates property slice manifests via `parsePropertySliceManifestArtifact(json)`.
- src/core/ir/validator.ts validates sliced models with `validateModel(model, { sliced: true })` and validates expression read paths against domains.
- Existing tests already cover important Plan 1-3 behavior:
  - test/check/slicing-parity.test.ts
  - test/check/slicing-dependency-graph.test.ts
  - test/extract/field-pruning.test.ts
  - src/cli/features/extract/command.run.test.ts
  - src/cli/features/extract/command.output.test.ts
  - src/cli/features/extract/command.report.test.ts
  - test/checker/checker.test.ts

## Exact file paths and relevant symbols

Primary files to edit:

- src/check/slicing/slice-model.ts
  - Extend the slice result path to optionally produce per-slice domain refinements.
  - Keep `sliceModelForCheckProperty` as the canonical entry point used by both check and extract.
  - Keep `finalizeSlicedTransitions` responsible for removing or stripping transitions after vars/domains are chosen.
- src/check/slicing/dependency-graph.ts
  - Add narrowly scoped dependency-closure refinements only when tests demonstrate a concrete over-retention.
  - Preserve the least-fixpoint shape of `reachVarsThroughTransitions`.
- src/check/slicing/predicate-relevance.ts
  - Extend directional analysis for additional safe expression shapes, if manifest diagnostics show closure fallback or irrelevant transitions dominate retained bits.
- src/core/ir/field-pruning.ts
  - Reuse existing path collection functions.
  - Add helpers for deriving a property-specific record-domain projection if field/path-sensitive slicing is implemented.
- src/core/ir/validator.ts
  - Update validation only if sliced record domains or stripped effects need sliced-mode allowances.
- src/cli/features/extract/command.ts
  - Ensure `buildPropertySlicePlan(...)` records before/after economics from actual emitted slice models.
  - Add manifest/report fields only if the existing contributor fields cannot express the new evidence.
- src/core/report/types.ts
  - Add schema fields only if needed for field-sensitive retained economics.
- src/core/artifacts/index.ts
  - Mirror any manifest/report schema additions in artifact parsers.
- [docs/_specs/03-checker.md](docs/_specs/03-checker.md)
  - Document any new sound slicing rule.
- docs/reference/property-api.md
  - Update only if user-visible property dependency behavior changes.

Secondary files to inspect before editing:

- src/core/ir/types.ts
  - `ExprIR`
  - `EffectIR`
  - `Model`
  - `StateVarDecl`
  - `FieldPruningEntry`
  - `FieldPruningMetadata`
- src/check/check-model.ts
  - Slice grouping and check diagnostics are useful parity examples.
- src/check/types.ts
  - Update only if check-side diagnostics need new slicing detail.

## Existing patterns to follow

- Use `sliceModelForCheckProperty(...)` for both extract and check paths so emitted artifacts and transient check slicing remain identical.
- Use canonical JSON through `canonicalJson(...)` when writing artifacts.
- Preserve deterministic ordering by sorting property names, var ids, transition ids, field paths, manifest entries, and diagnostics.
- Keep artifact schemas on `schemaVersion: 1` with explicit optional fields rather than separate compatibility layers.
- Treat diagnostics as evidence. Implement a slicing rule only after a small fixture can show a before/after reduction in retained contributors.
- Keep slicing conservative. Every improvement must be expressible as "this slice is still an over-approximation of the property-relevant behavior."
- Prefer helper functions in `src/core/ir/field-pruning.ts` over duplicating expression or effect walkers.
- Follow the test style already used in `test/check/slicing-parity.test.ts` and `test/check/slicing-dependency-graph.test.ts`: small hand-authored models with explicit vars, transitions, and properties.
- Keep tests snapshot-light. Assert key manifest fields, retained/pruned contributors, and verdict parity rather than brittle full JSON blobs.
- Keep docs aligned with behavior changes in `docs/_specs/03-checker.md`.

## Atomic implementation steps

### Step 1: Add an evidence fixture for remaining over-retention

Create a narrow test fixture that reproduces the next largest known retained contributor after Plans 1-3. Prefer a synthetic model inside this repo over importing Coffee DX.

Use one or more of these fixture shapes:

- A record var with many independent fields where the property reads one field path.
- A route-local state var whose mount guard requires only `location-current`, while sibling route-local vars and unrelated route/history vars are large.
- A reachable predicate where simple directional analysis currently falls back because the predicate uses a supported-safe shape not yet recognized.
- A pending-queue property that should retain one queue fact but not unrelated queue payload fields.

The test should first assert the current retained economics from `buildPropertySlicePlan(...)` or `compareModelEconomics(...)` so the implementation has a concrete before number.

Per-step files to edit:

- test/check/slicing-parity.test.ts
- test/check/slicing-dependency-graph.test.ts
- test/extract/field-pruning.test.ts, if the evidence involves record fields
- src/cli/features/extract/command.run.test.ts, if manifest evidence is required

Stop and report if:

- No large retained contributor can be reproduced inside a small synthetic model.
- The only observed blowup comes from interleavings rather than retained vars or transitions. That belongs to Plan 5.

### Step 2: Implement property/path-sensitive record-domain slicing

If Step 1 shows whole-record retention dominates, make slices retain only field paths required by the property and retained transition semantics.

Recommended design:

1. Add helper(s) in src/core/ir/field-pruning.ts that can derive retained field paths for a given `Model`, `Property`, retained var id, and retained transitions.
2. Treat a whole-var read as requiring the full domain.
3. Treat path reads from property predicates, transition guards, effect expressions, mount guards, and retained effect writes as requiring those paths.
4. Do not project a domain when any retained expression or effect reads the whole var.
5. Do not project domains for vars whose domain is not `record` in this phase.
6. Do not project domains in a way that invalidates existing initial values or retained assignments.
7. Keep any new helper pure and deterministic.

Potential implementation shape:

- Add a helper such as `projectRecordDomainForSlice(...)` or `sliceRecordDomainByPaths(...)` in core IR field-pruning utilities.
- In `sliceModelForProperty(...)` and `sliceModelForTargetedStepProperty(...)`, after the retained vars are selected and before returning the sliced model, map retained `StateVarDecl` entries through the projection helper.
- Ensure projection includes all paths needed by `finalizeSlicedTransitions(...)` after observation-only stripping.
- If assigning an updated full record cannot be projected safely, keep the full domain for that var and record the retained path reason in diagnostics.

Per-step files to edit:

- src/core/ir/field-pruning.ts
- src/check/slicing/slice-model.ts
- src/core/ir/validator.ts, only if validation needs sliced-mode allowances
- test/extract/field-pruning.test.ts
- test/check/slicing-parity.test.ts

Stop and report if:

- Projecting record domains requires rewriting arbitrary effects instead of filtering unused domains.
- A retained effect needs fields outside the projected domain and cannot be soundly rewritten.
- The Rust checker rejects projected sliced models for reasons that imply a semantic mismatch.

### Step 3: Preserve and expose field-sensitive economics

Once record-domain slicing changes actual emitted slice models, ensure the manifest and report evidence reflect the new retained state-space size.

Required behavior:

- `buildPropertySlicePlan(...)` must compute retained/pruned bits from the actual emitted slice model.
- Existing `topRetainedContributors[].prunedFieldPaths` should remain meaningful. If actual domain projection makes this obsolete or insufficient, add an explicit optional field such as retained field paths or projected field paths.
- `parsePropertySliceManifestArtifact(...)` must validate any new manifest fields.
- Extraction output should still show compact `slice-economics=...` lines with the largest retained property.

Per-step files to edit:

- src/check/slicing/contributors.ts
- src/cli/features/extract/command.ts
- src/core/report/types.ts
- src/core/artifacts/index.ts
- src/cli/features/extract/command.run.test.ts
- src/cli/features/extract/command.output.test.ts

Stop and report if:

- Existing economics cannot distinguish "whole var retained" from "field-projected var retained" without a broader report schema change.
- Manifest additions would require changing `schemaVersion`.

### Step 4: Extend directional predicate relevance only for provably safe shapes

If diagnostics show `closureFallback: "directional predicate shape unsupported"` or irrelevant transitions dominate for reachable predicates, extend src/check/slicing/predicate-relevance.ts narrowly.

Safe candidate extensions:

- Recognize `not(eq(read(x), lit(v)))` as `neq(read(x), lit(v))`.
- Recognize `not(neq(read(x), lit(v)))` as `eq(read(x), lit(v))`.
- Recognize nested `and` of already-supported clauses.
- For `or`, only keep current behavior if every branch is independently simple and the rule remains an over-approximation. If uncertain, do not change `or`.
- Recognize path reads only if record-domain projection and effect assignment analysis can prove the path write contributes to the path-level predicate. Otherwise keep whole-var behavior.

Do not add clever symbolic reasoning. Unsupported shapes should keep producing `closureFallback` and broad closure.

Per-step files to edit:

- src/check/slicing/predicate-relevance.ts
- src/check/slicing/dependency-graph.ts, only if path-level or clause-level write filtering needs graph support
- test/checker/checker.test.ts
- test/check/slicing-parity.test.ts

Stop and report if:

- The proposed directional rule cannot be stated as a sound over-approximation.
- The rule depends on transition ordering, fairness, or search semantics rather than static dependency analysis.

### Step 5: Refine route/mount and pending-queue closure only where diagnostics prove over-retention

Use manifest fields to identify whether retained system vars are large:

- `retainedSystemVars`
- `pendingQueueDependencies`
- `mountScopeDependencies`
- `topRetainedContributors`

Candidate refinements:

- For mount-local vars, keep only mount guard reads needed for retained mount-local vars; do not reverse-expand sibling vars sharing the same guard.
- For guard-only enabled observations, continue stripping effects and writes through `stripObservationOnlyTransition(...)`.
- For pending queues, retain a queue role var only when a property step fact or retained transition effect actually requires queue contents.
- For retained transitions that write only pruned pending queues, continue stripping enqueue/dequeue effects when no queue is retained.

Several of these behaviors already exist. Add a new rule only if the evidence fixture shows a concrete remaining over-retention.

Per-step files to edit:

- src/check/slicing/dependency-graph.ts
- src/check/slicing/slice-model.ts
- test/check/slicing-dependency-graph.test.ts
- test/check/slicing-parity.test.ts
- test/kernel/mounted-scope.test.ts, if mount diagnostics change

Stop and report if:

- A route or pending-queue rule would remove a var required to evaluate a retained guard, mount condition, step fact, or retained effect.
- The proposed rule changes model semantics rather than dependency analysis.

### Step 6: Add metamorphic parity tests for every changed rule

For each implemented rule, add a test that compares sliced and unsliced verdicts.

Required parity assertions:

- `checkModel(model, [property])` and `checkModel(model, [property], { slicing: true })` produce the same verdict status.
- Extract-side `buildPropertySlicePlan(...)` produces the same var/transition ids as `sliceModelForCheckProperty(...)`.
- Any field/domain projection still parses and validates as a model artifact.
- If a rule intentionally keeps a broad dependency, the diagnostics explain why through existing fields or a new explicit reason.

Per-step files to edit:

- test/check/slicing-parity.test.ts
- test/checker/checker.test.ts
- src/cli/features/extract/command.run.test.ts
- test/extract/field-pruning.test.ts, if record projection is implemented

Stop and report if:

- Slicing changes a verdict for any affected property class.
- The test only passes by switching the property to full-mode slicing.

### Step 7: Document the new slicing rule and limitations

Update docs after tests pass.

Required docs:

- In [docs/_specs/03-checker.md](docs/_specs/03-checker.md), describe the new rule as part of per-property cone-of-influence slicing.
- If field/path-sensitive slicing is added, explicitly document when a retained record var can be domain-projected and when it must remain whole.
- If directional relevance is extended, document supported shapes and the conservative fallback.
- If route/pending behavior changes, document which role vars enter a slice and why.

Per-step files to edit:

- [docs/_specs/03-checker.md](docs/_specs/03-checker.md)
- docs/reference/property-api.md, only for user-visible property dependency behavior

Stop and report if:

- The implementation behavior cannot be described simply enough for the checker spec.

## Acceptance criteria

- Each implemented slicing improvement has a before/after diagnostic from an extract-side slice artifact or `buildPropertySlicePlan(...)` test fixture.
- The largest retained contributor in the relevant test fixture shrinks in retained bits, retained field paths, retained system vars, or retained transitions.
- `sliceModelForCheckProperty(...)` remains the single source of truth for both check-side slicing and extract-side slice artifacts.
- Extract-side and check-side slicing produce identical var ids and transition ids for affected properties.
- Slicing on vs off produces the same verdict status for every affected property kind.
- Slice artifacts parse through `parseModelArtifact(...)` and validate with sliced-mode validation where applicable.
- No broad full-model fallback is introduced for sliceable state properties.
- `enabled(...)` remains guard/mount-only and observation-only for retained transitions.
- Diagnostics remain deterministic and explain conservative retention or fallback.
- Docs state every new slicing rule and its conservative fallback.

## Tests to add or update

- Add a record-field slice fixture in test/extract/field-pruning.test.ts if field/path-sensitive projection is implemented.
- Add a metamorphic sliced-vs-unsliced verdict test in test/check/slicing-parity.test.ts for each new slicing rule.
- Add dependency closure tests in test/check/slicing-dependency-graph.test.ts for route/mount or pending-queue refinements.
- Add Rust-backed checker parity tests in test/checker/checker.test.ts when actual emitted slice models have changed.
- Add extract manifest tests in src/cli/features/extract/command.run.test.ts for before/after economics and any new manifest fields.
- Update src/cli/features/extract/command.output.test.ts only if compact output changes.
- Update src/cli/features/extract/command.report.test.ts only if extraction report diagnostics change.

## Verification commands

Run focused checks first:

```bash
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm test -- test/check/slicing-dependency-graph.test.ts
rtk pnpm test -- test/extract/field-pruning.test.ts
rtk pnpm test -- src/cli/features/extract/command.run.test.ts
rtk pnpm test -- test/checker/checker.test.ts
```

Then run broader validation:

```bash
rtk pnpm architecture
rtk pnpm typecheck
rtk pnpm fix
```

Before declaring Plan 4 complete, run:

```bash
rtk pnpm test
rtk pnpm phase7
```

If record-domain projection or sliced model validation touches native checker assumptions, also run:

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
```

Optional performance evidence, if the local benchmark fixture is configured:

```bash
rtk pnpm perf:check
```

## Risks, ambiguities, and stop conditions

- Field/path-sensitive slicing can become unsound if retained effects still depend on pruned fields. Stop unless every projected domain is justified by retained property, guard, mount, and effect usage.
- `updateField(...)` effects over records may require whole-record retention unless the implementation can safely prove all touched paths are retained.
- Directional pruning over `or` predicates is easy to under-approximate. Keep broad closure unless the rule is obviously conservative.
- Pending queues encode step facts and async continuation semantics. Do not prune a queue or queue fields if a retained step predicate, enqueue, dequeue, or `readOpArg` can observe them.
- Route and mount vars are system vars but can still be semantic dependencies. Do not prune a location or tree var needed to evaluate a mount condition.
- Manifest economics may need adjustment if retained domains shrink without changing `varIds`. If the current schema cannot express the evidence clearly, add optional fields and parser validation rather than relying on comments or terminal-only output.
- If sliced and unsliced verdicts diverge, stop immediately and minimize the counterexample before continuing.
- If the largest remaining contributor is transition interleaving rather than retained state, stop and report that the next improvement belongs in Plan 5 partial-order reduction.
- If an improvement requires changing model semantics, stop and report. Plan 4 is dependency analysis, not a semantic rewrite.
