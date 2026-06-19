# Plan 7: Cone-of-Influence Effect Projection (Coffee DX over-10s fix)

Resolves `docs/_issues/coffee-dx-density-check-still-over-10s-after-slicing.md`.

## Found issue

The `densityOneRequiresConnectedPrinter` slice stayed large (it retained
`printerStatusData` ~9 bits and all 7 `optimisticDensity.seq.*` transitions)
even though the property only reads `printerStatus` and observes enabledness of
`seq.1`. Confirmed empirically by reproducing the real-app slice in-repo.

Root cause: the slice closure retained **all co-writes** of any kept transition.

- In `src/check/slicing/dependency-graph.ts`, `reachVarsThroughTransitions`
  added every `transition.writes` entry to the needed set when the transition
  wrote any needed var.
- So the mount `useEffect` (writes the needed `printerStatus`) dragged in its
  co-writes `printerStatusData` + `optimisticDensity*` at full domain, which in
  turn pulled in every `seq.*` transition.
- `finalizeSlicedTransitions` kept those transitions' full effects, so the wide
  `printerStatusData` domain (~512 values) was re-havoc'd from every state →
  millions of edges → >10s. The cost was edges/domain breadth, not state count.

Why the synthetic benchmark missed it: in `tools/perf/coffee-shaped-fixture.ts`
`printerStatus` has no writer transition, so the cone never expanded. The real
app's `useEffect` co-writer is what triggers the blowup.

## Applied fixes

Replaced the over-broad co-write rule with true backward cone-of-influence plus
assignment-level effect projection (sound syntactic projection onto relevant
variables).

- New `src/check/slicing/effect-projection.ts` — `projectEffectToVars(effect,
  retained)`: drops separable writes (`assign`/`havoc`/`choose`) to pruned vars,
  keeps `opaque` multi-writes whole, recurses `seq`/`if`, leaves
  `enqueue`/`dequeue` to the existing pending strip.
- `dependency-graph.ts` — `addRetainedTransitionInputs` adds only what
  influences the property: guard reads, reads of the *projected* effect, coupled
  `opaque` co-writes, and trigger vars. Pending queues are pulled in by reads
  (so guards stay evaluable) but not by co-writes.
- `slice-model.ts` — `finalizeSlicedTransitions` projects each retained
  transition's effect onto the sliced vars, recomputes reads/writes, and drops
  resulting no-ops. Removed the now-subsumed `stripToEnabledObservationTransition`.

## Result

`densityOneRequiresConnectedPrinter` slice: 10 vars / 8 transitions →
`{printerStatus, sys:route}` + `seq.1` observation (the Plan-2 target), checking
in ~12ms / 3 states.

## Validation

- Verdict + exact counterexample-trace parity preserved (demo-acceptance still
  finds all 3 seeded bugs with identical traces; states/edges drop, e.g. ToDo
  edges 245→97, checkout 1600→1144).
- Updated stale over-retention assertions to the tighter (correct) slices.
- Added a co-write regression test in `test/check/slicing-parity.test.ts` with
  full-model verdict parity.
- `pnpm typecheck`, `architecture`, `phase7` (TLC differential + POR parity) all
  pass. Full suite green except a pre-existing unrelated `command.output.test.ts`
  flake (fails identically on clean tree).

## Not done (follow-up)

Abstract-by-default for opaque externally-fetched payloads (extract side). Only
needed if an extractor couples `printerStatus := f(printerStatusData)` via a
read, which would keep the wide payload even under precise CoI. The reproduction
uses independent havocs, so this fix resolves the reported case.
