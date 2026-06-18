# Docs and Conformance Fixtures for Economics and Trust Ledger

Status: implementation plan.
Date: 2026-06-17.
Plan family: I - Trust Ledger and Documentation.
Depends on:

- `260617-23-1-shared-state-space-economics-diagnostics.md`
- `260617-23-2-structured-property-dependency-slicing.md`
- `260617-23-3-route-mount-pruning-diagnostics.md`
- `260617-23-4-pending-queue-slicing-and-bounds.md`
- `260617-23-5-field-pruning-metadata.md`
- `260617-23-6-model-slack-trust-ledger.md`
- `260617-23-7-source-created-caveats-no-warning-parsing.md`
- `260617-23-8-property-confidence-reporting.md`

## 1. Goal

Update user-facing docs, internal specs, and focused conformance-style tests so
the implemented state-space economics and trust-ledger behavior is documented
and protected against regressions.

The end state is:

- docs describe the actual implemented schema exactly;
- internal specs and user-facing docs agree;
- small fixtures prove contributor diagnostics, pruning explanations, model
  slack, warning-caveat structure, and property confidence;
- real-app canaries remain integration validation, not the primary proof.

## 2. Non-goals

- Do not add new implementation behavior in docs-only edits.
- Do not update generated docs build assets.
- Do not create broad real-app snapshots as the main tests.
- Do not edit closed plans.
- Do not claim unsupported behavior is supported.

## 3. Current-State Findings

- `docs/concepts/state-space-control.md` already describes sound reductions,
  per-property slicing, explicit bounds, numeric reductions, and claim
  downgrades.
- `docs/reference/schemas.md` documents report schemas and extraction caveats
  but currently lacks the new fields from these plans until implemented.
- `docs/guides/diagnostics-and-search-limits.md` documents slicing/search
  diagnostics.
- `docs/soundness/trust-ledger.md` and
  `docs/soundness/e1-invariant.md` describe trust/caveat behavior.
- `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`,
  `docs/_specs/03-checker.md`, and `docs/_specs/04-conformance.md` already
  describe intended directions for IR, extraction, checker diagnostics, and
  canaries.
- The implementation plans before this one add schema fields that need docs and
  focused tests.

## 4. Exact File Paths and Relevant Symbols

- Docs:
  - `docs/concepts/state-space-control.md`
  - `docs/reference/schemas.md`
  - `docs/guides/diagnostics-and-search-limits.md`
  - `docs/soundness/trust-ledger.md`
  - `docs/soundness/e1-invariant.md`
  - `docs/_specs/01-ir.md`
  - `docs/_specs/02-extraction.md`
  - `docs/_specs/03-checker.md`
  - `docs/_specs/04-conformance.md`
- Tests:
  - `test/checker/checker.test.ts`
  - `test/kernel/mounted-scope.test.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/ci/command.test.ts`
  - `test/kernel/artifacts.test.ts`
  - `test/extraction/architecture.test.ts`
  - focused source tests under `test/sources/*`

## 5. Existing Patterns to Follow

- Keep user-facing docs in `docs/`.
- Keep internal specifications in `docs/_specs/`.
- Keep docs and schemas synchronized with `src/core/report/types.ts` and
  `src/core/ir/types.ts`.
- Prefer small fixtures over large snapshots.
- Run docs-related checks only if this repo already exposes them through
  package scripts.

## 6. Atomic Implementation Steps

1. Update `docs/reference/schemas.md` for all implemented schema changes:

   - check report slicing diagnostics with retained/pruned contributors;
   - extraction/check `modelSlack` fields;
   - property confidence metadata;
   - field-pruning metadata if implemented;
   - pending bound assumptions if exposed.

2. Update `docs/concepts/state-space-control.md`:

   - explain shared state-space contributors;
   - explain per-slice retained/pruned bits;
   - explain route/mount and pending queue pruning;
   - explain field-pruning metadata versus actual domain pruning.

3. Update `docs/guides/diagnostics-and-search-limits.md`:

   - document new slice summary fields;
   - document compact confidence output;
   - document bound hits versus configured bounds.

4. Update `docs/soundness/trust-ledger.md`:

   - add typed `modelSlack`;
   - explain warning strings are human text only;
   - document CI trust-ledger comparison of model slack.

5. Update `docs/soundness/e1-invariant.md`:

   - state that trust-affecting caveats must be structured at creation;
   - state that production report code must not parse warnings to recover
     caveat identity.

6. Update internal specs:

   - `docs/_specs/01-ir.md`: field-pruning metadata and caveat model if added.
   - `docs/_specs/02-extraction.md`: source-created caveats and model slack.
   - `docs/_specs/03-checker.md`: slicing contributors, route/mount/pending
     diagnostics, and property confidence.
   - `docs/_specs/04-conformance.md`: canaries compare contributor budgets and
     accepted caveats, not only pass/fail behavior.

7. Add focused fixtures if earlier plans did not already add all of them:

   - property unrelated to async state slices away pending queue;
   - property with `resolved` or `opId` retains pending queue and reports why;
   - property unrelated to route state slices away route/history vars;
   - property reading mount-local state retains only mount guard dependencies;
   - full model reports top contributors;
   - per-slice report shows retained and pruned contributors;
   - wide domains produce typed model-slack in extraction and check reports;
   - unextractable handler entries come from structured caveats;
   - CI detects model-slack changes;
   - property confidence annotates non-exact results.

8. Ensure tests avoid broad real-app snapshots. Use canaries only after small
   fixtures pass if existing scripts require it.

## 7. Per-Step Files to Edit

- Step 1:
  - `docs/reference/schemas.md`
- Step 2:
  - `docs/concepts/state-space-control.md`
- Step 3:
  - `docs/guides/diagnostics-and-search-limits.md`
- Step 4:
  - `docs/soundness/trust-ledger.md`
- Step 5:
  - `docs/soundness/e1-invariant.md`
- Step 6:
  - `docs/_specs/01-ir.md`
  - `docs/_specs/02-extraction.md`
  - `docs/_specs/03-checker.md`
  - `docs/_specs/04-conformance.md`
- Step 7:
  - `test/checker/checker.test.ts`
  - `test/kernel/mounted-scope.test.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - `src/cli/features/ci/command.test.ts`
  - `test/kernel/artifacts.test.ts`
  - `test/extraction/architecture.test.ts`
  - focused source tests under `test/sources/*`

## 8. Acceptance Criteria

- User-facing docs match the implemented report and model schemas.
- Internal specs and docs agree on model slack, confidence, slicing
  diagnostics, and warning-caveat structure.
- Tests prove each new report field introduced by this plan family.
- Tests fail if warning-string parsing is reintroduced for trust data.
- Tests prove state-space contributor behavior with small fixtures, not only
  real apps.

## 9. Tests to Add or Update

- `test/checker/checker.test.ts`
  - generalized property dependency extraction;
  - `leadsToWithin` slicing;
  - pending queue retained/pruned behavior;
  - property confidence for bound hits if checker-level confidence exists.
- `test/kernel/mounted-scope.test.ts`
  - mount-scope dependencies retained only when needed;
  - route/mount pruning appears in slice diagnostics.
- `src/cli/features/check/command.test.ts`
  - per-slice contributors;
  - `modelSlack` trust ledger;
  - property confidence metadata;
  - compact non-exact confidence output.
- `src/cli/features/extract/command.test.ts`
  - full-model contributors from shared helper;
  - model-slack caveats for wide domains and field pruning;
  - unextractable handlers report without warning parsing.
- `src/cli/features/ci/command.test.ts`
  - added/removed model-slack caveats are detected.
- `test/kernel/artifacts.test.ts`
  - artifact parsers validate new report fields.
- `test/extraction/architecture.test.ts`
  - no production warning-string parsing for trust data.

## 10. Verification Commands

Run targeted validation:

```bash
rtk pnpm vitest run test/checker/checker.test.ts
rtk pnpm vitest run test/kernel/mounted-scope.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/cli/features/ci/command.test.ts
rtk pnpm vitest run test/kernel/artifacts.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts
```

Run broad validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if docs would need to describe behavior that was not
  implemented by the earlier plans. Correct the docs to the implementation, or
  split a follow-up implementation plan.
- Stop and report if generated docs assets under `docs/build/` appear in diffs.
  Do not commit generated docs build output.
- Stop and report if broad snapshots make test failures hard to interpret.
  Replace them with focused fixtures.
- Stop and report if a schema field remains optional in code but docs present
  it as required, or vice versa.

## 12. Must Not Change

- Do not edit closed plans.
- Do not change implementation behavior while updating docs unless a test
  exposes a small schema mismatch that belongs to the current plan.
- Do not claim warning strings are machine-readable trust data.
- Do not make real-app canaries the primary proof of correctness.
