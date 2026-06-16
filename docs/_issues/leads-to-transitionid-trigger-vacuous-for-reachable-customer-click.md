# Leads-To TransitionId Trigger Is Vacuous For Reachable Customer Click

## Summary

While adding Coffee DX properties, a `leadsToWithin` property whose trigger was the
reachable transition `CustomerHome.onClick.isPrinterSettingsOpen` reported:

```text
printerSettingsOpenClickImmediatelyOpensDialog vacuous-warning
Trigger never fired within bounds
```

The same property file also has a `reachable` property for
`local:CustomerHome.isPrinterSettingsOpen === true`, and that witness trace is exactly
`CustomerHome.onClick.isPrinterSettingsOpen`.

## Reproduction

In `/Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.mjs`, add:

```js
leadsToWithin(
  model,
  stepTransitionId("CustomerHome.onClick.isPrinterSettingsOpen"),
  eq(readVar("local:CustomerHome.isPrinterSettingsOpen"), lit(true)),
  {
    name: "printerSettingsOpenClickImmediatelyOpensDialog",
    budget: { steps: 0, environment: 0 },
    enabledTransitions: ["CustomerHome.onClick.isPrinterSettingsOpen"],
  },
)
```

Then run:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality check .modality/probe-customer.model.json app/_customer/home.props.mjs \
  --max-states 50000 --max-edges 150000
```

## Observed Behavior

The property returns a vacuity warning saying the trigger never fired, even though the
transition is reachable and used by another property's witness trace.

## Expected Behavior

`leadsToWithin` should treat a reachable `transitionId` trigger as fired and verify the
post-state goal for the immediate successor, or produce a diagnostic explaining why the
trigger transition was excluded from the response search.

## Impact

This makes simple bounded response properties unreliable for some route-local user
clicks, so property authors have to fall back to `reachable` plus `alwaysStep` checks
instead of directly expressing "this click immediately causes this state."

## Current status (2026-06-17)

An in-repo minimal regression matching the reported shape does **not** reproduce the
vacuity warning on current HEAD. The fixture lives in
`test/checker/checker.test.ts` (`treats route-local transitionId leadsToWithin triggers as
fired`) and passes:

```bash
rtk pnpm build:rust
rtk pnpm vitest run test/checker/checker.test.ts -t "route-local transitionId"
```

Both `printerSettingsOpenReachable` and
`printerSettingsOpenClickImmediatelyOpensDialog` verify as expected (`reachable` and
`verified-within-bounds` respectively).

A follow-up check of
`/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs` found that the full
discovered Drip2 check still fails, but not because of this `leadsToWithin`
transition-id trigger behavior. With
`.modality/models/app/_drip2/home.model.json`,
`drip2CancelClickImmediatelyOpensDialog` is `verified-within-bounds`. The failing
properties are `drip2LaneSlotsRemainEmptyInExtractedModel` and
`drip2TimerResetAlwaysEnabled`; the discovered model initializes
`local:DripHome.laneSlots` to `"many"` and has no transition with id
`LaneTimer.onClick.draftSec`.

If the original CustomerHome property still produces `Trigger never fired within
bounds`, use its generated model artifact directly to build a more faithful in-repo
regression.
