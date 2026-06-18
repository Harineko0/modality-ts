# CLI, Docs, Architecture, and Cleanup

Status: implementation plan.
Date: 2026-06-17.
Plan family: F - Conformance Matrix, G - Real-App Canary Suite.
Split sequence: 260617-22-5.
Depends on:
- `260617-22-1-report-and-manifest-foundation.md`
- `260617-22-2-canonical-conformance-fixtures-and-runner.md`
- `260617-22-3-real-app-canary-manifest-and-runner.md`
- `260617-22-4-threshold-budget-and-classification-gates.md`

## 1. Goal

Finish the conformance/canary infrastructure by adding only justified CLI
surface, updating docs and internal specs, tightening architecture/regression
tests, and deleting obsolete hard-coded paths.

The intended end state of this plan is:

- maintainer workflows are documented through `ci:conformance`,
  `ci:canaries`, and `ci:examples`;
- optional user-facing CLI commands exist only if useful outside this repo;
- docs explain matrix rows, canonical fixtures, canaries, thresholds, budgets,
  and failure classifications;
- architecture tests prevent runners from importing private adapter internals;
- stale hard-coded demo/example thresholds are removed;
- full verification passes.

## 2. Non-goals

- Do not add new semantic support for any framework/library.
- Do not add broad CLI flags that duplicate every manifest field.
- Do not turn repo-maintainer manifests into public API unless deliberately
  documented.
- Do not edit generated docs output, generated `dist/`, or `native/` artifacts.
- Do not weaken or remove the existing `ci:examples` compatibility workflow.

## 3. Current-State Findings

- `src/cli/cli.ts` owns command dispatch and usage lines.
- `src/cli/defaults.ts` owns `.modality` default artifact paths.
- `test/modality/cli.test.ts` and `test/modality/cli-defaults.test.ts` cover
  CLI/default behavior.
- `test/modality/features-architecture.test.ts` already asserts public feature
  entrypoints.
- `test/extraction/architecture.test.ts` contains architecture-sensitive import
  rules.
- Docs/specs already discuss conformance, replay, state-space control, and
  architecture:
  - `docs/_specs/04-conformance.md`;
  - `docs/architecture/conformance-and-replay.md`;
  - `docs/concepts/state-space-control.md`;
  - `docs/_specs/05-architecture.md`.
- Earlier split plans should have created `ci:conformance`, `ci:canaries`,
  manifest files, runners, and shared gates.

## 4. Exact File Paths and Relevant Symbols

Files to edit if adding CLI commands:

- `src/cli/cli.ts`
- optional new `src/cli/features/matrix/`
- optional new `src/cli/features/canary/`
- `src/cli/defaults.ts` only if default report paths are needed
- `test/modality/cli.test.ts`
- `test/modality/cli-defaults.test.ts`
- `test/packaging/package-manifest.test.ts` if public subpaths are added

Docs/specs:

- `docs/_specs/04-conformance.md`
- `docs/architecture/conformance-and-replay.md`
- `docs/concepts/state-space-control.md`
- `docs/guides/ci-integration.md` if present
- `docs/reference/schemas.md` if report schemas are public
- `docs/_specs/05-architecture.md`
- `docs/reference/package-entry-points.md` if public exports are added

Architecture and cleanup:

- `test/extraction/architecture.test.ts`
- `test/modality/features-architecture.test.ts`
- `test/conformance/matrix.test.ts`
- `test/canaries/manifest.test.ts`
- `tools/examples-ci.ts`
- shared gate/helper files under `tools/`

## 5. Existing Patterns to Follow

- Keep repository-only orchestration in `tools/`.
- Add CLI feature slices only for user-facing commands that make sense outside
  this repo.
- Keep CLI wrappers thin around runner modules.
- Keep detailed configuration in manifests, not CLI flags.
- Update source Markdown docs only; do not edit generated docs output.
- Use architecture tests to enforce boundaries instead of relying on comments.

## 6. Atomic Implementation Steps

### Step 1 - Decide whether user-facing CLI commands are justified

Files to inspect/edit:

- `src/cli/cli.ts`
- `tools/conformance-ci.ts`
- `tools/canary-ci.ts`
- `docs/guides/ci-integration.md` if present

Implementation:

1. Prefer maintainer tools by default:
   - `pnpm ci:conformance`;
   - `pnpm ci:canaries`;
   - `pnpm ci:examples`.
2. Add CLI commands only if they are useful to package users outside this repo:
   - `modality matrix --manifest test/conformance/matrix.json`;
   - `modality canary --manifest test/canaries/canaries.json`.
3. If commands are not added, document that decision in maintainer docs and do
   not alter package exports.
4. If commands are added, keep them thin wrappers around runner modules and
   avoid duplicating manifest fields as flags.

Acceptance criteria:

- There is a clear yes/no decision in source docs or plan handoff notes.
- No public CLI surface is added just for internal CI convenience.

### Step 2 - Add CLI wrappers only if justified

Files to edit if needed:

- `src/cli/cli.ts`
- optional `src/cli/features/matrix/`
- optional `src/cli/features/canary/`
- `test/modality/cli.test.ts`
- `test/packaging/package-manifest.test.ts`

Implementation:

1. Add usage lines for any new commands.
2. Support only high-value flags:
   - `--manifest`;
   - `--report`;
   - narrow selectors such as `--feature`, `--target`, `--fixture`, `--canary`,
     or `--kind` if the runner already supports them.
3. Do not duplicate manifest thresholds, budgets, or caveats as CLI options.
4. Ensure feature slices do not import private source adapter internals.

Acceptance criteria:

- CLI tests cover arg parsing and usage output.
- Package exports are updated only if new public subpaths are intentionally
  added.

### Step 3 - Update conformance, replay, and CI docs

Files to edit:

- `docs/_specs/04-conformance.md`
- `docs/architecture/conformance-and-replay.md`
- `docs/guides/ci-integration.md` if present
- `docs/reference/schemas.md` if report schemas are public

Implementation:

1. Document the conformance matrix:
   - rows are semantic capabilities;
   - columns are framework/library/source targets;
   - supported cells require canonical fixtures.
2. Document fixture workflow:
   - add row;
   - add fixture;
   - connect fixture to matrix;
   - run `rtk pnpm ci:conformance`.
3. Document real-app canaries:
   - canaries find missing abstraction boundaries;
   - canaries are not the design oracle;
   - canary failures should point back to fixtures and plan families.
4. Document generated report locations and artifact hygiene.
5. Update schema docs if `ConformanceMatrixReport` or `CanaryRunReport` are
   public artifacts.

Acceptance criteria:

- Docs do not claim broad real-app debugging is the primary workflow.
- Docs explain how to add a row, fixture, and canary.
- Docs name the verification commands.

### Step 4 - Update state-space and architecture specs

Files to edit:

- `docs/concepts/state-space-control.md`
- `docs/_specs/05-architecture.md`
- `docs/architecture/conformance-and-replay.md`

Implementation:

1. Document manifest-owned state-space budgets:
   - states;
   - edges;
   - depth;
   - frontier;
   - dominant var values;
   - state-space bits;
   - top contributor bits;
   - pending queue length.
2. Document budget failures as `state-space-budget`.
3. Document failure categories and expected follow-up plan family:
   - missing abstraction;
   - missing adapter capability;
   - syntax recognition gap;
   - incorrect IR/checker;
   - state-space budget;
   - environment/project integration;
   - explicit unsupported behavior;
   - fixture/canary invalid.
4. Document that runner logic should use public command wrappers and report
   artifacts, not private adapter internals.

Acceptance criteria:

- State-space docs align with gate behavior from plan 4.
- Architecture docs describe the runner boundary.

### Step 5 - Tighten architecture and manifest regression tests

Files to edit:

- `test/extraction/architecture.test.ts`
- `test/modality/features-architecture.test.ts`
- `test/conformance/matrix.test.ts`
- `test/canaries/manifest.test.ts`

Implementation:

1. Add tests preventing conformance/canary runners and shared gates from
   importing private adapter internals.
2. Add tests that every current source adapter or type-library adapter has a
   matrix target column.
3. Add tests that every active canary has:
   - thresholds;
   - budgets or budget rationale;
   - accepted caveats list, even if empty;
   - failure classification policy.
4. Add tests that generated artifacts are ignored by runner temp dirs and not
   written under fixture or app roots, if not already covered.

Acceptance criteria:

- Architecture tests fail on private adapter imports from runners.
- Matrix/canary manifests cannot silently decay as adapters are added.

### Step 6 - Remove obsolete hard-coded paths and duplicated logic

Files to edit:

- `tools/examples-ci.ts`
- shared gate/helper files under `tools/`
- runner tests

Implementation:

1. Remove hard-coded demo thresholds from `tools/examples-ci.ts` after they
   exist in `test/canaries/canaries.json`.
2. Remove duplicated threshold comparison logic between conformance and canary
   runners.
3. Search for stale assumptions:

   ```bash
   rtk grep -n "demo extraction has unextractable handlers\\|expected 3 seeded bugs\\|overlay line budget exceeded\\|conform-pass-rate" tools src test
   ```

4. Keep tests that intentionally assert demo behavior, but make them read the
   manifest or runner report.

Acceptance criteria:

- `tools/examples-ci.ts` is a compatibility entrypoint.
- Threshold logic has one implementation.
- No new library-specific special cases appear in runners or shared gates.

### Step 7 - Run full verification and fix drift

Files to edit:

- only files already touched by this plan or earlier split plans

Implementation:

1. Run the full verification command set listed below.
2. Fix any docs, architecture, test, or formatting drift.
3. Do not broaden scope into semantic implementation work.

Acceptance criteria:

- Full verification passes or any failure is clearly documented with a stop
  condition.

## 7. Per-Step Files to Edit

| Step | Files |
| --- | --- |
| 1 | CLI/tool entrypoints and docs only as needed |
| 2 | `src/cli/cli.ts`, optional CLI feature slices, CLI/package tests |
| 3 | conformance/replay/CI docs and schema docs |
| 4 | state-space and architecture docs/specs |
| 5 | architecture tests, matrix tests, manifest tests |
| 6 | `tools/examples-ci.ts`, shared gate/helper files, runner tests |
| 7 | touched files only |

## 8. Acceptance Criteria

- Optional CLI surface is either deliberately added with tests or deliberately
  omitted with maintainer-tool docs.
- Docs explain matrix rows, fixtures, canaries, thresholds, budgets, and failure
  classifications.
- Architecture tests enforce runner boundaries.
- `tools/examples-ci.ts` is a compatibility entrypoint, not a duplicate canary
  system.
- Stale hard-coded demo threshold strings are removed.
- Full verification passes.

## 9. Tests to Add or Update

Update as applicable:

- `test/modality/cli.test.ts`
  - only if new CLI commands or usage lines are added.
- `test/modality/cli-defaults.test.ts`
  - only if new default paths are added.
- `test/packaging/package-manifest.test.ts`
  - only if public exports or scripts are asserted there.
- `test/extraction/architecture.test.ts`
  - runner/shared-gate private import boundaries.
- `test/modality/features-architecture.test.ts`
  - public feature entrypoints if CLI feature slices are added.
- `test/conformance/matrix.test.ts`
  - target coverage and manifest decay prevention.
- `test/canaries/manifest.test.ts`
  - active canary required fields and classification policy.

## 10. Verification Commands

Run focused checks during development:

```bash
rtk pnpm vitest run test/modality/cli.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts
rtk pnpm vitest run test/modality/features-architecture.test.ts
rtk pnpm vitest run test/conformance/matrix.test.ts
rtk pnpm vitest run test/canaries/manifest.test.ts
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

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if CLI commands would require exposing repo-internal manifest
  concepts as public API without a clear user workflow.
- Stop and report if architecture tests reveal runners must import private
  adapter internals. Add report metadata or public command-wrapper support
  instead.
- Stop and report if docs would need to claim unsupported behavior is supported.
  Keep support statuses honest.
- Stop and report if full verification fails due to semantic behavior outside
  this infrastructure scope.
- Stop and report if cleanup would weaken demo-app acceptance coverage.

## 12. Must Not Change

- Do not edit generated `dist/`, `native/`, or generated docs artifacts.
- Do not add new framework/library semantics.
- Do not weaken `ci:examples`, `ci:conformance`, or `ci:canaries`.
- Do not leave duplicate threshold logic in compatibility entrypoints.
- Do not edit unrelated worker plan files.
