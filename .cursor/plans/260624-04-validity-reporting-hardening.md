# 260624-03 — Validity reporting hardening

## Goal

Make the validity experiment reporting fail loudly when an experiment is
*structurally broken* (produces no actionable signal), rather than reporting
`pass` under a `0` threshold. Today `mutation` reported **`pass` with detection
0.0% (0/16)** — every mutant survived because the replay pipeline was broken, yet
the threshold `minDetectionRate: 0` let it pass. This masks total breakage and
must not happen again.

The fix is symmetric with the existing `conformance` all-inconclusive guard:
an experiment that cannot exercise its oracle at all must be `fail`/blocked, not
`pass`.

## Non-goals

- Do NOT fix the underlying observation/replay breakage (that is `260624-03`) or
  model dedup (`260624-02`). This plan only hardens *reporting/classification* so
  breakage is never silently green.
- Do NOT raise the configured thresholds in `benchmarks/manifest.json`. The guard
  must be independent of the numeric threshold (a `0` threshold is a legitimate
  "no minimum" setting; the guard catches "no signal at all").
- Do NOT change comment formatting beyond surfacing the new blocked/fail states.

## Current-state findings

- Thresholds in `benchmarks/manifest.json` are all `0`
  (`conformance.minPassRate`, `mutation.minDetectionRate`,
  `metamorphic.minStabilityRate`).
- **conformance** already has the right pattern: `sliceFromConformReport`
  (`tools/validity/experiments/conformance.ts:240-247`) forces `status: "fail"`
  when `hasOnlyInconclusiveWalks` (total > 0 and reproduced+notReproduced === 0),
  and `summarizeConformance` (line 279-284) fails when
  `total > 0 && reproduced === 0 && inconclusive === total`.
- **mutation** has NO equivalent guard. Status is computed purely as
  `metrics.detectionRate < minDetectionRate ? "fail" : "pass"`
  (`tools/validity/experiments/mutation.ts:214`). With `minDetectionRate = 0`,
  `0 < 0` is false → `pass`, even when `mutantsTotal > 0` and `killed === 0` and
  every mutant `survived` (not `preserved`). A run where mutants exist but the
  oracle never killed or preserved any is structurally inconclusive and should
  fail.
- **metamorphic** already fails on "no comparable variants"
  (all-inconclusive) — verify it has an explicit guard and keep it consistent
  with the new mutation guard's shape.
- Report/threshold types live in `tools/benchmark/manifest.ts`
  (`validityThresholds`) and experiment summaries in
  `tools/validity/experiments/*.ts`; comment rendering in
  `tools/validity/comment.ts`.

## Atomic implementation steps

1. **Add a shared "no-signal" classifier.** In a shared location
   (`tools/validity/runner.ts` or a small `tools/validity/guards.ts`), add a
   predicate capturing "experiment ran but produced zero conclusive oracle
   outcomes". Express it per-experiment in terms each already computes:
   - conformance: `total > 0 && reproduced + notReproduced === 0`
     (already implemented — refactor to use the shared predicate).
   - mutation: `mutantsTotal > 0 && killed === 0 && preserved === 0`
     (i.e. every mutant `survived`/`error` — the oracle distinguished nothing).
   - metamorphic: `variants > 0 && stable === 0 && divergent === 0`
     (all inconclusive — already failing; route through the shared predicate).

2. **Force fail on no-signal in mutation.** In
   `tools/validity/experiments/mutation.ts`, change the status computation
   (line ~214) so that when the no-signal predicate holds the slice/summary status
   is `fail` regardless of `minDetectionRate`. Add a clear headline/message, e.g.
   `blocked: no mutants killed or preserved (oracle produced no signal)`.

3. **Unify conformance + metamorphic through the shared predicate.** Replace the
   inline guards in `conformance.ts` (lines 240-247, 279-284) and the metamorphic
   equivalent with calls to the shared predicate so all three experiments classify
   "no signal" identically. Behavior for conformance/metamorphic must remain
   `fail` (no regression); only mutation changes from `pass`→`fail`.

4. **Surface the blocked state in the comment.** In `tools/validity/comment.ts`,
   ensure the no-signal status renders distinctly (e.g. a `blocked`/`fail` tag with
   the explanatory message) so a reader of the PR comment can tell "0% because
   broken pipeline" from "0% because threshold is 0 and nothing was expected".

5. **Keep aggregate `kind`/exit semantics correct.** Confirm the top-level
   validity run exit code (`tools/validity-ci.ts`) reflects any experiment now
   classified as `fail`, so CI goes red when an experiment is structurally broken.

## Tests to add or update

- **New unit tests** for the shared no-signal predicate covering each experiment
  shape: (a) zero-signal → blocked/fail, (b) some signal → not blocked,
  (c) zero items total → not blocked (nothing to run is not "broken").
- **Mutation experiment test:** given a per-benchmark result where
  `mutantsTotal > 0`, `killed === 0`, `preserved === 0`, assert summary status is
  `fail` even with `minDetectionRate: 0`.
- **Regression test:** a healthy mutation result (some killed, some preserved,
  detection ≥ threshold) still reports `pass`.
- Update existing `tools/validity` tests / snapshots that asserted mutation
  `pass` under the old behavior.
- Comment-rendering test asserting the blocked message appears.

## Verification

- `pnpm typecheck`, `pnpm fix`.
- Targeted vitest run over `test/validity/**` (and any
  `tools/validity` colocated tests).
- Dry-run `pnpm validity` against the current (pre-`260624-02`) broken state and
  confirm `mutation` now reports **fail/blocked** instead of `pass`.
- After `260624-01` + `260624-02` land, confirm a *healthy* run reports `pass`
  for mutation (guard does not produce false positives once the pipeline works).

## Acceptance criteria

- An experiment that runs but yields zero conclusive oracle outcomes is classified
  `fail`/`blocked` regardless of a `0` threshold.
- `mutation` with all-survived mutants reports `fail`, with a message explaining
  the no-signal cause.
- `conformance` and `metamorphic` retain their existing fail-on-no-signal behavior
  via the shared predicate (no behavior regression).
- Validity CI exit code is non-zero when any experiment is structurally broken.
- A healthy run with real signal still passes.

## Risks, ambiguities, and stop conditions

- **Independent of `260624-01`/`260624-02`** and safe to land first — it is the
  detection mechanism that would have caught this regression. Landing it first
  makes the broken `mutation` go red immediately, which is desirable.
- **Risk of false positives:** ensure "zero items total" (no mutants generated, no
  variants produced) is treated as *not broken* by this guard if that is a
  legitimate state — but consider whether "no mutants generated at all" is itself a
  failure worth flagging separately. If ambiguous, default to: `items === 0` is a
  separate `blocked: nothing-to-run` status, distinct from `items > 0 && no
  signal`.
- **Ambiguity:** whether `error`-status mutants count as "signal". Decide: an
  `error` mutant is NOT signal (oracle did not conclude), so a run that is all
  `error` is also no-signal/blocked. Document the decision in the predicate.
- **Stop condition:** if unifying the three guards would change conformance or
  metamorphic classification on existing fixtures, stop — the shared predicate must
  be exactly equivalent to today's conformance/metamorphic guards, only *adding*
  the mutation case.
