# React Router Form Action Submit Transitions

## 1. Goal

Fix `docs/_issues/coffee-dx-form-actions-and-submit-transitions-missing.md` by modeling React Router route-action submissions as async operations.

The implementation should make React Router `<Form method="post">` submits and `useSubmit(form)` calls produce:

- a user `submit` transition that enqueues a route-action operation;
- `success` and `error` environment resolution transitions;
- a modeled `useActionData()` signal so action outcomes can trigger existing `useEffect`-based continuations;
- submit guards from submit-button `disabled` / `aria-disabled` attributes;
- useful `sys:pending.args` from static hidden form fields when extractable.

Use minimal diffs and keep the existing checker and IR semantics intact.

## 2. Non-goals

- Do not implement exact React Router server execution semantics.
- Do not inline or model every statement inside route `action()` bodies.
- Do not model arbitrary `FormData` construction, dynamic form trees, or all React Router navigation states exactly.
- Do not broaden server-only helper imports into the client interaction surface.
- Do not change existing async fetch extraction behavior except where route-action submit ops need shared helpers.
- Do not change public IR types unless a small optional field is unavoidable; prefer existing `enqueue`, `dequeue`, `resolve`, `args`, and normal state vars.

## 3. Current-State Findings

- Issue file: `docs/_issues/coffee-dx-form-actions-and-submit-transitions-missing.md`.
- Coffee DX route examples at `/Users/hari/proj/coffee-dx/apps/web` use these patterns:
  - `app/_customer/home.tsx`: `const submit = useSubmit()`, `handlePrintSubmit(e)`, `submit(form)`, `useActionData<typeof action>()`, and a `useEffect` that advances `phase` to `"complete"`.
  - `app/_drip/home.tsx` and `app/_drip2/home.tsx`: many `<Form method="post">` submits with hidden `intent`, `eventId`, `batchId`, `menuItemId`, `count`, `laneIndex`, and timer fields.
  - `app/_drip2/components/LaneIdle.tsx`: `<Form method="post" onSubmit={onStart}>` where `onStart` is intentionally a client no-op; the route action is the important operation.
  - `app/components/order-status-card.tsx`: reusable component renders `<Form>` from `action.fields.map(...)` and `cancelAction.fields.map(...)`.
- Existing async handler modeling is in `src/extract/engine/ts/transition/async.ts`, especially `transitionsFromAsyncHandler`, `effectOpForCall`, `effectCallArgs`, and `pendingIs`.
- Existing JSX handler modeling is in `src/extract/engine/ts/transition/handlers.ts`, especially `transitionsFromJsxAttribute` and `transitionsFromResolvedHandler`.
- Existing event labels and form-submit disabled guards are in:
  - `src/extract/engine/ts/transition/ui.ts`: `labelForEvent("onSubmit")` already returns `{ kind: "submit" }`.
  - `src/extract/engine/ts/transition/guards.ts`: `submitButtonDisabledAttribute()` already finds disabled submit buttons under intrinsic `<form onSubmit>`.
- The React Router adapter currently handles route discovery, module roles, and links:
  - `src/extract/sources/router/index.ts`
  - `src/extract/sources/router/discover.ts`
  - `src/extract/sources/router/module-roles.ts`
  - `src/extract/sources/router/navigation.ts`
- `src/extract/sources/router/module-roles.ts` classifies `action` as a server route export through `SERVER_EXPORT_NAMES`.
- CLI effect API discovery already supports router-adapter-discovered server ops through `NavigationAdapter.discoverEffectApis` in `src/cli/features/extract/project.ts`.
- `src/cli/features/extract/command.ts` currently wraps only the Next adapter with `discoverNextServerEffectApis` in `withServerEffectDiscovery()`.
- Existing React Router app-directory tests are in `src/cli/features/extract/command.test.ts`, especially:
  - `"extracts a React Router v7 app directory with tsconfig imports, fetch flows, Button wrappers, and theme context"`
  - `"extracts a React Router v7 app directory with aliases, fetch flows, links, and context setters"`
  - `"excludes React Router server-only imports from client pending ops"`
- Existing low-level extraction tests are in `test/extraction/extraction.test.ts`.

## 4. Exact File Paths and Relevant Symbols

- `src/extract/engine/spi/index.ts`
  - `NavigationAdapter`
  - `EffectApiDiscoveryCtx`
  - `DiscoveredEffectApi`
- `src/extract/sources/router/index.ts`
  - `reactRouterAdapter`
- `src/extract/sources/router/module-roles.ts`
  - `SERVER_EXPORT_NAMES`
  - `reactRouterModuleEntryExports`
  - `classifyReactRouterModule`
- Add new file:
  - `src/extract/sources/router/server-effects.ts`
  - suggested symbols: `discoverReactRouterActionEffectApis`, `reactRouterActionOpId`, `reactRouterActionOutcomeHints`
- Add new file:
  - `src/extract/engine/ts/transition/router-submit.ts`
  - suggested symbols: `discoverUseSubmitBindings`, `transitionsFromReactRouterForm`, `transitionsFromUseSubmitHandler`, `reactRouterActionDataVarDecls`, `bindReactRouterActionDataReads`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `visit`
  - `setters`
  - `vars`
  - `transitions`
  - `warnings`
- `src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromResolvedHandler`
  - warning emission path for no extractable handler effect
- `src/extract/engine/ts/transition/guards.ts`
  - `disabledGuardFor`
  - `submitButtonDisabledAttribute`
  - add/adjust helper so React Router `<Form>` submit transitions can use the same submit-button disabled guard logic.
- `src/extract/engine/ts/transition/ui.ts`
  - `locatorForEventAttribute`
  - `labelForEvent`
  - add a locator helper for JSX opening elements if needed.
- `src/extract/engine/ts/transition/async.ts`
  - reuse `pendingIs`, `confidenceForEffects`, `effectCallArgs` where possible.
- `src/cli/features/extract/project.ts`
  - `sourceWithReachableImports`
  - effect API discovery branch using `adapter.discoverEffectApis`
- `src/cli/features/extract/command.ts`
  - `withServerEffectDiscovery`
  - `pendingVars`
  - `buildEffectOperations`
- Tests:
  - `test/extraction/extraction.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - optionally `src/extract/sources/router/discover.test.ts` or new `src/extract/sources/router/server-effects.test.ts`
- Specs/docs:
  - `docs/_specs/02-extraction.md`
  - `docs/_issues/coffee-dx-form-actions-and-submit-transitions-missing.md`

## 5. Existing Patterns to Follow

- Follow the Next server effect discovery pattern in `src/extract/sources/next/server-effects.ts`.
- Keep operation discovery in the router adapter, not in the generic CLI.
- Follow existing transition IDs:
  - async start: `${Component}.onSubmit.${op}.start`
  - async success: `${Component}.onSubmit.${op}.success`
  - async error: `${Component}.onSubmit.${op}.error`
- Use existing `EffectIR`:
  - start: `seq([...preEffects, { kind: "enqueue", op, continuation, args }])`
  - resolution: `seq([{ kind: "dequeue", index: 0 }, ...effects])`
- Use existing `sys:pending` domain synthesis in `pendingVars`; do not hand-create pending vars.
- Follow existing route/action server-surface separation in `src/cli/features/extract/project.ts`; server `action()` imports must not become client interaction sources.
- Follow existing disabled guard composition via `combineParsedGuards`, `renderGuardFor`, and `disabledGuardFor`.
- Follow current warning style with `unextractableHandlerCaveat` only when the user-visible handler truly remains unmodeled.

## 6. Atomic Implementation Steps

1. Add React Router route-action effect discovery.
   - Implement `discoverReactRouterActionEffectApis(ctx)` in `src/extract/sources/router/server-effects.ts`.
   - Detect exported `function action(...)` and `export const action = ...`.
   - Use the route pattern from `ctx.route?.pattern` first; fall back to `ctx.inventory` only if necessary.
   - Use stable op id `ACTION ${routePattern}`.
   - Add a small helper to collect outcome hints:
     - success when a returned object has `ok: true`, `orderNumber`, or lacks an obvious error property;
     - error when a returned object has `ok: false` or an `error` property;
     - if uncertain, include both success and error outcomes.
   - Export `reactRouterActionOpId(routePattern)`.

2. Wire React Router effect discovery into the adapter.
   - In `src/extract/sources/router/index.ts`, add `discoverEffectApis: discoverReactRouterActionEffectApis` to `reactRouterAdapter()`.
   - Keep `withServerEffectDiscovery()` in `src/cli/features/extract/command.ts` Next-specific only; React Router should expose its own discovery directly.
   - Ensure `src/cli/features/extract/project.ts` discovers route action ops for server route exports without including server helper fetches as client pending ops.

3. Model `useActionData()` as a route-local read/write signal.
   - In the TS extractor, detect declarations like `const actionData = useActionData<typeof action>()`.
   - Add a state var, suggested id: `router:actionData:${safeId(route)}:${component}` or `router:actionData:${component}` if the route is not known.
   - Domain can be an enum/tagged abstraction with at least `none`, `success`, and `error`; initial must be `none`.
   - Bind the local identifier `actionData` so `dependencyReads([actionData], setters, ...)` and `valueExpr(actionData, ...)` can read the synthetic var.
   - Prefer a small read-binding abstraction if the existing `SetterBinding` map becomes awkward; otherwise use a synthetic setter binding carefully and do not create a write channel for user code.

4. Add generic helpers for React Router submit op metadata.
   - Add `src/extract/engine/ts/transition/router-submit.ts`.
   - Implement helpers to:
     - identify React Router `Form` JSX elements by tag name `Form`;
     - treat `method` missing or `method="get"` as non-action submit and skip for this fix;
     - treat `method="post"` and other non-GET methods as current-route action submits;
     - derive op id `ACTION ${route}` using the current extraction route or router route for component;
     - collect static hidden inputs under the form into `args`;
     - collect `intent` specially when present, but keep it in `args` rather than in the op id;
     - produce a submit locator from the form or first submit button when available.

5. Synthesize `<Form method="post">` transitions.
   - In `react-source-transitions.ts`, when visiting a JSX opening/self-closing element for tag `Form`, call `transitionsFromReactRouterForm`.
   - Generate a start user transition and success/error env transitions.
   - Start transition:
     - `cls: "user"`
     - `label: { kind: "submit", locator? }`
     - guard combines render guard and submit-button disabled guard.
     - effect enqueues `ACTION ${route}` with continuation `${Component}.onSubmit.ACTION ${route}.cont`.
     - args include static hidden fields.
   - Success/error transitions:
     - `cls: "env"`
     - `label: { kind: "resolve", op, outcome }`
     - guard `pendingIs(op)`
     - effect dequeues pending index 0 and assigns the synthetic `useActionData` var to `success` or `error` when that var exists for the component/route.
   - If no `useActionData` binding exists, still emit success/error dequeue transitions with no extra writes.

6. Synthesize `useSubmit(form)` transitions inside submit handlers.
   - Detect `const submit = useSubmit()` bindings in `react-source-transitions.ts`.
   - In `transitionsFromResolvedHandler`, before ordinary async and setter summarization, detect calls to a bound submit function.
   - Accept these shapes:
     - `submit(form)`
     - `submit(e.currentTarget)`
     - `submit(e.currentTarget, { method: "post" })`
   - For a JSX `onSubmit` handler that calls `useSubmit`, derive the form args from the JSX form element hidden inputs when possible.
   - Ignore `e.preventDefault()` and unsupported non-modeled awaits before `submit(...)` unless they write modeled state or await a configured effect API.
   - If modeled state writes occur before `submit(...)`, summarize them as pre-effects before the enqueue.
   - Stop and report if there is an awaited configured effect API before the submit call; do not silently reorder async behavior.

7. Avoid duplicate and noisy handler reporting.
   - If a React Router `<Form>` submit transition was synthesized for a form with `onSubmit={onStart}` and the handler itself has no modeled effect, do not also emit an `Unextractable handler LaneIdle.onSubmit [no-extractable-effect]` warning.
   - If a handler contains both a modeled `useSubmit(...)` and no other modeled effects, classify it through the generated submit transitions.
   - Preserve warnings for truly unsupported submit handlers that neither synthesize a form action nor call `useSubmit`.

8. Keep args extraction conservative.
   - Extract hidden inputs when:
     - `name` is a string literal attribute;
     - `value` is a string/number/boolean literal, template-literal route pattern, or a modeled state/prop read supported by existing `valueExpr`;
     - JSX expression is `JSON.stringify(...)`, `String(...)`, or `Number(...)`; represent unsupported values as token args rather than failing the whole transition.
   - For mapped hidden fields such as `action.fields.map(...)`, emit the submit transition even if args are `{}` or tokenized; do not make exact field-map support a blocker.

9. Update extraction reports and effect operation provenance.
   - Ensure `report.effectOperations` includes `ACTION ${routePattern}` with origin `source`.
   - Ensure `sys:pending.domain.inner.fields.opId.values` includes route action ops discovered from route `action` exports.
   - Ensure `sys:pending.domain.inner.fields.args.fields.intent` is refined to literal intent values when static hidden inputs were extracted.

10. Update docs/specs and close the issue.
   - Add a short React Router form-actions subsection to `docs/_specs/02-extraction.md`.
   - Update `docs/_issues/coffee-dx-form-actions-and-submit-transitions-missing.md` with implementation notes and verification status, or move it to the project’s closed issue convention if one exists.

## 7. Per-Step Files to Edit

- Step 1:
  - Add `src/extract/sources/router/server-effects.ts`
  - Add tests in `src/extract/sources/router/server-effects.test.ts` or `src/extract/sources/router/discover.test.ts`
- Step 2:
  - Edit `src/extract/sources/router/index.ts`
  - Possibly edit `src/cli/features/extract/command.test.ts`
- Step 3:
  - Edit `src/extract/engine/ts/react-source-transitions.ts`
  - Possibly edit `src/extract/engine/ts/types.ts` if a read-binding type is introduced
  - Possibly edit `src/extract/engine/ts/transition/effects.ts` only if dependency reads need a helper that accepts non-setter read bindings
- Step 4:
  - Add `src/extract/engine/ts/transition/router-submit.ts`
  - Possibly edit `src/extract/engine/ts/transition/ui.ts`
  - Possibly edit `src/extract/engine/ts/transition/guards.ts`
- Step 5:
  - Edit `src/extract/engine/ts/react-source-transitions.ts`
  - Edit `src/extract/engine/ts/transition/router-submit.ts`
- Step 6:
  - Edit `src/extract/engine/ts/transition/handlers.ts`
  - Edit `src/extract/engine/ts/transition/router-submit.ts`
  - Reuse helpers from `src/extract/engine/ts/transition/async.ts`
- Step 7:
  - Edit `src/extract/engine/ts/react-source-transitions.ts`
  - Edit `src/extract/engine/ts/transition/handlers.ts`
- Step 8:
  - Edit `src/extract/engine/ts/transition/router-submit.ts`
  - Reuse `valueExpr` from `src/extract/engine/ts/transition/expressions.ts`
- Step 9:
  - Edit tests in `src/cli/features/extract/command.test.ts`
  - Only edit `src/cli/features/extract/command.ts` if effect operation provenance or pending var synthesis misses discovered route-action ops
- Step 10:
  - Edit `docs/_specs/02-extraction.md`
  - Edit `docs/_issues/coffee-dx-form-actions-and-submit-transitions-missing.md`

## 8. Acceptance Criteria

- Extracting a React Router route with `export async function action(...)` and `<Form method="post">` produces `ACTION ${route}` in `sys:pending` op values.
- A `<Form method="post">` submit produces one user start transition and success/error env transitions.
- A `useSubmit(form)` call inside an `onSubmit` handler produces the same route-action submit operation.
- Submit-button disabled guards apply to React Router `<Form>` synthesized transitions.
- `useActionData()` creates a modeled signal with initial `none`; action success/error env transitions assign `success`/`error`.
- `useEffect(..., [actionData])` can be triggered by action outcomes through existing internal effect extraction.
- Coffee-like `intent` hidden inputs appear in pending args when statically extractable.
- Existing fetch, Link navigation, context, timer, SWR/Jotai/Zustand, and Next extraction tests continue to pass.
- Server-only route action helper imports do not leak server fetch/call operations into client pending ops.
- Previously unextractable no-op form submit handlers such as `LaneIdle.onSubmit` are not reported when the form action itself is modeled.

## 9. Tests to Add or Update

- Add low-level extraction tests in `test/extraction/extraction.test.ts`:
  - React Router `<Form method="post">` with static hidden `intent` emits `ACTION /` start/success/error transitions and submit label.
  - React Router `<Form method="post">` disabled submit button contributes a guard to the start transition.
  - `useActionData()` plus `useEffect(..., [actionData])` creates an actionData var and an internal continuation transition after success/error.
  - `useSubmit(e.currentTarget)` in an `onSubmit` handler emits a route-action start transition and does not report the handler as unextractable.

- Add CLI integration tests in `src/cli/features/extract/command.test.ts`:
  - React Router v7 app directory with route `action()`, child component `<Form method="post">`, and hidden `intent="brew-start"`:
    - `report.effectOperations` contains `ACTION /drip`;
    - `sys:pending` op values contain `ACTION /drip`;
    - pending args include `intent` with `brew-start`.
  - Customer-like route with `useSubmit()` and `useActionData()`:
    - transition ids include `CustomerHome.onSubmit.ACTION /customer.start`, `.success`, `.error` or the stable id shape chosen by implementation;
    - a success resolution writes the synthetic actionData var;
    - `local:CustomerHome.phase` can become `"complete"` or is at least included in a precise/over-approx internal effect triggered by actionData.
  - Server-only action helper test:
    - route `action()` awaits a server helper that fetches `https://example.com/server`;
    - client component has `<Form method="post">`;
    - model includes `ACTION /items`;
    - model does not include `GET https://example.com/server` or `POST https://example.com/server` as client pending ops.

- Add router discovery tests:
  - action export function and const action are discovered.
  - no route pattern means no op and no crash.
  - object returns with `ok: false` or `error` set error outcome hints.

- Update existing tests only when expected output legitimately changes:
  - `src/cli/features/extract/command.test.ts` React Router app-directory tests may gain `ACTION` ops only if those fixtures include route `action()` exports.

## 10. Verification Commands

Run these from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- src/extract/sources/router/discover.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
rtk pnpm test
```

Optional Coffee DX probes after building/linking the local package as appropriate:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality extract app/_customer/home.tsx --report .modality/probe-customer.extraction-report.json
rtk pnpm exec modality extract app/_drip2/home.tsx --report .modality/probe-drip2.extraction-report.json
```

Expected probe checks:

- customer `sys:pending` includes an `ACTION ...customer...` route action op, not only `GET /cashier/orders-history?:id`;
- drip2 no longer reports form action handlers such as `LaneIdle.onSubmit` as unextractable solely because the client handler is a no-op;
- submit transitions include `intent` args for brew start/complete/cancel/timer forms when statically recoverable.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if the implementation requires changing core IR semantics; this plan assumes existing `enqueue`/`resolve`/`args` are sufficient.
- Stop and report if `useActionData()` cannot be represented without a broad read-binding refactor. A small synthetic read binding is acceptable; a cross-extractor rewrite is not.
- Stop and report if React Router `<Form>` import identity becomes necessary to avoid false positives. Existing Link extraction is tag-name based, so tag-name based `Form` handling is acceptable for this change unless tests show collisions.
- Treat exact hidden field extraction from `fields.map(...)` as optional. The submit transition itself is required; exact args for mapped arrays should not block the fix.
- Do not model server route action internals as client async operations. The route action operation is the abstraction boundary.
- Include both success and error outcomes when static action return analysis is uncertain. Prefer over-approximation with exact operation identity over silently omitting an outcome.
- If the generated transition id shape differs from the suggested examples, update tests to assert stable behavior rather than brittle punctuation, but keep ids readable and consistent with existing async handler ids.
