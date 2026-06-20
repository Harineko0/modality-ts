# Diagnostics and Benchmarking for Check Performance

## Goal

Make per-property slice cost, retained state-space causes, and check-time baselines observable before applying semantic fixes.

This is Plan 2 from `.cursor/plans/260619-11-check-performance-overhaul-plan-of-plans.md`. Plan 1 has already landed: extract-side property slice manifests and `.slice.json` model artifacts exist. This plan must build on that implementation rather than recreating it.

The immediate outcome is that `modality extract --props ... --report ...` can answer:

- which property slices were emitted or skipped;
- how large each slice is relative to the full model;
- which variables dominate retained and pruned state-space bits;
- how long slice computation took, separate from artifact writes;
- what reproducible benchmark command produced the current baseline for a Coffee-shaped property.

## Non-goals

- Do not change checker semantics.
- Do not implement the `enabled()` dependency fix from Plan 3.
- Do not make `check` consume persisted extract-side slice artifacts.
- Do not add partial-order reduction, CTL operators, or Rust checker search changes.
- Do not make elapsed timings part of deterministic golden snapshots or fixture equality.
- Do not import the local Coffee DX repository from tests or CI; use a synthetic in-repo fixture unless an implementation agent is explicitly asked to run a local cross-repo benchmark.
- Do not persist sensitive source text, full state values, or full property function bodies in diagnostics.

## Current-state findings

- Plan 1 is implemented in `src/cli/features/extract/command.ts`.
  - `ExtractCommandOptions` now has `propsPath`, `propsPaths`, and `sliceManifestPath`.
  - `runExtractCommand()` loads properties through `loadProperties()`, calls `buildPropertySlicePlan()`, writes `.slice.json` files, writes a `property-slice-manifest`, and adds `diagnostics.propertySlices` to the extraction report.
  - `buildPropertySlicePlan()` is exported and currently computes `compareModelEconomics()` once per emitted property slice.
- `PropertySliceManifestEntry` in `src/core/report/types.ts` already records per-emitted-slice `vars`, `transitions`, `varIds`, `transitionIds`, `retainedBits`, `prunedBits`, `topContributors`, `prunedTopContributors`, system vars, dependency diagnostics, and `sliceKey`.
- `ExtractionPropertySliceDiagnosticsEntry` currently records compact per-property data, but it does not include full-model var/transition counts, contributor arrays, or per-property elapsed timings.
- `sliceStatsLine` in `runExtractCommand()` currently summarizes only property count, emitted count, skipped count, group count, and manifest path.
- `src/check/slicing/contributors.ts` already contains the state-space contributor vocabulary through `StateSpaceContributor`, `buildStateContributors()`, and `compareModelEconomics()`.
- `test/checker/checker.test.ts` already contains a synthetic Coffee-shaped model helper named `coffeeNearFullSliceModel()` and a regression test for `densityOneRequiresConnectedPrinter`. Do not copy that helper blindly into production code; move or recreate a small reusable benchmark fixture under `tools/perf/`.
- `tools/checker-profile.ts` is a simple JSON-emitting profiling script for independent toggles. It is a useful pattern, but it does not cover per-property slicing economics.
- `tools/canary/runner.ts` currently calls `runExtractCommand()` without passing `propsPaths`, so canary extract reports do not yet include extract-side slice diagnostics even when canaries have `check.propsPaths`.
- Shared canary/conformance budget gates live under `tools/shared-gates/`. They currently support full-model state-space budgets, not property-slice budgets.

## Exact file paths and relevant symbols

- `src/cli/features/extract/command.ts`
  - `runExtractCommand()`
  - `createExtractDiagnosticsClock()`
  - `buildPropertySlicePlan()`
  - `PropertySlicePlan`
  - `PropertySliceWrite`
  - `computeSliceKey()`
  - `sliceStatsLine`
- `src/core/report/types.ts`
  - `PropertySliceManifestEntry`
  - `ExtractionPropertySliceDiagnosticsEntry`
  - `ExtractionPropertySliceDiagnostics`
  - `StateSpaceContributor`
- `src/core/artifacts/index.ts`
  - `parsePropertySliceManifestArtifact()`
  - `assertPropertySliceManifestEntry()`
- `src/cli/features/extract/output.ts`
  - `HumanExtractTargetResult`
  - `renderHumanExtractTargets()`
- `src/check/slicing/contributors.ts`
  - `compareModelEconomics()`
  - `buildStateContributors()`
  - `SliceEconomics`
- `tools/checker-profile.ts`
  - Existing profile script to keep or supersede with a new check-performance benchmark.
- New `tools/perf/coffee-shaped-fixture.ts`
  - Synthetic Coffee-shaped model and properties for reproducible benchmark runs.
- New `tools/check-performance-benchmark.ts`
  - JSON-emitting benchmark runner for slice and check baselines.
- `tools/canary/runner.ts`
  - Optional, targeted wire-up to pass canary `propsPaths` into extract so extract reports include slice diagnostics.
- `tools/shared-gates/types.ts`
  - Only edit if adding explicit slice budget fields.
- `tools/shared-gates/validate.ts`
  - Only edit if adding explicit slice budget fields.
- `tools/shared-gates/budgets.ts`
  - Only edit if adding explicit slice budget evaluation.
- `package.json`
  - Add a maintainer script such as `perf:check`.
- Tests:
  - `src/cli/features/extract/command.run.test.ts`
  - `src/cli/features/extract/command.output.test.ts`
  - `test/kernel/artifacts.test.ts`
  - New `test/tools/check-performance-benchmark.test.ts`
  - `test/canaries/runner.test.ts` only if canary extract is wired to props.
- Docs:
  - `docs/_specs/03-checker.md`
  - `docs/architecture/extraction-pipeline.md`
  - New `docs/_benchmarks/check-performance.md` or `docs/_specs/check-performance-baselines.md`

## Existing patterns to follow

- Use `canonicalJson()` for JSON artifacts.
- Keep manifest contents deterministic. Put elapsed timings in extraction reports and benchmark output, not in the slice manifest.
- Keep diagnostic arrays sorted by stable keys:
  - property name, then property index;
  - contributor bits descending, then `varId`;
  - var IDs and transition IDs lexicographically.
- Follow the existing report-diagnostics style: compact structured report fields, human output as one or two summary lines.
- Follow `compareModelEconomics()` for retained/pruned bit calculations instead of inventing a second state-space metric.
- Follow `tools/checker-profile.ts` for a CLI benchmark script: use `tsx`, emit JSON, and avoid CI-only assumptions.
- Keep benchmark elapsed-time assertions out of normal unit tests. Tests may assert that timings are finite numbers, not exact values.
- Prefer a synthetic in-repo Coffee-shaped model over importing `/Users/hari/proj/coffee-dx` in tests.

## Proposed diagnostic shape

Keep the manifest deterministic and source-inspection friendly. Add missing size context to emitted manifest entries:

```ts
type PropertySliceManifestEntry =
  | {
      property: string;
      propertyIndex: number;
      status: "emitted";
      mode: "state" | "targetedStep" | "full";
      path: string;
      fullVars: number;
      fullTransitions: number;
      vars: number;
      transitions: number;
      retainedBits: number;
      prunedBits: number;
      topRetainedContributors: readonly StateSpaceContributor[];
      topPrunedContributors: readonly StateSpaceContributor[];
      // existing dependency fields remain
      sliceKey: string;
    }
  | {
      property: string;
      propertyIndex: number;
      status: "skipped";
      reason: string;
    };
```

Use the clearer `topRetainedContributors` / `topPrunedContributors` names for property slice manifests and extraction diagnostics. Do not rename check-report `sliceSummaries[].topContributors` in this plan unless required by type sharing; check reports are not the target surface here.

Add report-only timing fields:

```ts
interface ExtractionPropertySliceDiagnosticsEntry {
  property: string;
  propertyIndex: number;
  status: "emitted" | "skipped";
  mode?: "state" | "targetedStep" | "full";
  path?: string;
  fullVars?: number;
  fullTransitions?: number;
  vars?: number;
  transitions?: number;
  retainedBits?: number;
  prunedBits?: number;
  topRetainedContributors?: readonly StateSpaceContributor[];
  topPrunedContributors?: readonly StateSpaceContributor[];
  sliceKey?: string;
  reason?: string;
  elapsedMs?: number;
}

interface ExtractionPropertySliceDiagnostics {
  manifestPath: string;
  properties: number;
  emitted: number;
  skipped: number;
  slices: number;
  totalElapsedMs?: number;
  largestRetainedProperty?: string;
  largestRetainedBits?: number;
  largestPrunedBits?: number;
  entries?: readonly ExtractionPropertySliceDiagnosticsEntry[];
}
```

## Atomic implementation steps

1. Extend property-slice diagnostics without changing semantics.
   - In `src/core/report/types.ts`, add `fullVars`, `fullTransitions`, `topRetainedContributors`, and `topPrunedContributors` to emitted `PropertySliceManifestEntry`.
   - Add the same fields plus `elapsedMs` to `ExtractionPropertySliceDiagnosticsEntry`.
   - Add optional aggregate fields to `ExtractionPropertySliceDiagnostics`: `totalElapsedMs`, `largestRetainedProperty`, `largestRetainedBits`, and `largestPrunedBits`.
   - Prefer replacing manifest field names `topContributors` and `prunedTopContributors` with `topRetainedContributors` and `topPrunedContributors` in this experimental artifact surface. If the implementation agent chooses to avoid a rename, it must still add explicit retained/pruned names to extraction report diagnostics.

2. Update manifest parsing.
   - In `src/core/artifacts/index.ts`, update `parsePropertySliceManifestArtifact()` validation for the new emitted-entry fields.
   - Require `fullVars` and `fullTransitions` for emitted entries.
   - Validate contributor arrays through the same shape checks used for existing `topContributors` and `prunedTopContributors`.
   - Keep skipped entries unchanged.

3. Measure per-property slice planning time.
   - In `src/cli/features/extract/command.ts`, measure elapsed time inside `buildPropertySlicePlan()` around each property's skip/slice/economics work.
   - Use `performance.now()` for per-property timing. Do not include file writes.
   - Record `elapsedMs` only in `diagnosticsEntries`, not in `manifest.properties`.
   - Compute `totalElapsedMs` from diagnostic entries.
   - Preserve deterministic manifest output when `now` is fixed.

4. Add full-model context and clearer contributor names.
   - In each emitted manifest entry from `buildPropertySlicePlan()`, add:
     - `fullVars: model.vars.length`
     - `fullTransitions: model.transitions.length`
     - `topRetainedContributors: economics.topContributors`
     - `topPrunedContributors: economics.prunedTopContributors`
   - In each emitted extraction diagnostic entry, include `fullVars`, `fullTransitions`, retained/pruned contributors, bits, and `sliceKey`.
   - For skipped diagnostic entries, include `elapsedMs` and the explicit skip reason.
   - Sort and limit contributor arrays through existing `compareModelEconomics()` behavior.

5. Add CLI-visible slice economics.
   - In `runExtractCommand()`, enhance `sliceStatsLine` or add a second compact line that names the largest retained slice.
   - Keep the line short and stable, for example:
     - `slice-economics=largest:densityOneRequiresConnectedPrinter retained:12.0bits pruned:90.0bits topRetained:printerStatus(1.6) topPruned:orderHistoryPayload(16.0)`
   - If adding a new line, update `ExtractCommandResult`, `HumanExtractTargetResult`, and `renderHumanExtractTargets()`.
   - Do not print all contributor arrays in human output.

6. Create a reusable synthetic Coffee-shaped benchmark fixture.
   - Add `tools/perf/coffee-shaped-fixture.ts`.
   - Move the shape of `coffeeNearFullSliceModel()` from `test/checker/checker.test.ts` into a reusable fixture, or recreate a smaller equivalent model there.
   - Export:
     - `coffeeShapedPerformanceModel(): Model`
     - `coffeeShapedPerformanceProperties(model: Model): readonly Property[]`
     - stable IDs for `densityOneRequiresConnectedPrinter` and related benchmark properties.
   - Keep the fixture model-level. Do not require React extraction for this benchmark phase.
   - After the fixture exists, update `test/checker/checker.test.ts` to use it only if that reduces duplication cleanly; otherwise leave test code alone and keep the benchmark fixture independent.

7. Add a JSON benchmark runner.
   - Add `tools/check-performance-benchmark.ts`.
   - Accept a fixture flag, initially defaulting to `coffee-shaped`.
   - For the Coffee-shaped fixture:
     - construct the model and properties;
     - call `buildPropertySlicePlan(model, properties, "benchmark.model.json", "benchmark.slices.json", fixedDate)`;
     - run `checkModel(model, properties, { slicing: false })`;
     - run `checkModel(model, properties, { slicing: true })`;
     - emit JSON with:
       - fixture ID;
       - property names;
       - full var/transition counts;
       - full state-space bits from `buildStateContributors(model)`;
       - per-property slice vars/transitions/retained/pruned bits/top contributors;
       - unsliced states/edges/depth/elapsedMs;
       - sliced states/edges/depth/elapsedMs;
       - speedup ratio when both timings are positive.
   - Keep the runner non-gating by default. It should produce a baseline artifact humans can compare across runs.
   - Add `package.json` script `perf:check`: `tsx tools/check-performance-benchmark.ts`.

8. Record a reproducible baseline procedure.
   - Add `docs/_benchmarks/check-performance.md` or `docs/_specs/check-performance-baselines.md`.
   - Document:
     - the original Coffee DX motivating property and observed rough numbers from the plan-of-plans;
     - the in-repo synthetic benchmark command;
     - the fact that elapsed time is environment-dependent;
     - the deterministic fields to compare first: full vars/transitions, slice vars/transitions, retained/pruned bits, states, edges, depth.
   - If committing a sample JSON baseline, store it under `docs/_benchmarks/` and make clear that elapsed fields are illustrative, not test goldens.

9. Optionally wire canary extract to property slices.
   - In `tools/canary/runner.ts`, pass `propsPaths` into `runExtractCommand()` when `canary.check?.propsPaths` exists.
   - Add the emitted slice manifest path to `canaryResults[].reportPaths` only if it exists.
   - Do not add slice budget gates in the same edit unless the diagnostics-only pieces are already stable.
   - If this makes existing active canaries meaningfully slower, stop and report rather than hiding the cost.

10. Add optional slice budget gates only if needed.
   - If the implementation agent chooses to make canaries enforce slice economics, add explicit budget fields rather than overloading full-model budgets:
     - `maxLargestSliceRetainedBits`
     - `maxLargestSliceVars`
     - `maxLargestSliceTransitions`
   - Edit `tools/shared-gates/types.ts`, `tools/shared-gates/validate.ts`, and `tools/shared-gates/budgets.ts`.
   - Evaluate these budgets from `extractionReport.diagnostics.propertySlices.entries`.
   - Keep this step small and skip it if it causes broad canary manifest churn.

## Per-step files to edit

- Step 1:
  - `src/core/report/types.ts`
- Step 2:
  - `src/core/artifacts/index.ts`
  - `test/kernel/artifacts.test.ts`
- Steps 3 and 4:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/command.run.test.ts`
- Step 5:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/output.ts`
  - `src/cli/features/extract/command.output.test.ts`
- Step 6:
  - `tools/perf/coffee-shaped-fixture.ts`
  - optionally `test/checker/checker.test.ts`
- Step 7:
  - `tools/check-performance-benchmark.ts`
  - `package.json`
  - `test/tools/check-performance-benchmark.test.ts`
- Step 8:
  - `docs/_benchmarks/check-performance.md` or `docs/_specs/check-performance-baselines.md`
  - `docs/_specs/03-checker.md`
  - `docs/architecture/extraction-pipeline.md`
- Step 9:
  - `tools/canary/runner.ts`
  - `test/canaries/runner.test.ts`
- Step 10:
  - `tools/shared-gates/types.ts`
  - `tools/shared-gates/validate.ts`
  - `tools/shared-gates/budgets.ts`
  - `test/canaries/manifest.test.ts`
  - `test/canaries/runner.test.ts`

## Acceptance criteria

- Extract reports include per-property slice diagnostics with:
  - property name;
  - property index;
  - emitted/skipped status;
  - skip reason when skipped;
  - slice mode when emitted;
  - full vars/transitions;
  - slice vars/transitions;
  - retained/pruned bits;
  - top retained/pruned contributors;
  - slice key;
  - elapsed slice-planning time.
- Slice manifests include full-model var/transition counts and explicit retained/pruned contributor names, while remaining deterministic for a fixed `now`.
- Human extract output includes a compact slice economics summary that points at the largest retained property and top retained/pruned variables.
- Elapsed timings are present in reports and benchmark output, but no test asserts exact timing values.
- The synthetic Coffee-shaped benchmark can be run from `package.json` and emits machine-readable JSON.
- The benchmark output records full model size, slice size, retained/pruned bits, check stats, and check elapsed time for the motivating property shape.
- If canary extract is wired to props, active canary reports can expose extract-side slice diagnostics without changing `check` behavior.
- No diagnostics persist sensitive source text, full state values, or function bodies.

## Tests to add or update

- `src/cli/features/extract/command.run.test.ts`
  - Assert `report.diagnostics.propertySlices.entries` includes `fullVars`, `fullTransitions`, retained/pruned contributor arrays, and finite `elapsedMs` for emitted slices.
  - Assert skipped entries include reason and finite `elapsedMs`.
  - Assert manifest JSON does not include `elapsedMs`.
  - Assert manifest entries include deterministic full/slice counts and explicit retained/pruned contributor names.
- `src/cli/features/extract/command.output.test.ts`
  - Assert human output includes the compact slice economics line when slices are emitted.
  - Assert the line is omitted when extraction runs without props.
  - Assert output does not dump full contributor arrays.
- `test/kernel/artifacts.test.ts`
  - Update valid manifest tests for `fullVars`, `fullTransitions`, `topRetainedContributors`, and `topPrunedContributors`.
  - Add malformed manifest tests for missing full counts and malformed contributor arrays.
- New `test/tools/check-performance-benchmark.test.ts`
  - Execute or directly call benchmark helpers with the Coffee-shaped fixture.
  - Assert JSON has stable structural fields.
  - Assert elapsed fields are numbers greater than or equal to zero, not exact values.
- `test/canaries/runner.test.ts`
  - Only if step 9 is implemented: assert `runExtractCommand()` receives `propsPaths` or that canary extract reports include `diagnostics.propertySlices`.
- `test/canaries/manifest.test.ts`
  - Only if step 10 is implemented: assert new slice budget fields validate correctly.

## Verification commands

Run focused checks first:

```bash
rtk pnpm test -- src/cli/features/extract
rtk pnpm test -- test/kernel/artifacts.test.ts
rtk pnpm test -- test/tools/check-performance-benchmark.test.ts
```

If canary wiring or budget gates are touched:

```bash
rtk pnpm test -- test/canaries
rtk pnpm ci:canaries -- --canary examples-demo-app
```

Run the benchmark manually and inspect JSON:

```bash
rtk pnpm perf:check
```

Then run project-level checks:

```bash
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If any checker-facing imports or property fixture reuse touches checker tests, also run:

```bash
rtk pnpm test -- test/checker/checker.test.ts
```

## Risks, ambiguities, and stop conditions

- Stop and report if adding contributor arrays to extraction diagnostics makes reports too large for normal use. Prefer limiting to top 10 or top 20 contributors over dropping the field entirely.
- Stop and report if per-property timings accidentally include file writes or full extraction time. The timing must isolate skip/slice/economics work.
- Stop and report if deterministic manifests acquire elapsed timings or environment-dependent ordering.
- Stop and report if manifest field renaming causes broad unrelated churn outside extract/report/artifact tests.
- Stop and report if the benchmark fixture requires duplicating a large private Coffee DX model or importing files outside this repository.
- Stop and report if passing canary props into extract makes active canaries materially slower or changes canary behavior beyond adding diagnostics.
- Stop and report if slice budget gates require changing the public `modality ci` surface in this plan.
- Stop and report if diagnostics would require storing source snippets, full state payloads, or property implementation source text.
