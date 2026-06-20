# Coffee DX Density Check Still Exceeds 10s After Slicing

## Summary

Plans 1-5 of the check performance overhaul materially reduce the Coffee DX
`densityOneRequiresConnectedPrinter` state slice, but the real app check still
does not meet the Plan 6 readiness target of completing under 10 seconds.

The synthetic Coffee-shaped benchmark now shows the intended reduction:

- full model: 18 vars, 13 transitions, 54.23 state-space bits
- motivating property slice: 2 vars, 1 transition, 2.58 retained bits
- check footprint: unsliced 8 states / 24 edges, sliced 3 states / 0 edges

The real Coffee DX customer-home property improves but remains too large:

- full extracted model: 22 vars, 20 transitions, 43.31 state-space bits
- `densityOneRequiresConnectedPrinter` slice: 4 vars, 8 transitions, 13.58 retained bits
- retained slice vars:
  - `local:CustomerHome.optimisticDensity`
  - `local:CustomerHome.printerStatus`
  - `local:CustomerHome.printerStatusData`
  - `sys:route`

Default, POR-enabled, and `--max-states 10000` focused checks did not return
promptly in local measurement and were interrupted after roughly 90 seconds.

## Why This Matters

Plan 6 should start only after state-space reduction is measurable and stable.
The current extract-side slice economics are measurable, but the original
performance goal is not yet met on the real Coffee DX case. Adding CTL operators
before resolving this would risk building new temporal forms on top of a checker
path that is still too slow for the motivating invariant shape.

## Reproduction

Use the sibling Coffee DX app and a focused props file containing only:

```ts
always(
  model,
  orExpr(
    neq(readVar("local:CustomerHome.printerStatus"), lit("connected")),
    enabled(model, "PrinterSettingsDialog.onClick.optimisticDensity.seq.1"),
  ),
  { name: "densityOneRequiresConnectedPrinter" },
)
```

Build the local package first:

```bash
cd /Users/hari/proj/modality-ts
rtk pnpm build
```

Extract the Coffee DX customer home model with the focused props file:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js extract \
  app/_customer/home.tsx \
  --props /path/to/focused-density-one.props.ts \
  --out /tmp/customer-home-density-one.plan6.model.json \
  --app-model /tmp/customer-home-density-one.plan6.app.model.ts \
  --report /tmp/customer-home-density-one.plan6.extract-report.json \
  --package-json /Users/hari/proj/coffee-dx/apps/web/package.json
```

Observed extract summary:

```text
state-space≈43.3bits top:local:CustomerHome.printerStatusData(9.0),sys:pending(8.5),sys:history(2.3)
slices=properties:1 emitted:1 skipped:0 groups:1
slice-economics=largest:densityOneRequiresConnectedPrinter retained:13.6bits pruned:29.7bits topRetained:local:CustomerHome.printerStatusData(9.0) topPruned:sys:pending(8.5)
```

Then run a focused check:

```bash
cd /Users/hari/proj/modality-ts
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js check \
  /tmp/customer-home-density-one.plan6.model.json \
  /path/to/focused-density-one.props.ts \
  --report /tmp/customer-home-density-one.plan6.check-report.json
```

Also tried:

```bash
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js check \
  /tmp/customer-home-density-one.plan6.model.json \
  /path/to/focused-density-one.props.ts \
  --partial-order-reduction \
  --report /tmp/customer-home-density-one.plan6.check-por-report.json

rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js check \
  /tmp/customer-home-density-one.plan6.model.json \
  /path/to/focused-density-one.props.ts \
  --max-states 10000 \
  --report /tmp/customer-home-density-one.plan6.check-10k-report.json
```

## Expected Behavior

The focused real Coffee DX invariant should complete under 10 seconds after
extract-side property slicing, enabledness dependency narrowing, slicing
improvements, and opt-in POR.

## Observed Behavior

The focused property slice is much smaller than the pre-overhaul behavior, but
checking still did not complete promptly in local measurement.

The retained slice from `/tmp/customer-home-density-one.plan6.slices.json` was:

```text
vars=4 transitions=8 retainedBits=13.58 prunedBits=29.73
```

Top retained contributors:

```text
local:CustomerHome.printerStatusData 9.00 bits
local:CustomerHome.printerStatus     2.00 bits
sys:route                            1.58 bits
local:CustomerHome.optimisticDensity 1.00 bits
```

Retained transitions:

```text
CustomerHome.useEffect.printerStatus_printerStatusData_optimisticDensity
PrinterSettingsDialog.onClick.optimisticDensity.seq.1
PrinterSettingsDialog.onClick.optimisticDensity.seq.2
PrinterSettingsDialog.onClick.optimisticDensity.seq.3
PrinterSettingsDialog.onClick.optimisticDensity.seq.4
PrinterSettingsDialog.onClick.optimisticDensity.seq.5
PrinterSettingsDialog.onClick.optimisticDensity.seq.6
PrinterSettingsDialog.onClick.optimisticDensity.seq.7
```

The largest remaining contributor is `printerStatusData`, and the slice still
retains all density transitions, not only the queried `seq.1` enabledness
transition.

## Possible Fix Directions

- Investigate why `enabled(seq.1)` retains all `optimisticDensity.seq.*`
  sibling transitions.
- Determine whether `printerStatusData` is genuinely required for enabledness
  of `PrinterSettingsDialog.onClick.optimisticDensity.seq.1`, or whether it is
  retained through mount/effect closure that can be narrowed.
- Add a focused benchmark gate for the real Coffee DX property when the sibling
  repo is available, and keep the in-repo synthetic fixture as the portable CI
  baseline.
- Add checker diagnostics for per-transition evaluation cost inside a slice so
  slow 4-var slices are distinguishable from large-state-space slices.
- Re-run the focused check with a smaller minimized hand model that preserves
  `printerStatusData`, the mount effect, and the seven density transitions.
