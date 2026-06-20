# 260620-04 — `modality generate` command + extract/props decoupling

> Part 1 of 3 of the CLI output-quality work. Independent of, and lands before,
> `260620-05` (incremental streaming) and `260620-06` (colored statusline).
> This plan changes command structure only; output styling/streaming come later.

## 1. Goal

Make the intended pipeline possible and remove the extract/props chicken-and-egg:

1. create empty `*.props.ts` files (they *register* which `*.tsx` to model),
2. `modality generate` → writes the corresponding `*.modals.ts` typed-handle
   modules **from source analysis alone — no properties required**,
3. write properties in `*.props.ts` (importing those handles),
4. `modality extract` → writes `model.json` + `*.slices/*.model.json`,
5. `modality check`.

Concretely:
- Split a shared, behavior-preserving `buildExtractionModel` core out of
  `runExtractCommand` (the props-independent source→model analysis).
- Add `modality generate` that runs `buildExtractionModel` and emits
  `*.modals.ts`; it must **never** load properties or slice, so empty/broken
  props files do not block it.
- `extract` stops emitting `*.modals.ts` and becomes **resilient** to broken or
  missing props: it still writes `model.json` / `app.model.ts`, skips slices for
  any props file that fails to load, records the failure, and exits `0`.

## 2. Non-goals

- `generate` writes **only** `*.modals.ts` — no `model.json`, `app.model.ts`, or
  slices. `check` still requires `extract` to have produced `model.json`; do not
  make `check` extract implicitly.
- Do **not** make `generate` depend on a pre-existing `model.json`.
- Do **not** change incremental streaming or summary coloring here — extract
  keeps using the existing `renderHumanExtractTargets` aggregate renderer; this
  plan only adds a polite `propsErrors` block to it and a plain `generate`
  renderer. (Streaming → `260620-05`; coloring → `260620-06`.)
- Do **not** change extraction/model semantics, the report schema, or the slice
  format. `buildExtractionModel` must yield byte-identical `model.json`.

## 3. Current-state findings

- **`runExtractCommand`** (`src/cli/features/extract/command.ts:144-627`):
  - **Source→model analysis (props-independent)**, `147-451`: load project,
    config/registry, route inventory, next config, project surface, route/bounds,
    extraction pipeline, cache/storage fragments, model assembly
    (`extractedModel`), overlay apply, warnings/caveats, numeric reductions,
    field pruning → final `model`; then `createExtractionReport` → `report`.
    This is the part `generate` needs.
  - **Props-dependent tail**, `452-534`: `loadProperties(model, propsPaths)`
    (`456-457`), `buildPropertySlicePlan` (`463-472`),
    `emitComponentModalModules(model, appModelPath)` (`475`), then the
    `"write-artifacts"` phase (`476-516`) writing `model.json` (`481`),
    `app.model.ts` (`483`), `*.modals.ts` (`484-489`), slices + manifest
    (`490-511`), expect-model (`512-514`).
  - **Result assembly**, `535-626`: `stateSpaceLine`/`coarseDomainsLine`/
    `routeCoverageLine`, `varCount`/`transitionCount`, `pluginLabels`,
    `artifacts[]` (incl. `componentVars` `571-576`), legacy `lines[]` (incl.
    `componentModals=` `611-613`).
  - A `diagnosticsClock` (`756-790`) wraps every phase via
    `measureSync`/`measureAsync`; `finish()` sorts timings into
    `report.diagnostics.phaseTimings`.
- **`emitComponentModalModules(model, appModelPath)`**
  (`src/cli/codegen/component-state.ts:328-358`) is pure in `(model,
  appModelPath)`; it does not read props. Writes `<dir>/<name>.modals.ts` next
  to each source (`modulePathForSource`), fallback `componentModalsDir`.
- **Props loading is the only props-dependent step**: `loadProperties`
  (`src/cli/properties/load-properties.ts:34-56`) `import()`s the props module; a
  TS error / unresolved symbol throws and currently propagates out of
  `runExtractCommand` (it runs *before* `write-artifacts`), aborting the run and
  blocking `*.modals.ts` — the chicken-and-egg. `loadProperties` uses
  `rewriteImportedSymbols`, which re-derives modal symbols **in-memory** via
  `emitComponentModalModules` (`src/cli/properties/resolve-symbols.ts:4`), so
  physical `*.modals.ts` files are **not** required for `check`/slicing.
- **Target discovery** (`src/cli/defaults.ts`):
  `inferExtractTargetsFromProps(root)` (`54-87`) discovers `*.props.ts`, derives
  the sibling `.tsx` (requires it to exist), returns `{ propsPath, sourcePath,
  modelPath, appModelPath }`; reads only props *existence*, never content.
  `inferSourceFilesFromProps` (`89-94`) maps those to source paths. Throws if no
  `*.props.ts` exist. `artifactPathsForPropsFile` maps `Foo.props.ts` →
  `.modality/models/Foo.model.json` + `.../Foo.props.ts` (appModelPath).
- **Dispatch** (`src/cli/cli.ts`): allow-list `check|ci|conform|export|extract|
  init|replay` (`98-106`), usage block (`107-138`), extract block
  (`379-517`) builds `sharedOptions` and runs either a merged target
  (`wantsSingleMergedOutput`) or an `inferExtractTargetsFromProps` loop, then
  `renderHumanExtractTargets(...)` once, `process.exit(0)`. Thin re-export
  entrypoints exist (`src/cli/extract.ts` etc.) mapped under
  `exports["./cli/<name>"]` in `package.json`.
- **Extract output** (`src/cli/features/extract/output.ts`):
  `renderHumanExtractTargets` loops per-target rows (`63-85`) then trailing
  `Duration` + optional `Artifacts` (`86-98`); `ExtractArtifactEntry` kinds incl.
  `componentVars`. Renderers are plain unless `options.color`.
- **Tests**: `extract/command.output.test.ts` calls
  `runExtractCommand({ sourcePath, modelPath[, propsPaths] })` and asserts model
  shape, `(model)`/`(sliceManifest)`/`(sliceModel)` artifacts, `slices=properties:`
  — these stay in `extract`. No test asserts `(componentVars)` from extract, so
  moving modal emission out is safe. `command.output.test.ts:8-43` asserts
  `/^ ✓ App\.tsx /` and `Duration`.

## 4. Exact file paths and relevant symbols

Create:
- `src/cli/features/generate/command.ts` — `runGenerateCommand`,
  `GenerateCommandOptions`, `GenerateTargetResult`, `GenerateArtifactEntry`.
- `src/cli/features/generate/output.ts` — `renderHumanGenerateTargets`.
- `src/cli/features/generate/index.ts` — re-exports.
- `src/cli/generate.ts` — thin re-export (mirror `src/cli/extract.ts`).
- `src/cli/features/generate/command.test.ts` — unit tests.

Edit:
- `src/cli/features/extract/command.ts` — add `buildExtractionModel`; remove
  modal emission; resilient per-file props loading; add `propsErrors`; drop
  `componentVars`/`componentModals`.
- `src/cli/features/extract/output.ts` — add `ExtractPropsError`; render a
  `propsErrors` block inside the existing per-target loop.
- `src/cli/features/extract/index.ts` — export `buildExtractionModel`,
  `ExtractPropsError`, `ExtractionModelBuild`.
- `src/cli/cli.ts` — add `generate` dispatch + usage; pass `propsErrors` into the
  extract render call.
- `package.json` — add `exports["./cli/generate"]`.

## 5. Existing patterns to follow

- Feature module shape `features/<name>/{command,output,index,command.test}.ts`
  with `run<Name>Command` / `*CommandOptions` / `renderHuman<Name>...`. Mirror
  `features/extract`.
- Thin entrypoint `src/cli/generate.ts` mirrors `src/cli/extract.ts`.
- CLI dispatch mirrors the `if (command === "extract")` block: parse via
  `flagValue`/`positionals`, build options, run, `emitLines(render...())`,
  `process.exit(0)`.
- Reuse `inferExtractTargetsFromProps` / `inferSourceFilesFromProps` for
  discovery; reuse `emitComponentModalModules` for codegen.
- Renderers stay plain unless `options.color === true`.

## 6. Atomic implementation steps

### Step 1 — Extract `buildExtractionModel` (pure refactor)
In `src/cli/features/extract/command.ts`:
- Define `export interface ExtractionModelBuild { model: Model; report:
  ExtractionReport; appModelPath: string; route: string; varCount: number;
  transitionCount: number; pluginLabels: readonly string[]; stateSpaceLine?:
  string; coarseDomainsLine?: string; routeCoverageLine?: string; driftLines:
  readonly string[]; }` (include everything the tail + result assembly read from
  analysis scope).
- Move analysis (`147-451`) plus the derived
  `stateSpaceLine`/`coarseDomainsLine`/`routeCoverageLine`,
  `varCount`/`transitionCount`/`pluginLabels` into
  `export async function buildExtractionModel(options: ExtractCommandOptions,
  clock: ExtractDiagnosticsClock): Promise<ExtractionModelBuild>`. Pass the
  `diagnosticsClock` in as a parameter so phase ids/labels stay identical and
  `runExtractCommand` can still `finish()` after its write phases.
- `runExtractCommand`: create clock → `const build = await
  buildExtractionModel(options, clock)` → run the props/slice/write tail
  (Step 3) → assemble result from `build` + tail outputs.
- **Land this step alone and run `pnpm test`**: `model.json` and all extract
  tests must be byte-identical.

### Step 2 — New `generate` command
- `src/cli/features/generate/command.ts`:
  - `GenerateCommandOptions` = the analysis subset of `ExtractCommandOptions`
    (`sourcePath?`, `sourcePaths?`, `appModelPath?`, `modelPath?`, `configPath?`,
    `packageJsonPath?`, `disabledPlugins?`, `effectApis?`, `now?`).
  - `runGenerateCommand(options): Promise<GenerateTargetResult>`: create a clock,
    `const build = await buildExtractionModel({ ...options, modelPath:
    options.modelPath ?? <derived from appModelPath/cwd> }, clock)`, then
    `emitComponentModalModules(build.model, build.appModelPath)`, `mkdir` +
    `writeFile` each module (exact code removed from `command.ts:484-489`).
    Return `{ targetLabel, moduleCount, varCount, transitionCount, pluginLabels,
    artifacts: GenerateArtifactEntry[] }` with `{ kind: "componentVars", path }`.
  - Never call `loadProperties`/slicing.
- `src/cli/features/generate/output.ts`: `renderHumanGenerateTargets(results,
  options)` — per-target ` ✓ <label> (<n> modules) <ms>` rows, blank line,
  `Duration`, optional `Artifacts` via `formatArtifactLine` (plain; reuse
  `formatStatusSymbol`/`formatSummaryLabel`/`formatMs`/`formatDuration`).
- `src/cli/features/generate/index.ts`: re-export command + renderer + types.
- `src/cli/generate.ts`: `export * from "./features/generate/index.js";`.

### Step 3 — Extract: drop modals, resilient props
In `src/cli/features/extract/command.ts` (tail, after `buildExtractionModel`):
- Remove `emitComponentModalModules` import + use (`475`), the write loop
  (`484-489`), the `componentVars` artifacts (`571-576`), and the
  `componentModals=` line (`611-613`).
- Replace the single `loadProperties(model, propsPaths)` (`456-457`) with a
  per-file resilient loop: for each `propsPath`,
  `await loadProperties(model, [propsPath])` in try/catch; on success accumulate
  properties; on failure push `{ propsPath, message }` to
  `propsErrors: ExtractPropsError[]`. Build `buildPropertySlicePlan` only from
  successfully-loaded properties (skip slices if none).
- Extend `ExtractCommandResult` with `propsErrors: readonly ExtractPropsError[]`
  (default `[]`); keep `model.json`/`app.model.ts`/slices/expect-model.
- Define+export `interface ExtractPropsError { propsPath: string; message:
  string }` in `extract/output.ts`.

### Step 4 — Render `propsErrors` (in existing aggregate renderer)
In `src/cli/features/extract/output.ts`:
- Add `propsErrors?: readonly ExtractPropsError[]` to
  `HumanExtractTargetResult`.
- Inside the existing per-target loop of `renderHumanExtractTargets`, after the
  target's stat lines, when `target.propsErrors?.length`, push a polite block:
  ` ${formatStatusSymbol("warn", options)} <propsPath>` then indented
  `    <message>` lines.
In `src/cli/cli.ts` extract block: include `propsErrors: result.propsErrors` in
  each mapped target passed to `renderHumanExtractTargets`. Keep `exit(0)`.

### Step 5 — Wire `generate` into the dispatcher
- `cli.ts`: add `"generate"` to the allow-list (`98-106`); add a usage line
  (`modality generate [source.tsx ...] [--app-model <path>] [--config <path>]
  [--package-json <path>] [--disable-plugin id] [--effect-api name]
  [--artifact|-A]`, noting it writes `*.modals.ts` from source with no props
  needed; no sources → discovered via `*.props.ts`); add
  `if (command === "generate") { ... }`: resolve targets (explicit positionals,
  else `inferSourceFilesFromProps()`), `runGenerateCommand` per source, collect
  results, `emitLines(renderHumanGenerateTargets(...))`, `process.exit(0)`.
- `package.json`: add `exports["./cli/generate"]` mirroring `./cli/extract`.

### Step 6 — Docs
- Update README / `docs/` / `docs/_specs/` where `modality extract` or
  `.modals.ts` is documented: add the 5-step pipeline and note extract no longer
  writes `*.modals.ts`. If none reference it, skip and note it.

## 7. Per-step files to edit

- **1**: `src/cli/features/extract/command.ts`.
- **2**: `src/cli/features/generate/{command,output,index}.ts`,
  `src/cli/generate.ts`.
- **3**: `src/cli/features/extract/command.ts`, `src/cli/features/extract/output.ts`.
- **4**: `src/cli/features/extract/output.ts`, `src/cli/cli.ts`.
- **5**: `src/cli/cli.ts`, `package.json`, `src/cli/features/extract/index.ts`.
- **6**: `README.md`, `docs/**`, `docs/_specs/**` (matching files only).
- **Tests**: `src/cli/features/generate/command.test.ts` (new);
  `extract/command.output.test.ts` (updates).

## 8. Acceptance criteria

1. `modality generate` writes `*.modals.ts` next to sources — byte-identical to
   what extract previously produced for the same model — **without** loading
   properties and **without** a prior `model.json`. Empty/broken props files do
   not affect it.
2. `modality generate` writes no `model.json`, `app.model.ts`, or slices.
3. `modality extract` no longer writes `*.modals.ts`; still writes `model.json`,
   `app.model.ts`, and slices when props load.
4. A broken/unresolved `*.props.ts` no longer aborts `extract`: exit `0`, model
   artifacts written, that file's slices skipped, and a polite per-file error
   block printed.
5. End to end: empty props → `generate` → write props → `extract` → `check`
   succeeds (check uses the in-memory symbol rewrite; no physical `*.modals.ts`
   needed).
6. `buildExtractionModel` is behavior-preserving: `model.json` + all extract
   tests byte-identical after Step 1 alone.
7. `pnpm typecheck`, `pnpm test`, `pnpm fix`, `pnpm architecture` pass.

## 9. Tests to add or update

- **New** `generate/command.test.ts`: (a) `App.tsx` + empty `App.props.ts` →
  `runGenerateCommand` writes `App.modals.ts` equal to
  `emitComponentModalModules(build.model, appModelPath)`, and writes no
  `model.json`/slices; (b) broken `App.props.ts` still lets `generate` succeed
  and write `App.modals.ts`; (c) `renderHumanGenerateTargets` contains `✓`,
  `Duration`, `(componentVars)` when `showArtifacts`.
- **Update** `extract/command.output.test.ts`: add a broken-props case where
  `runExtractCommand` resolves (no throw), `result.propsErrors` has one entry,
  and `renderHumanExtractTargets` output contains the props path + warn symbol;
  confirm no assertion expects `(componentVars)` from extract; keep slice
  assertions.
- Keep assertions color-agnostic.

## 10. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm fix
rtk pnpm architecture
# manual smoke in an example app:
rtk pnpm --filter <example> exec modality generate   # after creating empty *.props.ts
rtk pnpm --filter <example> exec modality extract
rtk pnpm --filter <example> exec modality check
```

## 11. Risks, ambiguities, and stop conditions

- **Stop & report** if `loadProperties`/`rewriteImportedSymbols` actually reads
  physical `*.modals.ts` from disk (contrary to §3) — then removing modal
  emission from `extract` breaks `check`; fall back to also writing
  `*.modals.ts` in `extract` while keeping `generate` as the props-independent
  producer. Verify by running `check` after an `extract` that wrote no
  `*.modals.ts`.
- **Step 1 refactor**: keep `model.json` byte-identical and the diagnostics phase
  set unchanged; pass the clock as a parameter rather than duplicating it. Land
  Step 1 alone, run `pnpm test`, before Steps 2–5.
- **First `generate` discovery**: `inferExtractTargetsFromProps` throws with zero
  props files, so the first run needs ≥1 (empty) `*.props.ts` or an explicit
  source arg; document this, don't silently no-op.
- **Architecture rules**: `features/generate` may import only from the layers
  `features/extract` uses (`modality-ts/core`, `codegen/component-state.js`,
  `defaults.js`, the extract module). Match extract's dependency set if
  `pnpm architecture` flags an import; don't relax dependency-cruiser rules.
```
