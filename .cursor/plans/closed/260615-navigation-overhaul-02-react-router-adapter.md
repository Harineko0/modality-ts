# 260615 — Navigation Overhaul · Phase 02: React-Router Adapter

Prereq: Phases 00–01. Implements the `NavigationAdapter` for react-router. **Lands together with
Phase 01** to close the interface (see Phase 01 acceptance). Still **not wired into the engine**
(Phase 03) — model output unchanged.

## Goal

Implement every `NavigationAdapter` method for react-router v7, porting existing logic and adding
route discovery (classified inventory + redirect detection), JSX classification, file→route
binding, and the location lowering with **reduced history domain**.

## Non-goals

- Do not edit the engine, pipeline, or CLI (Phases 03–04).
- Do not add `forward`/`go` (decision #2). Recognizing `.forward()` returns `"unsupported"`.
- No Next.js adapter.

## Current-state findings (to port)

- `src/extract/sources/router/navigation.ts` — `navigationCall(callee,args)` string matcher
  (handles `navigate`, `.push`/`.replace`, `.back`). Port into `classifyNavigationCall`.
- `src/extract/sources/router/routes.ts` — `routeVars(routes, options)` builds `sys:route` enum
  + `sys:history` (`boundedList` inner = route domain, `maxLen` 4). Port into `locationVars`
  with the history reduction.
- `src/cli/features/extract/command.ts:548-581` — `parseReactRouterRoutes(source)` +
  `reactRouterPathPattern(pattern)`. **Move** these into the adapter (a new
  `src/extract/sources/router/discover.ts`). Leave a temporary re-export in `command.ts`
  (`export { parseReactRouterRoutes } from "…/sources/router/discover.js"`) so Phase-pre-04
  stays compiling; Phase 04 deletes the CLI copy + re-export.
- `src/extract/sources/router/harness.ts` — keep as-is (already framework navigation harness).
- `src/extract/sources/router/index.ts` — `routerSource()` factory (`:12-29`). Rename to
  `reactRouterAdapter()`, keep `routerSource` alias export + `export default`.

## Files to edit / add

- `src/extract/sources/router/discover.ts` *(new)* — manifest parsing + classification + redirect detection
- `src/extract/sources/router/navigation.ts` — `classifyNavigationCall`, `classifyNavigationJsx`
- `src/extract/sources/router/routes.ts` — `locationVars` (+ keep pure helpers it needs)
- `src/extract/sources/router/index.ts` — assemble the adapter object; rename factory + alias
- `src/extract/sources/router/*.test.ts` — unit tests

## Atomic steps

1. **`discover.ts` — parse manifest.** Move `parseReactRouterRoutes` + `reactRouterPathPattern`
   here as pure fns returning `Array<{ pattern; file }>` (unchanged logic). Re-export from
   `command.ts` temporarily (see findings).
2. **`discover.ts` — classify into `RouteNode[]`.** For each entry set `kind`:
   `index('file')` → `index`; `.ts` file (not `.tsx`) **or** pattern starts with `/api/`/`==="/api"`
   → `resource`; otherwise → `page`. (`layout` only if a pathless layout helper is parsed — current
   parser does not emit those, so none for now.)
3. **`discover.ts` — redirect detection (best-effort).** `discoverRoutes(ctx)` reads each route
   node's `file` via `ctx.readFile` (resolve relative to `ctx.rootDir`/manifest dir); if the file
   text contains a `redirect("…")` / `permanentRedirect("…")` call with a **string-literal**
   target, set `node.redirectTo` to the normalized pattern. Non-literal → leave undefined (report
   only later). Wrap IO in try/catch; missing file → skip that node's redirect (keep the node).
   Return `{ routes }` sorted by `pattern`.
4. **`classifyNavigationCall`** (in `navigation.ts`): port the string matcher; additionally, when
   the call is `navigate(to, { replace: true })` (2 args, 2nd is an object with `replace: true`),
   return `{ mode: "replace", to }`. `.forward()`/`go()` → `"unsupported"`. Keep return type
   `NavIntent | "unsupported"`.
5. **`classifyNavigationJsx(tag, attrs)`** (new, in `navigation.ts`): for `tag === "Link"` with a
   `to` attr → `{ mode: "push", to }`; for `tag === "Navigate"` → `{ mode: attrs.has("replace") ? "replace" : "push", to: attrs.get("to") }`. Else `"unsupported"`. (`attrs` values are the
   already-resolved literal strings/flags the engine will pass in Phase 03.)
6. **`routeForComponent(componentName, inventory)`** (new; put in `discover.ts` or `routes.ts`):
   the engine only has component *names* (sources are concatenated — no per-file boundary). Port
   the existing name heuristic (`normalizeComponentRouteName` from `engine/ts/routes.ts:99-109`)
   but match the normalized component name against each inventory node's **file basename** and its
   **last path segment**, preferring `page`/`index` nodes; return that node's `pattern` (or
   `undefined`). This keeps route binding adapter-owned and framework-specific (Next.js would bind
   by file path instead).
7. **`locationVars(inventory, options, lowering)`** (in `routes.ts`): 
   - `sys:route` domain = `enum` of `uniqueRoutes([options.route, ...uiPatterns, ...lowering.pushTargets])`
     where `uiPatterns` = patterns of nodes with kind `page`/`index`. (resource/layout excluded.)
   - `historyRoutes` = `lowering.hasUnboundPush` ? **all** `sys:route` values
     : `uniqueRoutes([options.route, ...lowering.pushTargets, ...lowering.pushOrigins])`.
     `sys:history` = `boundedList` with `inner: { kind:"enum", values: historyRoutes }`,
     `maxLen: options.bounds?.maxHistory ?? 4`. **Invariant:** `historyRoutes ⊆ sys:route values`
     (assert/clamp). Keep `origin`/`scope`/`initial` exactly as the current `routeVars`.
8. **Assemble adapter** in `index.ts`: `reactRouterAdapter()` returns
   `{ id:"router", version, packageNames:["react-router","react-router-dom"], discoverRoutes,
   classifyNavigationCall, classifyNavigationJsx, routeForComponent, locationVars, harness }`. Export
   `routerSource = reactRouterAdapter` alias + default. Add unit tests (discover/classify/redirect/
   locationVars incl. the unbound-push fallback and the `⊆` invariant).

## Acceptance criteria

- `reactRouterAdapter()` satisfies `NavigationAdapter`; `pnpm typecheck` green.
- `discoverRoutes` on the TinyURL manifest yields the 13 nodes with correct `kind`
  (`/api/links`, `/api/auth/*`, `/auth/signout*` → `resource`; the rest → `page`/`index`).
- `locationVars` produces `sys:history.inner` ⊆ `sys:route` and equal to the reduced set when no
  unbound push; equal to the full set when `hasUnboundPush`.
- No engine/CLI wiring yet → `pnpm test` unaffected except the new adapter unit tests.

## Tests to add

`src/extract/sources/router/discover.test.ts` and `…/routes.test.ts` (or extend existing):
classification, redirect literal extraction (and non-literal skip), `routeForFile` matching,
`locationVars` history reduction + fallback + subset invariant, `classifyNavigationCall`
replace-option, `classifyNavigationJsx` Link/Navigate.

## Verification

```bash
rtk pnpm typecheck
rtk pnpm exec vitest run src/extract/sources/router
```

## Risks / stop conditions

- Redirect detection is best-effort and string-literal only — do **not** build a loader
  evaluator. Non-literal redirect → leave `redirectTo` undefined.
- If `routeForFile` path matching is ambiguous (two nodes same basename), prefer the longest
  matching suffix; if still ambiguous, return `undefined` (engine then emits an unguarded mount).
