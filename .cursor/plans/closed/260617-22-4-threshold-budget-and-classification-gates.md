# Threshold, Budget, and Classification Gates

Status: implementation plan.
Date: 2026-06-17.
Plan family: F - Conformance Matrix, G - Real-App Canary Suite.
Split sequence: 260617-22-4.
Depends on:
- `260617-22-2-canonical-conformance-fixtures-and-runner.md`
- `260617-22-3-real-app-canary-manifest-and-runner.md`

## 1. Goal

Centralize the gate logic that turns conformance fixture and canary results into
structured pass/fail evidence and deterministic failure classifications.

The intended end state of this plan is:

- coverage thresholds, accepted caveats, conform pass-rate thresholds, and
  state-space budgets are manifest-owned and runner-enforced;
- budget failures include machine-readable evidence naming the relevant report
  fields and contributor var ids where available;
- every failing canary has at least one deterministic
  `CanaryFailureClassification`;
- shared threshold logic is factored so conformance and canary runners do not
  drift;
- no gate relies on parsing human warning strings.

## 2. Non-goals

- Do not add new conformance fixtures unless needed to test gate behavior.
- Do not add new real-app canaries unless needed to test gate behavior.
- Do not redesign check, extract, conform, or IR semantics.
- Do not hide unsupported behavior by treating accepted caveats as success
  without report evidence.
- Do not add user-facing CLI commands in this plan.

## 3. Current-State Findings

- `ExtractionReport` already includes coverage, global taints, stale reads,
  unhandled rejections, domains, optional `stateContributors`, and route
  coverage.
- `CheckReport` already includes `stats`, `diagnostics.search`,
  `diagnostics.limits`, `diagnostics.dominantVars`, and `trustLedger.boundHits`.
- `ConformReport` includes aggregate and per-transition pass rates. Plan 1
  should have added optional fixture context.
- `src/cli/features/ci/command.ts` already compares trust-ledger regressions
  against a baseline check report.
- Plans 2 and 3 should have introduced conformance and canary runners with
  initial threshold handling.
- Failure taxonomy types should exist from plan 1.

## 4. Exact File Paths and Relevant Symbols

Files to add/edit:

- new `tools/shared-gates/thresholds.ts` or equivalent small shared module
- new `tools/shared-gates/caveats.ts` or equivalent small shared module
- new `tools/shared-gates/budgets.ts` or equivalent small shared module
- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- `tools/conformance/manifest.ts`
- `tools/canary/manifest.ts`
- `tools/canary/classify.ts`
- optional `tools/conformance/classify.ts`
- `src/core/report/types.ts`
- `test/conformance/runner.test.ts`
- `test/canaries/runner.test.ts`
- `test/canaries/manifest.test.ts`
- `test/conformance/matrix.test.ts`

Report fields to use:

- `ExtractionReport.coverage.percentExactOrOverlay`
- `ExtractionReport.coverage.unextractable`
- `ExtractionReport.globalTaints`
- `ExtractionReport.staleReads`
- `ExtractionReport.unhandledRejections`
- `ExtractionReport.routeCoverage`
- `ExtractionReport.stateContributors`
- `CheckReport.stats.states`
- `CheckReport.stats.edges`
- `CheckReport.stats.depth`
- `CheckReport.diagnostics.search`
- `CheckReport.diagnostics.limits`
- `CheckReport.diagnostics.dominantVars`
- `CheckReport.trustLedger.boundHits`
- `ConformReport.metrics.passRate`
- `ConformReport.transitionMetrics`

## 5. Existing Patterns to Follow

- Keep structured comparison logic in small helper modules under `tools/`.
- Keep public report result types in `src/core/report/types.ts`.
- Follow the existing CI command style for threshold failures and concise
  evidence.
- Use structured caveat fields and stable ids/kinds. Do not match prose
  messages.
- Keep manifest data as the source of threshold and budget values.
- Treat disappearing caveats as good unless the manifest explicitly marks the
  caveat `mustRemain: true`.

## 6. Atomic Implementation Steps

### Step 1 - Normalize threshold and budget manifest types

Files to edit:

- `tools/conformance/manifest.ts`
- `tools/canary/manifest.ts`
- `src/core/report/types.ts`
- manifest tests

Implementation:

1. Support shared threshold fields:
   - `minExactOrOverlay`;
   - `maxUnextractable`;
   - `maxGlobalTaints`;
   - `maxUnhandledRejections`;
   - `maxStaleReads`;
   - `minRouteCoverage`;
   - `minConformPassRate`;
   - `minTransitionConformPassRate`.
2. Support shared budget fields:
   - `maxStates`;
   - `maxEdges`;
   - `maxDepth`;
   - `maxFrontier`;
   - `maxDominantVarValues`;
   - `maxStateSpaceBits`;
   - `maxTopContributorBits`;
   - `maxPendingQueueLen`.
3. Validate threshold percentages and pass rates as `0 <= value <= 1`.
4. Validate budgets as positive integers.
5. Require active canaries to define budgets or an explicit
   `budgetNotApplicableReason`.

Acceptance criteria:

- Invalid threshold and budget values fail manifest validation.
- Active canaries cannot silently omit both budgets and budget rationale.

### Step 2 - Implement shared coverage and conform gates

Files to add/edit:

- `tools/shared-gates/thresholds.ts`
- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- runner tests

Implementation:

1. Compare extraction coverage thresholds from structured report fields.
2. Compare conform aggregate and per-transition pass rates.
3. Produce machine-readable result entries:
   - gate id;
   - expected value;
   - actual value;
   - status;
   - evidence.
4. Do not hard-code demo-app thresholds in TypeScript. Demo thresholds remain
   manifest data.

Acceptance criteria:

- A canary below `minExactOrOverlay` fails with structured evidence.
- A fixture below per-transition conform pass rate fails with transition id
  evidence.
- Demo-app 100 percent exact/overlay requirement is represented as a threshold
  gate result.

### Step 3 - Implement accepted caveat gates

Files to add/edit:

- `tools/shared-gates/caveats.ts`
- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- manifest tests
- runner tests

Implementation:

1. Match accepted caveats by structured identity:
   - `kind`;
   - `id`;
   - optional `severity`;
   - optional `producer` if available from adapter SPI work.
2. Fail if a report contains an unaccepted caveat unless the fixture/canary is
   explicitly partial or planned.
3. Do not fail when an accepted caveat disappears unless the manifest marks
   `mustRemain: true`.
4. Preserve accepted unsupported behavior in the report; do not drop it from
   evidence.

Acceptance criteria:

- New unaccepted caveats fail conformance/canary runs.
- Accepted caveats appear in reports as accepted evidence.
- Free-form caveat message matching is impossible through manifest validation.

### Step 4 - Implement state-space budget gates

Files to add/edit:

- `tools/shared-gates/budgets.ts`
- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- `src/cli/features/extract/command.ts` only if state contributor data is not
  emitted consistently enough for budget evidence
- `src/cli/features/check/command.ts` only if diagnostics are missing required
  budget facts
- runner tests

Implementation:

1. Read budget evidence from:
   - `CheckReport.stats`;
   - `CheckReport.diagnostics.search`;
   - `CheckReport.diagnostics.limits`;
   - `CheckReport.diagnostics.dominantVars`;
   - `ExtractionReport.stateContributors`;
   - model `bounds`, if already available to the runner.
2. Treat search-limit hits as failures, not warnings.
3. Fail on budget exceedance with evidence naming the report field.
4. When contributor data exists, include var ids in evidence.
5. Do not add broad report fields to extract/check commands unless a required
   fact is unavailable in structured form.

Acceptance criteria:

- A canary that exceeds `maxStates` fails with budget evidence.
- A conformance fixture can assert low state count or absence of unrelated
  contributors when structured evidence exists.
- Budget failures are classifiable as `state-space-budget`.

### Step 5 - Implement deterministic failure classification

Files to add/edit:

- `tools/canary/classify.ts`
- optional `tools/conformance/classify.ts`
- `tools/canary/runner.ts`
- `tools/conformance/runner.ts`
- `src/core/report/types.ts`
- runner tests

Implementation:

1. Classify using structured report facts:
   - extraction parse/project errors:
     `environment-or-project-integration`;
   - coverage below threshold due to new unextractable handlers:
     `missing-semantic-abstraction`;
   - structured caveat from a known adapter capability gap:
     `missing-adapter-capability`;
   - conform failure on a supported fixture exact transition:
     `incorrect-ir-or-checker`;
   - conform failure only in a canary when fixture coverage passes:
     `syntax-recognition-gap`;
   - search limits, bound hits, dominant vars, or budgets over limit:
     `state-space-budget`;
   - caveats listed in `knownUnsupported`:
     `explicit-unsupported-behavior`;
   - manifest/root/command invalid:
     `fixture-or-canary-invalid`.
2. Add `suggestedPlanFamily` mapping:
   - missing abstraction -> `semantic-typescript-foundation` or
     `framework-neutral-ir-checker`;
   - adapter gap -> `adapter-spi`;
   - domain gap -> `domain-data-abstraction`;
   - effects/async -> `effects-async-environment`;
   - conformance data issue -> `conformance-matrix`;
   - canary data issue -> `real-app-canary`;
   - budget issue -> `state-space-economics`;
   - caveat/doc issue -> `trust-ledger-docs`.
3. If a failure cannot be classified deterministically, classify it as
   `fixture-or-canary-invalid` with evidence requiring manifest/schema
   improvement.

Acceptance criteria:

- Every failing canary report includes at least one classification.
- Tests force each classification category without depending on a large real
  app.
- Classification does not use framework-specific ids outside manifest data.

### Step 6 - Remove duplicated gate logic from runners

Files to edit:

- `tools/conformance/runner.ts`
- `tools/canary/runner.ts`
- shared gate modules
- runner tests

Implementation:

1. Factor repeated threshold/caveat/budget comparisons into shared helpers.
2. Keep runner-specific orchestration in each runner.
3. Keep canary-specific classification in `tools/canary/classify.ts`, but allow
   conformance runner to reuse classification helpers if useful.

Acceptance criteria:

- Threshold logic has one implementation.
- Canary and conformance reports use compatible gate result entries.

## 7. Per-Step Files to Edit

| Step | Files |
| --- | --- |
| 1 | manifest modules, `src/core/report/types.ts`, manifest tests |
| 2 | `tools/shared-gates/thresholds.ts`, runners, runner tests |
| 3 | `tools/shared-gates/caveats.ts`, runners, manifest tests, runner tests |
| 4 | `tools/shared-gates/budgets.ts`, runners, extract/check command files only if structured facts are missing |
| 5 | `tools/canary/classify.ts`, optional `tools/conformance/classify.ts`, runners, report types, runner tests |
| 6 | runners, shared gate modules, runner tests |

## 8. Acceptance Criteria

- Coverage thresholds are manifest-owned and runner-enforced.
- Accepted caveats match by structured identity.
- State-space budgets fail with machine-readable evidence.
- Search-limit hits are failures.
- Every failing canary has a deterministic classification.
- Shared threshold logic is not duplicated between runners.
- No gate parses human warning strings.

## 9. Tests to Add or Update

Update:

- `test/conformance/runner.test.ts`
  - low coverage failure;
  - conform pass-rate failure;
  - state-space budget failure;
  - unaccepted caveat failure;
  - generated budget evidence.
- `test/canaries/runner.test.ts`
  - threshold failure;
  - accepted and unaccepted caveats;
  - state-space budget classification;
  - every classification category.
- `test/canaries/manifest.test.ts`
  - rejects invalid thresholds/budgets;
  - rejects free-form accepted caveat matching.
- `test/conformance/matrix.test.ts`
  - validates threshold and budget fields on cells/fixtures.

## 10. Verification Commands

Run during development:

```bash
rtk pnpm vitest run test/conformance/runner.test.ts
rtk pnpm vitest run test/canaries/runner.test.ts
rtk pnpm vitest run test/canaries/manifest.test.ts
rtk pnpm ci:conformance
rtk pnpm ci:canaries
rtk pnpm ci:examples
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if report fields required for classification are only present
  in human warning strings. Add structured fields first.
- Stop and report if state-space budgets are too unstable across platforms.
  Prefer deterministic evidence or require an explicit advisory rationale.
- Stop and report if a canary classification suggests changing semantics before
  a corresponding conformance fixture exists.
- Stop and report if accepted unsupported behavior disappears from reports.
- Stop and report if shared gate helpers start importing private adapter
  internals.

## 12. Must Not Change

- Do not weaken existing demo-app acceptance expectations.
- Do not classify accepted unsupported behavior as a silent pass.
- Do not add framework-specific branches to shared gates.
- Do not commit generated report or trace artifacts.
- Do not edit unrelated worker plan files.
