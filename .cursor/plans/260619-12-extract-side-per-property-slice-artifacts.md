# Extract-Side Per-Property Slice Artifacts

## Goal

Materialize per-property model slices during `modality extract` so slices are persisted, deterministic, independently inspectable, and measurable before `modality check` runs.

This is Plan 1 from `.cursor/plans/260619-11-check-performance-overhaul-plan-of-plans.md`. The implementation must keep the full extracted model as the canonical extraction output, add optional property-aware slice emission, and not make `check` consume extract-side slices yet.

## Non-Goals

- Do not change checker semantics or Rust checker behavior.
- Do not remove or weaken current check-side slicing.
- Do not make extraction require properties; extraction without props must behave as it does today.
- Do not add CTL, POR, or enabledness dependency fixes in this plan.
- Do not silently fall back to full-model slice artifacts for unsliceable properties.
- Do not name slice model files `*.model.json`; current generated-model discovery treats those as check targets.
- Do not introduce compatibility shims for old artifact shapes. This tool is experimental.

## Current-State Findings

- `src/cli/features/extract/command.ts`
  - `ExtractCommandOptions` has `sourcePath`, `sourcePaths`, `modelPath`, `appModelPath`, `reportPath`, but no `propsPath` or `propsPaths`.
  - `runExtractCommand()` assembles the final postprocessed `model`, creates `reportWithDiagnostics`, then writes the full model and generated app model inside the `"write-artifacts"` phase.
  - Artifacts returned today are only `{ kind: "model" | "appModel" | "report" }`.
  - Writes already use `canonicalJson()` for JSON artifacts.
- `src/cli/features/check/command.ts`
  - `CheckCommandOptions` already has `propsPath?: string` and `propsPaths?: readonly string[]`.
  - `runCheckCommand()` loads properties with a private `loadProperties(model, propsPaths)` helper, then enables check-side slicing only when `canSliceAllProperties(model, properties)` is true.
  - The private property loader supports `propertiesFor(model)`, `properties(model)`, array-valued `properties`, default `PropertyArtifact`, and default property arrays.
  - The loader also contains TS transpilation and Vitest import-cache handling. Reuse this exactly by extracting it; do not implement a second loader.
- `tools/depcruise.config.cjs`
  - `cli-feature-slices-do-not-import-each-other` forbids imports between different `src/cli/features/<name>/` slices.
  - Therefore, a shared property loader must live outside feature slices, for example `src/cli/properties/load-properties.ts`, not `src/cli/features/properties/load-properties.ts`.
- `src/check/slicing/slice-model.ts`
  - `sliceModelForCheckProperty(model, property)` returns `{ model, mode, diagnostics }`.
  - `propertySlicingSkipReason(model, property)` returns a reason for opaque or otherwise unsliceable properties.
  - `canSliceProperty()` and `canSliceAllProperties()` are exported.
- `src/check/slicing/contributors.ts`
  - `compareModelEconomics(full, slice, limit, retainedFieldPaths?)` already computes `retainedBits`, `prunedBits`, top retained/pruned contributors, and retained/pruned system vars.
- `src/check/check-model.ts`
  - `checkModelSliced()` groups equivalent slices by sorted var IDs, sorted transition IDs, and slice mode, and records slice summaries.
  - This grouping is useful as a diagnostic pattern, but extract-side artifacts should still write one manifest entry per property.
- `src/cli/defaults.ts`
  - `inferExtractTargetsFromProps()` already returns `{ propsPath, sourcePath, modelPath, appModelPath }`.
  - The CLI currently discards `propsPath` when invoking `runExtractCommand()` for inferred extract targets.
  - `discoverGeneratedModelFiles()` recursively returns every `.modality/models/**/*.model.json`; slice files must avoid that suffix.
- `src/core/report/types.ts`
  - `ExtractionDiagnostics` currently contains `phaseTimings`, `surface`, and optional `pipeline`.
  - `CheckReportDiagnostics.slicing.sliceSummaries` already defines the slice economics vocabulary used in reports.
- `src/core/artifacts/index.ts`
  - `parseModelArtifact()` validates models independent of filename.
  - New slice manifest validation can live here if the manifest type is part of the core artifact surface.

## Exact File Paths and Relevant Symbols

- `src/cli/properties/load-properties.ts`
  - New module. Move and export `loadProperties()`, `importableModulePath()`, `transpiledTypeScriptModule()`, `importCacheFileName()`, `normalizedImportCacheKey()`, and local `sha256()` from the check command.
  - Export only the helper(s) needed by command code; keep implementation helpers private.
- `src/cli/features/check/command.ts`
  - Remove private property-loading helpers and related imports.
  - Import `loadProperties` from `../../properties/load-properties.js` or the correct relative path after creating the module.
- `src/cli/features/extract/command.ts`
  - Extend `ExtractCommandOptions` with `propsPath?: string`, `propsPaths?: readonly string[]`, and optional `sliceManifestPath?: string` only if needed for explicit path override.
  - In `runExtractCommand()`, after `model` is final and before `reportWithDiagnostics` is frozen/written, load properties when any props paths are present.
  - Compute slice artifacts with `sliceModelForCheckProperty()`, `propertySlicingSkipReason()`, `compareModelEconomics()`, and `prunedFieldPathsForSlice()`.
  - Write slice files and manifest inside `"write-artifacts"` or a nested measured phase.
  - Return slice artifact entries in `ExtractCommandResult.artifacts` and add slice summary output lines.
- `src/cli/cli.ts`
  - Add extract CLI support for repeatable `--props <path>` for explicit extraction.
  - When using `inferExtractTargetsFromProps()`, pass `propsPaths: [target.propsPath]` into `runExtractCommand()`.
  - For single merged extraction with explicit sources, pass only explicitly supplied `--props` values. Do not auto-discover all props unless the existing no-source inferred-props flow is in use.
  - Update usage text.
- `src/cli/defaults.ts`
  - Add helpers for deterministic slice output paths, for example:
    - `sliceManifestPathForModel(modelPath: string): string`
    - `sliceArtifactsDirForModel(modelPath: string): string`
  - Use names like `.modality/models/app/home.slices.json` and `.modality/models/app/home.slices/<safe-property>.slice.json`.
  - Do not return slice files from `discoverGeneratedModelFiles()`.
- `src/cli/features/extract/output.ts`
  - Extend `ExtractArtifactEntry.kind` with `"sliceManifest"` and `"sliceModel"`.
  - Render artifacts through existing `formatArtifactLine()`.
  - Optionally show one compact line such as `slices=3 emitted=2 skipped=1`.
- `src/core/report/types.ts`
  - Add reusable manifest/report types:
    - `PropertySliceManifest`
    - `PropertySliceManifestEntry`
    - `ExtractionDiagnostics.propertySlices?`
  - Keep the manifest shape explicit and versioned with `schemaVersion: 1` and `kind: "property-slice-manifest"`.
- `src/core/artifacts/index.ts`
  - Add `parsePropertySliceManifestArtifact(json: string): PropertySliceManifest` if the manifest is exported as a core artifact.
- `src/check/slicing/slice-model.ts`
  - Only make minor export-shape changes if needed. Prefer using existing exported `sliceModelForCheckProperty()` and `propertySlicingSkipReason()`.
- `src/check/slicing/contributors.ts`
  - Export no new code unless extract cannot compute economics through existing `compareModelEconomics()`.
- `docs/_specs/03-checker.md`
  - Document that extract can emit per-property slices, but check still computes/uses its own slices in this phase.
- `docs/architecture/extraction-pipeline.md`
  - Add a short user-facing note about property-aware extract artifacts.

## Existing Patterns to Follow

- Use `canonicalJson()` for the manifest and slice JSON files.
- Keep all generated artifact ordering deterministic:
  - props paths sorted by input order only when user-specified; inferred targets already sorted by `discoverPropsFiles()`.
  - property entries sorted by property name, with stable tie-breaking by original index.
  - var IDs, transition IDs, source paths, and artifact paths sorted where they appear in summaries.
- Follow `runExtractCommand()` and `runCheckCommand()` option-object style.
- Follow `checkModelSliced()` for the slice identity key: sorted vars, sorted transitions, and mode.
- Follow `compareModelEconomics()` and `CheckReportDiagnostics.slicing.sliceSummaries` naming for slice economics.
- Use existing temp-project test helpers in `src/cli/features/extract/test-helpers.ts` for extraction tests.
- Keep shared CLI-only helpers under `src/cli/`, not under another `src/cli/features/*` slice.

## Proposed Artifact Shape

Manifest path:

```text
.modality/models/<source-base>.slices.json
```

Slice model paths:

```text
.modality/models/<source-base>.slices/<safe-property-name>.slice.json
```

Manifest structure:

```ts
interface PropertySliceManifest {
  schemaVersion: 1;
  kind: "property-slice-manifest";
  modelId: string;
  sourceModelPath: string;
  sourceModelHash: string;
  generatedAt: string;
  properties: readonly PropertySliceManifestEntry[];
}

type PropertySliceManifestEntry =
  | {
      property: string;
      propertyIndex: number;
      status: "emitted";
      mode: "state" | "targetedStep" | "full";
      path: string;
      vars: number;
      transitions: number;
      varIds: readonly string[];
      transitionIds: readonly string[];
      retainedBits: number;
      prunedBits: number;
      topContributors: readonly StateSpaceContributor[];
      prunedTopContributors: readonly StateSpaceContributor[];
      retainedSystemVars: readonly string[];
      prunedSystemVars: readonly string[];
      pendingQueueDependencies?: readonly PendingQueueDependency[];
      mountScopeDependencies?: readonly MountScopeDependency[];
      closureFallback?: string;
      sliceKey: string;
    }
  | {
      property: string;
      propertyIndex: number;
      status: "skipped";
      reason: string;
    };
```

Notes:

- `sourceModelHash` should be a sha256 of `canonicalJson(model)`, not a filesystem mtime.
- `path` should be relative to the manifest directory or project root consistently. Prefer project-root relative paths because existing CLI artifact paths are project-root relative.
- `safe-property-name` must be deterministic and collision-resistant. Start from a sanitized property name, then append `-<shortHash>` when two properties sanitize to the same name or when names differ only by case on case-insensitive filesystems.
- Do not emit a slice model for skipped entries.

## Atomic Implementation Steps

1. Extract the shared property loader.
   - Create `src/cli/properties/load-properties.ts`.
   - Move the private property-loading implementation from `src/cli/features/check/command.ts` into this module.
   - Export `loadProperties(model: Model, propsPaths: readonly string[]): Promise<Property[]>`.
   - Update `src/cli/features/check/command.ts` to import the helper and remove now-unused imports.
   - Do not change supported property module shapes.

2. Add slice artifact path helpers.
   - In `src/cli/defaults.ts`, add deterministic helpers for deriving `.slices.json` and `.slices/` paths from a full model path.
   - Add a safe property filename helper either in `src/cli/defaults.ts` or a new neutral CLI artifact helper module.
   - Ensure generated slice model paths end in `.slice.json`, not `.model.json`.
   - Add tests proving `discoverGeneratedModelFiles()` ignores slice files.

3. Define the manifest/report types.
   - Add `PropertySliceManifest` and `PropertySliceManifestEntry` to `src/core/report/types.ts` or a more appropriate core artifact type file if one exists.
   - Add `ExtractionDiagnostics.propertySlices?` with summary fields:
     - `manifestPath`
     - `properties`
     - `emitted`
     - `skipped`
     - `slices`
     - optional compact entries mirroring manifest entries without duplicating large contributor arrays if needed.
   - Add `parsePropertySliceManifestArtifact()` in `src/core/artifacts/index.ts` if the manifest is part of public artifacts.

4. Build extract-side slice computation.
   - In `src/cli/features/extract/command.ts`, add `propsPath` and `propsPaths` options.
   - Normalize props paths as `[...(options.propsPaths ?? []), ...(options.propsPath ? [options.propsPath] : [])]`.
   - If no props paths are supplied, skip all new slice work.
   - If props paths exist, call shared `loadProperties(model, propsPaths)` after final model postprocessing.
   - For each loaded property:
     - call `propertySlicingSkipReason(model, property)`;
     - if skipped, add a manifest skipped entry with the explicit reason;
     - otherwise call `sliceModelForCheckProperty(model, property)`;
     - compute economics with `compareModelEconomics(model, slice, 20, prunedFieldPathsForSlice(model, slice, [property]))`;
     - compute a stable `sliceKey` from sorted var IDs, sorted transition IDs, and mode;
     - write the slice model through `canonicalJson(slice)`.
   - Preserve one manifest entry per property even if multiple properties share a `sliceKey`.

5. Write manifest and artifacts.
   - Write slice model files before the manifest so the manifest never points at missing files after a successful command.
   - Write the manifest with `canonicalJson()`.
   - Add `{ kind: "sliceModel", path }` entries for emitted slices and `{ kind: "sliceManifest", path }` for the manifest to `ExtractCommandResult.artifacts`.
   - Include a compact line in `ExtractCommandResult.lines`, for example `slices=properties:3 emitted:2 skipped:1 groups:2 manifest=.modality/models/app/home.slices.json`.

6. Wire CLI props into extract.
   - In `src/cli/cli.ts`, add repeatable `--props` parsing to the extract command.
   - Include `--props` in `positionals()` value flags for extract.
   - Pass explicit props to `runExtractCommand()` in single-output mode.
   - In the inferred target loop, pass `propsPaths: [target.propsPath]`.
   - Update usage text to mention `--props`.
   - Do not auto-load unrelated discovered props for explicit source extraction unless the user passes `--props`.

7. Update human output.
   - In `src/cli/features/extract/output.ts`, extend artifact kinds.
   - Render slice artifacts in the existing artifact summary.
   - Add a compact per-target slice stats line only if slice diagnostics exist.

8. Document behavior.
   - Update `docs/_specs/03-checker.md` with the phase boundary:
     - extract can emit persisted property slices;
     - check still computes transient slices independently;
     - parity tests must keep both paths aligned.
   - Update `docs/architecture/extraction-pipeline.md` with how to request property-aware extraction.

## Per-Step Files to Edit

- Step 1:
  - `src/cli/properties/load-properties.ts`
  - `src/cli/features/check/command.ts`
- Step 2:
  - `src/cli/defaults.ts`
  - `test/modality/cli-defaults.test.ts`
- Step 3:
  - `src/core/report/types.ts`
  - `src/core/artifacts/index.ts`
  - `test/kernel/artifacts.test.ts`
- Step 4:
  - `src/cli/features/extract/command.ts`
  - possibly `src/check/slicing/slice-model.ts` only for minor exported diagnostic shape changes
- Step 5:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/output.ts`
  - `src/cli/features/extract/command.output.test.ts`
- Step 6:
  - `src/cli/cli.ts`
  - `src/cli/features/extract/command.run.test.ts`
  - `test/modality/cli-defaults.test.ts` if target inference shape changes
- Step 7:
  - `src/cli/features/extract/output.ts`
  - `src/cli/features/extract/command.output.test.ts`
- Step 8:
  - `docs/_specs/03-checker.md`
  - `docs/architecture/extraction-pipeline.md`

## Acceptance Criteria

- `runExtractCommand()` without `propsPath` or `propsPaths` writes exactly the same artifact set as today: full model, app model, and optional report.
- `runExtractCommand()` with props writes:
  - the full model at `modelPath`;
  - the generated app model at `appModelPath`;
  - one `.slices.json` manifest;
  - one `.slice.json` model per sliceable property.
- The manifest contains enough economics to compare full model size vs slice size without running `check`.
- Unsliceable properties are present in the manifest with `status: "skipped"` and a reason, and do not get fake full-model slice files.
- Slice model artifacts parse with `parseModelArtifact()`.
- Slice file names and manifest entries are deterministic across runs.
- Multiple properties with equivalent slices have identical `sliceKey` values, but each property still has its own manifest entry.
- `discoverGeneratedModelFiles()` does not return slice models.
- `modality extract` with inferred props passes each target's props path into extraction and emits slices.
- `modality check` behavior and output remain unchanged except for imports moved to the shared property loader.
- `pnpm architecture` passes; no new CLI feature-slice import violation is introduced.

## Tests to Add or Update

- `src/cli/features/extract/command.run.test.ts`
  - Add a fixture with a small TSX source and matching `.props.ts`.
  - Call `runExtractCommand({ sourcePath, modelPath, propsPaths: [propsPath] })`.
  - Assert the manifest exists, has `kind: "property-slice-manifest"`, and has emitted entries.
  - Assert emitted `.slice.json` files parse with `parseModelArtifact()`.
  - Assert running without props does not emit manifest or slice artifacts.
- `src/cli/features/extract/command.output.test.ts`
  - Assert human artifact output renders `sliceManifest` and `sliceModel`.
  - Assert compact slice stats appear only when slices are produced.
- `test/modality/cli-defaults.test.ts`
  - Add tests for slice manifest and slice directory path helpers.
  - Add test that `discoverGeneratedModelFiles()` ignores `.slice.json` files under `.slices/`.
  - Add deterministic safe property filename tests, including punctuation and collision cases.
- `test/kernel/artifacts.test.ts`
  - Add parser coverage for valid and malformed property slice manifests if `parsePropertySliceManifestArtifact()` is added.
- `test/check/slicing-parity.test.ts`
  - Add a helper assertion that an extract-side slice computed through the new utility path has the same var IDs and transition IDs as direct `sliceModelForCheckProperty()` for the same property.
  - Include at least one state property and one unsliceable/opaque property case.
- `src/cli/features/check/command.test.ts`
  - Keep existing property-loading coverage passing after moving the loader.
  - Add one targeted regression if the move exposes missing import-cache behavior under Vitest.
- Optional CLI integration test:
  - Exercise `modality extract` with no positional sources in a temp project containing `App.tsx` and `App.props.ts`, then assert `.modality/models/App.slices.json` exists.

## Verification Commands

Run focused checks first:

```bash
rtk pnpm test -- src/cli/features/extract
rtk pnpm test -- test/modality/cli-defaults.test.ts
rtk pnpm test -- test/kernel/artifacts.test.ts
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts
```

Then run project-level checks:

```bash
rtk pnpm architecture
rtk pnpm typecheck
rtk pnpm fix
```

If the change touches broader checker or artifact exports unexpectedly, also run:

```bash
rtk pnpm test
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if moving `loadProperties()` changes module import behavior for `.props.ts` files, especially Vitest cache behavior or `propertiesFor(model)` evaluation.
- Stop and report if the shared loader cannot live under `src/cli/properties/` without TypeScript path or architecture issues.
- Stop and report if a property factory requires runtime context unavailable during extract beyond the final `Model`.
- Stop and report if the chosen slice artifact path is returned by `discoverGeneratedModelFiles()` or inferred check targets.
- Stop and report if a manifest entry cannot be made deterministic because property names are missing, duplicated without stable indices, or generated from runtime-random property factories.
- Stop and report if `sliceModelForCheckProperty()` returns `mode: "full"` for a property that is not explicitly unsliceable; do not emit a full-model slice unless the current slicer says the property is sliceable and full mode is the intended sound mode.
- Stop and report if adding manifest validation requires duplicating large model validation logic. Keep the manifest parser shallow, like existing artifact parsers.
- Stop and report if docs would need to claim that `check` consumes persisted slices. It must not in this phase.
