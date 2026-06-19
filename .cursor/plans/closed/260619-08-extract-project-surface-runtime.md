# Extract Project Surface Runtime Diagnostics and Caching

## Goal

Fix `docs/_issues/semantic-project-surface-increases-extract-runtime.md` by making single-entry `modality extract` pay less duplicate work for the semantic project surface, and by reporting which surface-building phases dominate runtime when extraction intentionally expands beyond the requested file.

The fix should preserve the correctness wins from semantic reachability: imported client components, server action aliases, route inventory, and type/domain inference must remain available. The intended first pass is not "make extraction entry-file-only by default"; it is to remove avoidable duplication and make broad-surface cost transparent and gateable.

## Non-goals

- Do not remove `sourceWithReachableImports()` or revert to text-only extraction.
- Do not silently narrow the default extraction surface in a way that drops imported interactions or effect APIs.
- Do not introduce process-global caches that can leak across CLI invocations or tests.
- Do not add wall-clock-only assertions to unit tests.
- Do not change plugin SPI unless a specific plugin needs a narrow, typed diagnostics field.
- Do not implement a new user-facing `--narrow` or `--entry-only` mode in this plan. Leave that as a follow-up after diagnostics show where it belongs.
- Do not edit `docs/build/**` generated docs artifacts.

## Current-State Findings

- `src/cli/features/extract/command.ts` runs extraction as one long sequence and only emits final model/report lines. It does not collect phase timing, source-count, or surface-expansion diagnostics.
- `src/cli/features/extract/extraction-project.ts` `buildClientProjectSurface()` creates a semantic project from `project.rawEntries` as a module resolver, calls `sourceWithReachableImports()`, then creates a second semantic project from `includedSources`.
- `src/cli/features/extract/project.ts` `sourceWithReachableImports()` repeatedly reparses each module's text with local `createSourceFile()` in helpers such as `seedsForModule()`, `followDeclarationReference()`, the fixpoint loop, type-dependency expansion, output surface building, fetch discovery, and server-action alias discovery.
- `sourceWithReachableImports()` already receives a `SemanticModuleResolver`; when the resolver has a `SourceFile` for a loaded module, the current local parse cache can reuse that instead of recreating a syntax tree.
- `src/cli/features/extract/extraction-project.ts` `runProjectExtractionPipeline()` precomputes `projectSummary` and `sharedDiscovery` for multi-fragment extraction, but the single-fragment path still calls `runExtractionPipeline()` directly with `discoverFragments`.
- `src/extract/engine/pipeline/index.ts` `discoveryRelatedFragments()` expands related fragments from `semanticProject.sourceFiles`, so plugin discovery and React project summary work can include the whole semantic surface, not only the interaction fragments.
- `src/core/report/types.ts` `ExtractionReport` has source files, handlers, caveats, domains, state contributors, route coverage, warnings, and effect operations, but no extraction diagnostics.
- `src/cli/features/extract/report.ts` `createExtractionReport()` is the right assembly point for optional report diagnostics.
- `src/core/artifacts/index.ts` `parseExtractionReportArtifact()` validates required extraction report fields permissively; optional diagnostics can be added without changing required parse behavior.
- Canary budget gates in `tools/shared-gates/budgets.ts` currently focus on check/search state-space budgets. They do not yet support extract source-count or timing budgets.
- Existing tests for the relevant behavior are concentrated in:
  - `src/cli/features/extract/project-surface.test.ts`
  - `test/extraction/next-module-boundaries.test.ts`
  - `src/cli/features/extract/command.report.test.ts`
  - `src/cli/features/extract/command.run.test.ts`
  - `test/kernel/artifacts.test.ts`

## Exact File Paths and Relevant Symbols

- `src/cli/features/extract/command.ts`
  - `runExtractCommand`
  - `ExtractCommandResult`
  - call sites for `loadExtractionProject`, `attachRouteInventory`, `buildClientProjectSurface`, `runProjectExtractionPipeline`, `discoverCacheStorageFragments`, `createExtractionReport`
- `src/cli/features/extract/extraction-project.ts`
  - `ExtractionProject`
  - `buildClientProjectSurface`
  - `runProjectExtractionPipeline`
  - `mergeExtractionPipelineResults`
- `src/cli/features/extract/project.ts`
  - `ProjectSourceEntry`
  - `ReachableImportsResult`
  - `ModuleRecord`
  - local `createSourceFile`
  - `sourceWithReachableImports`
  - `followDeclarationReference`
  - `resolveImportPath`
  - `discoverServerActionImportAliases`
- `src/extract/engine/ts/semantic-project.ts`
  - `SemanticModuleResolver`
  - `SemanticProject`
  - `createSemanticProject`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runPluginDiscoveryPhase`
  - `runExtractionPipeline`
  - `discoveryRelatedFragments`
  - `semanticTypeContextForFile`
- `src/extract/engine/ts/react-extraction-project-summary.ts`
  - `buildReactExtractionProjectSummary`
  - `collectRelatedSourceFiles`
  - `collectProjectTypeAliases`
- `src/core/report/types.ts`
  - `ExtractionReport`
- `src/cli/features/extract/report.ts`
  - `createExtractionReport`
- `src/core/artifacts/index.ts`
  - `parseExtractionReportArtifact`
- Optional canary gate files if extract budgets are added:
  - `tools/shared-gates/types.ts`
  - `tools/shared-gates/validate.ts`
  - `tools/shared-gates/budgets.ts`
  - `tools/canary/manifest.ts`
  - `tools/canary/assertions.ts`
  - `tools/canary/runner.ts`
  - `test/canaries/manifest.test.ts`
  - `test/canaries/runner.test.ts`

## Existing Patterns to Follow

- Keep report additions optional to preserve existing report parsing behavior under schema version 1.
- Use deterministic sorting for paths, phase IDs, and diagnostics entries.
- Use small typed option bags and return objects rather than module-level mutable state.
- Keep CLI orchestration in `src/cli/features/extract/command.ts`; keep report shape construction in `report.ts`.
- Reuse semantic access through `SemanticModuleResolver` / `SemanticProject` instead of inventing a parallel resolver.
- Prefer structural tests for source counts, parse reuse, and diagnostics shape; keep real wall-clock measurement as manual verification.
- Follow existing `canonicalJson()` output behavior by using plain JSON-compatible report fields.

## Atomic Implementation Steps

1. Add extraction diagnostics report types.
   - In `src/core/report/types.ts`, add optional report fields with stable names, for example:
     - `ExtractionPhaseTiming` with `id`, `label`, and `elapsedMs`.
     - `ExtractionSurfaceDiagnostics` with counts such as `rawEntries`, `reachableSources`, `includedSources`, `interactionSources`, `reportedSources`, and optional `expandedSourceFiles`.
     - `ExtractionDiagnostics` with `phaseTimings` and `surface`.
   - Add `diagnostics?: ExtractionDiagnostics` to `ExtractionReport`.
   - Keep every new field optional. Do not bump `schemaVersion` unless the repo has a strict policy requiring it for optional additive fields.

2. Add a small extraction timing helper local to the extract CLI.
   - In `src/cli/features/extract/command.ts`, introduce a local helper such as `createExtractDiagnosticsClock()` or a small internal class.
   - It should measure named async and sync phases with `performance.now()` from `node:perf_hooks`.
   - Phase IDs should be stable and map to existing work:
     - `load-project`
     - `load-config-and-registry`
     - `route-inventory`
     - `next-config`
     - `project-surface`
     - `route-and-bounds`
     - `extraction-pipeline`
     - `cache-storage`
     - `model-assembly`
     - `overlay`
     - `report`
     - `write-artifacts`
   - Do not expose timing in normal terminal output yet unless a test or existing pattern requires it; put it in the JSON report first.

3. Thread diagnostics through report assembly.
   - Update `src/cli/features/extract/report.ts` `createExtractionReport()` to accept an optional diagnostics object.
   - Pass diagnostics from `runExtractCommand()` into `createExtractionReport()`.
   - Keep existing call sites compiling by using an optional final parameter or a named options bag if the call count is still small.
   - Update `src/cli/features/extract/command.report.test.ts` to assert that reports include:
     - `diagnostics.phaseTimings` with non-negative numeric `elapsedMs`.
     - `diagnostics.surface` count fields matching the fixture.
   - Update `test/kernel/artifacts.test.ts` only if parse fixtures should assert optional diagnostics survive parsing.

4. Make project-surface count diagnostics explicit.
   - Extend `buildClientProjectSurface()` to return or attach enough count metadata without changing extraction semantics.
   - Prefer adding an optional `surfaceDiagnostics` field to `ExtractionProject` rather than recomputing counts from report fields later.
   - Populate:
     - `rawEntries`: `project.rawEntries.length`
     - `reachableSources`: `reachable.sources.length`
     - `includedSources`: `includedSources.length`
     - `interactionSources`: `interactionSources.length`
     - `reportedSources`: `reportSources.length`
     - `expandedSourceFiles`: sorted included paths when `includedSources.length > project.rawEntries.length`
   - Make `runExtractCommand()` copy these values into `report.diagnostics.surface`.
   - Do not change `sourceFiles` semantics in the report.

5. Add a parse/cache layer inside `sourceWithReachableImports()`.
   - In `src/cli/features/extract/project.ts`, add a per-call helper inside `sourceWithReachableImports()`:
     - key by `moduleKey(path, moduleResolver)`.
     - return `moduleResolver.getSourceFile(path)` when available.
     - otherwise create and cache a `ts.SourceFile` with the existing local `createSourceFile()`.
   - Add an optional `sourceFile: ts.SourceFile` field to `ModuleRecord`, or keep a local `sourceFilesByModuleKey` map.
   - Replace repeated `createSourceFile(record.path, record.text)` calls in the reachability loop and output pass with the cache helper.
   - Ensure the helper still handles `.ts`, `.tsx`, `.js`, and `.jsx` the same way as the existing local `createSourceFile()` fallback.

6. Reuse resolved semantic source files while loading modules.
   - In `resolveImportPath()`, a semantic resolver may return `ResolvedModuleName.sourceFile`.
   - Adjust the ensure-module path so that, when a resolved non-external `SourceFile` exists, `ensureModule()` can avoid an immediate disk `readFile()` by using `sourceFile.text`.
   - Keep disk fallback behavior unchanged for files not present in the semantic project.
   - Stop and report if this causes path canonicalization mismatches between `program.getSourceFile()` names and `storagePath()` names.

7. Avoid rebuilding single-fragment shared discovery and summaries.
   - In `runProjectExtractionPipeline()`, compute `discoverFragments`, `relatedFragments`, `projectSummary`, and `sharedDiscovery` once whenever `fragments.length > 0`, including the single-fragment case.
   - Pass `sharedDiscovery` and `projectSummary` into the single-fragment `runExtractionPipeline()` call.
   - Preserve the empty-fragment inventory-only behavior.
   - Add a regression test that a single-entry semantic extraction still discovers imported component/hook state and that plugin discovery output is unchanged.

8. Keep `discoveryRelatedFragments()` broad, but make its cost visible.
   - Do not narrow `discoveryRelatedFragments()` in this plan unless tests prove specific unrelated semantic files are being included incorrectly.
   - Add diagnostics counts for:
     - discovery fragments
     - related fragments
     - semantic project source files
   - These can live under `diagnostics.surface` or under a nested `diagnostics.pipeline`.
   - This makes the report explain why Coffee DX sees 17 files even when only one source path was requested.

9. Add optional extract budgets only after diagnostics are in place.
   - If this issue must be guarded by canaries immediately, extend `SharedBudgets` with structural extract budgets before adding wall-clock budgets:
     - `maxExtractSourceFiles`
     - `maxExtractIncludedSources`
     - `maxExtractInteractionSources`
   - Implement them in `tools/shared-gates/budgets.ts` against `extractionReport.diagnostics.surface`.
   - Add validation in `tools/shared-gates/validate.ts` and canary manifest tests.
   - Do not add `maxExtractElapsedMs` as a required CI gate in the first pass; elapsed time should be diagnostic because machine variance will make it flaky.

10. Document the diagnostics in user-facing architecture docs.
   - Update `docs/architecture/extraction-pipeline.md` and `docs/_specs/02-extraction.md` to mention extraction report diagnostics and surface counts.
   - Do not update generated `docs/build/**`.

## Per-Step Files to Edit

- Step 1:
  - `src/core/report/types.ts`
- Step 2:
  - `src/cli/features/extract/command.ts`
- Step 3:
  - `src/cli/features/extract/report.ts`
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/command.report.test.ts`
  - `test/kernel/artifacts.test.ts` if optional diagnostics parsing gets explicit coverage
- Step 4:
  - `src/cli/features/extract/extraction-project.ts`
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/command.report.test.ts`
- Step 5:
  - `src/cli/features/extract/project.ts`
  - `src/cli/features/extract/project-surface.test.ts`
- Step 6:
  - `src/cli/features/extract/project.ts`
  - `src/extract/engine/ts/semantic-project.ts` only if `ResolvedModuleName` needs a clearer contract
- Step 7:
  - `src/cli/features/extract/extraction-project.ts`
  - `src/extract/engine/pipeline/index.ts` only if option typing needs adjustment
  - `src/cli/features/extract/command.run.test.ts` or `src/cli/features/extract/command.run.plugins.test.ts`
- Step 8:
  - `src/cli/features/extract/extraction-project.ts`
  - `src/cli/features/extract/command.ts`
  - `src/core/report/types.ts`
- Step 9, only if canary extract budgets are required:
  - `tools/shared-gates/types.ts`
  - `tools/shared-gates/validate.ts`
  - `tools/shared-gates/budgets.ts`
  - `tools/canary/manifest.ts`
  - `tools/canary/assertions.ts`
  - `tools/canary/runner.ts`
  - `test/canaries/manifest.test.ts`
  - `test/canaries/runner.test.ts`
  - `test/canaries/canaries.json` only if an active local canary can support the new budget without external project paths
- Step 10:
  - `docs/architecture/extraction-pipeline.md`
  - `docs/_specs/02-extraction.md`

## Acceptance Criteria

- Existing extraction behavior remains semantically equivalent: imported interactions, server action aliases, route inventory, type/domain inference, and plugin discoveries still work.
- `ExtractionReport` includes optional diagnostics with stable phase timings and surface counts.
- Diagnostics make the Coffee DX shape understandable: requested source count is distinct from reachable/included/interaction/reported source counts.
- `sourceWithReachableImports()` does not recreate a new `ts.SourceFile` for every helper pass over the same module.
- Single-fragment extraction can reuse `sharedDiscovery` and `projectSummary` instead of forcing `runExtractionPipeline()` to rebuild them internally.
- No process-global cache is introduced.
- Unit tests do not assert hard wall-clock limits.
- If extract structural budgets are added, they fail with clear evidence naming `extractionReport.diagnostics.surface`.

## Tests to Add or Update

- Add or update `src/cli/features/extract/command.report.test.ts`:
  - report contains `diagnostics.phaseTimings`.
  - every `elapsedMs` is a finite non-negative number.
  - report contains surface counts for a small imported-component fixture.
  - `sourceFiles` remains unchanged from current behavior.
- Add `src/cli/features/extract/project-surface.test.ts` coverage for parse/source-file reuse:
  - create a semantic resolver-backed fixture.
  - exercise an imported component and type-only import.
  - assert behavior is unchanged.
  - If call-count instrumentation is practical, inject or expose a test-only parse counter through a narrow internal helper; otherwise avoid brittle implementation tests.
- Add `src/cli/features/extract/command.run.test.ts` or `command.run.plugins.test.ts` coverage for single-fragment `sharedDiscovery` / `projectSummary` reuse:
  - include one source path that reaches an imported client component or custom hook.
  - assert transitions/state vars match existing expected output.
- Update `test/kernel/artifacts.test.ts` only if optional diagnostics should be explicitly accepted by `parseExtractionReportArtifact()`.
- If extract budgets are added:
  - update `test/canaries/manifest.test.ts` for new budget validation.
  - update `test/canaries/runner.test.ts` for pass/fail budget evaluation from extraction diagnostics.

## Verification Commands

```bash
rtk pnpm test src/cli/features/extract/project-surface.test.ts
rtk pnpm test test/extraction/next-module-boundaries.test.ts
rtk pnpm test src/cli/features/extract/command.report.test.ts
rtk pnpm test src/cli/features/extract/command.run.test.ts
rtk pnpm test test/kernel/artifacts.test.ts
rtk pnpm typecheck
```

If canary budget support is added:

```bash
rtk pnpm test test/canaries/manifest.test.ts
rtk pnpm test test/canaries/runner.test.ts
rtk pnpm test tools
rtk pnpm ci:canaries
```

Manual Coffee DX verification after `rtk pnpm build`:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js extract \
  app/_customer/home.tsx \
  --out /tmp/customer-home.model.json \
  --app-model /tmp/customer-home.props.ts \
  --report /tmp/customer-home.extract-report.json
```

Inspect:

```bash
rtk json /tmp/customer-home.extract-report.json
```

Confirm the report shows:

- phase timing entries including `project-surface` and `extraction-pipeline`.
- surface counts distinguishing raw entries from reachable/included/report source files.
- no loss of expected effect operations or source files.

## Risks, Ambiguities, and Stop Conditions

- Stop and report if reusing `SemanticProject` source files changes module identity, source text, or canonical path comparisons.
- Stop and report if a semantic resolver-backed `SourceFile` does not exist for files that `sourceWithReachableImports()` reads from disk; keep disk fallback rather than forcing all files into the initial project.
- Stop and report if precomputing `sharedDiscovery` or `projectSummary` for the single-fragment path changes emitted vars/transitions/warnings.
- Stop and report if a plugin relies on discovery running separately per `runExtractionPipeline()` call; preserve output first, then consider a plugin-specific fix.
- Stop and report before adding wall-clock CI gates. Use elapsed time as diagnostics and structural budgets as gates.
- Do not close the issue solely because diagnostics exist. The implementation must also remove the obvious duplicate parsing/single-fragment summary work, or document with evidence why those are not material.
- If Coffee DX is unavailable in the local environment, complete in-repo tests and report the manual verification command as not run.
