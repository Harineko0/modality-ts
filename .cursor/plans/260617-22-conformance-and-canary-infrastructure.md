# Conformance Matrix and Real-App Canary Infrastructure

Status: implementation plan.
Date: 2026-06-17.
Plan families: F - Conformance Matrix, G - Real-App Canary Suite.

This plan implements the verification infrastructure that should keep future
`modality-ts` work architecture-led instead of app-debugging-led. It creates a
durable conformance matrix, canonical fixtures, canary manifests, threshold
checks, state-space budgets, failure classification, and CI/local commands.

This plan is intentionally architecture-supporting. It should not add support
for one new library or framework feature. Its job is to make every future
feature prove itself against small semantic fixtures first, then against
curated real-app canaries second.

## 1. Goal

Create first-class infrastructure for:

- a repository-owned conformance matrix whose rows are semantic capabilities and
  whose columns are frameworks/libraries/source adapters;
- small canonical fixtures that prove semantic claims through extract, check,
  conform, and report assertions;
- real-app canary definitions that record commands, dependency/version facts,
  accepted caveats, coverage thresholds, conformance thresholds, state-space
  budgets, and known unsupported behavior;
- canary failure classification that turns real-app failures into
  abstraction-level signals, not one-off patches;
- local and CI commands for running fixture conformance, canaries, or both;
- reports that are machine-readable enough to gate changes and human-readable
  enough to guide future implementation plans.

The intended end state is:

- a semantic feature is not marked supported until a canonical conformance
  fixture exists and is listed in the matrix;
- real-app failures are classified as missing abstraction, missing adapter
  capability, syntax recognition gap, checker/IR bug, state-space budget issue,
  environment/project integration issue, or explicit unsupported behavior;
- thresholds and budgets live in versioned fixtures/manifests rather than
  hard-coded scripts;
- `pnpm ci:examples` evolves from one demo app into a small orchestrated canary
  runner, while preserving the demo acceptance check as one canary.

## 2. Non-goals

- Do not implement new React, Next, React Router, Jotai, SWR, Zustand, Zod,
  ArkType, XState, or cache semantics.
- Do not change checker semantics, IR semantics, source adapter semantics, or
  TypeScript extraction rules except where report metadata is needed by the new
  infrastructure.
- Do not make real apps the source of truth for semantics. Real apps are
  canaries after fixtures pass.
- Do not preserve compatibility with the current hard-coded
  `tools/examples-ci.ts` shape if a manifest-driven runner replaces it.
- Do not add compatibility aliases for old report shapes if the plan chooses a
  cleaner schema.
- Do not execute arbitrary remote app code. Canary apps must be local fixtures,
  local worktrees, or explicit manifest paths.
- Do not commit generated `.modality/`, `dist/`, trace, report, or replay-test
  artifacts.
- Do not edit `.cursor/plans/260617-18-versatility-plan-of-plans.md` or other
  worker plan files.

## 3. Current-State Findings

- `package.json` already exports `modality-ts/cli/conform` and has scripts:
  - `pnpm ci:examples` -> `tsx tools/examples-ci.ts`;
  - `pnpm phase7` -> `tsx tools/phase7-differential.ts`;
  - `pnpm test`, `pnpm typecheck`, `pnpm architecture`, and `pnpm fix`.
- `src/cli/features/conform/command.ts` already provides:
  - `runConformCommand`;
  - `generateConformWalks`;
  - `ConformWalkArtifact`;
  - `ConformWalksArtifact`;
  - abstract and action replay modes;
  - per-transition pass-rate aggregation.
- `src/core/report/types.ts` already defines `ConformReport`, but it only
  records walk and transition metrics. It does not record matrix row ids,
  fixture ids, canary ids, semantic feature ids, failure categories, thresholds,
  or budgets.
- `src/cli/features/ci/command.ts` already supports optional conformance during
  CI through:
  - `conformWalksPath`;
  - `conformCount`;
  - `conformDepth`;
  - `conformSeed`;
  - `conformMode`;
  - `conformHarnessPath`;
  - `minConformPassRate`;
  - `minTransitionConformPassRate`.
- `src/cli/features/ci/command.ts` already compares trust-ledger regressions
  against a baseline check report, including caveats, manual transitions,
  over-approx transitions, ignored vars, domains, plugins, and bound hits.
- `tools/examples-ci.ts` is a single hard-coded integration script for
  `examples/demo-app`. It verifies:
  - extraction coverage is 100 percent exact/overlay;
  - check finds three seeded violations;
  - at least two replay traces reproduce;
  - overlay line count stays under 100;
  - `runCiCommand` reports expected seeded failures and determinism.
- `examples/` currently contains `demo-app`, `checkout-app`, and `todo-app`.
  These are useful starter canaries, but the current runner only uses
  `demo-app`.
- `docs/_specs/04-conformance.md` and
  `docs/architecture/conformance-and-replay.md` already describe proactive
  conformance, replay verdicts, stepwise agreement, witness factories, and
  per-transition pass rates. The implementation is narrower than the spec.
- `docs/concepts/state-space-control.md` already describes state-space budgets,
  sound reductions, heuristic reductions, and bound-hit policy.
- `src/core/report/types.ts` already has extraction coverage, route coverage,
  state-space contributors, trust ledger, diagnostics, and search limit fields
  that can be reused for canary thresholds.
- `src/core/artifacts/index.ts` validates report artifact schemas but has no
  parser for matrix/canary manifest artifacts.
- There is no repository-owned `test/conformance/` or `test/canaries/`
  directory, no manifest schema, no matrix artifact, and no failure taxonomy in
  code.
- Several recent closed plans and issues show real-app-driven discovery around
  routing, state-space explosion, tsconfig JSONC, schema refinements, imported
  interactions, lazy initializers, and server/effect APIs. This confirms the
  need to preserve real-app contact, but classify it into reusable
  infrastructure instead of local patches.

## 4. Exact File Paths and Relevant Symbols

Primary implementation files:

- `src/core/report/types.ts`
  - `ConformReport`
  - `ExtractionReport`
  - `CheckReport`
  - `CheckReportDiagnostics`
  - `RouteCoverage`
  - `StateSpaceContributors`
  - add `ConformanceMatrixReport`
  - add `CanaryRunReport`
  - add `CanaryFailureClassification`
- `src/core/artifacts/index.ts`
  - `parseConformReportArtifact`
  - add `parseConformanceMatrixReportArtifact`
  - add `parseCanaryRunReportArtifact`
  - optionally add manifest parsing only if manifests live in `core`
- `src/cli/features/conform/command.ts`
  - `ConformCommandOptions`
  - `ConformCommandResult`
  - `runConformCommand`
  - `generateConformWalks`
  - `createConformReport`
  - `transitionMetrics`
- `src/cli/features/conform/output.ts`
  - `renderHumanConformResult`
- `src/cli/features/ci/command.ts`
  - `CiCommandOptions`
  - `runCiCommand`
  - `transitionConformFailuresBelow`
  - `compareTrustLedger`
- `src/cli/features/ci/output.ts`
  - `renderHumanCiResult`
- `src/cli/cli.ts`
  - command dispatch and usage lines
  - conform/ci option parsing
- `src/cli/defaults.ts`
  - `.modality` default artifact paths
- `tools/examples-ci.ts`
  - replace or wrap with manifest-driven canary runner
- new `tools/conformance-ci.ts`
  - fixture matrix runner
- new `tools/canary-ci.ts`
  - real-app canary runner
- new `src/cli/features/conformance-matrix/`
  - only if a CLI feature is preferred over a tool script
- new `src/cli/features/canary/`
  - only if a CLI feature is preferred over a tool script

New data/config files:

- new `test/conformance/matrix.json`
  - durable list of semantic rows, library/framework columns, fixtures, and
    expected support level.
- new `test/conformance/fixtures/**`
  - canonical fixture apps and/or model/report fixtures.
- new `test/conformance/fixtures/**/modality.conformance.json`
  - per-fixture command and threshold metadata if matrix rows need local
    overrides.
- new `test/canaries/canaries.json`
  - curated real-app canary manifest.
- new `test/canaries/apps/**`
  - only for small local canary apps that belong in-repo.
- new `test/canaries/baselines/**`
  - checked-in baseline report snapshots only if small and intentionally
    hand-curated. Do not store generated traces or `.modality` directories.

Tests to add/update:

- `src/cli/features/conform/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- `test/modality/cli.test.ts`
- `test/modality/cli-defaults.test.ts`
- new `test/conformance/matrix.test.ts`
- new `test/conformance/runner.test.ts`
- new `test/canaries/manifest.test.ts`
- new `test/canaries/runner.test.ts`
- `test/packaging/package-manifest.test.ts` if package exports/scripts change
- `test/extraction/architecture.test.ts` if new directories or feature imports
  need architecture rules

Docs/specs to update:

- `docs/_specs/04-conformance.md`
- `docs/architecture/conformance-and-replay.md`
- `docs/concepts/state-space-control.md`
- `docs/guides/ci-integration.md` if present
- `docs/reference/schemas.md` if report artifacts gain new schemas
- `docs/_specs/05-architecture.md` if feature-slice layout changes

## 5. Existing Patterns to Follow

- Keep artifact schemas in `src/core/report/types.ts` and parsing in
  `src/core/artifacts/index.ts`.
- Keep CLI feature implementations under `src/cli/features/<feature>/` when
  the command is user-facing. Keep repository-only orchestration under `tools/`
  when the command is mostly maintainer CI.
- Follow `src/cli/features/conform/command.ts` for deterministic seeded walks
  and pass-rate metrics.
- Follow `src/cli/features/ci/command.ts` for threshold failure exit codes and
  machine-readable line summaries.
- Follow `tools/examples-ci.ts` for direct TypeScript invocation of command
  wrappers and temp artifact directories.
- Follow `tools/phase7-differential.ts` for a repo-level verification tool that
  produces concise pass/fail output and cleans temp directories.
- Follow `src/core/artifacts/index.ts` parse functions: reject unsupported
  `schemaVersion`, validate required fields, and cast only after structural
  checks.
- Keep fixtures small and canonical. Prefer focused fixture directories over
  broad app snapshots.
- Keep real-app canaries manifest-driven. App-specific expectations belong in
  the canary manifest, not in TypeScript conditionals.

## 6. Target Concepts and Data Shapes

Names may be adjusted during implementation, but keep these concepts explicit.

### 6.1 Semantic Feature Rows

Create stable row ids for semantic capabilities, for example:

```ts
export interface ConformanceFeatureRow {
  id: string;
  title: string;
  layer:
    | "typescript"
    | "core-ir"
    | "checker"
    | "react-semantics"
    | "routing"
    | "state-source"
    | "effect-api"
    | "schema-domain"
    | "replay-observation"
    | "reporting";
  contract:
    | "compiler"
    | "official-docs"
    | "core-spec"
    | "adapter-spi"
    | "fixture";
  requiredFixtures: readonly string[];
}
```

Rows should describe semantic behavior, not library names. Examples:

- `state.local.setter-batching`
- `state.local.functional-updater`
- `scope.mount-local.reset`
- `effects.cleanup-order`
- `async.pending-op.args`
- `routing.location-assignment`
- `forms.submit-action`
- `domains.schema.numeric-bounds`
- `stores.external.selector-action`
- `reports.structured-caveats`
- `slicing.unrelated-vars-pruned`

### 6.2 Matrix Cells

```ts
export interface ConformanceMatrixCell {
  featureId: string;
  targetId: string;
  status: "supported" | "partial" | "unsupported" | "not-applicable";
  fixtures: readonly string[];
  acceptedCaveats?: readonly string[];
  minCoverageExactOrOverlay?: number;
  minConformPassRate?: number;
  maxStates?: number;
  maxEdges?: number;
  maxFrontier?: number;
  notes?: string;
}
```

Targets should be adapter/framework/library columns such as:

- `core`
- `typescript`
- `react-use-state`
- `react-router`
- `next-app-router`
- `next-pages-router`
- `jotai`
- `swr`
- `zustand`
- `zod`
- `arktype`

### 6.3 Fixture Manifest

```ts
export interface ConformanceFixture {
  id: string;
  featureIds: readonly string[];
  targetIds: readonly string[];
  root: string;
  sourcePaths: readonly string[];
  propsPaths: readonly string[];
  commands: {
    extract?: ExtractFixtureCommand;
    check?: CheckFixtureCommand;
    conform?: ConformFixtureCommand;
  };
  thresholds: ConformanceThresholds;
  expectedReports?: {
    extraction?: PartialExtractionExpectation;
    check?: PartialCheckExpectation;
    conform?: PartialConformExpectation;
  };
}
```

Fixture expectations should compare semantic facts, not full snapshots. Avoid
blanket JSON snapshot regeneration.

### 6.4 Canary Manifest

```ts
export interface CanaryDefinition {
  id: string;
  title: string;
  kind:
    | "react-router-app"
    | "next-app-router-app"
    | "next-pages-router-app"
    | "external-store-app"
    | "schema-form-app"
    | "server-action-app"
    | "tsconfig-layout-app";
  root: string;
  packageManager?: "pnpm" | "npm" | "yarn";
  dependencyFacts: readonly {
    packageName: string;
    expectedRange?: string;
    source: "package-json" | "lockfile";
  }[];
  extract: {
    sourcePaths?: readonly string[];
    configPath?: string;
    packageJsonPath?: string;
    effectApis?: readonly string[];
    disabledPlugins?: readonly string[];
  };
  check?: {
    propsPaths?: readonly string[];
    maxStates?: number;
    maxEdges?: number;
    maxFrontier?: number;
    memoryGuardMb?: number;
  };
  conform?: {
    count?: number;
    depth?: number;
    seed?: number;
    mode?: "abstract" | "action";
    harnessPath?: string;
    minPassRate?: number;
    minTransitionPassRate?: number;
  };
  thresholds: CanaryThresholds;
  acceptedCaveats: readonly CanaryAcceptedCaveat[];
  knownUnsupported: readonly string[];
}
```

### 6.5 Failure Classification

```ts
export type CanaryFailureCategory =
  | "missing-semantic-abstraction"
  | "missing-adapter-capability"
  | "syntax-recognition-gap"
  | "incorrect-ir-or-checker"
  | "state-space-budget"
  | "environment-or-project-integration"
  | "explicit-unsupported-behavior"
  | "fixture-or-canary-invalid";

export interface CanaryFailureClassification {
  canaryId: string;
  category: CanaryFailureCategory;
  severity: "blocker" | "action-required" | "accepted";
  evidence: readonly string[];
  suggestedPlanFamily:
    | "semantic-typescript-foundation"
    | "framework-neutral-ir-checker"
    | "adapter-spi"
    | "domain-data-abstraction"
    | "effects-async-environment"
    | "conformance-matrix"
    | "real-app-canary"
    | "state-space-economics"
    | "trust-ledger-docs";
}
```

Classification should be deterministic from report facts where possible:

- new unextractable handler, new global taint, or missing write caveat:
  `missing-semantic-abstraction` or `missing-adapter-capability`;
- one transition not reproduced while the same semantic fixture passes:
  `syntax-recognition-gap` if the abstraction already exists;
- validator/checker/TLA mismatch, impossible trace, or exact transition
  divergence in a canonical fixture: `incorrect-ir-or-checker`;
- max states/edges/frontier/memory guard hit or dominant vars above budget:
  `state-space-budget`;
- tsconfig/package/module resolution failure: `environment-or-project-integration`;
- caveat listed in `knownUnsupported`: `explicit-unsupported-behavior`.

## 7. Atomic Implementation Steps

### Step 1 - Add manifest and report types

Files to edit:

- `src/core/report/types.ts`
- `src/core/artifacts/index.ts`
- new `test/conformance/matrix.test.ts`
- new `test/canaries/manifest.test.ts`

Implementation:

1. Add report types for:
   - `ConformanceMatrixReport`;
   - `CanaryRunReport`;
   - `CanaryFailureClassification`;
   - threshold and budget result entries.
2. Add artifact parsers:
   - `parseConformanceMatrixReportArtifact`;
   - `parseCanaryRunReportArtifact`.
3. Decide whether manifest parse helpers belong in `core` or in a new
   `tools/conformance/manifest.ts`. Prefer `tools/` if these manifests are
   repository-maintainer inputs, not public package artifacts.
4. Use `schemaVersion: 1` and `kind` discriminants:
   - `kind: "conformance-matrix-report"`;
   - `kind: "canary-run-report"`.
5. Reject malformed threshold values:
   - pass rates must be `0 <= value <= 1`;
   - budgets must be positive integers;
   - fixture ids, feature ids, target ids, and canary ids must be non-empty.

Acceptance criteria:

- Parser tests reject unsupported schema versions and missing required fields.
- Report types can express matrix row status, per-fixture results, canary
  thresholds, budgets, accepted caveats, and failure classification.
- No existing `ConformReport` reader breaks unless intentionally updated in the
  same step.

### Step 2 - Create the conformance matrix manifest

Files to add/edit:

- new `test/conformance/matrix.json`
- new `test/conformance/README.md`
- new `test/conformance/matrix.test.ts`

Implementation:

1. Define the initial matrix schema in JSON with:
   - `schemaVersion`;
   - `features`;
   - `targets`;
   - `cells`;
   - `fixtures`.
2. Seed rows for architecture-level semantic capabilities already present in
   the codebase:
   - local state setter semantics;
   - batching/functional updater snapshots;
   - effects/cleanup/stale closure;
   - timers and cancellation;
   - suspense/concurrent transitions;
   - numeric/domain abstraction;
   - schema domain refinements;
   - route/mount scope behavior;
   - external state source basics;
   - structured caveats/trust ledger;
   - state-space contributor reporting;
   - conform walk replay.
3. Seed target columns for current built-ins:
   - `core`;
   - `typescript`;
   - `react-use-state`;
   - `react-router`;
   - `next`;
   - `jotai`;
   - `swr`;
   - `zustand`;
   - `zod`;
   - `arktype`.
4. Mark cells honestly:
   - use `supported` only when a current focused test/fixture already exists;
   - use `partial` where behavior exists but lacks a canonical fixture;
   - use `unsupported` where behavior is known absent;
   - use `not-applicable` where the target cannot exercise the row.
5. Add a test that every `supported` cell has at least one fixture id and every
   fixture id exists.
6. Add a test that every current source adapter or type-library adapter has at
   least one target column.

Acceptance criteria:

- The matrix is a durable planning artifact, not an aspirational checklist.
- It can represent gaps without failing CI unless the runner is asked to enforce
  supported cells only.
- The matrix test fails when a supported cell lacks a fixture.

### Step 3 - Add canonical fixture directory conventions

Files to add/edit:

- new `test/conformance/fixtures/README.md`
- new `test/conformance/fixtures/**`
- new `test/conformance/runner.test.ts`
- optionally new helper `test/conformance/helpers.ts`

Implementation:

1. Establish fixture layout:

```text
test/conformance/fixtures/<fixture-id>/
  app/
    App.tsx or route files
    app.props.ts or *.props.ts
    package.json when dependency facts matter
    tsconfig.json when compiler behavior matters
  fixture.json
```

2. `fixture.json` records feature ids, target ids, commands, thresholds, and
   expected semantic report facts.
3. Add a small helper for running extract/check/conform commands against a
   fixture into a temp artifact directory.
4. Move only truly canonical mini-apps into this tree. Do not move large
   examples or real apps.
5. Prefer semantic assertions:
   - transition ids present;
   - var domains and scopes;
   - caveat kinds/ids;
   - coverage percentages;
   - conformance pass rates;
   - state-space stats under budget.

Acceptance criteria:

- At least three initial fixtures exist and are connected to matrix cells:
  - one local `useState` setter/batching fixture;
  - one route/mount scope fixture;
  - one structured caveat or domain-refinement fixture.
- Fixture tests run without writing generated artifacts into the repository.
- Fixture failures point to semantic expectation mismatches, not full JSON
  snapshot diffs.

### Step 4 - Implement a conformance matrix runner

Files to add/edit:

- new `tools/conformance-ci.ts`
- new `tools/conformance/manifest.ts`
- new `tools/conformance/runner.ts`
- `package.json`
- new `test/conformance/runner.test.ts`

Implementation:

1. Add a maintainer script:

```json
"ci:conformance": "tsx tools/conformance-ci.ts"
```

2. The runner should:
   - read `test/conformance/matrix.json`;
   - run all fixtures for cells with `status: "supported"` by default;
   - support flags `--feature`, `--target`, `--fixture`, and `--include-partial`;
   - write a `ConformanceMatrixReport` to a temp dir by default;
   - optionally write a report path with `--report`.
3. The runner should call existing command wrappers directly:
   - `runExtractCommand`;
   - `runCheckCommand`;
   - `runConformCommand`.
4. Threshold checks should include:
   - `ExtractionReport.coverage.percentExactOrOverlay`;
   - `ExtractionReport.coverage.unextractable`;
   - `ExtractionReport.globalTaints`, `staleReads`,
     `unhandledRejections`;
   - `CheckReport.stats.states`, `edges`, `depth`;
   - `CheckReport.diagnostics.limits`;
   - `CheckReport.trustLedger.boundHits`;
   - `ConformReport.metrics.passRate`;
   - per-transition pass rate when configured.
5. Exit codes:
   - `0`: all enforced cells pass;
   - `2`: semantic expectation or threshold failed;
   - `3`: fixture invalid or missing manifest entry;
   - `4`: runner infrastructure failure.

Acceptance criteria:

- `rtk pnpm ci:conformance` runs initial fixtures and produces concise output.
- A deliberately failing fixture in tests produces a classified matrix failure.
- The runner does not know about specific libraries beyond manifest target ids.

### Step 5 - Extend `ConformReport` with fixture context

Files to edit:

- `src/core/report/types.ts`
- `src/core/artifacts/index.ts`
- `src/cli/features/conform/command.ts`
- `src/cli/features/conform/output.ts`
- `src/cli/features/conform/command.test.ts`

Implementation:

1. Add optional metadata to `ConformReport`:
   - `fixtureId?: string`;
   - `featureIds?: readonly string[]`;
   - `targetIds?: readonly string[]`;
   - `thresholds?: { minPassRate?: number; minTransitionPassRate?: number }`.
2. Extend `ConformCommandOptions` with the same optional metadata, or keep it
   runner-side if the CLI should stay lean. Prefer command options if `ci`
   should later pass these through.
3. Do not require ordinary users of `modality conform` to provide fixture ids.
4. Render fixture context in human output only when present.

Acceptance criteria:

- Existing conform tests continue to pass after updating expected report shapes.
- Matrix runner can associate conform results with fixture/feature/target ids
  without external side tables.
- `parseConformReportArtifact` validates new optional arrays when present.

### Step 6 - Introduce real-app canary manifest

Files to add/edit:

- new `test/canaries/canaries.json`
- new `test/canaries/README.md`
- new `test/canaries/manifest.test.ts`

Implementation:

1. Create a manifest schema for curated canaries.
2. Seed canaries using local apps already in the repository:
   - `examples/demo-app` as a seeded-bug acceptance canary;
   - `examples/todo-app` as a simple local-state app;
   - `examples/checkout-app` as a checkout workflow canary.
3. If additional framework families are not currently available in-repo, list
   their canary slots with `status: "planned"` or equivalent instead of
   fabricating coverage:
   - React Router app;
   - Next App Router app;
   - Next Pages Router app;
   - external-store app;
   - schema/forms app;
   - server actions/effect API app;
   - unusual tsconfig/module-layout app.
4. Each active canary must define:
   - root path;
   - extraction command inputs;
   - check/conform options;
   - coverage thresholds;
   - accepted caveats;
   - state-space budgets;
   - expected violation/replay behavior if it is a seeded-bug app.
5. Add tests that:
   - every active canary root exists;
   - every active canary has at least one threshold;
   - accepted caveats have stable ids/kinds, not free-form message regexes;
   - planned canaries do not run.

Acceptance criteria:

- Real-app canary expectations are declarative.
- `examples/demo-app` behavior is represented by manifest data rather than
  hard-coded TypeScript constants.
- The manifest can grow to out-of-repo worktree paths later without changing
  runner logic.

### Step 7 - Implement canary runner and replace hard-coded example CI

Files to add/edit:

- new `tools/canary-ci.ts`
- new `tools/canary/manifest.ts`
- new `tools/canary/runner.ts`
- `tools/examples-ci.ts`
- `package.json`
- new `test/canaries/runner.test.ts`

Implementation:

1. Add a script:

```json
"ci:canaries": "tsx tools/canary-ci.ts"
```

2. Keep `pnpm ci:examples`, but make `tools/examples-ci.ts` call the new canary
   runner for the example-app canary group. This preserves the existing command
   name while removing hard-coded logic.
3. The canary runner should:
   - read `test/canaries/canaries.json`;
   - select active canaries by default;
   - support `--canary <id>`, `--kind <kind>`, and `--report <path>`;
   - create temp artifact dirs;
   - run extract, check, replay/conform as requested by the manifest;
   - compare results against thresholds and accepted caveats;
   - write a `CanaryRunReport`.
4. Preserve demo-app seeded-bug checks as manifest expectations:
   - expected violated property count;
   - expected property names;
   - minimum reproduced replay count;
   - overlay line budget;
   - expected CI exit code for seeded bugs.
5. Do not shell out to `pnpm` for extract/check if direct command wrappers are
   sufficient. Use direct wrappers for speed and determinism.

Acceptance criteria:

- `rtk pnpm ci:examples` still passes with equivalent semantic checks.
- `rtk pnpm ci:canaries` runs all active canaries.
- Tests prove a canary threshold failure is recorded in `CanaryRunReport`.
- `tools/examples-ci.ts` no longer encodes demo-specific thresholds except by
  selecting the demo canary/group.

### Step 8 - Add failure classification

Files to add/edit:

- new `tools/canary/classify.ts`
- new `tools/conformance/classify.ts` if matrix failures share logic
- `src/core/report/types.ts`
- `test/canaries/runner.test.ts`
- `test/conformance/runner.test.ts`

Implementation:

1. Implement deterministic classification from available report facts:
   - extraction parse/project errors -> `environment-or-project-integration`;
   - coverage below threshold due to new unextractable handlers ->
     `missing-semantic-abstraction`;
   - structured caveat from a known adapter capability gap ->
     `missing-adapter-capability`;
   - conform failure on a supported fixture exact transition ->
     `incorrect-ir-or-checker`;
   - conform failure only in canary with fixture passing and known abstraction
     row supported -> `syntax-recognition-gap`;
   - search limits, bound hits, or dominant vars over budget ->
     `state-space-budget`;
   - caveats listed in `knownUnsupported` -> `explicit-unsupported-behavior`;
   - manifest/root/command invalid -> `fixture-or-canary-invalid`.
2. Add `suggestedPlanFamily` mapping so failures point to the plan family that
   should own the next implementation plan.
3. Do not classify by parsing human warning strings. Use structured report
   fields and caveat ids/kinds.
4. If a failure cannot be classified deterministically, report
   `fixture-or-canary-invalid` or a runner error and require manifest/schema
   improvement.

Acceptance criteria:

- Runner reports include one or more classifications for every failing canary.
- A test fixture can force each classification category without depending on a
  real app.
- Classification does not rely on framework-specific ids outside manifest data.

### Step 9 - Integrate state-space budgets and contributor checks

Files to edit:

- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- `src/core/report/types.ts`
- `src/cli/features/extract/command.ts` only if state contributor data needs to
  be emitted more consistently
- `src/cli/features/check/command.ts` only if diagnostics are missing required
  budget facts
- tests under `test/conformance/` and `test/canaries/`

Implementation:

1. Support manifest budgets:
   - `maxStates`;
   - `maxEdges`;
   - `maxDepth`;
   - `maxFrontier`;
   - `maxDominantVarValues`;
   - `maxStateSpaceBits`;
   - `maxTopContributorBits`;
   - `maxPendingQueueLen`.
2. Read budget evidence from:
   - `CheckReport.stats`;
   - `CheckReport.diagnostics.search`;
   - `CheckReport.diagnostics.limits`;
   - `CheckReport.diagnostics.dominantVars`;
   - `ExtractionReport.stateContributors`;
   - model `bounds`.
3. Treat search-limit hits as failures, not warnings.
4. Report budget failures as `state-space-budget` with evidence naming the
   contributor var ids.

Acceptance criteria:

- A canary that exceeds `maxStates` fails with `state-space-budget`.
- A conformance fixture can require a state var to disappear from unrelated
  property slices by asserting low state count or absence from slice summaries.
- Budget evidence appears in machine-readable reports.

### Step 10 - Add accepted caveat and coverage threshold gates

Files to edit:

- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- `tools/canary/manifest.ts`
- `tools/conformance/manifest.ts`
- `test/canaries/runner.test.ts`
- `test/conformance/runner.test.ts`

Implementation:

1. Implement accepted caveat matching by structured identity:
   - `kind`;
   - `id`;
   - optional `severity`;
   - optional `producer` if Adapter SPI plan has landed.
2. Fail if a report contains a caveat not listed as accepted for that fixture
   or canary, unless the fixture is explicitly partial.
3. Fail if an accepted caveat disappears only if the manifest marks it
   `mustRemain: true`. By default, disappearing caveats are good.
4. Support coverage thresholds:
   - `minExactOrOverlay`;
   - `maxUnextractable`;
   - `maxGlobalTaints`;
   - `maxUnhandledRejections`;
   - `maxStaleReads`;
   - `minRouteCoverage` when route coverage exists.
5. Ensure thresholds are not one-note global constants; each fixture/canary
   owns its threshold.

Acceptance criteria:

- New unaccepted caveats fail canaries.
- Known unsupported behavior can be acknowledged without hiding it from the
  report.
- Demo-app 100 percent exact/overlay requirement is represented as a threshold.

### Step 11 - Add CLI support only where it clarifies user workflow

Files to edit if adding CLI commands:

- `src/cli/cli.ts`
- new `src/cli/features/matrix/`
- new `src/cli/features/canary/`
- `test/modality/cli.test.ts`
- `package.json` exports if public subpaths are added

Implementation:

1. Prefer `tools/conformance-ci.ts` and `tools/canary-ci.ts` for repo
   maintainer workflows.
2. Add user-facing CLI commands only if they are useful outside this repo:
   - `modality matrix --manifest test/conformance/matrix.json`;
   - `modality canary --manifest test/canaries/canaries.json`.
3. If commands are added, keep them thin wrappers around the same runner
   modules used by `tools/`.
4. Do not add broad CLI flags that duplicate every manifest field. Manifest
   files should own detailed configuration.

Acceptance criteria:

- If no CLI commands are added, package exports remain unchanged and tools are
  documented for maintainers.
- If CLI commands are added, default usage is clear, tests cover arg parsing,
  and feature slices do not import private source adapter internals.

### Step 12 - Update docs and internal specs

Files to edit:

- `docs/_specs/04-conformance.md`
- `docs/architecture/conformance-and-replay.md`
- `docs/concepts/state-space-control.md`
- `docs/guides/ci-integration.md` if present
- `docs/reference/schemas.md` if report schemas are public
- `docs/_specs/05-architecture.md`

Implementation:

1. Document the conformance matrix:
   - rows are semantic capabilities;
   - columns are library/framework targets;
   - supported cells require fixtures.
2. Document real-app canary purpose:
   - canaries find missing abstraction boundaries;
   - canaries are not the design oracle.
3. Document failure categories and the expected follow-up:
   - missing abstraction -> new abstraction-level plan;
   - syntax recognition gap -> focused adapter/source fix after fixture exists;
   - state-space budget -> state-space economics plan;
   - unsupported behavior -> structured caveat/trust ledger.
4. Document state-space budgets and coverage thresholds as manifest-owned
   gates.
5. Update schema docs if `ConformanceMatrixReport` or `CanaryRunReport` are
   considered public artifacts.

Acceptance criteria:

- Docs do not claim broad real-app debugging is the primary workflow.
- Docs describe how to add a new semantic row, fixture, and canary.
- Docs explain how failure classification maps to future implementation plans.

### Step 13 - Tighten architecture and regression tests

Files to edit:

- `test/extraction/architecture.test.ts`
- `test/modality/features-architecture.test.ts`
- new `test/conformance/matrix.test.ts`
- new `test/canaries/manifest.test.ts`

Implementation:

1. Add tests that prevent conformance/canary runners from importing private
   adapter internals. Runners should use public command wrappers and report
   artifacts.
2. Add tests that every current source adapter/type-library adapter has a matrix
   target column.
3. Add tests that every active canary has:
   - thresholds;
   - budgets or an explicit reason budgets are not applicable;
   - accepted caveats list, even if empty;
   - failure classification policy.
4. Add tests that generated artifacts are ignored by runner temp dirs and not
   written under fixture/app roots.

Acceptance criteria:

- Architecture tests fail on haphazard private imports.
- Matrix/canary manifests cannot silently decay as adapters are added.
- Running canaries locally leaves the git worktree clean except intentional
  report output paths.

### Step 14 - Delete obsolete hard-coded paths

Files to edit:

- `tools/examples-ci.ts`
- any helper files introduced temporarily

Implementation:

1. Remove hard-coded demo thresholds from `tools/examples-ci.ts` after they
   exist in `test/canaries/canaries.json`.
2. Remove any duplicated threshold comparison logic between conformance and
   canary runners by factoring a small shared helper under `tools/`.
3. Search and remove stale assumptions:

```bash
rtk grep -n "demo extraction has unextractable handlers\\|expected 3 seeded bugs\\|overlay line budget exceeded\\|conform-pass-rate" tools src test
```

4. Keep tests that intentionally assert demo behavior, but make them read the
   manifest or runner report.

Acceptance criteria:

- `tools/examples-ci.ts` is a compatibility entrypoint, not a second canary
  system.
- Threshold logic has one implementation.
- No new library-specific special cases appear in conformance/canary runners.

## 8. Per-Step Files to Edit

| Step | Files |
| --- | --- |
| 1 | `src/core/report/types.ts`, `src/core/artifacts/index.ts`, `test/conformance/matrix.test.ts`, `test/canaries/manifest.test.ts` |
| 2 | `test/conformance/matrix.json`, `test/conformance/README.md`, `test/conformance/matrix.test.ts` |
| 3 | `test/conformance/fixtures/**`, `test/conformance/fixtures/README.md`, `test/conformance/runner.test.ts` |
| 4 | `tools/conformance-ci.ts`, `tools/conformance/manifest.ts`, `tools/conformance/runner.ts`, `package.json`, `test/conformance/runner.test.ts` |
| 5 | `src/core/report/types.ts`, `src/core/artifacts/index.ts`, `src/cli/features/conform/command.ts`, `src/cli/features/conform/output.ts`, `src/cli/features/conform/command.test.ts` |
| 6 | `test/canaries/canaries.json`, `test/canaries/README.md`, `test/canaries/manifest.test.ts` |
| 7 | `tools/canary-ci.ts`, `tools/canary/manifest.ts`, `tools/canary/runner.ts`, `tools/examples-ci.ts`, `package.json`, `test/canaries/runner.test.ts` |
| 8 | `tools/canary/classify.ts`, `tools/conformance/classify.ts`, `src/core/report/types.ts`, runner tests |
| 9 | conformance/canary runners, `src/core/report/types.ts`, check/extract report emitters only if missing budget facts |
| 10 | conformance/canary manifest and runner files, runner tests |
| 11 | `src/cli/cli.ts`, optional new CLI feature slices, CLI tests, package exports only if public commands are added |
| 12 | conformance/replay docs, state-space docs, CI docs, schema docs, architecture spec |
| 13 | architecture tests, matrix tests, manifest tests |
| 14 | `tools/examples-ci.ts`, shared threshold helpers, stale hard-code cleanup |

## 9. Acceptance Criteria

- `test/conformance/matrix.json` exists and validates.
- Every `supported` matrix cell has at least one canonical fixture.
- Initial canonical fixtures run through a manifest-driven conformance runner.
- `test/canaries/canaries.json` exists and validates.
- Existing example-app CI behavior is preserved through manifest-driven canary
  execution.
- Canary reports include threshold results, budget evidence, accepted/unaccepted
  caveats, and failure classification.
- Coverage/caveat thresholds and state-space budgets are data-driven.
- Runner logic does not contain framework-specific branches for Next, React
  Router, Jotai, SWR, Zustand, Zod, or ArkType.
- New reports are schema-versioned and parsed through structured artifact
  readers.
- Docs explain matrix rows, canary roles, failure categories, and how to add
  future fixtures/canaries.
- Full verification passes before handoff.

## 10. Tests to Add or Update

Add:

- `test/conformance/matrix.test.ts`
  - validates matrix schema;
  - asserts supported cells have fixtures;
  - asserts adapter target coverage;
  - rejects orphan fixture ids and orphan feature ids.
- `test/conformance/runner.test.ts`
  - runs a tiny fixture successfully;
  - fails on low coverage;
  - fails on conformance pass-rate threshold;
  - records state-space budget failure.
- `test/canaries/manifest.test.ts`
  - validates active/planned canary entries;
  - rejects missing roots for active canaries;
  - rejects free-form accepted caveat matching.
- `test/canaries/runner.test.ts`
  - runs a minimal canary;
  - preserves demo-app seeded-bug expectations through manifest data;
  - classifies failures for every category.

Update:

- `src/cli/features/conform/command.test.ts`
  - optional fixture/feature/target metadata in `ConformReport`;
  - parser validation for new optional fields.
- `src/cli/features/ci/command.test.ts`
  - ensure existing conformance threshold behavior still works;
  - optionally consume fixture metadata if passed through.
- `test/modality/cli.test.ts`
  - only if new CLI commands or usage lines are added.
- `test/packaging/package-manifest.test.ts`
  - only if new public exports are added.
- `test/extraction/architecture.test.ts`
  - runner boundary checks if needed.

## 11. Verification Commands

Run while developing report/schema changes:

```bash
rtk pnpm vitest run test/conformance/matrix.test.ts
rtk pnpm vitest run test/canaries/manifest.test.ts
rtk pnpm vitest run src/cli/features/conform/command.test.ts
```

Run while developing runners:

```bash
rtk pnpm vitest run test/conformance/runner.test.ts
rtk pnpm vitest run test/canaries/runner.test.ts
rtk pnpm ci:conformance
rtk pnpm ci:canaries
rtk pnpm ci:examples
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:conformance
rtk pnpm ci:canaries
rtk pnpm ci:examples
rtk pnpm fix
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 12. Risks, Ambiguities, and Stop Conditions

- Stop and report if canonical fixtures start becoming whole app snapshots.
  Split them into smaller semantic fixtures.
- Stop and report if a canary failure suggests changing adapter/checker
  behavior before a corresponding conformance fixture exists. Add the fixture
  first or classify the canary as a missing abstraction.
- Stop and report if runner implementation needs framework-specific conditionals
  outside manifest data. Add manifest fields or adapter report metadata instead.
- Stop and report if report fields required for classification are only present
  in human warning strings. Add structured fields/caveats before classification.
- Stop and report if `tools/examples-ci.ts` cannot be migrated without losing
  current seeded-bug checks. Preserve the old checks behind the manifest runner
  until parity is proven, then delete the duplicate logic.
- Stop and report if active real-app canaries require installing dependencies or
  modifying files outside repo-controlled paths. Canary roots and dependency
  setup must be explicit in the manifest.
- Stop and report if adding matrix/canary reports to `core` creates broad
  package API churn. If they are repo-internal only, keep schemas under
  `tools/` instead and expose only final check/conform reports publicly.
- Stop and report if state-space budgets are too unstable across platforms.
  Prefer budget evidence that is deterministic, or mark the budget as advisory
  with a clear reason.
- Do not classify accepted unsupported behavior as a pass without preserving it
  in the report.
- Do not add generated reports, traces, replay tests, or `.modality` outputs to
  version control.
- Do not update unrelated worker plan files.

## 13. Must Not Change

- Do not edit generated `dist/` or `native/` artifacts.
- Do not add new semantic support for a framework/library in this plan.
- Do not add hidden framework knowledge to `src/core`, `src/check`, or canary
  runner logic.
- Do not weaken existing demo-app acceptance expectations.
- Do not replace focused tests with broad snapshots.
- Do not use real-app canary failures to justify stopgap patches.
- Do not preserve old hard-coded example CI behavior after manifest-driven
  parity is established.
