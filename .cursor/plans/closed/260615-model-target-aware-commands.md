# Goal

Update downstream CLI commands so the new props-scoped extraction layout is directly usable.

After `modality extract` generates per-props artifacts under `.modality/models`, commands that currently default to `.modality/model.json` and independently discovered props should be able to find the matching per-props model and source props pair automatically.

Primary target:

- `modality check` with no positional args should check each discovered source props file against its matching generated model:
  - `app/root.props.mjs` with `.modality/models/app/root.model.json`
  - `app/routes/$slug.props.mjs` with `.modality/models/app/routes/$slug.model.json`
  - `app/routes/analytics.props.mjs` with `.modality/models/app/routes/analytics.model.json`

Secondary targets:

- `modality ci` should have a path to run against one props-scoped model/props pair without requiring users to manually derive both paths.
- `modality conform` and `modality export` should either support the new default model discovery where unambiguous, or fail with a clear message that asks for an explicit model path when multiple generated models exist.

# Non-goals

- Do not change checker semantics, property loading, slicing, search limits, or verdict statuses.
- Do not make generated `.modality/models/**/*.props.ts` files executable property modules unless a separate design says so. The checker should continue importing user-authored `*.props.mjs` modules for properties.
- Do not fix malformed properties such as `reachable` objects that use `goal` instead of `predicate`.
- Do not change extraction behavior beyond relying on the per-props target helpers introduced by the extraction plan.
- Do not remove support for legacy `.modality/model.json`.

# Current-State Findings

- `src/cli/defaults.ts`
  - Defines `defaultModelPath = .modality/model.json`.
  - Defines `defaultReportPath = .modality/report.json`.
  - Discovers source props with `discoverPropsFiles(root)`.
  - The extraction plan introduces or has introduced:
    - `defaultModelsDir = .modality/models`
    - `artifactPathsForPropsFile(propsPath, root)`
    - `inferExtractTargetsFromProps(root)`
    - `ExtractTargetFromProps`

- `src/cli/cli.ts`
  - `check` branch:
    - positional parsing treats the first positional as `modelPath` and the rest as `propsPaths`.
    - no positional args currently becomes:
      - `modelPath = .modality/model.json`
      - `propsPaths = await discoverPropsFiles()`
    - this is wrong for the new per-props default because all props would still be checked against one legacy model path.
  - `ci` branch:
    - requires `<model.json>` positional and optional `[props.ts]` positional.
    - this remains usable but is clumsy with `.modality/models/...`.
  - `conform` branch:
    - defaults `--model` to `.modality/model.json` when generating walks.
    - with multiple generated models, there is no obvious single default.
  - `export` branch:
    - defaults model path to `.modality/model.json`.
    - with multiple generated models, there is no obvious single default.

- `src/cli/features/check/command.ts`
  - `runCheckCommand(options)` checks exactly one `modelPath` against zero or more props paths.
  - It writes one report and one traces/replay artifact set.
  - This should stay single-model; orchestration for multiple model/props targets should live in CLI-level code or a new small command helper.

- `src/cli/features/ci/command.ts`
  - `runCiCommand(options)` runs `runCheckCommand` for exactly one model and optional props path, then determinism/source-freshness/conformance checks.
  - This should stay single-target for now.

- `src/cli/features/conform/command.ts`
  - Reads `options.modelPath` when generating model-based walks.
  - It has no concept of multiple models.

- `src/cli/features/export/command.ts`
  - Reads exactly one model and writes one export artifact.

# Exact File Paths and Relevant Symbols

- `src/cli/defaults.ts`
  - Existing or planned: `discoverPropsFiles`, `inferExtractTargetsFromProps`, `artifactPathsForPropsFile`, `defaultModelPath`, `defaultModelsDir`.
  - Add target-discovery helpers for downstream commands:
    - `discoverCheckTargets(root = process.cwd())`
    - `resolveDefaultModelPath(root = process.cwd())` or similar if needed for `conform`/`export`.

- `src/cli/cli.ts`
  - Existing: `main()`
  - Change command branches:
    - `check`
    - optionally `ci`
    - `conform`
    - `export`

- `src/cli/features/check/command.ts`
  - Existing: `runCheckCommand`, `CheckCommandOptions`, `CheckCommandResult`.
  - Prefer not to change unless returning a combined report needs a reusable helper.

- `test/modality/cli-defaults.test.ts`
  - Add unit coverage for target discovery.

- `test/modality/cli.test.ts`
  - Add CLI integration coverage for no-arg `check`.
  - Add coverage for clear `conform` / `export` behavior with multiple generated models.

- `src/cli/features/check/command.test.ts`
  - No required changes if multi-target orchestration remains in `src/cli/cli.ts`.

# Existing Patterns to Follow

- Preserve single-target command functions and keep multi-target orchestration at the CLI layer, matching how `modality extract` fans out in the extraction plan.
- Use `discoverPropsFiles` / `artifactPathsForPropsFile` rather than duplicating path derivation logic.
- Keep deterministic ordering by sorting paths.
- Preserve all explicit positional behavior:
  - `modality check model.json props.mjs`
  - `modality check model.json props-a.mjs props-b.mjs`
  - `modality export model.json`
  - `modality conform --model model.json`
  - `modality ci model.json props.mjs --artifacts .modality`
- Prefer clear errors over surprising implicit behavior when a command requires exactly one model and multiple `.modality/models/**/*.model.json` files exist.

# Atomic Implementation Steps

1. Add downstream target discovery helpers.

   Files to edit:
   - `src/cli/defaults.ts`
   - `test/modality/cli-defaults.test.ts`

   Implementation:
   - Add an interface such as:
     - `CheckTargetFromProps`
       - `propsPath: string`
       - `modelPath: string`
       - optionally `appModelPath: string`
   - Add `inferCheckTargetsFromProps(root = process.cwd())`.
   - It should:
     - discover source `*.props.mjs` files;
     - derive each target model path using `artifactPathsForPropsFile(propsPath, root).modelPath`;
     - validate that each derived model file exists;
     - return sorted targets matching props discovery order.
   - If no props files exist, keep the existing `No *.props.mjs files found under ...` message.
   - If a props file exists but matching model does not, throw a clear message:
     - `Missing inferred model files for props: <model paths>`
   - Add `discoverGeneratedModelFiles(root = process.cwd())` only if needed for `conform` / `export` ambiguity checks.

2. Update no-argument `modality check`.

   Files to edit:
   - `src/cli/cli.ts`
   - `test/modality/cli.test.ts`

   Implementation:
   - Keep current explicit behavior:
     - if any positional model path is supplied, use existing logic exactly.
   - Change only the no-positional case:
     - call `inferCheckTargetsFromProps()`;
     - for each target, call `runCheckCommand` with:
       - `modelPath: target.modelPath`
       - `propsPaths: [target.propsPath]`
       - same overlay/search limit options;
       - target-specific report/traces/replay output paths, not shared global paths.
   - Recommended target-specific artifact paths:
     - report: replace `.model.json` with `.report.json` under `.modality/models`
     - traces: sibling directory named `<base>.traces`
     - replay tests: sibling directory named `<base>.replay-tests`
     - action replay tests: sibling directory named `<base>.action-replay-tests`
   - Print a header before each target result:
     - `checkTarget=<modelPath> props=<propsPath>`
   - Combined exit code:
     - `0` only if every target exit code is `0`;
     - `2` if any target exits `2`.
   - Do not attempt to merge reports in this change.

3. Preserve explicit `modality check` report/traces behavior.

   Files to edit:
   - `src/cli/cli.ts`
   - `test/modality/cli.test.ts`

   Implementation:
   - If the user supplies `modelPath`, keep `--report`, `--traces`, `--replay-tests`, and `--action-replay-tests` pointing exactly where requested/defaulted.
   - For no-positional multi-target mode, reject explicit artifact path flags that cannot safely fan out, or interpret them as root directories.
   - Recommended conservative behavior:
     - allow `--report` only in explicit single-model mode;
     - allow `--traces`, `--replay-tests`, and `--action-replay-tests` only in explicit single-model mode;
     - in no-positional multi-target mode, throw:
       - `--report requires an explicit model path when checking multiple generated models`
   - If product intent is directory fan-out for these flags, stop and ask before implementing.

4. Add CLI integration tests for no-arg `check`.

   Files to edit:
   - `test/modality/cli.test.ts`

   Test case:
   - Create a temp project with:
     - `app/root.props.mjs`
     - `app/routes/home.props.mjs`
     - matching `.modality/models/app/root.model.json`
     - matching `.modality/models/app/routes/home.model.json`
   - Use tiny model JSON fixtures with one simple var/transition or no transitions.
   - Props files should export valid `properties`.
   - Run `modality check` from the temp project root with no positional args.
   - Assert stdout contains:
     - `checkTarget=.modality/models/app/root.model.json props=<absolute-or-relative app/root.props.mjs>`
     - `checkTarget=.modality/models/app/routes/home.model.json props=<...>`
     - each property verdict.
   - Assert exit code is `0` when both pass.
   - Add a failing/violated property in one target and assert combined exit code is `2`.

5. Add missing-model test for no-arg `check`.

   Files to edit:
   - `test/modality/cli.test.ts`
   - or `test/modality/cli-defaults.test.ts` for helper-only behavior.

   Test case:
   - Create `app/root.props.mjs`.
   - Do not create `.modality/models/app/root.model.json`.
   - Run `modality check`.
   - Assert clear missing-model error.

6. Add `modality ci` convenience path without changing single-target internals.

   Files to edit:
   - `src/cli/cli.ts`
   - `test/modality/cli.test.ts`

   Recommended CLI behavior:
   - Preserve existing required form:
     - `modality ci <model.json> [props.mjs] --artifacts .modality`
   - Add a convenience form:
     - `modality ci <props.mjs> --artifacts .modality`
   - If the first positional ends with `.props.mjs`, derive model path with `artifactPathsForPropsFile(propsPath).modelPath`.
   - Pass derived `modelPath` and `propsPath` into `runCiCommand`.
   - Keep artifact output under the provided `--artifacts` dir; do not auto-fan-out CI in this change.
   - If no positional args are supplied to `ci`, keep the current `Missing model.json path` error unless product wants multi-target CI.

7. Make `modality conform` model defaults target-aware.

   Files to edit:
   - `src/cli/cli.ts`
   - `test/modality/cli.test.ts`

   Implementation:
   - Preserve explicit `--model`.
   - When generating walks with no `--model`:
     - if `.modality/model.json` exists, use it for backwards compatibility;
     - else if exactly one `.modality/models/**/*.model.json` exists, use it;
     - else if multiple generated models exist, throw:
       - `Multiple generated models found; pass --model <path>`
   - Do not auto-run conformance for every generated model in this change.

8. Make `modality export` model defaults target-aware.

   Files to edit:
   - `src/cli/cli.ts`
   - `test/modality/cli.test.ts`

   Implementation:
   - Preserve explicit positional model path.
   - With no model path:
     - if `.modality/model.json` exists, use it;
     - else if exactly one `.modality/models/**/*.model.json` exists, use it;
     - else if multiple generated models exist, throw:
       - `Multiple generated models found; pass a model path`
   - Do not auto-export every generated model in this change.

9. Update CLI usage text.

   Files to edit:
   - `src/cli/cli.ts`

   Implementation:
   - Update `modality check` usage to mention:
     - no args checks discovered `.modality/models/**/*.model.json` against matching `*.props.mjs`.
   - Update `ci` usage if the props-only convenience form is added.
   - Keep help text concise.

10. Update docs only where existing CLI behavior docs are already touched.

   Files to inspect:
   - `docs/design.md`
   - `docs/specs/04-conformance.md`
   - `docs/specs/05-architecture.md`

   Implementation:
   - Add a short note that no-arg `check` follows the per-props artifact layout.
   - Do not rewrite architecture docs.

# Per-Step Files to Edit

- Step 1:
  - `src/cli/defaults.ts`
  - `test/modality/cli-defaults.test.ts`

- Steps 2, 3, 6, 7, 8, 9:
  - `src/cli/cli.ts`
  - `test/modality/cli.test.ts`

- Step 4:
  - `test/modality/cli.test.ts`

- Step 5:
  - `test/modality/cli.test.ts`
  - optionally `test/modality/cli-defaults.test.ts`

- Step 10:
  - `docs/design.md`
  - optionally `docs/specs/04-conformance.md`
  - optionally `docs/specs/05-architecture.md`

# Acceptance Criteria

- `modality check` with no args no longer attempts to read `.modality/model.json` when per-props model artifacts exist.
- `modality check` with no args pairs each discovered `*.props.mjs` with its matching `.modality/models/**/*.model.json`.
- `app/root.props.mjs` maps to `.modality/models/app/root.model.json`.
- `app/routes/$slug.props.mjs` maps to `.modality/models/app/routes/$slug.model.json`.
- Explicit `modality check model.json props.mjs` behavior is unchanged.
- Explicit single-model `--report`, `--traces`, `--replay-tests`, and `--action-replay-tests` behavior is unchanged.
- No-arg multi-target `check` produces separate report/trace/replay locations or rejects single-output flags clearly.
- `modality ci <props.mjs> --artifacts <dir>` can derive the matching model path.
- `modality conform` and `modality export` do not silently choose one model when multiple generated models exist.
- Legacy `.modality/model.json` remains supported.

# Tests to Add or Update

- `test/modality/cli-defaults.test.ts`
  - `inferCheckTargetsFromProps` returns root and route targets.
  - Missing generated model gives clear helper error.
  - Single generated model discovery helper works if added.

- `test/modality/cli.test.ts`
  - no-arg `modality check` runs multiple props/model targets.
  - no-arg `modality check` returns `2` if any target fails.
  - no-arg `modality check --report custom.json` errors clearly in multi-target mode.
  - explicit `modality check model.json props.mjs --report custom.json` remains unchanged.
  - `modality ci app/root.props.mjs --artifacts .modality/ci-root` derives `.modality/models/app/root.model.json`.
  - `modality conform` with multiple generated models and no `--model` errors clearly.
  - `modality export` with multiple generated models and no model positional errors clearly.

# Verification Commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/modality/cli-defaults.test.ts test/modality/cli.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts src/cli/features/ci/command.test.ts src/cli/features/conform/command.test.ts src/cli/features/export/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

Optional manual verification against tinyurl after running the new extract:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk pnpm exec modality check
rtk pnpm exec modality check .modality/models/app/root.model.json app/root.props.mjs
rtk pnpm exec modality ci app/root.props.mjs --artifacts .modality/ci-root
```

# Risks, Ambiguities, and Stop Conditions

- Ambiguity: The generated `.modality/models/**/*.props.ts` files are named like props files but are generated TypeScript model companions. The checker currently imports user-authored `*.props.mjs`; do not import generated `.props.ts` unless product explicitly changes the contract.
- Ambiguity: Multi-target reports could be merged or written separately. This plan chooses separate per-target artifacts and rejects single-output flags in no-arg multi-target mode. Stop and ask if a combined report is required.
- Risk: `modality check` currently uses `discoverPropsFiles()` and may find props without generated models. Fail clearly; do not fall back to `.modality/model.json` for only some props because that mixes model scopes.
- Risk: CI multi-target fan-out is larger than this plan. This plan adds only a props-path convenience form. Stop and ask if the desired behavior is `modality ci --artifacts .modality` with no model/props args running all generated models.
- Risk: `conform` and `export` can only operate on one model today. Do not guess when multiple generated models exist.
- Stop and report if tests already rely on no-arg `modality check` using legacy `.modality/model.json` even when `.modality/models` exists; preserve legacy only when `.modality/model.json` exists and no generated per-props models are present, or ask for precedence.
