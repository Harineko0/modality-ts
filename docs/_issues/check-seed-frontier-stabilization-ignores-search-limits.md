# Check Seed Frontier Stabilization Ignores Search Limits

## Summary

`modality check` can spend minutes before honoring `--max-states`, `--max-edges`, or `--max-frontier` because the Rust checker builds and stabilizes the initial frontier before the first search-limit check.

This is visible in Coffee DX after the 0.0.25 to 0.0.27 updates. A check of `apps/web/app/_customer/home.props.ts` against the generated `_customer/home.model.json` can take hundreds of seconds even though later interruptible-search work made depth expansion more responsive.

## Why This Matters

Search limits should be the user's escape hatch for pathological real-app models. If a wide internal stabilization happens before limits are checked, bounded runs still look hung and cannot produce useful diagnostics.

## Reproduction

Use the sibling Coffee DX app:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk node /Users/hari/proj/modality-ts/dist/cli/cli.js check \
  .modality/models/app/_customer/home.model.json \
  app/_customer/home.props.ts \
  --max-states 10000 \
  --max-edges 50000 \
  --max-frontier 10000 \
  --report /tmp/customer-home.check-report.json
```

The reported real-world run was about 765s for `modality check`.

The model has:

```text
vars=22
transitions=20
bounds.maxDepth=20
bounds.maxPending=5
state-space≈43.31bits
top contributors: local:CustomerHome.printerStatusData, sys:pending, sys:history
```

The expensive internal transition is:

```text
CustomerHome.useEffect.printerStatus_printerStatusData_optimisticDensity
```

It havocs:

```text
local:CustomerHome.printerStatus
local:CustomerHome.printerStatusData
local:CustomerHome.optimisticDensity
```

`local:CustomerHome.printerStatusData` has a wide option/record abstraction with about 513 values.

## Expected Behavior

The checker should apply state, edge, frontier, and memory limits during initial frontier construction and internal stabilization, or emit a structured diagnostic when the seed frontier itself exceeds limits.

## Observed Behavior

`check_model_compiled()` calls `seed_frontier()` before checking search limits. `seed_frontier()` calls `initial_states()` and then `stabilize()` over the full initial changed-var set. In the Coffee DX model, that can expand the wide internal `havoc` before the main search loop starts.

Relevant code:

- `crates/checker/src/search.rs`: `check_model_compiled()` calls `seed_frontier()` before the loop limit checks.
- `crates/checker/src/search.rs`: `seed_frontier()` calls `initial_states(...).flat_map(stabilize(...))`.
- `crates/checker/src/domain.rs`: `initial_states()` normalizes mount locals for every initial state.

## Possible Fix Directions

- Thread an interruptible budget into `seed_frontier()` and `stabilize()`.
- Check `maxStates`, `maxFrontier`, `maxEdges`, and memory guard while generating initial stabilized states.
- Return a structured `limits.phase = "seed-frontier"` or `"initial-stabilization"` diagnostic.
- Avoid treating every var as changed for initial stabilization when a narrower dependency set is available.
- Add a regression test with an internal transition that havocs a 500-value domain from the initial state.
