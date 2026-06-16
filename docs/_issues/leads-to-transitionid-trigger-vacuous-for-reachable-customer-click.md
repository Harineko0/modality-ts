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
