# TanStack Router Support Plan 2: Navigation Extraction and Route State

## 1. Goal

Implement TanStack Router navigation classification, route-state lowering, route-tree mountedness, and replay observation on top of the adapter introduced by `260621-01-tanstack-router-route-inventory.md`.

Official documentation checked:

- https://tanstack.com/router/latest/docs/guide/navigation
- https://tanstack.com/router/v1/docs/api/router/useNavigateHook
- https://tanstack.com/router/latest/docs/how-to/navigate-with-search-params
- https://tanstack.com/router/latest/docs/guide/search-params
- https://tanstack.com/router/latest/docs/routing/route-trees

Relevant TanStack findings:

- Navigation APIs share `from` and `to` concepts; `to` is a route path and path params/search/hash/state are separate options.
- `useNavigate` returns a function that accepts a single options object.
- `router.navigate` accepts the same options shape.
- `<Navigate>` can immediately navigate on mount.
- `<Link>` uses the same route options and may navigate with only search changes.
- Search params are structured route state and can change without changing pathname.

## 2. Non-goals

- Do not implement loader execution, `beforeLoad`, route cache, redirects from loader/beforeLoad, or module-role filtering here; those belong to plan 3.
- Do not model every search parameter schema exactly. This plan should create a sound, bounded representation for navigation-relevant search behavior or explicitly caveat it.
- Do not execute TanStack Router runtime code.
- Do not change core checker semantics.
- Do not add TanStack Query support; this plan is about TanStack Router.

## 3. Current-State Findings

- JSX and imperative navigation extraction is already adapter-driven:
  - `src/extract/engine/ts/transition/navigation.ts`
  - `src/extract/engine/ts/static-navigation.ts`
- `NavigationAdapter.classifyNavigationCall` receives a callee string and statically reduced argument values from `callArgumentValue`.
- `classifyNavigationJsx` receives a tag and a map of literal-ish JSX attrs.
- Existing React Router navigation handles string `navigate("/x")`, `navigate("/x", { replace: true })`, `router.push("/x")`, `router.replace("/x")`, `router.back()`, `<Link to="...">`, and `<Navigate to="...">`.
- Existing Next navigation already demonstrates object navigation target normalization in `src/extract/sources/next/navigation.ts`.
- Existing flat route state uses `sys:route` and `sys:history`.
- `NavigationAdapter.routeTreeVars`, `lowerNavigation`, and `mountScopeForComponent` exist for frameworks with nested/tree route semantics.
- `buildLocationLowering` in `src/cli/features/extract/route-lowering.ts` assumes current/history vars are `sys:route` and `sys:history` when collecting push targets from effects.

## 4. Existing Patterns to Follow

- Put TanStack navigation classification in `src/extract/sources/tanstack-router/navigation.ts`.
- Follow Next's `resolveNavigationTarget` style for object-shaped route targets.
- Keep adapter output as generic `NavIntent` for current extraction; if extra search/hash/mask information is needed, use warnings/caveats or TanStack-specific route-tree vars rather than changing `NavIntent` unless absolutely necessary.
- Use `normalizeRouteTarget` from `src/extract/engine/ts/routes.ts` for route-domain compatibility.
- Use `locationEffect` and `applyLowerNavigation` instead of adding new effect kinds.
- Keep `StateVarDecl.role` as the trusted way to identify location vars.

## 5. Atomic Implementation Steps

1. Implement `src/extract/sources/tanstack-router/navigation.ts`.
   - Export `classifyNavigationCall`.
   - Export `classifyNavigationJsx`.
   - Export helper functions for tests: `classifyTanstackNavigationCall`, `classifyTanstackNavigationJsx`, `resolveTanstackToTarget`.

2. Classify imperative navigation calls.
   - Support `navigate({ to: "/path" })` from `useNavigate`.
   - Support `navigate({ to: "/path", replace: true })`.
   - Support `router.navigate({ to: "/path" })`.
   - Support route instance navigation if statically visible and it resolves to the same options object shape.
   - Support `router.history.back()` / `router.back()` if present in current TanStack examples or official APIs; otherwise do not guess.
   - Do not treat string-only `navigate("/path")` as TanStack Router unless official docs or real fixtures require it; that belongs to React Router semantics.

3. Classify JSX navigation.
   - Support `<Link to="/path">`.
   - Support `<Link to="/path" replace>`.
   - Support `<Navigate to="/path">`.
   - Support `params`, `search`, `hash`, and `state` props as route metadata, but route state lowering should only use the normalized `to` pathname unless search-state vars are implemented below.
   - Support omitted `to` with `search` only as same-route navigation with model slack caveat; do not silently drop it.

4. Normalize TanStack route targets.
   - Convert TanStack dynamic path syntax `$postId` to Modality `:postId` when matching route patterns.
   - Resolve absolute literal `to`.
   - For relative `to`, use explicit `from` if literal; otherwise use adapter `routeForComponent` origin where available.
   - If neither `from` nor component origin is available, over-approximate to known UI route patterns and surface a warning.
   - Ignore path params values for route-pattern selection; use `to` route pattern, not interpolated URLs.
   - Treat external URLs and `javascript:` URLs as unsupported, with a security caveat for `javascript:`.

5. Extend static argument extraction if needed.
   - If current `callArgumentValue` does not preserve object literal fields deeply enough for TanStack `navigate({ to, params, search })`, extend it in `src/extract/engine/ts/transition/plugin-calls.ts`.
   - Keep the extension generic and covered by tests; do not add TanStack-specific logic to the engine.
   - Preserve current behavior for plugin calls and React Router.

6. Extend JSX attr extraction if needed.
   - If `jsxLiteralAttrs` in `transition/navigation.ts` cannot pass enough object/function shape to TanStack classification, add generic literal object support.
   - Do not attempt to serialize arbitrary functions; use a sentinel or omit dynamic values and let the adapter over-approximate.

7. Implement route-tree vars only where they add real TanStack fidelity.
   - Use `RouteNode.metadata.tanstackRouteTree` from plan 1.
   - Add optional `sys:tanstack:match:<routeId>` or `sys:tanstack:branch` vars only if needed to model mounted layout/pathless-route persistence beyond flat `sys:route`.
   - Prefer a compact route-branch enum over many booleans if it avoids state blowup.
   - Keep `sys:route` as the primary current-location var with role `location-current`.

8. Implement `lowerNavigation` if route-tree vars exist.
   - Lower TanStack navigation into a `seq` over `sys:route`, `sys:history`, and any route-tree vars.
   - For known route targets, update the branch/match vars exactly.
   - For dynamic unknown route targets, havoc or choose over valid branch states and mark confidence `over-approx`.
   - Preserve existing `locationEffect` semantics for push/replace/back.

9. Implement `mountScopeForComponent`.
   - Use route-file/component metadata from plan 1.
   - Page component state should reset when the page route is not active.
   - Pathless/layout route state should persist while any descendant route in its branch is active.
   - Return `undefined` on ambiguity rather than guessing layout scope.

10. Add search-param state only as a bounded first pass.
    - Model `search` changes as a distinct system var only if static `validateSearch` or simple literal search keys can provide a bounded finite domain.
    - Suggested ids: `sys:tanstack:search:<routePattern>:<key>`.
    - If search functions or object values are dynamic, emit model-slack caveats and do not silently ignore navigation effects that properties might care about.
    - Do not recurse arbitrary JSON search param structures into large product domains.

11. Update TanStack harness.
    - Ensure `harness.observe` can observe `sys:route`, `sys:history`, and any TanStack route-tree/search vars added above.
    - Keep abstract replay deterministic and small.
    - Do not depend on a live TanStack Router runtime.

12. Wire navigation helpers into `tanstackRouterAdapter`.
    - Add `classifyNavigationCall`, `classifyNavigationJsx`, `routeTreeVars`, `lowerNavigation`, and `mountScopeForComponent` as implemented.

## 6. Tests to Add or Update

- Add `src/extract/sources/tanstack-router/navigation.test.ts`.
  - `navigate({ to: "/posts/$postId", params: { postId: "1" } })` classifies to `/posts/:postId`.
  - `navigate({ to: "/posts", replace: true })` classifies replace.
  - `router.navigate({ to: "/posts" })` classifies push.
  - `<Link to="/posts/$postId" params={{ postId: "1" }} />` classifies push.
  - `<Link to="/posts" replace />` classifies replace.
  - `<Navigate to="/login" />` classifies push or replace according to implemented/official semantics.
  - Search-only navigation is represented or caveated.
  - Dynamic unknown `to` over-approximates or returns unsupported with a warning, never exact.

- Add route-state tests under `src/extract/sources/tanstack-router/routes.test.ts`.
  - Location vars include file-discovered UI routes.
  - History inner domain uses push origins and targets where available.
  - Pathless/layout scopes persist across descendant pages if route-tree vars are implemented.
  - Dynamic target lowerings are `over-approx`.

- Add extraction tests.
  - A route component using `useNavigate` produces `nav` transitions.
  - A component rendering `<Link>` produces static nav transitions.
  - A pathless layout local `useState` var has a mount scope that covers descendants.

- Update `src/extract/engine/ts/transition/navigation.test.ts` only if generic literal extraction changes.

## 7. Verification

Run:

- `rtk pnpm test -- src/extract/sources/tanstack-router/navigation.test.ts src/extract/sources/tanstack-router/routes.test.ts`
- `rtk pnpm test -- src/extract/engine/ts/transition/navigation.test.ts src/extract/engine/ts/react-source-navigation.test.ts`
- `rtk pnpm test -- src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- TanStack `useNavigate`, `router.navigate`, `<Link>`, and `<Navigate>` produce navigation transitions for static route targets.
- TanStack `$param` route syntax maps cleanly to Modality `:param` route patterns.
- Navigation with `replace` does not push current route into history.
- Unknown dynamic navigation is conservative and reported, not silently exact.
- Page and layout/pathless local state mount scopes match route-tree mountedness for static fixtures.
- Existing React Router and Next navigation behavior is unchanged.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if modeling search params exactly requires a general URL-state SPI; do not wedge large JSON state into `sys:route`.
- Stop and report if route-tree mountedness cannot be represented compactly without exploding state domains.
- Stop and report if official TanStack APIs support navigation modes not expressible by `NavIntent`; propose a minimal SPI extension instead of ad hoc metadata.
- Treat dynamic params/search/hash as over-approximate unless bounded by static route definitions or overlays.
