# Extract Command Responsibility Refactor

Status: implementation plan.
Date: 2026-06-18.
Plan family: Refactoring - Large Source Files.
Depends on: none.

## 1. Goal

Split the extract CLI command implementation into focused modules without
changing extraction behavior.

The end state is:

- `src/cli/features/extract/command.ts` remains the public command entrypoint
  for `runExtractCommand()` and `ExtractCommandOptions`, but shrinks to command
  orchestration and result assembly;
- project loading and surface construction move out of `command.ts`;
- report, caveat, route-coverage, system-var, and post-processing helpers move
  behind focused extract-feature modules;
- the 5k-line extract command test file is split by responsibility while
  preserving the same assertions;
- imports stay acyclic and follow existing `src/cli/features/<name>/`
  boundaries.

## 2. Non-goals

- Do not change the model schema, transition ids, var ids, report schema, caveat
  semantics, route lowering semantics, plugin registry behavior, or output text.
- Do not refactor Rust checker files in this plan. `crates/checker/src/search.rs`,
  `expr.rs`, `effect.rs`, and `domain.rs` are also large, but they are a
  separate checker-internals concern.
- Do not refactor `src/core/ir/validator.ts` in this plan. It should be handled
  separately because it mirrors parts of the Rust domain/expression validator.
- Do not split `src/extract/engine/ts/transition/*` modules in this plan.
- Do not edit generated artifacts or `dist/`.
- Do not keep compatibility shims for moved private helpers. This project is
  experimental; update internal imports directly.

## 3. Current-State Findings

- `src/cli/features/extract/command.test.ts` is 5133 LOC. It mixes
  `runExtractCommand()` integration tests, human-target rendering tests, and
  compiler-backed project surface tests.
- `src/cli/features/extract/command.ts` is 1993 LOC. It currently owns command
  orchestration, project loading, project surface construction, route inventory
  attachment, config/package discovery, report construction, caveat
  aggregation, route coverage, location lowering, system-var synthesis, pending
  queue domain inference, mount scope application, and assigned-literal domain
  refinement.
- `src/cli/features/extract/project.ts` is 1432 LOC. It already owns
  `sourceWithReachableImports()`, module classification, import traversal,
  surface text generation, effect API discovery, and server-action alias
  discovery. This makes it the right home for extract project surface helpers
  currently sitting in `command.ts`.
- Other large files inspected for prioritization:
  - `src/core/ir/validator.ts` at 1465 LOC combines model validation,
    expression/effect walking, read/write collection, and domain inference.
  - `crates/checker/src/search.rs` at 1248 LOC combines request handling,
    parallel frontier exploration, diagnostics, limits, and public successor
    APIs.
  - `src/extract/engine/ts/transition/handlers.ts` at 1247 LOC and
    `src/extract/engine/ts/transition/async.ts` at 1164 LOC combine JSX,
    component-prop, handler-summary, async, await, and pending-effect lowering.
- Existing smaller CLI command modules such as
  `src/cli/features/check/command.ts`, `src/cli/features/conform/command.ts`,
  and `src/cli/features/replay/command.ts` keep one exported command function
  and private helpers. `extract/command.ts` has outgrown that pattern and needs
  internal feature modules.
- `src/cli/features/extract/project.ts#sourceWithReachableImports()` is used
  directly by tests in `test/extraction/next-module-boundaries.test.ts` and by
  `src/cli/features/extract/command.test.ts`; keep this exported API stable.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/cli/features/extract/command.ts`
  - `runExtractCommand()`
  - `ExtractCommandOptions`
  - `ExtractCommandResult`
  - `ExtractionProject`
  - `loadExtractionProject()`
  - `emptySurfaceProject()`
  - `buildClientProjectSurface()`
  - `runProjectExtractionPipeline()`
  - `mergeExtractionPipelineResults()`
  - `loadMultiFileExtractionProject()`
  - `attachRouteInventory()`
  - `resolveExtractionRoute()`
  - `createExtractionReport()`
  - `buildEffectOperations()`
  - `buildRouteCoverage()`
  - `buildLocationLowering()`
  - `collectPushReplaceNavigations()`
  - `createExtractionCaveats()`
  - `synthesizeSystemVars()`
  - `pendingVars()`
  - `applyMountScopesFromRouter()`
  - `refineAssignedLiteralDomains()`
- `src/cli/features/extract/project.ts`
  - `sourceWithReachableImports()`
  - `ReachableImportsResult`
  - `ProjectSourceEntry`
  - `EffectApiProvenanceEntry`
  - `TsConfigResolution`
- `src/cli/features/extract/command.test.ts`
  - `describe("runExtractCommand", ...)`
  - `describe("renderHumanExtractTargets", ...)`
  - `describe("compiler-backed project surface", ...)`
- `src/cli/features/extract/next-extract.test.ts`
- `test/extraction/next-module-boundaries.test.ts`

New files:

- `src/cli/features/extract/extraction-project.ts`
- `src/cli/features/extract/report.ts`
- `src/cli/features/extract/system-vars.ts`
- `src/cli/features/extract/model-postprocess.ts`
- `src/cli/features/extract/route-lowering.ts`
- `src/cli/features/extract/command.run.test.ts`
- `src/cli/features/extract/command.report.test.ts`
- `src/cli/features/extract/command.output.test.ts`
- `src/cli/features/extract/project-surface.test.ts`

## 5. Existing Patterns to Follow

- Keep public feature exports through `src/cli/features/extract/index.ts`.
- Keep CLI command entrypoints in `src/cli/features/*/command.ts`.
- Keep human rendering helpers in `src/cli/features/*/output.ts`; do not move
  `renderHumanExtractTargets()` as part of this plan.
- Keep project-surface logic in the extract feature folder, not in
  `src/extract/engine/ts/`, unless it becomes a generic extraction engine API.
- Use existing TypeScript ESM imports with `.js` suffixes.
- Preserve deterministic sorting patterns already used in report, plugin, route,
  and source lists.
- Prefer named exports for moved helpers so tests can cover them directly only
  when the helper has behavior worth locking down.

## 6. Atomic Implementation Steps

### Step 1 - Move extraction project loading and pipeline merging

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/extraction-project.ts`
- `src/cli/features/extract/project.ts`
- `src/cli/features/extract/command.test.ts`
- `src/cli/features/extract/project-surface.test.ts`

Implementation:

1. Create `src/cli/features/extract/extraction-project.ts`.
2. Move these symbols from `command.ts` into the new file:
   - `ExtractionProject`;
   - `normalizedSourcePaths()`;
   - `loadExtractionProject()`;
   - `emptySurfaceProject()`;
   - `buildClientProjectSurface()`;
   - `runProjectExtractionPipeline()`;
   - `mergeExtractionPipelineResults()`;
   - `loadMultiFileExtractionProject()`;
   - `attachRouteInventory()`;
   - `resolveRouterDiscoveryRoot()`;
   - `findManifestPath()`;
   - `resolveProjectRoot()`;
   - `projectRelativeSourcePath()`;
   - `routesForSourceFile()`;
   - `manifestRouteFiles()`;
   - `isManifestRouteSource()`;
   - `resolveExtractionRoute()`;
   - `findNearestRoutesManifest()`;
   - `readTsConfigResolution()`;
   - `existingFiles()`.
3. Export only the helpers needed by `runExtractCommand()` and tests:
   - `normalizedSourcePaths`;
   - `loadExtractionProject`;
   - `buildClientProjectSurface`;
   - `runProjectExtractionPipeline`;
   - `attachRouteInventory`;
   - `resolveExtractionRoute`.
4. Keep `sourceWithReachableImports()` in `project.ts`; do not move it in this
   step.
5. Move the `describe("compiler-backed project surface", ...)` block from
   `command.test.ts` into `project-surface.test.ts`. Keep direct
   `sourceWithReachableImports()` tests there.
6. Update imports and remove dead imports from `command.ts`.

Acceptance criteria:

- `runExtractCommand()` still calls project-loading helpers in the same order.
- No output text or model content changes.
- `command.ts` no longer imports `stat` for project loading or calls
  `sourceWithReachableImports()` directly.
- `project-surface.test.ts` owns direct project-surface tests.

### Step 2 - Move report, caveat, and route coverage construction

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/report.ts`
- `src/cli/features/extract/command.report.test.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Create `src/cli/features/extract/report.ts`.
2. Move these symbols from `command.ts` into `report.ts`:
   - `createExtractionReport()`;
   - `buildEffectOperations()`;
   - `buildRouteCoverage()`;
   - `formatRouteCoverageLine()`;
   - `emptyExtractionCaveats()`;
   - `createExtractionCaveats()`;
   - `mergeExtractionCaveats()`;
   - `pluginProvenance()`;
   - `overApproxReasons()`;
   - `dedupeUnextractableHandlers()`;
   - `wideProductDomainReachabilityWarnings()`;
   - `wideNumericReachabilityWarnings()`;
   - helper functions used only by those symbols.
3. Export the helpers consumed by `runExtractCommand()`:
   - `createExtractionReport`;
   - `buildEffectOperations`;
   - `formatRouteCoverageLine`;
   - `emptyExtractionCaveats`;
   - `createExtractionCaveats`;
   - `mergeExtractionCaveats`;
   - `pluginProvenance`;
   - `wideProductDomainReachabilityWarnings`;
   - `wideNumericReachabilityWarnings`.
4. Move report-heavy tests from `command.test.ts` into
   `command.report.test.ts`. Include tests that assert:
   - extraction report artifact shape;
   - unextractable handler report entries;
   - route coverage;
   - state-space/coarse-domain output lines;
   - plugin provenance warnings.
5. Keep tests invoking `runExtractCommand()` unless the helper is already a
   stable exported pure function. Do not over-unit-test private report helpers.

Acceptance criteria:

- Report JSON and human summary lines are byte-for-byte compatible with current
  test expectations.
- `command.ts` delegates report construction and caveat aggregation to
  `report.ts`.
- No new dependencies from `src/core` or `src/check` to `src/cli` are created.

### Step 3 - Move system variable synthesis and model post-processing

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/system-vars.ts`
- `src/cli/features/extract/model-postprocess.ts`
- `src/cli/features/extract/command.run.test.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Create `src/cli/features/extract/system-vars.ts`.
2. Move these symbols from `command.ts` into `system-vars.ts`:
   - `synthesizeSystemVars()`;
   - `collectSystemVarIds()`;
   - `pendingVars()`;
   - `enqueueOps()`;
   - `pendingArgDomain()`;
   - `domainForLiteral()`;
   - `mergeArgDomains()`.
3. Create `src/cli/features/extract/model-postprocess.ts`.
4. Move these symbols from `command.ts` into `model-postprocess.ts`:
   - `applyMountScopesFromRouter()`;
   - `refineAssignedLiteralDomains()`;
   - `mergeAssignedDomain()`;
   - `assignedLiteralDomains()`;
   - `attachFieldPruning()` if it is still local to `command.ts`;
   - helper functions used only by those symbols.
5. Export only:
   - `synthesizeSystemVars`;
   - `applyMountScopesFromRouter`;
   - `refineAssignedLiteralDomains`;
   - `attachFieldPruning` if moved.
6. Move system-var and post-processing tests from `command.test.ts` into
   `command.run.test.ts` unless a pure helper test is clearer.

Acceptance criteria:

- Pending queue vars still canonicalize aliases through `EffectOpAliases`.
- Pending arg domain inference still uses assigned literal, read, readPre, path,
  and fallback token behavior exactly as before.
- Router mount scopes still apply only to `local:` vars.
- Assigned literal refinements still skip `library-template` vars.

### Step 4 - Move route lowering helpers

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/route-lowering.ts`
- `src/cli/features/extract/command.run.test.ts`

Implementation:

1. Create `src/cli/features/extract/route-lowering.ts`.
2. Move these symbols from `command.ts` into the new file:
   - `buildLocationLowering()`;
   - `collectPushReplaceNavigations()`.
3. Export `buildLocationLowering()` for `runExtractCommand()`.
4. Keep `collectPushReplaceNavigations()` private unless an existing test needs
   direct coverage.
5. Keep route lowering adapter-facing types imported from
   `modality-ts/extract/engine/spi`.

Acceptance criteria:

- Location lowering still ignores `route:` transitions.
- Push/replace inference still treats history writes as `push` and route-only
  assignments as `replace`.
- Adapter `lowerNavigation()` results still contribute route targets.

### Step 5 - Split the extract command tests

Files to edit:

- `src/cli/features/extract/command.test.ts`
- `src/cli/features/extract/command.run.test.ts`
- `src/cli/features/extract/command.report.test.ts`
- `src/cli/features/extract/command.output.test.ts`
- `src/cli/features/extract/project-surface.test.ts`

Implementation:

1. Leave `command.test.ts` as a small compatibility-focused file or delete it
   after moving all tests, depending on Vitest discovery clarity.
2. Move `describe("renderHumanExtractTargets", ...)` into
   `command.output.test.ts`.
3. Move `describe("compiler-backed project surface", ...)` into
   `project-surface.test.ts`.
4. Move report/artifact/caveat/coverage tests into `command.report.test.ts`.
5. Move remaining extraction behavior tests into `command.run.test.ts`.
6. Keep shared fixture helpers local to the test file that uses them. If a
   helper is needed by three or more files, add
   `src/cli/features/extract/test-helpers.ts` and keep it test-only by naming
   and imports.
7. Preserve test names where practical so failures remain searchable in history.

Acceptance criteria:

- No single extract test file remains above 1500 LOC.
- All moved tests still execute under the existing Vitest config.
- Test helper imports do not leak into production modules.

### Step 6 - Final cleanup and architecture check

Files to edit:

- Files changed in steps 1-5.

Implementation:

1. Remove unused imports from all moved modules.
2. Confirm `.js` suffixes on relative TypeScript ESM imports.
3. Ensure all new modules are under `src/cli/features/extract/`.
4. Run formatting after the split.
5. Run architecture validation to catch accidental layer inversions.

Acceptance criteria:

- `src/cli/features/extract/command.ts` is below 700 LOC.
- `src/cli/features/extract/project.ts` remains below its current size and does
  not absorb command orchestration.
- No production module imports from a `*.test.ts` or test helper file.
- No generated files are changed.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/extraction-project.ts`
  - `src/cli/features/extract/project.ts`
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/extract/project-surface.test.ts`
- Step 2:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/report.ts`
  - `src/cli/features/extract/command.report.test.ts`
  - `src/cli/features/extract/command.test.ts`
- Step 3:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/system-vars.ts`
  - `src/cli/features/extract/model-postprocess.ts`
  - `src/cli/features/extract/command.run.test.ts`
  - `src/cli/features/extract/command.test.ts`
- Step 4:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/route-lowering.ts`
  - `src/cli/features/extract/command.run.test.ts`
- Step 5:
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/extract/command.run.test.ts`
  - `src/cli/features/extract/command.report.test.ts`
  - `src/cli/features/extract/command.output.test.ts`
  - `src/cli/features/extract/project-surface.test.ts`
- Step 6:
  - all files touched above

## 8. Acceptance Criteria

- `runExtractCommand()` behavior remains unchanged for current tests and
  examples.
- `src/cli/features/extract/command.ts` is below 700 LOC and contains only:
  option/config orchestration, calls into focused helpers, artifact writing, and
  final `ExtractCommandResult` assembly.
- No single `src/cli/features/extract/*.test.ts` file remains above 1500 LOC.
- Moved helpers have focused module homes:
  - project loading/surface helpers in `extraction-project.ts`;
  - reports/caveats/coverage in `report.ts`;
  - system vars and pending queue inference in `system-vars.ts`;
  - model post-processing in `model-postprocess.ts`;
  - navigation lowering in `route-lowering.ts`.
- Public imports continue to work through:
  - `src/cli/features/extract/index.ts`;
  - `src/cli/extract.ts`;
  - `modality-ts/cli` callers covered by existing tests.
- Architecture rules pass.

## 9. Tests to Add or Update

- Split, not rewrite, existing tests from
  `src/cli/features/extract/command.test.ts`.
- Add focused smoke assertions if any moved helper becomes exported and is not
  covered through `runExtractCommand()`.
- Preserve or move existing direct `sourceWithReachableImports()` tests:
  - `test/extraction/next-module-boundaries.test.ts`;
  - compiler-backed project surface tests moved to
    `src/cli/features/extract/project-surface.test.ts`.
- Keep `src/cli/features/extract/next-extract.test.ts` as the Next-specific
  integration suite.

## 10. Verification Commands

Run targeted validation after each step:

```bash
rtk pnpm vitest run src/cli/features/extract/command.run.test.ts
rtk pnpm vitest run src/cli/features/extract/command.report.test.ts
rtk pnpm vitest run src/cli/features/extract/command.output.test.ts
rtk pnpm vitest run src/cli/features/extract/project-surface.test.ts
rtk pnpm vitest run src/cli/features/extract/next-extract.test.ts
rtk pnpm vitest run test/extraction/next-module-boundaries.test.ts
```

Run broad validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if extracting helpers creates a dependency cycle involving
  `src/cli/features/extract/project.ts`, `src/extract/engine/ts/*`, or
  `src/core/*`. Do not solve cycles by moving CLI-specific code into core.
- Stop and report if any test expectation changes in serialized model JSON,
  report JSON, output lines, transition ids, var ids, caveats, route coverage,
  or plugin labels. This plan is a refactor, not a behavior change.
- Stop and report if a helper moved to `report.ts`, `system-vars.ts`, or
  `model-postprocess.ts` needs private state from `runExtractCommand()`. Prefer
  passing explicit inputs over introducing module-level mutable state.
- Stop and report if test splitting reveals hidden order dependencies or shared
  temp-directory collisions. Fix the fixture isolation first, then continue.
- Stop and report if `pnpm architecture` forbids a new module location. Move the
  helper within `src/cli/features/extract/` before considering broader
  architecture changes.
- Stop and report if any file outside `src/cli/features/extract/` must be
  changed for reasons other than imports or tests named above.
