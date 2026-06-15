# Goal

Change `modality extract` so the no-argument props-driven workflow emits one extracted artifact pair per discovered `*.props.mjs` file instead of collapsing every inferred source into one `.modality/model.json` and one `.modality/app.model.ts`.

For a project like `~/proj/gdgjp/tinyurl`, where props live beside routes, a no-argument extract from the project root should generate paths shaped like:

- `.modality/models/app/routes/$slug.model.json`
- `.modality/models/app/routes/$slug.props.ts`
- `.modality/models/app/routes/analytics.model.json`
- `.modality/models/app/routes/analytics.props.ts`
- `.modality/models/app/root.model.json`
- `.modality/models/app/root.props.ts`

Keep explicit-source extraction backwards compatible:

- `modality extract App.tsx --out X --app-model Y` still writes exactly `X` and `Y`.
- `runExtractCommand({ sourcePath/sourcePaths, modelPath, appModelPath })` keeps current behavior unless a new multi-artifact API is explicitly used.

# Non-goals

- Do not change checker semantics, slicing, search limits, or `alwaysStep` behavior.
- Do not fix malformed user props such as `reachable` properties using `goal` instead of `predicate`.
- Do not redesign `model.json`, `ExtractionReport`, overlays, or generated replay tests.
- Do not alter how `modality check` discovers props files.
- Do not change route extraction semantics beyond running extraction once per inferred props/source pair.

# Current-State Findings

- `src/cli/defaults.ts`
  - `discoverPropsFiles(root)` recursively finds `*.props.mjs` while ignoring `.git`, `.modality`, `dist`, and `node_modules`.
  - `inferSourceFilesFromProps(root)` maps each `*.props.mjs` to a sibling `.tsx` path by replacing `.props.mjs` with `.tsx`, validates existence, and returns only source paths.
  - The source path result loses the props path, which is needed to derive per-props output paths.

- `src/cli/cli.ts`
  - In the `extract` branch, positional source paths are parsed from argv.
  - With no explicit source paths, the CLI calls `inferSourceFilesFromProps()` and then invokes `runExtractCommand` once with all inferred `sourcePaths`.
  - Default outputs are currently `defaultModelPath` (`.modality/model.json`) and `defaultAppModelPath` (`.modality/app.model.ts`).

- `src/cli/features/extract/command.ts`
  - `runExtractCommand(options)` normalizes one or more source paths and loads them through `loadExtractionProject`.
  - Multiple `sourcePaths` are intentionally merged by `loadMultiFileExtractionProject(sourcePaths)`.
  - The function writes exactly one JSON model at `options.modelPath`.
  - It writes exactly one generated TypeScript model at `options.appModelPath ?? dirname(options.modelPath)/app.model.ts` using `emitAppModel(model)`.
  - The returned `lines` currently include one `model=...` and one `appModel=...`.

- `src/cli/features/extract/command.test.ts`
  - Existing tests assume one model path per `runExtractCommand` call.
  - There is a focused test for explicit app model path: `writes app.model.ts to an explicit path`.
  - There are app-directory tests that can be reused as patterns for temporary React Router projects.

- `test/modality/cli-defaults.test.ts`
  - Already covers `discoverPropsFiles` and `inferSourceFilesFromProps`.
  - This is the right place to add pure path derivation tests.

- `test/modality/cli.test.ts`
  - Already exercises the real CLI subprocess.
  - This is the right place to verify no-argument `modality extract` writes multiple files.

# Exact File Paths and Relevant Symbols

- `src/cli/defaults.ts`
  - Existing: `defaultArtifactDir`, `defaultModelPath`, `defaultAppModelPath`, `discoverPropsFiles`, `inferSourceFilesFromProps`, `discoverPropsFilesIn`.
  - Add: `defaultModelsDir` or similar constant for `.modality/models`.
  - Add: a structured discovery helper, for example `inferExtractTargetsFromProps(root = process.cwd())`.
  - Add: path derivation helper, for example `artifactPathsForPropsFile(propsPath, root = process.cwd())`.

- `src/cli/cli.ts`
  - Existing extract branch in `main()`.
  - Change only the no-explicit-source branch to run one extraction per discovered props target.
  - Keep the explicit-source branch using the current single `runExtractCommand` call.

- `src/cli/features/extract/command.ts`
  - Existing: `ExtractCommandOptions`, `ExtractCommandResult`, `runExtractCommand`.
  - Prefer not to change `runExtractCommand` behavior.
  - Optionally add a small exported helper if needed, but keep multi-target orchestration in CLI/defaults unless tests show command-level reuse is cleaner.

- `test/modality/cli-defaults.test.ts`
  - Add unit tests for props-to-artifact-path mapping.

- `test/modality/cli.test.ts`
  - Add CLI integration test for no-argument extract producing multiple `.modality/models/...` artifacts.

- `src/cli/features/extract/command.test.ts`
  - Add or update command-level tests only if a new command helper is introduced.

# Existing Patterns to Follow

- Use `join`, `dirname`, `relative`, `resolve`, and filesystem helpers from `node:path` / `node:fs/promises`; avoid hand-built slash manipulation except for extension suffix replacement.
- Follow the existing CLI pattern: parse flags first, validate missing flag values, call command function(s), print each returned line.
- Preserve deterministic ordering by sorting discovered props paths, matching `discoverPropsFiles`.
- Reuse `runExtractCommand` for each generated target rather than duplicating extraction internals.
- Keep generated TypeScript content from `emitAppModel(model)` unchanged; only change where it is written and what suffix is used in the no-argument props workflow.
- Use existing test patterns with `mkdtemp`, `writeFile`, `mkdir`, and `execa`/subprocess helpers already present in `test/modality/cli.test.ts`.

# Atomic Implementation Steps

1. Add structured props target discovery.

   Files to edit:
   - `src/cli/defaults.ts`
   - `test/modality/cli-defaults.test.ts`

   Implementation:
   - Introduce an exported interface, for example:
     - `ExtractTargetFromProps`
       - `propsPath: string`
       - `sourcePath: string`
       - `modelPath: string`
       - `appModelPath: string`
   - Add `defaultModelsDir = join(defaultArtifactDir, "models")`.
   - Add `inferExtractTargetsFromProps(root = process.cwd())`.
   - It should:
     - call `discoverPropsFiles(root)`;
     - error with the same no-props message if none are found;
     - map each props file to sibling source by replacing `.props.mjs` with `.tsx`;
     - validate source existence using the same missing-file behavior as `inferSourceFilesFromProps`;
     - derive artifact base from `relative(root, propsPath).replace(/\.props\.mjs$/, "")`;
     - return:
       - `modelPath = join(root, ".modality", "models", `${base}.model.json`)`
       - `appModelPath = join(root, ".modality", "models", `${base}.props.ts`)`
   - Preserve `inferSourceFilesFromProps` for compatibility, ideally by reusing the new helper and returning `targets.map(t => t.sourcePath)`.

2. Change no-argument `modality extract` orchestration.

   Files to edit:
   - `src/cli/cli.ts`
   - `test/modality/cli.test.ts`

   Implementation:
   - Import `inferExtractTargetsFromProps`.
   - In the extract branch:
     - If explicit source paths are present, keep current behavior exactly.
     - If no explicit source paths are present and no output path flags require a single output, call `inferExtractTargetsFromProps()` and run `runExtractCommand` once per target:
       - `sourcePath: target.sourcePath`
       - `modelPath: target.modelPath`
       - `appModelPath: target.appModelPath`
       - pass through `reportPath`, `overlayPath`, `expectModelPath`, `configPath`, `packageJsonPath`, `disabledPlugins`, `effectApis`, `explainDrift`.
   - Print every line from every result.
   - Stop and ask/report if `--out` or `--app-model` is used with no explicit source paths:
     - Recommended behavior: keep backwards compatibility by treating those flags as a request for current single merged extraction, using `inferSourceFilesFromProps()` and existing `modelPath/appModelPath`.
     - Do not make `--out` fan out into directories unless explicitly specified in a future design.

3. Clarify output behavior in CLI usage text.

   Files to edit:
   - `src/cli/cli.ts`

   Implementation:
   - Update the `modality extract` usage string to mention:
     - explicit source paths write the configured single output;
     - no source paths with discovered props writes `.modality/models/**/*.model.json` and `.props.ts`.
   - Keep the line concise.

4. Add pure path tests.

   Files to edit:
   - `test/modality/cli-defaults.test.ts`

   Test cases:
   - Given:
     - `app/root.props.mjs`
     - `app/routes/$slug.props.mjs`
     - `app/routes/analytics.props.mjs`
     - matching `.tsx` files
   - Expect targets:
     - `.modality/models/app/root.model.json`
     - `.modality/models/app/root.props.ts`
     - `.modality/models/app/routes/$slug.model.json`
     - `.modality/models/app/routes/$slug.props.ts`
     - `.modality/models/app/routes/analytics.model.json`
     - `.modality/models/app/routes/analytics.props.ts`
   - Verify sorted order is stable.
   - Verify missing sibling `.tsx` still throws `Missing inferred source files for props: ...`.

5. Add CLI integration test for multi-output extraction.

   Files to edit:
   - `test/modality/cli.test.ts`

   Test case:
   - Create a temp project with:
     - `app/root.tsx`
     - `app/root.props.mjs`
     - `app/routes/home.tsx`
     - `app/routes/home.props.mjs`
     - `app/routes/analytics.tsx`
     - `app/routes/analytics.props.mjs`
     - minimal React components using `useState` so extraction has content.
   - Run `modality extract` from the temp project root with no source args.
   - Assert files exist:
     - `.modality/models/app/root.model.json`
     - `.modality/models/app/root.props.ts`
     - `.modality/models/app/routes/home.model.json`
     - `.modality/models/app/routes/home.props.ts`
     - `.modality/models/app/routes/analytics.model.json`
     - `.modality/models/app/routes/analytics.props.ts`
   - Assert stdout contains each `model=` and `appModel=` line.
   - Assert the old `.modality/model.json` is not created in this no-arg multi-target path unless explicit flags were used.

6. Add explicit-output regression test if missing.

   Files to edit:
   - `test/modality/cli.test.ts`

   Test case:
   - With discovered props present, run:
     - `modality extract --out .modality/model.json --app-model .modality/app.model.ts`
   - Confirm this preserves current single merged output behavior.
   - This protects users who already depend on the existing artifact names.

7. Update docs only if there is an existing CLI behavior doc nearby.

   Files to inspect first:
   - `docs/design.md`
   - `docs/specs/02-extraction.md`

   Implementation:
   - If a concise CLI behavior section already exists, add one sentence about no-argument props-driven extraction producing per-props artifacts under `.modality/models`.
   - Do not rewrite design docs or broaden the feature scope.

# Per-Step Files to Edit

- Step 1:
  - `src/cli/defaults.ts`
  - `test/modality/cli-defaults.test.ts`

- Step 2:
  - `src/cli/cli.ts`
  - `test/modality/cli.test.ts`

- Step 3:
  - `src/cli/cli.ts`

- Step 4:
  - `test/modality/cli-defaults.test.ts`

- Step 5:
  - `test/modality/cli.test.ts`

- Step 6:
  - `test/modality/cli.test.ts`

- Step 7:
  - `docs/design.md` or `docs/specs/02-extraction.md`, only if a small local doc update is clearly appropriate.

# Acceptance Criteria

- Running `modality extract` with no source arguments in a project containing route props generates one model JSON and one generated TypeScript companion per `*.props.mjs`.
- Artifact paths preserve the props-relative project path under `.modality/models`.
- For `app/routes/$slug.props.mjs`, output is:
  - `.modality/models/app/routes/$slug.model.json`
  - `.modality/models/app/routes/$slug.props.ts`
- For `app/routes/analytics.props.mjs`, output is:
  - `.modality/models/app/routes/analytics.model.json`
  - `.modality/models/app/routes/analytics.props.ts`
- For `app/root.props.mjs`, output is:
  - `.modality/models/app/root.model.json`
  - `.modality/models/app/root.props.ts`
- Explicit-source extraction remains backwards compatible.
- Explicit `--out` / `--app-model` extraction remains backwards compatible.
- Existing tests for single extraction continue to pass.
- The implementation does not touch property validation, checker limits, slicing, or `alwaysStep` behavior.

# Tests to Add or Update

- `test/modality/cli-defaults.test.ts`
  - Add tests for `inferExtractTargetsFromProps` or the chosen helper name.
  - Update `inferSourceFilesFromProps` tests only if its implementation delegates to the new helper and observable behavior remains identical.

- `test/modality/cli.test.ts`
  - Add no-argument extract multi-output integration test.
  - Add or confirm explicit-output single-artifact regression test.

- `src/cli/features/extract/command.test.ts`
  - No required changes if `runExtractCommand` remains single-output.
  - Add tests only if a new exported extract orchestration helper is placed under `features/extract`.

# Verification Commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/modality/cli-defaults.test.ts test/modality/cli.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

Optional manual verification against tinyurl:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk find "*.model.json" .modality/models
rtk find "*.props.ts" .modality/models
```

Expected examples:

```text
.modality/models/app/routes/$slug.model.json
.modality/models/app/routes/$slug.props.ts
.modality/models/app/routes/analytics.model.json
.modality/models/app/routes/analytics.props.ts
.modality/models/app/root.model.json
.modality/models/app/root.props.ts
```

# Risks, Ambiguities, and Stop Conditions

- Ambiguity: The current generated TypeScript file is an app model from `emitAppModel(model)`, but the requested suffix is `.props.ts`. Implement the requested filename only for the no-argument props-driven workflow; do not rename the generated contents or exported symbols unless tests require it.
- Ambiguity: Existing no-argument extraction currently merges every inferred props source into one full-app model. This plan changes that default only when neither explicit source paths nor explicit output flags are supplied. If product intent is to remove the merged default entirely, stop and ask before breaking `--out`-less workflows with existing consumers.
- Risk: Per-route source extraction may include route inventory from `app/routes.ts` via `attachRouteInventory`, so each per-props model may still contain route/system information. That is acceptable; the goal is per-props source/artifact boundaries, not perfect route-only slicing.
- Risk: Passing a single route file to `runExtractCommand` still imports local dependencies and may pull shared components. Do not attempt to solve shared component state inflation in this change.
- Risk: `reportPath` and `expectModelPath` are single paths today. If no-argument multi-output extraction is requested with `--report` or `--expect-model`, stop and decide behavior before implementation. Conservative option: keep these flags on the backwards-compatible merged path, or error with a clear message.
- Stop and report if `inferSourceFilesFromProps` is used by external public API tests in a way that makes changing its internals observable.
- Stop and report if generated `.props.ts` naming conflicts with real source props files or TypeScript project include rules in test fixtures.
