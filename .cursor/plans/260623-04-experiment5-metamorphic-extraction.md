# 260623-04 — Experiment 5: metamorphic extraction (bisimulation under refactoring)

Part 4 of 4. Depends on 260623-01 (the `ValidityExperiment` seam + report spine). May
reuse the mutant-generation scaffolding from 260623-03 but is otherwise independent.
Replaces the `metamorphic` stub.

## 1. Goal

Demonstrate that `extract` tracks *meaning*, not surface syntax: apply
**semantics-preserving** source transforms to the benchmark apps, re-extract, and assert
the resulting model is **bisimilar** to the baseline model (identical canonical
reachable-state set and identical per-property verdicts). Report the fraction of transforms
under which extraction is invariant, and localize any divergence to a transform × source
site. This is the extract-specific validity argument: refactors that a human would call
"the same program" must yield "the same model".

## 2. Non-goals

- No semantic-changing edits (that is experiment 4). Every transform here must be provably
  behaviour-preserving by construction.
- No model *equality at the IR-text level* — equality is **behavioural bisimulation**
  (reachable-state set + verdicts), so cosmetic IR differences (var ordering, ids) never
  cause false alarms.
- No new checker capability; reuse `checkModel` / `modelInitialStates` / `modelSuccessors`.

## 3. Current-state findings

- Zero existing metamorphic/bisimulation infra (`grep` for `metamorphic`/`bisimul`
  returns nothing).
- `modality-ts/check` exports `checkModel`, `modelInitialStates`, `modelSuccessors`;
  `tools/phase7-differential.ts` already computes reachable-state counts by driving
  `checkModel` + `modelInitialStates` — reuse that exploration approach for the
  reachable-state set.
- `modality-ts/core` exports `canonicalJson` and the canonicalization used by the visited
  set; `docs/soundness/checker-correctness.md` documents token-rename idempotence and
  equality-preserving canonicalization — the same canonical form must key the
  reachable-state-set comparison so token renaming does not create spurious differences.
- `runExtractCommand` produces `model.json`; `runCheckCommand` produces verdicts. Both are
  the comparison inputs.
- TS compiler API is available for AST transforms (see 260623-03 step 1).

## 4. Atomic implementation steps

1. **Define semantics-preserving transforms** in `tools/metamorphic/transforms.ts`, each
   `MetamorphicTransform = { id, describe, apply(sourceFile): TransformedSource }`,
   ordered by safety:
   - **comment/whitespace insertion** (trivially safe; the sanity floor — extraction must
     be invariant),
   - **local-variable rename** (alpha-renaming of block-scoped locals that do not escape;
     verify no capture/shadowing before applying),
   - **reorder provably-independent statements** (only adjacent statements with disjoint
     read/write sets and no intervening control flow or `await` — compute a conservative
     dependency check and skip if uncertain),
   - **extract-subexpression-to-const** (hoist a pure subexpression to a `const` with no
     observable effect),
   - **extract-subcomponent** (lift a JSX subtree with no local `useState`/effects into a
     child component receiving props — guard heavily; skip if the subtree owns hooks, per
     `docs/soundness/limitations.md` stateful-list-item caveat).
   Each transform must be **conservative**: when its precondition cannot be proven, it
   emits *no* mutation for that site (never a risky edit). Safety of the transform set is
   the experiment's own validity premise and is asserted in tests (§5).
2. **Implement the bisimulation oracle** `tools/metamorphic/bisimulation.ts`:
   `compareModels(baseline, variant)`:
   - explore each model's reachable states (reuse phase7's `checkModel` +
     `modelInitialStates` + `modelSuccessors` BFS up to the benchmark `searchLimits`),
     encode each state with the **canonical** encoding (token-rename–invariant), and
     compare the resulting sets for set-equality;
   - compare per-property verdicts from `runCheckCommand` for exact agreement;
   - return `{ bisimilar: boolean, stateSetDelta?, verdictDelta?, boundHit?: boolean }`.
     If either side hits `searchLimits` before exhaustion, return `boundHit: true` and
     classify **inconclusive** (a truncated exploration cannot prove bisimulation).
3. **Implement variant generation** `tools/metamorphic/generate.ts`: like 260623-03's
   generator but emitting *semantics-preserving* variants (one transform application per
   variant), capped/seeded via manifest `metamorphic: { maxVariants, seed, transforms? }`.
   Record `{ variantId, file, transformId, siteId, sourceDiff }`.
4. **Implement the experiment module**
   `tools/validity/experiments/metamorphic.ts`:
   - extract+check the **baseline** model per benchmark;
   - for each variant: re-extract+check, run `compareModels(baseline, variant)`;
   - classify **stable** (bisimilar), **divergent** (not bisimilar), **inconclusive**
     (bound hit or transform/extraction error);
   - stability rate = `stable / (stable + divergent)`.
   - On **divergent**, attach the transform id, source diff, and the minimal
     state-set/verdict delta so the failure points at a concrete extraction
     syntax-sensitivity bug.
5. **Assemble the slice**: per benchmark `metrics: { variantsTotal, stable, divergent,
   inconclusive, stabilityRate, perTransform: {transformId → {generated, stable,
   divergent}} }`; headline = stability rate across both apps + any transform with
   divergences (a divergence cluster is a real extraction defect, high-signal for the blog).
   Threshold via manifest `validityThresholds.metamorphic.minStabilityRate` (a *divergent*
   result is the interesting, gate-worthy case — but report-only by default per 260623-01).

## 5. Tests to add or update

- `test/metamorphic/transforms.test.ts`: **the critical safety test.** For each transform,
  on a corpus of small TS/TSX snippets, assert (a) the transform's precondition gate
  rejects unsafe sites (e.g. statement reorder is *not* applied when read/write sets
  overlap or an `await` intervenes), and (b) applying it preserves a hand-checked semantic
  property. A transform that cannot be shown safe is removed, not shipped.
- `test/metamorphic/bisimulation.test.ts`: two models known-bisimilar (e.g. var-renamed
  IR) compare equal; two models differing by one reachable state compare not-equal; a
  bound-hit returns inconclusive (not a false "bisimilar").
- `test/validity/metamorphic-experiment.test.ts`: on a tiny fixture, a comment-insertion
  variant is `stable`; a deliberately *unsafe* transform (test-only) that changes behaviour
  is `divergent` (proves the oracle detects real differences).

## 6. Verification

- `pnpm typecheck`
- `pnpm validity -- --id metamorphic --report /tmp/mm.json` → high stability rate;
  any `divergent` entries carry a concrete transform + state/verdict delta.
- Sanity floor: the comment/whitespace transform must be **100% stable** on both apps; any
  divergence there is an extraction determinism bug and is a **stop** condition.
- `pnpm fix`, `pnpm architecture`.

## 7. Acceptance criteria

- Transform set is conservative and each transform's safety is asserted by tests; unsafe
  sites are skipped, never mutated.
- Bisimulation is decided on the **canonical** reachable-state set + verdict agreement, so
  cosmetic IR differences never produce false divergence.
- Bound-hit explorations are `inconclusive`, never counted as `stable`.
- The metamorphic slice reports per-transform stability and localizes every divergence to a
  transform × source site with a minimal delta.
- Comment/whitespace transform is 100% stable on both benchmark apps.

## 8. Risks, ambiguities, and stop conditions

- **Transform soundness is the whole premise.** If a transform is not provably
  behaviour-preserving, a "divergence" is ambiguous (could be the transform's fault). Bias
  every transform toward under-applying; start with only comment/whitespace +
  local-rename, and add reorder/extract-subcomponent only once their precondition gates are
  tested. **Stop** before shipping any transform whose safety test cannot be written.
- **State-space cost**: re-exploring reachable states per variant is expensive. Reuse the
  benchmark `searchLimits`, cap `maxVariants`, parallelize, and run the full set on a
  nightly `workflow_dispatch` if PR CI budget is exceeded (`sampled: true`).
- **Bound hits hide divergence**: if exploration truncates, bisimulation is unprovable —
  classify inconclusive and surface the count; a high inconclusive rate means the search
  budget, not extraction, is the limiting factor.
- **Extract-subcomponent vs the model boundary**: lifting a subtree that secretly owns
  hooks changes mount-local scoping (`docs/soundness/limitations.md`). The transform must
  refuse such subtrees; if the refusal logic is uncertain, drop this transform rather than
  risk false divergence.
