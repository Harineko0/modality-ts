# 260615 — Navigation Overhaul · Phase 03: Make the Engine Framework-Blind

Prereq: Phases 00–02. This is the **full decouple** (decision #1). The engine stops knowing
react-router; it asks the adapter. **Keep** `sys:route`/`sys:history` literal names in
reads/writes. May shift route-binding output → update affected engine unit tests **in this
phase**. Full golden regen is Phase 05.

> **Architectural constraint (read first):** `loadExtractionProject` concatenates all source
> files into a single `sourceText` with one `entryFile` (`command.ts:135`). The engine therefore
> has component *names* but **no per-component file boundary**. Route→component binding must stay
> **name-based**, done by the adapter (`routeForComponent(name, inventory)`), not file-based.
> Preserving per-file boundaries is a separate, larger refactor — **out of scope**.

## Goal

Remove all hardcoded react-router knowledge from the extraction engine and route navigation
recognition + route binding through the adapter (`classifyNavigationCall`,
`classifyNavigationJsx`, `routeForFile`) and the `RouteInventory`.

## Non-goals

- Do not change the location lowering / route domain (Phase 04).
- Do not synthesize redirect transitions (Phase 04).
- Do not touch `check/**`, IR types, validator, or TLA+ export.

## Current-state findings (the coupling to remove)

- `src/extract/engine/ts/transition/navigation.ts`:
  - `navigationCall(call, routerPlugin, routePatterns)` (`:54-83`) calls the plugin **then falls
    back** to hardcoded `navigate`/`.push`/`.replace`/`.back` (`:67-82`). Remove the fallback.
  - `linkNavigationTransition` (`:85-117`) hardcodes `tagName === "Link"` and the `to` attr.
    Replace with `adapter.classifyNavigationJsx(tag, attrs)`.
  - `firstNavigationInStatements` (`:130-146`) calls `navigationCall(node, undefined, …)` — must
    receive the adapter.
- `src/extract/engine/ts/static-navigation.ts:41` hardcodes `tag === "Link"` and uses
  `routeMountGuard(component, routePatterns)` / `routeMountReads` (name heuristics).
- `src/extract/engine/ts/routes.ts:88-109` — `routeForComponent` / `normalizeComponentRouteName`
  name-matching, and `routeMountGuard`/`routeMountReads` built on it. **Pure pattern utilities**
  in the same file (`normalizeRouteTarget`, `routePatternMatches`, `routePatternSpecificity`,
  `templateRoutePattern`, `routeTargetValue`, `jsxRouteTarget`) are framework-agnostic — **keep
  them**.
- `src/extract/engine/ts/transition/async.ts` and `…/statement-summary.ts` import
  `navigationCall` — re-route through the adapter.
- `src/extract/engine/ts/react-source-transitions.ts` (`:77`, `:108`, `:258`, `:393`, `:438`)
  threads `routePatterns` and (in some places) `routerPlugin` — this is where the adapter +
  inventory + current `fileName` get plumbed.

## Files to edit

- `src/extract/engine/ts/routes.ts`
- `src/extract/engine/ts/transition/navigation.ts`
- `src/extract/engine/ts/static-navigation.ts`
- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- affected `*.test.ts` under `src/extract/engine`

## Atomic steps

1. **`routes.ts` — split keep/remove.** Delete `routeForComponent`, `normalizeComponentRouteName`,
   `normalizeRouteComponentName`. Change `routeMountGuard`/`routeMountReads` to take a **resolved
   route pattern** (`string | undefined`) instead of `(component, routePatterns)`:
   `routeMountGuard(routePattern)` → `eq(sys:route, lit(routePattern))` or `lit(true)`. Keep the
   pure pattern utilities untouched.
2. **Thread adapter + inventory** through `react-source-transitions.ts`: add
   `adapter?: NavigationAdapter`, `inventory?: RouteInventory` to its options (it already has
   `routePatterns`/`routerPlugin`). For each component, resolve `routePattern` once via
   `adapter?.routeForComponent(componentName, inventory)` and pass it down to nav/static-nav
   builders (name-based — see the constraint note above).
3. **`transition/navigation.ts` — calls.** Replace `navigationCall(...)` internals with
   `adapter?.classifyNavigationCall(callName(call.expression), call.arguments.map(callArgumentValue))`;
   drop the hardcoded fallback. If adapter returns `"unsupported"`/absent → not a navigation.
4. **`transition/navigation.ts` — JSX.** Rewrite `linkNavigationTransition` to
   `navigationJsxTransition`: for any JSX element, build `attrs` (resolved literal map) and call
   `adapter?.classifyNavigationJsx(tag, attrs)`; build the transition from the returned
   `NavIntent` using `routeMountGuard(routePattern)` / `routeMountReads(routePattern)`.
5. **`static-navigation.ts`.** Remove the `tag === "Link"` special-case; for JSX elements use
   `adapter.classifyNavigationJsx`. Replace `routeMountGuard(component, routePatterns)` with the
   resolved-pattern variant.
6. **`async.ts` + `statement-summary.ts`.** Pass the adapter into their `navigationCall`/
   `firstNavigationInStatements` usages (signature now `(call, adapter, routePatterns)` or
   inventory-aware). No fallback logic.
7. **Keep `sys:route`/`sys:history`** literal strings in all `reads`/`writes`/effect `to`
   construction (unchanged — the kept convention).
8. **Update engine unit tests** that asserted name-heuristic mount guards or `<Link>` specifics;
   re-point them at adapter-driven binding (pass a real `reactRouterAdapter()` + an `inventory`
   in the test setup). Run targeted tests.

## Acceptance criteria

- `grep -rn "navigate\b\|\"Link\"\|react-router\|\.push\|\.replace\|\.back" src/extract/engine`
  returns **no** framework-navigation literals (only generic identifiers / adapter calls).
- The engine compiles with `adapter`/`inventory` optional; when absent, navigation extraction
  simply produces no nav transitions (no crash).
- For an app fixture wired with `reactRouterAdapter()`, the same navigation transitions are
  produced as before; route-mount guards now come from `adapter.routeForComponent(name,
  inventory)` (name→pattern via the inventory) rather than the engine's old in-line heuristic.

## Tests to add/update

- Update engine nav tests to inject a real adapter + inventory.
- Add a test that with `adapter = undefined`, JSX/`navigate()` produce no nav transitions
  (proves the engine has no built-in fallback).

## Verification

```bash
rtk pnpm typecheck
rtk pnpm exec vitest run src/extract/engine
```

## Risks / stop conditions

- Binding is name-based (`routeForComponent`) due to source concatenation (see constraint note).
  When the heuristic can't resolve a component, return `undefined` → unguarded mount (safe
  over-approximation), never a wrong guard.
- **STOP & ASK** if removing the engine fallback drops navigation transitions that existing tests
  rely on for non-react-router-shaped calls — that would indicate a needed adapter case, not an
  engine fallback. Add the case to the adapter (Phase 02), do not re-add engine knowledge.
