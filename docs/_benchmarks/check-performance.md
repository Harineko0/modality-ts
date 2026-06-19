# Check performance baselines

This document records how to reproduce slice and check baselines for the Coffee-shaped
performance fixture used in Plan 2 diagnostics work.

## Motivating property

The original motivating case is the Coffee DX property
`densityOneRequiresConnectedPrinter` in `coffee-dx` (`home.props.ts`): a printer-status
guard combined with `enabled(setDensity1)` that should retain only a small cone of state.

Rough observed numbers from the plan-of-plans (local Coffee DX, pre-fix):

- extraction: ~6.8 seconds
- checking (unsliced): ~600 seconds

The in-repo synthetic fixture mirrors that shape without importing Coffee DX.

## Reproducible benchmark command

```bash
pnpm perf:check
```

This runs `tools/check-performance-benchmark.ts` with the default `coffee-shaped`
fixture (`tools/perf/coffee-shaped-fixture.ts`). Output is machine-readable JSON on
stdout.

## What to compare first

Elapsed timings are environment-dependent. Compare deterministic fields first:

| Field | Meaning |
| --- | --- |
| `fullVars` / `fullTransitions` | Full model size |
| `propertySlices[].vars` / `transitions` | Per-property slice size |
| `propertySlices[].retainedBits` / `prunedBits` | Slice economics |
| `propertySlices[].topRetainedContributors` / `topPrunedContributors` | Dominant retained/pruned vars |
| `unsliced.states` / `edges` / `depth` | Unsliced search footprint |
| `sliced.states` / `edges` / `depth` | Sliced search footprint |
| `slicedPor.states` / `edges` / `depth` | Sliced search with `--partial-order-reduction` |
| `slicedPor.partialOrderReduction` | POR diagnostics (skipped transitions, reduced states, cycle fallbacks) |

Use `elapsedMs`, `slicePlanningElapsedMs`, `slicePlanningTotalElapsedMs`, and `speedup`
for trend tracking only — not as golden test values.

## Extract-side slice diagnostics

When running `modality extract --props … --report …`, the extraction report includes
`diagnostics.propertySlices` with per-property slice planning diagnostics:

- emitted/skipped status, mode, full and slice var/transition counts
- retained/pruned bits and top contributor arrays
- `elapsedMs` per property (slice planning only — not artifact writes)
- aggregate `totalElapsedMs`, `largestRetainedProperty`, `largestRetainedBits`

The property slice manifest (`*.slices.json`) remains deterministic for a fixed
`generatedAt` and does **not** include elapsed timings.

Human extract output adds a compact economics line, for example:

```text
slice-economics=largest:densityOneRequiresConnectedPrinter retained:12.0bits pruned:90.0bits topRetained:printerStatus(1.6) topPruned:orderHistoryPayload(16.0)
```

## Sample baseline

See `coffee-shaped.sample.json` for an illustrative snapshot. Elapsed fields in that
file are environment-specific and are not CI goldens.
