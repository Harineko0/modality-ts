# React Router Form Action Submit Review Fixes

## 1. Goal

Fix the three review findings from the staged React Router form-action implementation:

- `useSubmit(...)` transitions must enqueue the route action for the component's resolved route, not the global extraction route.
- `<Form>` without an explicit non-GET `method` must not be modeled as a route action submit.
- Hidden input values using supported wrappers such as `JSON.stringify(...)`, `String(...)`, and `Number(...)` must be extracted when their inner argument is extractable.

Keep the existing route-action abstraction and IR semantics intact.

## 2. Non-goals

- Do not redesign React Router route/action discovery.
- Do not model React Router GET form navigation in this fix.
- Do not change async fetch extraction, pending queue semantics, checker semantics, or public IR types.
- Do not broaden `<Form>` import identity handling beyond the existing tag-name approach unless a local test proves tag-name handling cannot be made correct.
- Do not implement exact `FormData` serialization or exact `JSON.stringify` runtime output for arbitrary objects.
- Do not modify unrelated tests or apply formatting-only churn outside touched files.

## 3. Current-State Findings

- `src/extract/engine/ts/react-source-transitions.ts` builds `routerSubmitContext(component)` with `route` set to the global extraction route.
- `transitionsFromReactRouterForm(...)` already receives `formRoute = routePattern ?? route`, so plain `<Form method="post">` JSX uses component route resolution correctly.
- `transitionsFromUseSubmitHandler(...)` receives `routerCtx.route` from `src/extract/engine/ts/transition/handlers.ts`, so `useSubmit(...)` handlers do not use `resolveComponentRoutePattern(...)`.
- A probe confirmed a component mapped to `/customer` can emit:
  - `Customer.onSubmit.ACTION /.start`
  - `Customer.onSubmit.ACTION /.success`
  - `Customer.onSubmit.ACTION /.error`
  when the expected operation is `ACTION /customer`.
- `isActionFormMethod(...)` in `src/extract/engine/ts/transition/router-submit.ts` currently returns `true` when `method` is absent.
- A probe confirmed `<Form><button type="submit" /></Form>` emits `Home.onSubmit.ACTION /.start`; the original plan required missing method and `method="get"` to be skipped.
- `hiddenInputValue(...)` checks `ts.isIdentifier(expr.expression)` and then compares `expr.expression.text` to `"JSON.stringify"`, which cannot work for `JSON.stringify(...)` because it is a property access expression.
- A probe confirmed `value={JSON.stringify("x")}` currently becomes `{ kind: "lit", value: "token:payload" }`.
- Focused tests and typecheck currently pass:
  - `rtk pnpm test -- test/extraction/extraction.test.ts src/extract/sources/router/server-effects.test.ts src/cli/features/extract/command.test.ts`
  - `rtk pnpm typecheck`

## 4. Exact File Paths and Relevant Symbols

- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `routerSubmitContext`
  - `resolveComponentRoutePattern`
  - `routePattern`
  - `transitionsFromReactRouterForm`
  - `transitionsFromJsxAttribute`
- `src/extract/engine/ts/transition/handlers.ts`
  - `HandlerExtractionContext`
  - `transitionsFromResolvedHandler`
  - call to `transitionsFromUseSubmitHandler`
- `src/extract/engine/ts/transition/router-submit.ts`
  - `ReactRouterSubmitContext`
  - `isActionFormMethod`
  - `hiddenInputValue`
  - `transitionsFromUseSubmitHandler`
  - `routeActionOpId`
- `src/extract/engine/ts/transition/ui.ts`
  - `stringAttribute`
- Tests:
  - `test/extraction/extraction.test.ts`
  - `src/cli/features/extract/command.test.ts`

## 5. Existing Patterns to Follow

- Follow the existing `<Form method="post">` route selection pattern in `react-source-transitions.ts`: derive `routePattern` with `resolveComponentRoutePattern(routerPlugin, inventory, activeComponent)` and fall back to the extraction `route`.
- Keep `ReactRouterSubmitContext` as the shared carrier for submit-related extraction state; it is already passed through `HandlerExtractionContext`.
- Follow existing route IDs and transition IDs:
  - `${Component}.onSubmit.ACTION ${route}.start`
  - `${Component}.onSubmit.ACTION ${route}.success`
  - `${Component}.onSubmit.ACTION ${route}.error`
- Follow existing hidden input extraction style:
  - extract literal/string/number/boolean values when supported by `valueExpr`;
  - use token fallback only when the value is unsupported.
- Follow existing test style in `test/extraction/extraction.test.ts`: use `extractReactSourceTransitions(...)` for direct extractor behavior.
- Follow existing CLI integration style in `src/cli/features/extract/command.test.ts`: create temporary React Router app fixtures with `routes.ts`, route modules, and `runExtractCommand(...)`.

## 6. Atomic Implementation Steps

1. Make route action submit context route-aware per component.
   - Change `routerSubmitContext(component)` in `react-source-transitions.ts` so it computes:
     - `const componentRoute = resolveComponentRoutePattern(routerPlugin, inventory, component) ?? route`
   - Put `componentRoute` into `ReactRouterSubmitContext.route`.
   - Preserve `component`, `actionDataVarId`, `submitBindings`, and `modeledSubmitHandlers` as-is.
   - This should make both direct JSX `<Form>` and handler-based `useSubmit(...)` share the same route resolution logic.

2. Remove redundant route plumbing if it becomes stale.
   - In `handlers.ts`, the call to `transitionsFromUseSubmitHandler(...)` currently passes both `routerCtx.route` and `routerCtx`.
   - Prefer using `ctx.route` inside `transitionsFromUseSubmitHandler(...)` and removing the separate `route` parameter if that keeps the API simpler.
   - If removing the parameter causes a broad diff, keep the parameter but ensure the caller passes the route-aware `routerCtx.route`.

3. Require explicit non-GET form methods for route action submit modeling.
   - Update `isActionFormMethod(...)` so an absent method returns `false`.
   - Keep `method="get"` and case variants such as `method="GET"` skipped.
   - Keep `method="post"` and other non-GET string literal methods modeled.
   - Leave dynamic `method={...}` unsupported unless existing `stringAttribute(...)` already extracts it; do not add dynamic method modeling in this fix.

4. Fix supported wrapper detection for hidden input values.
   - Add a small helper in `router-submit.ts`, for example `supportedHiddenValueWrapper(call: ts.CallExpression): "JSON.stringify" | "String" | "Number" | undefined`.
   - Recognize:
     - identifier calls: `String(value)`, `Number(value)`;
     - property access call: `JSON.stringify(value)`.
   - Keep the operation conservative:
     - if the first argument is extractable by `valueExpr(...)`, return that bound expression;
     - otherwise fall back to the existing token behavior.
   - Do not attempt to serialize arbitrary object literals to JSON strings; representing the inner extractable value is sufficient for this abstraction unless tests or existing semantics require the exact string.

5. Add low-level regression tests for the three findings.
   - Add a test that uses inventory with routes `/` and `/customer`, component `Customer`, and an intrinsic `<form onSubmit={handler}>` where `handler` calls `submit(e.currentTarget)`.
   - Assert the generated transition IDs include `Customer.onSubmit.ACTION /customer.start` and do not include `Customer.onSubmit.ACTION /.start`.
   - Add a test for `<Form>` without `method`; assert no `ACTION /` transitions are emitted.
   - Add a test for `<Form method="get">`; assert no `ACTION /` transitions are emitted if this exact case is not already covered.
   - Add a test for hidden input wrapper extraction:
     - `value={JSON.stringify("brew-start")}` should produce an enqueue arg that is not `token:intent`.
     - Also cover `String("brew-start")` or `Number(2)` if this can be done without making the test brittle.

6. Add one CLI integration regression for route-aware `useSubmit`.
   - Create a temporary React Router app with routes `/` and `/customer`.
   - Put `useSubmit(...)` in `routes/customer.tsx`.
   - Run extraction in a way that previously would use the global route `/` for the handler.
   - Assert pending op values and transition IDs include `ACTION /customer`.
   - Assert no transition ID includes `ACTION /` for that customer submit handler.

7. Re-run focused verification.
   - Run the direct extraction tests and CLI extract tests.
   - Run typecheck.
   - Only broaden to full `pnpm test` if focused tests pass and the change touched shared extractor behavior in a way that could affect non-router handlers.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/extract/engine/ts/react-source-transitions.ts`
- Step 2:
  - `src/extract/engine/ts/transition/handlers.ts`
  - `src/extract/engine/ts/transition/router-submit.ts`
- Step 3:
  - `src/extract/engine/ts/transition/router-submit.ts`
- Step 4:
  - `src/extract/engine/ts/transition/router-submit.ts`
- Step 5:
  - `test/extraction/extraction.test.ts`
- Step 6:
  - `src/cli/features/extract/command.test.ts`
- Step 7:
  - no code edits unless verification exposes failures

## 8. Acceptance Criteria

- In a multi-route React Router inventory, `useSubmit(e.currentTarget)` inside a component mapped to `/customer` emits `ACTION /customer`, not `ACTION /`.
- `<Form>` with no `method` emits no route-action submit transitions.
- `<Form method="get">` emits no route-action submit transitions.
- `<Form method="post">` behavior remains intact:
  - start transition enqueues `ACTION <route>`;
  - success/error env transitions are emitted;
  - disabled submit button guards still apply;
  - static hidden fields still appear in pending args when extractable.
- Hidden input values wrapped in `JSON.stringify(...)`, `String(...)`, or `Number(...)` are extracted when their first argument is supported by `valueExpr(...)`.
- Existing tests added by the staged route-action implementation continue to pass.
- No public IR type changes are introduced.

## 9. Tests to Add or Update

- `test/extraction/extraction.test.ts`
  - Add `useSubmit uses component route rather than global extraction route`.
  - Add `skips React Router Form without explicit method`.
  - Add `skips React Router Form method get`.
  - Add `extracts hidden input wrapper values for action args`.

- `src/cli/features/extract/command.test.ts`
  - Add `models useSubmit route action on the matched route in multi-route apps`.
  - Fixture shape:
    - `app/routes.ts` includes both `/` and `/customer`.
    - `routes/home.tsx` exports a simple default route.
    - `routes/customer.tsx` exports `action()` and default `Customer` component with `useSubmit()`.
    - Customer submit handler calls `submit(e.currentTarget)` or `submit(e.currentTarget, { method: "post" })`.
  - Assertions:
    - `sys:pending` op values contain `ACTION /customer`.
    - customer submit transition IDs contain `ACTION /customer`.
    - customer submit transition IDs do not contain `ACTION /`.

## 10. Verification Commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm typecheck
```

If those pass and the implementation changed handler signatures or shared extraction helpers, also run:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts src/extract/sources/router/server-effects.test.ts src/cli/features/extract/command.test.ts
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
```

Optional quick probes after implementation:

```bash
rtk pnpm exec tsx -e "import { extractReactSourceTransitions } from './src/extract/engine/ts/react-source-transitions.ts'; import { reactRouterAdapter } from './src/extract/sources/router/index.ts'; const result = extractReactSourceTransitions(\`import { useSubmit } from 'react-router'; export default function Customer() { const submit = useSubmit(); const onSubmit = (e) => { e.preventDefault(); submit(e.currentTarget); }; return <form onSubmit={onSubmit} />; }\`, { route: '/', routePatterns: ['/', '/customer'], fileName: 'routes/customer.tsx', effectApis: ['ACTION /', 'ACTION /customer'], routerPlugin: reactRouterAdapter(), inventory: { routes: [{ pattern: '/', kind: 'page', file: 'routes/home.tsx' }, { pattern: '/customer', kind: 'page', file: 'routes/customer.tsx' }] } }); console.log(result.transitions.map(t => t.id).filter(id => id.includes('ACTION')).join('\\n'));"
rtk pnpm exec tsx -e "import { extractReactSourceTransitions } from './src/extract/engine/ts/react-source-transitions.ts'; import { reactRouterAdapter } from './src/extract/sources/router/index.ts'; const result = extractReactSourceTransitions(\`import { Form } from 'react-router'; export default function Home() { return <Form><button type=\\\"submit\\\">Search</button></Form>; }\`, { route: '/', effectApis: ['ACTION /'], routerPlugin: reactRouterAdapter() }); console.log(result.transitions.map(t => t.id).filter(id => id.includes('ACTION')).join('\\n') || 'no action transitions');"
```

Expected probe results:

- The first probe prints `Customer.onSubmit.ACTION /customer.*` only.
- The second probe prints `no action transitions`.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if `routerSubmitContext(component)` cannot access `routerPlugin` or `inventory` without a broad extractor refactor.
- Stop and report if route resolution for `useSubmit(...)` needs file-path route mapping rather than component-name route mapping; this plan assumes the existing `routeForComponent(...)` logic is sufficient for the current abstraction.
- Stop and report if requiring explicit `method` breaks an existing test whose fixture intentionally relies on React Router's default action submission behavior; clarify whether this project wants default GET forms modeled as navigation or skipped.
- Stop and report if hidden wrapper extraction needs exact serialized JSON string semantics. This plan intentionally keeps the existing abstraction of pending args rather than implementing full serialization.
- Do not suppress unextractable-handler warnings broadly. Only keep the existing suppression when a submit transition was actually synthesized.
- Do not add fallback `ACTION /` operations just to satisfy missing route resolution; that would reintroduce the reviewed bug.
