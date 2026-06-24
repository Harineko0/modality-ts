# 260624-01 — Model var de-duplication at assembly (Fix B)

## Goal

Eliminate duplicate state-variable declarations in the assembled model so that
the extracted model contains exactly one declaration per `var.id`. This fixes
the `metamorphic` validity experiment, which currently reports
`reachable-state exploration hit search limits` for *every* variant — including
semantically-identical comment-whitespace variants — because the base model is
state-space-exploded by ~40× duplication.

Concretely, `.modality/ledgerops-react-router.model.json` currently has **4659
var declarations but only 114 unique ids** (every global `library-template` var
duplicated ~102×). The checker treats each declaration as a distinct state
dimension, so exploration blows past search limits immediately.

## Non-goals

- Do NOT change the observation/replay path (that is plan `260624-03`).
- Do NOT change validity reporting/threshold semantics (that is `260624-04`).
- Do NOT attempt to dedupe transitions — they are already unique (93/93) and are
  correctly deduped in `mergeExtractionPipelineResults`.
- Do NOT preserve backward compatibility of emitted model JSON; regenerating
  golden/snapshot models is expected and in-scope.

## Current-state findings

- Final model assembly lives in `src/cli/extraction/build-model.ts` around
  lines 319–357. `templateVars` is built as:
  ```ts
  const templateVars = [
    ...pipeline.templateFragments.flatMap((fragment) => fragment.vars),
    ...routeExecutionFragment.vars,
    ...cacheStorageFragments.vars,
  ];
  ```
  and then concatenated (`...stateVars`, `...routeVars`,
  `...synthesizeSystemVars(...)`) into `model.vars` with **no dedup by id**.
- `pipeline.templateFragments` is deduped only by *whole-fragment composite key*
  in `uniqueTemplateFragments` (`src/cli/features/extract/extraction-project.ts:488`).
  The same global `library-template` var (e.g. `swr:useAccountDetail:data`) recurs
  across ~102 distinct fragments (one per call-site/route, each carrying different
  transitions), so the fragment-level dedup never collapses the shared vars.
- Library-template vars are global-scope and identical across duplicates:
  verified that all 45 duplicated ids have **byte-identical** declarations
  (0 conflicting shapes). Keep-first dedup is therefore semantically lossless
  today, but the implementation must still merge defensively (see step 3) to be
  future-proof against domain-widening differences.
- `validateModel` (`src/core/ir/validator.ts:26`) ALREADY detects duplicate var
  ids via `pushDuplicates(errors, "state var", ...)` (line 36). However
  `validateModel` is invoked **only** by the export command
  (`src/cli/features/export/command.ts:83,132`) — never during extraction or
  check. That is why a duplicate-laden model flows through extract → check →
  conformance/metamorphic without error. This plan both fixes the source of the
  duplication AND wires validation into extraction so the class of bug regresses
  loudly.
- The extract command builds the model via `buildExtractionModel(options, ...)`
  (`src/cli/features/extract/command.ts:92`) and writes it at line 147. The model
  returned from `buildExtractionModel` is the natural dedup + validation point.
- `varCount` reported by extraction (`build-model.ts:477`) currently counts
  `templateFragments.flatMap(f => f.vars).length` and will change after dedup;
  diagnostics expecting the inflated count must be updated.

## Atomic implementation steps

1. **Add a pure dedup helper.** In `src/cli/extraction/build-model.ts` (or a new
   `src/core/ir/dedupe-vars.ts` if it is reusable by other call sites — prefer the
   shared module so export/check can use it too), add:
   ```ts
   export function dedupeVarsById(
     vars: readonly StateVarDecl[],
   ): StateVarDecl[]
   ```
   It must iterate in order, keep first occurrence per id, and when a later
   declaration with the same id has a *different* domain, merge via the existing
   domain-merge logic rather than silently dropping it (see step 3). It returns
   declarations in first-seen order so model output stays deterministic.

2. **Apply dedup at final assembly.** Wrap the `vars:` array in the returned
   model object (`build-model.ts:347-357`) with `dedupeVarsById(...)`. Dedup must
   run AFTER `synthesizeSystemVars` and the `routeVars`/`stateVars` concat so the
   whole combined set is deduplicated as a unit. `synthesizeSystemVars` receives
   `[...routeVars, ...stateVars]` for its own logic — leave that input untouched;
   only the final emitted array is deduped.

3. **Merge domains defensively.** Reuse `mergeAssignedDomain`/`mergeArgDomains`
   semantics from `src/cli/features/extract/model-postprocess.ts` (export them or
   factor into a shared util) so that two declarations with the same id but
   widened numeric/enum domains collapse to the union rather than first-wins.
   Identical declarations (today's case) collapse trivially. Do NOT introduce a
   bespoke merge — abstract the existing one.

4. **Wire validation into extraction.** In
   `src/cli/features/extract/command.ts`, after `buildExtractionModel` (line 92),
   call `validateModel(model)` and fail the command (throw with the joined
   `errors`) when `!ok`. This guarantees any future re-introduction of duplicate
   ids (or other structural breakage) is caught at extraction time, not silently
   tolerated by the native checker. Confirm `validateModel` runs on the FULL model
   (use default options, not `{ sliced: true }`).

5. **Fix the var-count diagnostic.** Update `build-model.ts:477` (and any
   downstream `varCount`/`stateSpaceLine` consumers in `command.ts`) to count the
   deduped `model.vars.length`, not the pre-dedup template flat-map length, so the
   reported state-space metrics reflect the real model.

6. **Regenerate golden/snapshot models.** Re-extract the benchmark fixtures and
   any committed expected-model snapshots
   (`.modality/ledgerops-*.model.json`, plus any `expectedModelPath` snapshots
   referenced in `command.ts` snapshot checks). Verify each reduces to its unique
   var count (react-router: 4659 → 114).

## Tests to add or update

- **New unit test** `test/extract/dedupe-vars.test.ts` (or colocated
  `src/core/ir/dedupe-vars.test.ts` if the helper lives in core): covers
  (a) identical-duplicate collapse, (b) order preservation, (c) domain-merge on
  differing numeric/enum domains, (d) no-op on already-unique input.
- **New/updated extraction test** asserting the assembled model from a fixture
  with multiple call-sites of the same SWR/zustand hook yields one declaration
  per id (regression guard for the 102× bug). Put under `test/extract/`.
- **New negative test** asserting the extract command throws when given a model
  that would contain duplicate var ids (e.g. by stubbing `buildExtractionModel`
  to return a duplicate-laden model), confirming step 4 enforcement.
- Update any snapshot tests in `src/cli/features/extract/` that encode the
  inflated var counts.

## Verification

- `pnpm typecheck`
- `pnpm test` (fast tier) — must pass.
- `pnpm fix` — lint/format clean.
- `pnpm architecture` — dependency rules intact (especially if a new
  `src/core/ir/dedupe-vars.ts` is added; confirm core does not import cli).
- Re-extract react-router benchmark and assert
  `jq '[.vars[].id] | length' model.json == ([.vars[].id] | unique | length)`.
- `pnpm validity:metamorphic` — variants must now reach `stable`/`divergent`
  verdicts instead of all-`inconclusive (search limits)`. At minimum the
  comment-whitespace variants must classify as `stable`.
- `pnpm phase7` (semantics-sensitive: model generation changed).

## Acceptance criteria

- Every extracted model satisfies `unique(var.id) == count(var.id)`.
- `validateModel` runs during `extract` and fails the command on duplicate ids or
  other structural errors.
- `metamorphic` validity experiment produces comparable variants (no
  `no comparable variants (… inconclusive)` headline); comment-whitespace
  variants classify `stable`.
- No regression in `pnpm test`, `pnpm phase7`, `pnpm architecture`.

## Risks, ambiguities, and stop conditions

- **Risk:** a duplicate id legitimately carries *different* roles/scopes (not just
  domains). Verified not the case today (0 conflicts), but if step 3 encounters a
  conflict it cannot merge (e.g. different `role.kind` or non-global scope),
  **stop** and surface the conflict as an extraction error rather than guessing —
  this indicates a deeper plugin bug to file separately.
- **Risk:** metamorphic may still hit search limits after dedup if domains are
  genuinely large. If so, that is a *separate* tuning concern (search bounds in
  the benchmark manifest), not part of this plan — note it and stop; do not raise
  limits speculatively here.
- **Ambiguity:** helper placement (core vs cli). Prefer `src/core/ir` only if no
  cli-only imports leak in; otherwise keep it in `src/cli/extraction`. Let
  `pnpm architecture` decide.
- **Stop condition:** if regenerated snapshots reveal transition or property
  changes (not just var-count shrinkage), stop — that means dedup altered
  semantics and the merge logic is wrong.
