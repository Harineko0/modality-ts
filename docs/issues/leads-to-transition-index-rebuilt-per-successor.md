# Leads-To Rebuilds Transition Index Per Successor

## Summary

The `leadsToWithin` failure-suffix search rebuilds the checker transition index inside `schedulerSuccessors(...)`, which runs for every recursive state/depth expansion.

## Why This Matters

The hot-path optimization is meant to build transition indexes once and reuse them during checker exploration. Rebuilding the index for each `leadsToWithin` successor keeps correctness intact, but it reintroduces `O(transitions log transitions)` work on a property-checking hot path and can reduce the benefit of the optimization on large models.

## Reproduction

Inspect the current implementation:

```bash
cd /Users/hari/proj/modality-ts
rtk read src/check/properties/leads-to.ts
```

`schedulerSuccessors(...)` calls `buildTransitionIndex(model)` before scanning enabled transitions, and `failingSuffixWithin(...)` calls `schedulerSuccessors(...)` from its recursive `visit(...)` function.

## Expected Behavior

`failingSuffixWithin(...)` should build the transition index once per failure-suffix search and pass it into successor generation.

## Observed Behavior

Each recursive successor expansion builds and sorts a fresh transition index.

## Possible Fix Directions

- Move `const index = buildTransitionIndex(model)` into `failingSuffixWithin(...)`.
- Pass the index into `schedulerSuccessors(...)`.
- Add a focused test or instrumentation hook if future regressions in index construction frequency are easy to observe without timing-sensitive assertions.
