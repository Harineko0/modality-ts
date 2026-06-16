# Coffee DX WebSocket effects are unextractable

## Summary

Coffee DX drip and cashier pages derive most UI state from `WebSocket` `onmessage`, `onopen`, `onclose`, and `onerror` callbacks inside `useEffect`. Extraction reports classify those effects as unextractable, leaving the models unable to represent snapshots, order updates, brew-unit updates, reconnect behavior, or connection errors.

## Reproduction

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality extract app/_drip/home.tsx --report .modality/probe-drip.extraction-report.json
pnpm exec modality extract app/_cashier/home.tsx --report .modality/probe-cashier.extraction-report.json
```

Observed reports:

- `DripHome.useEffect`: `Unextractable effect DripHome.useEffect`
- `CashierHome.useEffect`: `Unextractable effect CashierHome.useEffect`

The cashier model has zero transitions, despite runtime close/cancel forms and live order state changes.

## Impact

This blocks useful properties for:

- snapshot loading eventually making `isSnapshotLoaded === true`;
- connection lifecycle and reconnect invariants;
- order status updates removing completed/cancelled orders;
- brew-unit events updating production counts;
- cashier completion only being available for server-ready orders.

## Expected capability

Provide a first-class environment-event model for WebSocket callbacks, or an overlay/config pattern that can declare message variants and bind them to the callback state updates without hand-authoring the entire route model.
