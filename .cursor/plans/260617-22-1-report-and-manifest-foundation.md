# Report and Manifest Foundation

Status: implementation plan.
Date: 2026-06-17.
Plan family: F - Conformance Matrix, G - Real-App Canary Suite.
Split sequence: 260617-22-1.

## 1. Goal

Create the shared schema and validation foundation for conformance matrix and
real-app canary infrastructure.

The intended end state of this plan is:

- `ConformanceMatrixReport`, `CanaryRunReport`, and
  `CanaryFailureClassification` are represented as schema-versioned structured
  report types;
- artifact parsers reject malformed conformance/canary reports before casts;
- manifest parsing lives outside `core` unless a schema is intentionally public;
- `test/conformance/matrix.json` exists as an honest repository-owned semantic
  matrix;
- `ConformReport` can optionally carry fixture, feature, target, and threshold
  context without making ordinary `modality conform` usage more complex.

## 2. Non-goals

- Do not implement conformance fixture execution. That belongs in
  `260617-22-2-canonical-conformance-fixtures-and-runner.md`.
- Do not implement canary execution. That belongs in
  `260617-22-3-real-app-canary-manifest-and-runner.md`.
- Do not add coverage, caveat, state-space budget, or classification gate logic
  beyond type shapes needed by later plans.
- Do not add user-facing CLI commands in this plan.
- Do not change checker semantics, IR semantics, extraction semantics, or source
  adapter behavior.
- Do not add compatibility aliases for old report shapes.

## 3. Current-State Findings

- `src/core/report/types.ts` defines `ExtractionReport`, `CheckReport`,
  `ReplayReport`, and `ConformReport`.
- `ConformReport` currently records walk metrics and transition metrics only.
  It has no fixture id, feature ids, target ids, or threshold context.
- `src/core/artifacts/index.ts` validates existing report artifacts with
  parser functions such as `parseConformReportArtifact`, but there are no
  parsers for conformance matrix or canary run reports.
- There is no `test/conformance/` directory, no `test/canaries/` directory, no
  matrix manifest, and no canary manifest.
- `package.json` already has `ci:examples`, `phase7`, `test`, `typecheck`,
  `architecture`, and `fix` scripts.
- `src/cli/features/conform/command.ts` creates `ConformReport` through
  `createConformReport()` and formats internal command output through
  `renderConformReport()`.
- `src/cli/features/conform/output.ts` exposes `renderHumanConformResult()` for
  human output tests.

## 4. Exact File Paths and Relevant Symbols

Primary files:

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
  - add shared threshold/budget result entry types
- `src/core/artifacts/index.ts`
  - `parseConformReportArtifact`
  - add `parseConformanceMatrixReportArtifact`
  - add `parseCanaryRunReportArtifact`
- `src/cli/features/conform/command.ts`
  - `ConformCommandOptions`
  - `ConformCommandResult`
  - `runConformCommand`
  - `createConformReport`
  - `transitionMetrics`
- `src/cli/features/conform/output.ts`
  - `renderHumanConformResult`
- new `test/conformance/matrix.json`
- new `test/conformance/README.md`
- new `test/conformance/matrix.test.ts`
- new `test/canaries/manifest.test.ts`
- optionally new `tools/conformance/manifest.ts`
- optionally new `tools/canary/manifest.ts`

## 5. Existing Patterns to Follow

- Keep public artifact schemas in `src/core/report/types.ts`.
- Keep parsing in `src/core/artifacts/index.ts`; reject unsupported
  `schemaVersion`, reject wrong `kind`, validate required fields, then cast.
- Keep repository-maintainer manifest parsing under `tools/` unless the schema
  is explicitly meant to become package API.
- Follow existing command option patterns in `src/cli/features/conform`.
- Keep optional metadata optional. Existing conform callers must not need to
  provide fixture ids.
- Use semantic ids that are stable and not library-marketing names.

## 6. Target Concepts and Data Shapes

Names may be refined during implementation, but preserve these concepts.

### Semantic Feature Rows

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

Feature ids should describe behavior, for example:

- `state.local.setter-batching`
- `state.local.functional-updater`
- `scope.mount-local.reset`
- `effects.cleanup-order`
- `async.pending-op.args`
- `routing.location-assignment`
- `domains.schema.numeric-bounds`
- `reports.structured-caveats`
- `slicing.unrelated-vars-pruned`

### Matrix Cells

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

Targets should include current and planned adapter/library columns such as
`core`, `typescript`, `react-use-state`, `react-router`, `next-app-router`,
`next-pages-router`, `jotai`, `swr`, `zustand`, `zod`, and `arktype`.

### Report Types

Use `schemaVersion: 1` and discriminants:

- `kind: "conformance-matrix-report"`
- `kind: "canary-run-report"`

Reports must be able to express:

- selected matrix/canary ids;
- per-fixture or per-canary result status;
- threshold results;
- state-space budget results;
- accepted and unaccepted caveats;
- failure classification entries;
- generated report paths, where useful.

## 7. Atomic Implementation Steps

### Step 1 - Add shared report and classification types

Files to edit:

- `src/core/report/types.ts`

Implementation:

1. Add `CanaryFailureCategory` with these categories:
   - `missing-semantic-abstraction`;
   - `missing-adapter-capability`;
   - `syntax-recognition-gap`;
   - `incorrect-ir-or-checker`;
   - `state-space-budget`;
   - `environment-or-project-integration`;
   - `explicit-unsupported-behavior`;
   - `fixture-or-canary-invalid`.
2. Add `CanaryFailureClassification` with:
   - `canaryId`;
   - optional `fixtureId`;
   - `category`;
   - `severity: "blocker" | "action-required" | "accepted"`;
   - `evidence: readonly string[]`;
   - `suggestedPlanFamily`.
3. Add reusable threshold/budget result entry types. Keep them generic enough
   for both matrix and canary reports.
4. Add `ConformanceMatrixReport` and `CanaryRunReport` as schema-versioned
   artifacts.
5. Do not import runner-only manifest types into `core`.

Acceptance criteria:

- Type names are exported from `src/core/report/types.ts`.
- New types do not force changes to existing extraction/check/replay reports.

### Step 2 - Add artifact parsers for new report artifacts

Files to edit:

- `src/core/artifacts/index.ts`
- `test/conformance/matrix.test.ts`
- `test/canaries/manifest.test.ts`

Implementation:

1. Import new report types.
2. Add `parseConformanceMatrixReportArtifact(json: string)`.
3. Add `parseCanaryRunReportArtifact(json: string)`.
4. Validate:
   - object shape;
   - `schemaVersion === 1`;
   - expected `kind`;
   - required arrays/objects;
   - pass rates between `0` and `1`;
   - budgets as positive integers when present;
   - ids as non-empty strings.
5. Keep parser errors concise and specific.

Acceptance criteria:

- Tests reject unsupported schema versions.
- Tests reject missing required report fields.
- Tests reject malformed pass rates, budget values, and ids.

### Step 3 - Extend `ConformReport` with optional fixture context

Files to edit:

- `src/core/report/types.ts`
- `src/core/artifacts/index.ts`
- `src/cli/features/conform/command.ts`
- `src/cli/features/conform/output.ts`
- `src/cli/features/conform/command.test.ts`

Implementation:

1. Add optional fields to `ConformReport`:
   - `fixtureId?: string`;
   - `featureIds?: readonly string[]`;
   - `targetIds?: readonly string[]`;
   - `thresholds?: { minPassRate?: number; minTransitionPassRate?: number }`.
2. Extend `ConformCommandOptions` with matching optional metadata only if the
   runner needs command-level propagation. Prefer command options if `ci` should
   later pass metadata through.
3. Pass metadata into `createConformReport()` when provided.
4. Render fixture context in human output only when present.
5. Update `parseConformReportArtifact()` validation for optional arrays and
   threshold values.

Acceptance criteria:

- Existing conform tests pass after any expected shape updates.
- Ordinary `modality conform` usage has no new required arguments.
- Matrix runner work in plan 2 can associate conform results with fixture,
  feature, and target ids without separate side tables.

### Step 4 - Create the initial conformance matrix manifest

Files to add/edit:

- `test/conformance/matrix.json`
- `test/conformance/README.md`
- `test/conformance/matrix.test.ts`

Implementation:

1. Define the initial JSON manifest with:
   - `schemaVersion`;
   - `features`;
   - `targets`;
   - `cells`;
   - `fixtures`.
2. Seed architecture-level semantic feature rows already represented in the
   codebase or existing tests:
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
3. Seed target columns for current built-ins and planned matrix targets.
4. Mark cells honestly:
   - `supported` only when a focused test or canonical fixture exists;
   - `partial` when behavior exists but lacks canonical fixture coverage;
   - `unsupported` where known absent;
   - `not-applicable` where the target cannot exercise the row.
5. Add validation tests:
   - every `supported` cell names at least one fixture id;
   - every referenced fixture id exists;
   - every fixture references existing features and targets;
   - every current source adapter or type-library adapter has a target column.

Acceptance criteria:

- `test/conformance/matrix.json` is durable planning data, not an aspirational
  checklist.
- The matrix can represent gaps without failing CI unless a runner is asked to
  enforce supported cells.
- The matrix test fails when a supported cell lacks a fixture.

### Step 5 - Add repository-maintainer manifest parsers only as needed

Files to add/edit:

- optional `tools/conformance/manifest.ts`
- optional `tools/canary/manifest.ts`
- `test/conformance/matrix.test.ts`
- `test/canaries/manifest.test.ts`

Implementation:

1. If manifest validation grows beyond tests, add small manifest parser modules
   under `tools/`.
2. Keep parser APIs focused:
   - read JSON;
   - validate ids, references, thresholds, paths, and statuses;
   - return typed manifest objects.
3. Do not place repository-maintainer manifest schemas in `src/core` unless the
   artifacts are intended for public package consumers.

Acceptance criteria:

- Manifest parse helpers, if added, are reusable by later runner plans.
- `core` remains report-artifact focused, not maintainer-tool focused.

## 8. Per-Step Files to Edit

| Step | Files |
| --- | --- |
| 1 | `src/core/report/types.ts` |
| 2 | `src/core/artifacts/index.ts`, `test/conformance/matrix.test.ts`, `test/canaries/manifest.test.ts` |
| 3 | `src/core/report/types.ts`, `src/core/artifacts/index.ts`, `src/cli/features/conform/command.ts`, `src/cli/features/conform/output.ts`, `src/cli/features/conform/command.test.ts` |
| 4 | `test/conformance/matrix.json`, `test/conformance/README.md`, `test/conformance/matrix.test.ts` |
| 5 | optional `tools/conformance/manifest.ts`, optional `tools/canary/manifest.ts`, manifest tests |

## 9. Acceptance Criteria

- New report types are schema-versioned and exported.
- New artifact parsers validate conformance matrix and canary run reports.
- `ConformReport` optional metadata is accepted and validated without breaking
  existing callers.
- `test/conformance/matrix.json` exists, validates, and uses honest support
  statuses.
- Every `supported` matrix cell has at least one fixture id.
- Every matrix fixture id, feature id, and target id reference is valid.

## 10. Tests to Add or Update

Add:

- `test/conformance/matrix.test.ts`
  - validates matrix schema;
  - validates new conformance matrix report parser;
  - asserts supported cells have fixtures;
  - asserts adapter/type-library target coverage;
  - rejects orphan fixture ids, feature ids, and target ids.
- `test/canaries/manifest.test.ts`
  - validates new canary run report parser;
  - rejects malformed classification, threshold, and budget entries.

Update:

- `src/cli/features/conform/command.test.ts`
  - optional fixture/feature/target metadata in `ConformReport`;
  - parser validation for new optional conform metadata.

## 11. Verification Commands

Run during development:

```bash
rtk pnpm vitest run test/conformance/matrix.test.ts
rtk pnpm vitest run test/canaries/manifest.test.ts
rtk pnpm vitest run src/cli/features/conform/command.test.ts
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk git diff --check
```

## 12. Risks, Ambiguities, and Stop Conditions

- Stop and report if adding matrix/canary reports to `core` creates broad
  package API churn. Keep repository-only schemas under `tools/` instead.
- Stop and report if report fields required by later classification can only be
  read from human warning strings. Add structured fields before proceeding.
- Stop and report if matrix rows become library names instead of semantic
  capabilities.
- Stop and report if a `supported` cell would require inventing fixture coverage
  that does not exist yet. Mark it `partial` until plan 2 adds the fixture.
- Do not add generated report, trace, replay, or `.modality` files.

## 13. Must Not Change

- Do not edit generated `dist/` or `native/` artifacts.
- Do not add new framework/library semantics.
- Do not add hidden framework knowledge to `src/core`.
- Do not weaken existing conform report metrics.
- Do not edit unrelated worker plan files.
