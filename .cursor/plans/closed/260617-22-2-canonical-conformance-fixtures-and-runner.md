# Canonical Conformance Fixtures and Runner

Status: implementation plan.
Date: 2026-06-17.
Plan family: F - Conformance Matrix.
Split sequence: 260617-22-2.
Depends on: `260617-22-1-report-and-manifest-foundation.md`.

## 1. Goal

Add canonical semantic fixture conventions and a manifest-driven conformance
runner that executes supported matrix cells through existing extract, check,
and conform command wrappers.

The intended end state of this plan is:

- canonical fixtures live under `test/conformance/fixtures/` with a documented
  layout;
- at least three initial fixtures are connected to supported matrix cells;
- `pnpm ci:conformance` runs enforced fixtures and writes a
  `ConformanceMatrixReport`;
- fixture assertions compare semantic facts rather than broad JSON snapshots;
- generated artifacts are written to temp directories, not fixture roots.

## 2. Non-goals

- Do not create real-app canaries. That belongs in
  `260617-22-3-real-app-canary-manifest-and-runner.md`.
- Do not centralize all budget/caveat/classification gates here. Shared gates
  belong in `260617-22-4-threshold-budget-and-classification-gates.md`.
- Do not add new source adapter semantics to make a fixture pass.
- Do not move large examples into `test/conformance/fixtures/`.
- Do not add user-facing CLI commands in this plan.

## 3. Current-State Findings

- Plan 1 should have created `test/conformance/matrix.json` and report/parser
  types.
- `src/cli/features/extract/command.ts` exports `runExtractCommand`.
- `src/cli/features/check/command.ts` exports `runCheckCommand`.
- `src/cli/features/conform/command.ts` exports `runConformCommand` and
  deterministic conform walk generation.
- `tools/examples-ci.ts` already demonstrates direct command-wrapper execution
  with temporary artifact paths.
- `tools/phase7-differential.ts` is the closest pattern for a repo-level
  maintainer tool with concise pass/fail output.
- No `test/conformance/fixtures/` or `tools/conformance/runner.ts` exists yet.

## 4. Exact File Paths and Relevant Symbols

Files to add/edit:

- `test/conformance/fixtures/README.md`
- `test/conformance/fixtures/**/fixture.json`
- `test/conformance/fixtures/**/app/**`
- `test/conformance/matrix.json`
- `test/conformance/matrix.test.ts`
- `test/conformance/runner.test.ts`
- optionally `test/conformance/helpers.ts`
- `tools/conformance-ci.ts`
- `tools/conformance/manifest.ts`
- `tools/conformance/runner.ts`
- optional `tools/conformance/assertions.ts`
- `package.json`
  - add `ci:conformance`

Command wrappers to use:

- `runExtractCommand` from `src/cli/features/extract/command.ts` or the public
  local CLI subpath used by existing tools.
- `runCheckCommand` from `src/cli/features/check/command.ts`.
- `runConformCommand` from `src/cli/features/conform/command.ts`.

Reports to consume:

- `ExtractionReport.coverage`
- `ExtractionReport.globalTaints`
- `ExtractionReport.staleReads`
- `ExtractionReport.unhandledRejections`
- `ExtractionReport.stateContributors`
- `CheckReport.stats`
- `CheckReport.diagnostics`
- `CheckReport.trustLedger`
- `ConformReport.metrics`
- `ConformReport.transitionMetrics`

## 5. Existing Patterns to Follow

- Use direct command wrappers instead of shelling out where possible.
- Follow `tools/examples-ci.ts` for temp artifact directories and direct command
  invocation.
- Follow `tools/phase7-differential.ts` for concise maintainer output and temp
  cleanup.
- Keep fixtures small, semantic, and canonical.
- Keep framework/library-specific expectations in manifest data, not TypeScript
  conditionals.
- Keep broad threshold and budget gate implementations factored so plan 4 can
  share them with canaries.

## 6. Fixture Layout

Establish this directory convention:

```text
test/conformance/fixtures/<fixture-id>/
  app/
    App.tsx or route files
    app.props.ts or *.props.ts
    package.json when dependency facts matter
    tsconfig.json when compiler behavior matters
  fixture.json
```

`fixture.json` records:

- `id`;
- `featureIds`;
- `targetIds`;
- `root`;
- `sourcePaths`;
- `propsPaths`;
- command options for extract, check, and conform;
- thresholds and budgets;
- expected semantic report facts.

Semantic expectations should name facts such as:

- transition ids present;
- variable ids, domains, and scopes;
- caveat kinds and stable ids;
- coverage percentages;
- conformance pass rates;
- state-space stats under budget.

Do not add full report snapshots as the primary assertion mechanism.

## 7. Atomic Implementation Steps

### Step 1 - Document fixture conventions

Files to add/edit:

- `test/conformance/fixtures/README.md`
- `test/conformance/README.md`

Implementation:

1. Document the fixture directory layout.
2. Explain when to add a fixture:
   - a semantic matrix row becomes `supported`;
   - a canary failure reveals missing fixture coverage;
   - a regression needs a canonical semantic proof.
3. Explain what must stay out of fixtures:
   - full app snapshots;
   - generated `.modality` output;
   - dependency lockfiles unless a dependency fact is the point of the fixture.

Acceptance criteria:

- A future implementer can add a fixture without reading runner internals.

### Step 2 - Add three initial canonical fixtures

Files to add/edit:

- `test/conformance/fixtures/**`
- `test/conformance/matrix.json`
- `test/conformance/matrix.test.ts`

Implementation:

1. Add a local `useState` setter/batching fixture.
2. Add a route or mount-scope fixture.
3. Add one structured caveat, domain-refinement, or state-space contributor
   fixture based on currently implemented behavior.
4. Connect each fixture to matrix cells by id.
5. Mark cells `supported` only when the fixture is runnable and asserts the
   semantic behavior.

Acceptance criteria:

- At least three initial fixtures exist.
- Every new `supported` cell names a real fixture.
- Existing matrix tests continue to pass.

### Step 3 - Add conformance manifest and assertion helpers

Files to add/edit:

- `tools/conformance/manifest.ts`
- optional `tools/conformance/assertions.ts`
- `test/conformance/runner.test.ts`

Implementation:

1. Load and validate `test/conformance/matrix.json`.
2. Resolve fixture roots relative to the repository root.
3. Validate that source and props paths exist.
4. Add helpers for semantic expectations:
   - coverage thresholds;
   - transition id presence;
   - var/domain/scope presence;
   - conform aggregate pass rate;
   - per-transition pass rate;
   - check state/edge/depth limits.
5. Keep assertion helpers small and structured. Do not parse human output.

Acceptance criteria:

- Unit tests can validate a synthetic fixture manifest without running a full
  app.
- Invalid fixture roots or missing paths fail as fixture-invalid errors.

### Step 4 - Implement `tools/conformance/runner.ts`

Files to add/edit:

- `tools/conformance/runner.ts`
- `test/conformance/runner.test.ts`

Implementation:

1. Read the matrix manifest.
2. Select cells with `status: "supported"` by default.
3. Support selection flags:
   - `--feature <id>`;
   - `--target <id>`;
   - `--fixture <id>`;
   - `--include-partial`.
4. For each selected fixture:
   - create a temp artifact directory;
   - run extract with `runExtractCommand`;
   - run check with `runCheckCommand` when configured;
   - run conform with `runConformCommand` when configured;
   - compare semantic expectations;
   - collect threshold and expectation results.
5. Write a `ConformanceMatrixReport` to a temp path by default.
6. Support `--report <path>` for explicit report output.
7. Return exit codes:
   - `0`: all enforced cells pass;
   - `2`: semantic expectation or threshold failed;
   - `3`: fixture invalid or missing manifest entry;
   - `4`: runner infrastructure failure.

Acceptance criteria:

- A passing fixture produces a passing report entry.
- A deliberately failing fixture in tests produces a failed matrix result.
- Runner code contains no framework-specific branches beyond manifest target ids.

### Step 5 - Add `tools/conformance-ci.ts` and package script

Files to add/edit:

- `tools/conformance-ci.ts`
- `package.json`
- `test/packaging/package-manifest.test.ts` if scripts are asserted there

Implementation:

1. Add:

   ```json
   "ci:conformance": "tsx tools/conformance-ci.ts"
   ```

2. Parse CLI flags in the tool entrypoint, or delegate parsing to the runner.
3. Print concise output:
   - selected fixture count;
   - pass/fail summary;
   - report path;
   - failure evidence.
4. Avoid printing full JSON reports unless explicitly requested.

Acceptance criteria:

- `rtk pnpm ci:conformance` runs initial fixtures.
- `rtk pnpm ci:conformance -- --fixture <id>` runs one fixture.
- Report path is visible in output.

### Step 6 - Keep generated artifacts outside fixture roots

Files to add/edit:

- `tools/conformance/runner.ts`
- `test/conformance/runner.test.ts`

Implementation:

1. Use temp dirs for generated model, property, trace, replay, and report files.
2. Ensure no `.modality` directory is written under fixture roots.
3. Add a runner test that verifies fixture roots remain clean after execution.

Acceptance criteria:

- Running conformance locally does not dirty fixture app directories.
- Intentional report output only appears at the user-provided `--report` path.

## 8. Per-Step Files to Edit

| Step | Files |
| --- | --- |
| 1 | `test/conformance/fixtures/README.md`, `test/conformance/README.md` |
| 2 | `test/conformance/fixtures/**`, `test/conformance/matrix.json`, `test/conformance/matrix.test.ts` |
| 3 | `tools/conformance/manifest.ts`, optional `tools/conformance/assertions.ts`, `test/conformance/runner.test.ts` |
| 4 | `tools/conformance/runner.ts`, `test/conformance/runner.test.ts` |
| 5 | `tools/conformance-ci.ts`, `package.json`, packaging tests if needed |
| 6 | `tools/conformance/runner.ts`, `test/conformance/runner.test.ts` |

## 9. Acceptance Criteria

- Canonical fixture layout is documented.
- At least three initial fixtures exist and are connected to matrix cells.
- `rtk pnpm ci:conformance` runs initial fixtures and writes a structured
  report.
- Runner supports feature, target, fixture, and partial-selection flags.
- Fixture assertions compare semantic facts rather than full snapshots.
- Generated artifacts are written outside fixture roots.
- Runner logic does not contain framework-specific conditionals.

## 10. Tests to Add or Update

Add:

- `test/conformance/runner.test.ts`
  - runs a tiny fixture successfully;
  - fails on low coverage;
  - fails on conform pass-rate threshold;
  - records a state-space budget-style failure placeholder until plan 4 owns
    full budget classification;
  - verifies generated artifacts do not appear under fixture roots.

Update:

- `test/conformance/matrix.test.ts`
  - includes the three initial fixture ids;
  - asserts selected cells and fixtures remain consistent.
- `test/packaging/package-manifest.test.ts`
  - only if package scripts are covered by existing packaging tests.

## 11. Verification Commands

Run during development:

```bash
rtk pnpm vitest run test/conformance/matrix.test.ts
rtk pnpm vitest run test/conformance/runner.test.ts
rtk pnpm ci:conformance
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk git diff --check
```

## 12. Risks, Ambiguities, and Stop Conditions

- Stop and report if canonical fixtures start becoming whole app snapshots.
  Split them into smaller semantic fixtures.
- Stop and report if a fixture requires changing adapter or checker semantics
  to pass. That belongs in the semantic plan family that owns the behavior.
- Stop and report if runner implementation needs framework-specific
  conditionals outside manifest data.
- Stop and report if semantic expectations are only available in human output.
  Add structured report fields before asserting them.
- Stop and report if state-space budgets are unstable across platforms. Plan 4
  should decide whether the budget is deterministic or advisory.

## 13. Must Not Change

- Do not add real-app canaries in `test/conformance/fixtures/`.
- Do not add new framework/library support.
- Do not write generated artifacts to fixture roots.
- Do not weaken existing extraction/check/conform command behavior.
- Do not edit unrelated worker plan files.
