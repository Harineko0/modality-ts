# Coffee DX Check Retains Near-Full Slices

## Summary

Several Coffee DX customer-home properties retain nearly the entire extracted model after slicing. These slices include the wide printer-status abstraction, pending queue, route/history state, and all transitions, so per-property slicing does not prevent state explosion.

## Why This Matters

The 0.0.25 to 0.0.27 changes added more precise semantic extraction and more advanced slicing, but real app checks still become dominated by broad infrastructure and internal effect state. Users see long `modality check` times even when the model has only a few dozen vars and transitions.

## Reproduction

Use:

```text
/Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json
/Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts
```

Measured model shape:

```text
vars=22
transitions=20
bounds.maxDepth=20
bounds.maxPending=5
properties=19
```

The first cheap reachability properties slice well. For example:

```text
customerCanOpenPrinterSettings vars=2 transitions=1
customerCanOpenOrderHistory vars=2 transitions=1
customerCanDisableAutoPrint vars=2 transitions=1
```

But these properties retain near-full slices:

```text
densityOneRequiresConnectedPrinter vars=21 transitions=20
densitySevenDisabledWhenPrinterDisconnected vars=21 transitions=20
loadMoreOrdersEnabledOnlyWithCursorAndIdleDialog vars=21 transitions=20
```

The first near-full property did not return within 30s even with:

```text
maxStates=10000
maxEdges=50000
maxFrontier=10000
```

## Expected Behavior

Properties that mention printer density or order-history enablement should avoid pulling unrelated route/history/pending combinations and unrelated component state unless those variables are semantically necessary.

## Observed Behavior

The dependency closure expands through writer/read dependencies, mount guards, enabled-transition observations, and internal transitions until most of the model is retained. Once a slice includes the printer status data and pending queue, search cost is dominated by broad domains rather than the small property surface.

Relevant code:

- `src/check/check-model.ts`: `checkModelSliced()` computes and groups slices per property.
- `src/check/slicing/dependency-graph.ts`: `reachVarsThroughTransitions()` grows needed vars through transition reads and writes.
- `src/check/slicing/dependency-graph.ts`: `expandMountGuardDependencies()` can retain mount-local vars because they share route mount guards.

## Possible Fix Directions

- Add slice diagnostics that explain why each retained high-bit var entered the slice.
- Make `enabled(...)` predicates seed only guard/enablement dependencies, not unrelated writes from the same broad slice.
- Avoid retaining all mount-local vars merely because a shared route guard is read.
- Add special handling for internal `havoc` effects so they do not automatically pull wide abstractions into unrelated properties.
- Add a Coffee DX canary that records per-property slice sizes and fails if near-full slices return for these properties.
