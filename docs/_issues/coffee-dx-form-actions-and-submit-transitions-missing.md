# Coffee DX form actions and submit transitions are missing

## Summary

Several Coffee DX routes use React Router `Form`, `useSubmit`, and action functions for important behavior. The extracted models mostly omit these submits as async operations, so properties cannot connect user submits to action outcomes.

Examples:

- `app/_customer/home.tsx` uses `useSubmit` in `handlePrintSubmit`, then `useActionData` drives the `complete` phase.
- `app/_drip/home.tsx` and `app/_drip2/home.tsx` submit brew start/complete/cancel/timer intents.
- `app/_cashier/home.tsx` submits complete/cancel intents for orders.

## Reproduction

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality extract app/_customer/home.tsx --report .modality/probe-customer.extraction-report.json
pnpm exec modality extract app/_drip2/home.tsx --report .modality/probe-drip2.extraction-report.json
```

Observed behavior (before fix):

- `sys:pending` for the customer route contains only `GET /cashier/orders-history?:id`; no order creation submit operation appears.
- drip2 reports many submit/action-adjacent handlers as `unextractable`, including `LaneIdle.onSubmit`.

## Impact

This blocks response properties such as:

- after confirming an order, action success leads to `phase === "complete"`;
- invalid action responses leave the route in confirm with an error;
- brew start enqueues exactly one DO operation;
- complete/cancel buttons cannot double-submit the same order or batch.

## Expected capability

React Router form submissions and `useSubmit(form)` should be modeled as named async operations with success/error outcomes that can feed `useActionData` continuations.

## Resolution

Implemented in the React Router adapter and TS transition extractor:

- Route `action()` exports discover `ACTION <routePattern>` ops (`src/extract/sources/router/server-effects.ts`).
- `<Form method="post">` and `useSubmit(...)` synthesize user `submit` starts plus success/error env resolutions.
- `useActionData()` binds a `router:actionData:*` enum for `useEffect` continuations.
- Static hidden `intent` (and similar) fields refine `sys:pending.args` when extractable.

Verification: `pnpm test`, `pnpm typecheck`, `pnpm architecture`, and focused tests in `test/extraction/extraction.test.ts`, `src/extract/sources/router/server-effects.test.ts`, and `src/cli/features/extract/command.test.ts`.
