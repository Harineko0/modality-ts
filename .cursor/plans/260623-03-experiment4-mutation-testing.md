# 260623-03 — Experiment 4: mutation-testing true-positive rate

Part 3 of 4. Depends on 260623-01 (the `ValidityExperiment` seam + report spine).
Replaces the `mutation` stub.

## 1. Goal

Quantify the tool's bug-catching power empirically: mechanically mutate the benchmark app
source, re-run `extract → check` (and `replay` to confirm) for each mutant, and report the
**detection rate** — the fraction of *property-violating* mutants the tool flags (and whose
counterexample replays as `reproduced`) — alongside the **false-positive rate** on
behaviour-preserving mutants. This is the headline "we injected N real bugs and caught X%"
number.

## 2. Non-goals

- Not replacing the existing hand-seeded probes in `benchmarks/manifest.json`
  (`expected.truePositive*`); those remain a fixed regression oracle. Mutation testing is
  an *additional*, broader, automatically-generated signal.
- No mutation of `*.props.ts` target-registration files or properties — mutate **app
  behaviour** only, so a detected mutant means the property genuinely broke.
- No coverage-based mutant selection from runtime traces (future work); selection is
  AST-operator + targeting-driven.
- No attempt to detect equivalent mutants perfectly (undecidable); handle them via the
  metamorphic-style "behaviour-preserving" oracle in §4.5 and report them separately.

## 3. Current-state findings

- `tools/benchmark/runner.ts` already runs `runExtractCommand`/`runCheckCommand`/
  `runReplayCommand` per benchmark and classifies verdicts
  (`tools/benchmark/classify.ts`), with `BenchmarkRunReport` in `tools/benchmark/report.ts`.
  This is the per-mutant pipeline to reuse — factor its extract→check→replay core into a
  reusable function.
- `benchmarks/manifest.json` per-benchmark fields drive extraction: `sourcePaths`,
  `propsPaths`, `effectApis`, `searchLimits`, plus `expected{...}` (the hand-seeded oracle).
- `benchmarks/shared/app-spec/seeded-outcomes.ts` and `property-catalog.ts` define which
  properties exist and which API outcomes are seeded — the property set a mutant can break.
- TypeScript/TSX is available (`typescript` is a direct dependency); AST mutation can use
  the TS compiler API (`ts.transform`, factory) — no new heavy dependency required.
- `runCheckCommand` returns verdicts with `status: "violated" | "verified" |
  "verified-within-bounds"`; `runReplayCommand` returns the Spec 04 §1 verdict
  (`reproduced | not-reproduced | inconclusive`).

## 4. Atomic implementation steps

1. **Define mutation operators** in `tools/mutation/operators.ts` as pure AST→AST
   transforms over a single TS source file, each tagged `MutationOperator = { id, describe,
   appliesTo(node), mutate(node) }`. Initial behaviour-affecting set:
   - conditional-boundary (`<`↔`<=`, `>`↔`>=`),
   - negate-conditional (`===`↔`!==`, invert `if` guard),
   - remove-conditional (force guard `true`/`false`),
   - swap setter argument / drop a state write (delete a `setX(...)` call statement),
   - off-by-one on numeric literals used in guards/bounds,
   - swap branch bodies of an `if/else`.
   Each operator yields a list of concrete `MutationSite` candidates with source range +
   stable site id. Keep operators framework-agnostic (operate on TS AST, not React APIs).
2. **Implement the mutant generator** `tools/mutation/generate.ts`:
   given a benchmark's `sourcePaths`, parse each file, enumerate sites for all operators,
   and materialize each mutant as a *copy of the app tree* in the workDir with exactly one
   site mutated (one mutation per mutant). Cap per-benchmark mutant count via manifest
   `mutation: { maxMutants, seed, operators? }` with deterministic seeded sampling when the
   full set exceeds the cap. Record `{ mutantId, file, operatorId, siteId, sourceDiff }`.
3. **Factor the per-run core** out of `tools/benchmark/runner.ts` into
   `tools/benchmark/run-once.ts` (`extractCheckReplayOnce({ appRoot, sourcePaths,
   propsPaths, searchLimits, workDir })` → `{ extractReport, checkReport, replayVerdicts }`).
   Re-point the existing benchmark runner at it (pure refactor, no behaviour change — the
   existing benchmark tests must still pass).
4. **Implement the experiment module** `tools/validity/experiments/mutation.ts`:
   - establish the **baseline**: run `extractCheckReplayOnce` on the unmutated app; require
     all properties `verified*` (a violated baseline means the benchmark is mis-seeded —
     error out for that app).
   - for each mutant: run `extractCheckReplayOnce`; classify:
     - **killed** = at least one property flips to `violated` *and* its counterexample
       replays `reproduced` against the **mutated** app (true positive);
     - **survived** = all properties still `verified*` (missed bug — counts against
       detection if the mutant is behaviour-affecting);
     - **equivalent/preserved** = §4.5 oracle says the mutant did not change observable
       behaviour (excluded from the denominator, reported separately);
     - **error/timeout** = extraction or check failed / hit `searchLimits` (reported
       separately, never silently counted as killed or survived).
   - detection rate = `killed / (killed + survived)` over behaviour-affecting mutants.
5. **Behaviour-preserving oracle** (`tools/mutation/oracle.ts`): to separate "missed bug"
   from "equivalent mutant", replay a fixed seeded conformance walk set (reuse the harness
   from 260623-02) against both the baseline app and the mutant; if observable behaviour is
   identical across the walk set, classify the mutant **preserved** (don't penalize the
   tool for not flagging a no-op change). This reuses experiment-3 machinery and keeps the
   denominator honest.
6. **False-positive rate**: among **preserved** mutants, any that the tool reports as
   `violated` with a `reproduced` replay is a false positive (the model claimed a bug in
   behaviour that did not change). Report `falsePositiveRate = falsePositives / preserved`.
   For a sound over-approximating extractor this should be ~0 for `exact` transitions; a
   non-zero rate localizes to specific transitions — include those transition ids.
7. **Assemble the slice**: per benchmark, `metrics: { mutantsTotal, killed, survived,
   preserved, error, detectionRate, falsePositiveRate, perOperator:
   {operatorId → {generated, killed, survived}} }`; headline = detection rate across both
   apps + the operator with the worst survival rate (a survival cluster localizes an
   extraction gap). Threshold via manifest `validityThresholds.mutation.minDetectionRate`
   (report-only by default).

## 5. Tests to add or update

- `test/mutation/operators.test.ts`: each operator, given a minimal source, produces the
  expected mutated text and a stable `siteId`; idempotent enumeration.
- `test/mutation/generate.test.ts`: seeded sampling is deterministic; one mutation per
  mutant; full-tree copy is isolated (mutating mutant A never affects B).
- `test/validity/mutation-experiment.test.ts`: on a tiny fixture app with one known
  behaviour-affecting site and one no-op site, assert the affecting mutant is `killed`
  (violated + reproduced) and the no-op mutant is `preserved` (not `survived`).
- Confirm the `tools/benchmark/runner.ts` refactor (step 3) leaves
  `test/benchmarks/**` (or the benchmark runner tests) green.

## 6. Verification

- `pnpm typecheck`
- `pnpm validity -- --id mutation --report /tmp/m.json` → per-benchmark detection rate,
  per-operator breakdown, false-positive rate, with `error`/`preserved` reported
  separately (not folded into detection).
- Spot-check a `survived` mutant by hand: confirm it is a genuine missed bug (→ extraction
  gap, file a follow-up) or reclassify the oracle. Spot-check a `killed` mutant's replay is
  `reproduced` (not a spurious model-only flag).
- `pnpm fix`, `pnpm architecture`.

## 7. Acceptance criteria

- Mutation harness is generic over TS source files and operator-pluggable; adding an
  operator is one entry in `operators.ts`.
- Each benchmark reports a detection rate over behaviour-affecting mutants, with
  `preserved`/`equivalent` excluded from the denominator via the behaviour oracle.
- `killed` requires a `reproduced` replay against the mutated app — never a model-only
  `violated`.
- Per-operator survival breakdown is present so a survival cluster points at a concrete
  extraction gap.
- Runtime stays within CI budget (see §8); mutant count is manifest-capped and seeded.

## 8. Risks, ambiguities, and stop conditions

- **Combinatorial cost**: full mutant × extract+check can be very slow. Mitigate with
  `maxMutants` cap, seeded sampling, per-mutant `searchLimits` (smaller than full
  benchmark), and parallelism across mutants (worker pool over `extractCheckReplayOnce`).
  If a single benchmark exceeds the CI budget, run a seeded subsample in PR CI and the full
  set on a scheduled (nightly) `workflow_dispatch` — record `sampled: true` in the slice.
- **Equivalent-mutant misclassification**: the behaviour oracle (step 5) is walk-bounded,
  so it can call a real bug "preserved" if no walk exercises it. Bias the oracle walk set
  toward the mutated file's transitions; when in doubt classify **survived** (conservative:
  counts against the tool, never falsely inflates detection). Document this bias.
- **Mutant doesn't typecheck / app won't build**: skip with `status: error`, never count.
- **Baseline not all-verified**: a benchmark whose baseline has a violated property is
  mis-seeded for this experiment — **stop** and fix the benchmark before measuring mutation.
- Keep mutation strictly to app source; mutating props/properties would make a "detection"
  meaningless.
