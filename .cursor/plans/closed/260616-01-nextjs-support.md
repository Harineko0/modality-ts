# Next.js Support

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-16.

This plan adds first-class Next.js support to `modality-ts`, covering App Router
and Pages Router projects with full route-tree fidelity. It must be implemented
in small stages because Next.js layouts, parallel slots, templates, and
intercepting routes do not fit the current flat `sys:route`-only mountedness
model.

Official Next.js docs researched for this plan:

- App Router overview: https://nextjs.org/docs/app
- Layouts and Pages: https://nextjs.org/docs/app/getting-started/layouts-and-pages
- Linking and Navigating: https://nextjs.org/docs/app/getting-started/linking-and-navigating
- Dynamic Segments: https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes
- Parallel Routes: https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes
- Intercepting Routes: https://nextjs.org/docs/app/api-reference/file-conventions/intercepting-routes
- Server Functions / Actions: https://nextjs.org/docs/app/getting-started/mutating-data
- Caching / Revalidating: https://nextjs.org/docs/app/getting-started/revalidating
- Route Handlers: https://nextjs.org/docs/app/getting-started/route-handlers
- Proxy: https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- `@next/routing`: https://nextjs.org/docs/pages/api-reference/adapters/routing-with-next-routing
- Pages Router: https://nextjs.org/docs/pages/building-your-application/routing/pages-and-layouts
- Pages Router data APIs: `getStaticProps`, `getStaticPaths`,
  `getServerSideProps`, `getInitialProps`.

The following modeling decisions were confirmed with the product owner. Do not
re-open them without asking:

1. **Server execution** — Server Actions, Route Handlers, API Routes,
   `getServerSideProps`, `getStaticProps`, `getInitialProps`, and server-side
   `fetch` become nondeterministic async effect APIs. Do not try to symbolically
   execute arbitrary server code.
2. **Streaming/cache timing** — RSC streaming, `loading.tsx`, Suspense, PPR, and
   cache refresh timing are finite environment states, not exact Flight/byte
   timing.
3. **Route topology** — target full route-tree fidelity: layout-scoped state,
   template remounting, parallel routes, and intercepting routes must be modeled.
4. **No-op platform features** — Image, Font, Script, Metadata, CSS, static
   assets, and config options are no-op/model metadata unless they expose
   user-visible callbacks, navigation, request matching, redirects, rewrites,
   headers, cookies, or cache behavior.

---

## 1. Goal

Add a built-in `NavigationAdapter` for Next.js projects and the minimal generic
mountedness extensions needed to model Next App Router accurately.

The finished implementation should:

- Auto-enable when a project depends on `next`.
- Discover `app/`, `src/app/`, `pages/`, and `src/pages/` route structures.
- Preserve the current flat `sys:route` and `sys:history` contract for
  compatibility.
- Add route-tree system vars for active layouts, templates, parallel slots,
  intercepting routes, and finite loading/error/cache phases.
- Scope component state to the correct mount boundary:
  page, layout, template instance, parallel slot branch, or global provider.
- Model `next/link`, `next/navigation`, and `next/router` navigation APIs.
- Model redirects/rewrites/proxy/config route rules as navigation/request
  transitions where they affect the route graph.
- Model Server Actions, Route Handlers, API Routes, Pages Router data APIs, and
  server fetches as async effect APIs with nondeterministic outcomes.
- Treat platform-only features as metadata/no-ops unless they affect modeled
  state, navigation, cache, request matching, or user callbacks.

## 2. Non-goals

- Do not implement exact React Flight, HTML streaming, CDN, or byte-level timing.
- Do not symbolically execute arbitrary server code, database code, ORM calls,
  or user-defined server logic.
- Do not require a built Next.js `.next` output directory. Static source
  discovery must work from the filesystem.
- Do not depend on private Next.js internals. Use official concepts and stable
  source conventions. `@next/routing` may be optionally supported later for
  adapter/platform integration, but source discovery cannot require it.
- Do not remove or regress the existing React Router adapter.
- Do not rename the public `routerSource` / `reactRouterAdapter` exports.
- Do not change `EffectIR.navigate` semantics unless the plan explicitly calls
  for an adapter-level lowering hook. Prefer additive companion assignments.
- Do not model Image, Font, Script, Metadata, CSS, static assets, or build-only
  config as state unless user-visible behavior depends on them.
- Do not make broad refactors to extraction. Add narrow extension points and
  Next-specific code under a new source folder.

## 3. Current-State Findings

- Routing is framework-agnostic through `NavigationAdapter` in
  `src/extract/engine/spi/index.ts`. Existing methods include
  `discoverRoutes`, `classifyNavigationCall`, `classifyNavigationJsx`,
  `routeForComponent`, module role hooks, `locationVars`, and `harness`.
- The only built-in router today is the React Router adapter in
  `src/extract/sources/router/`. It is a good shape to follow, but its route
  model is flat.
- `RouteNode` currently has only `pattern`, `kind`, `file`, and `redirectTo`.
  This is insufficient for Next App Router route trees, layouts, templates,
  slots, route groups, and intercepting routes.
- `StateVarDecl.scope` in `src/core/ir/types.ts` is currently:
  `{ kind: "global" } | { kind: "route-local"; route: string }`.
  This cannot represent layout-scoped or slot-scoped state.
- Native checker mountedness is implemented in Rust:
  `crates/checker/src/model.rs`, `crates/checker/src/navigation.rs`,
  `crates/checker/src/transition_index.rs`, `crates/checker/src/expr.rs`,
  `crates/checker/src/stabilize.rs`, `crates/checker/src/property.rs`.
  It currently checks route-local vars by comparing `sys:route` to the var's
  `route`.
- TLA export route-local reset semantics live in
  `src/cli/features/export/command.ts` in `navigateBranches`.
- Slicing adds `sys:route` for route-local vars in
  `src/check/slicing/slice-model.ts`.
- React source extraction assigns `useState` vars in
  `src/extract/engine/ts/react-source-transitions.ts`; provider components are
  global, otherwise route-local by `route`.
- Navigation transitions are emitted by:
  `src/extract/engine/ts/transition/navigation.ts` and
  `src/extract/engine/ts/static-navigation.ts`. They currently produce
  `EffectIR{ kind: "navigate" }` and declare writes to `sys:route` and
  `sys:history`.
- `runExtractCommand` in `src/cli/features/extract/command.ts` uses the registry
  router plugin, attaches route inventory, builds the reachable project surface,
  then asks `routerAdapter.locationVars(...)` for route vars.
- Built-in plugin registration is in `src/cli/registry/index.ts`.
- Package exports for router-like sources are listed in `package.json` under
  `./extract/sources/router` and `./extract/sources/router/harness`.

## 4. Exact File Paths and Relevant Symbols

### Core IR and checker mountedness

- `src/core/ir/types.ts`
  - `StateVarDecl`
  - `ExprIR`
  - `EffectIR`
  - `Model`
- `src/core/ir/validator.ts`
  - `validateDecl`
  - `effectWrites`
  - `validateRouteLocalWrites`
  - `validateRouteLocalWriteOrder`
- `src/core/ir/domains.ts`
  - `UNMOUNTED`
  - `validateValue`
  - `enumerateDomain`
- `crates/checker/src/model.rs`
  - `Scope`
  - `StateVarDecl`
  - `CompiledVar`
  - `CompiledTransition`
  - `CompiledModel::compile`
  - `route_local_mounted`
- `crates/checker/src/navigation.rs`
  - `navigate`
  - `normalize_initial_route_locals`
  - `reset_route_locals`
- `crates/checker/src/transition_index.rs`
  - mountedness filtering via `route_local_mounted`
- `crates/checker/src/stabilize.rs`
  - internal transition mountedness checks
- `crates/checker/src/property.rs`
  - `route_local_reads_ok`
- `src/check/slicing/slice-model.ts`
  - `sliceModelForProperty`

### Navigation SPI and extraction

- `src/extract/engine/spi/index.ts`
  - `NavigationAdapter`
  - `NavIntent`
  - `RouteNode`
  - `RouteInventory`
  - `LocationLowering`
  - `ModuleClassification`
  - `ModuleEntryExport`
  - `ImportEdgeCtx`
- `src/extract/engine/ts/transition/navigation.ts`
  - `navigationTransition`
  - `navigationCall`
  - `navigationJsxTransition`
  - `navigationEffect`
  - `appendEffect`
- `src/extract/engine/ts/static-navigation.ts`
  - `staticNavigationTransitions`
  - `staticNavigationJsxTransitions`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `resolveComponentRoutePattern`
- `src/extract/engine/ts/components.ts`
  - `inlineCustomHookState`
  - `componentDeclarations`
- `src/cli/features/extract/project.ts`
  - `sourceWithReachableImports`
  - `classifyModule`
  - `moduleEntryExports`
  - `classifyImportEdge`
- `src/cli/features/extract/command.ts`
  - `ModalityConfig`
  - `runExtractCommand`
  - `attachRouteInventory`
  - `buildClientProjectSurface`
  - `buildLocationLowering`
  - `buildRouteCoverage`

### Existing router adapter pattern

- `src/extract/sources/router/index.ts`
  - `reactRouterAdapter`
  - `routerSource`
- `src/extract/sources/router/discover.ts`
  - `discoverRoutes`
  - `routeForComponent`
- `src/extract/sources/router/navigation.ts`
  - `classifyNavigationCall`
  - `classifyNavigationJsx`
- `src/extract/sources/router/module-roles.ts`
  - `classifyReactRouterModule`
  - `reactRouterModuleEntryExports`
  - `classifyReactRouterImportEdge`
- `src/extract/sources/router/routes.ts`
  - `locationVars`
- `src/extract/sources/router/harness.ts`

### New Next.js files to create

```
src/extract/sources/next/index.ts
src/extract/sources/next/discover.ts
src/extract/sources/next/routes.ts
src/extract/sources/next/navigation.ts
src/extract/sources/next/module-roles.ts
src/extract/sources/next/server-effects.ts
src/extract/sources/next/cache.ts
src/extract/sources/next/config.ts
src/extract/sources/next/harness.ts
src/extract/sources/next/types.ts
src/extract/sources/next/discover.test.ts
src/extract/sources/next/navigation.test.ts
src/extract/sources/next/module-roles.test.ts
```

Prefer `next` over `nextjs` for the folder name because the package name is
`next` and built-in source folders are package-adjacent (`swr`, `jotai`,
`zustand`).

### Existing files to edit

```
src/core/ir/types.ts
src/core/ir/validator.ts
src/check/slicing/slice-model.ts
src/cli/features/export/command.ts
crates/checker/src/model.rs
crates/checker/src/navigation.rs
crates/checker/src/transition_index.rs
crates/checker/src/stabilize.rs
crates/checker/src/expr.rs
crates/checker/src/property.rs
crates/checker/src/domain.rs
src/extract/engine/spi/index.ts
src/extract/engine/ts/routes.ts
src/extract/engine/ts/transition/navigation.ts
src/extract/engine/ts/static-navigation.ts
src/extract/engine/ts/react-source-transitions.ts
src/cli/features/extract/project.ts
src/cli/features/extract/command.ts
src/cli/registry/index.ts
package.json
docs/_specs/01-ir.md
docs/_specs/02-extraction.md
docs/architecture/navigation.md
```

## 5. Existing Patterns To Follow

- Follow `src/extract/sources/router/` for adapter factory layout, harness,
  navigation classification, route discovery tests, and module role tests.
- Follow `sourceWithReachableImports` in
  `src/cli/features/extract/project.ts` for server/client/import boundary
  handling. The Next adapter should supply framework-specific
  `classifyModule`, `moduleEntryExports`, `classifyImportEdge`, and
  `isServerOnlyModule`.
- Follow `src/extract/engine/ts/transition/suspense.ts` for finite Suspense
  state vars and resolve transitions.
- Follow `src/extract/sources/swr/template.ts` for cache-shaped async
  operations and nondeterministic resolve transitions.
- Preserve the IR's structured effect contract. Add a new scope form and
  adapter lowering hook only because full route-tree fidelity requires them.
  Do not add new `EffectIR` node kinds.
- Preserve `sys:route` and `sys:history` for existing properties, TLA export,
  and route coverage.

## 6. Atomic Implementation Steps

### Step 1 — Add generic mounted scopes

Add a generic mounted-local scope form while preserving existing `route-local`.

New TypeScript shape in `src/core/ir/types.ts`:

```ts
type StateVarScope =
  | { kind: "global" }
  | { kind: "route-local"; route: string }
  | { kind: "mount-local"; id: string; when: ExprIR };
```

Rules:

- `route-local` remains supported and is semantically equivalent to
  `mount-local` with `when = eq(read("sys:route"), lit(route))`.
- `mount-local.when` must be a structured boolean `ExprIR`.
- A mounted-local var is active exactly when `when` evaluates true.
- On transition/stabilization, if a local var becomes inactive, set it to
  `UNMOUNTED`.
- If it becomes active from `UNMOUNTED`, reset it to its initial value(s).
- If it remains active, preserve it.
- If it remains inactive, keep `UNMOUNTED`.

Files:

- `src/core/ir/types.ts`
- `src/core/ir/validator.ts`
- `src/core/ir/domains.ts` if helper types are needed
- `crates/checker/src/model.rs`
- `crates/checker/src/navigation.rs`
- `crates/checker/src/domain.rs`
- `crates/checker/src/expr.rs`
- `crates/checker/src/transition_index.rs`
- `crates/checker/src/stabilize.rs`
- `crates/checker/src/property.rs`
- `src/check/slicing/slice-model.ts`
- `src/cli/features/export/command.ts`
- `docs/_specs/01-ir.md`

Implementation notes:

- Rename Rust helper `route_local_mounted` to `transition_locals_mounted`, but
  keep a compatibility wrapper if the diff is smaller.
- In Rust `CompiledVar`, replace `route_pattern: Option<String>` with
  `mount_guard: Option<ExprIR>` or a compiled mount predicate representation.
- In Rust navigation, replace `reset_route_locals` with
  `reset_local_scopes(compiled, previous_state, next_state, preserve_mounted)`.
  Evaluate each local var's mount predicate against pre/post states to decide
  reset/unmount.
- In slicing, if a property reads a `mount-local` var, include all vars read by
  its `when` expression.
- In TLA export, reset local scopes using `tlaExpr(scope.when, nextEnv)`.
- Add tests proving old route-local behavior is unchanged.

Stop condition:

- Stop and report if the Rust checker cannot evaluate `mount-local.when`
  without cycles or if the expression reads the var it scopes. The validator
  should reject self-referential mount guards.

### Step 2 — Extend NavigationAdapter for route-tree lowering

Add optional route-tree hooks to `NavigationAdapter` in
`src/extract/engine/spi/index.ts`.

Suggested additions:

```ts
export interface NavigationAdapter {
  // existing fields...
  routeTreeVars?(
    inventory: RouteInventory,
    options: ResolvedOptions,
  ): readonly StateVarDecl[];

  lowerNavigation?(
    intent: NavIntent,
    ctx: {
      inventory: RouteInventory;
      routePatterns: readonly string[];
    },
  ): {
    effect: EffectIR;
    reads: readonly string[];
    writes: readonly string[];
    confidence?: "exact" | "over-approx";
  };

  mountScopeForComponent?(
    componentName: string,
    inventory: RouteInventory,
  ): StateVarDecl["scope"] | undefined;
}
```

Rules:

- Existing adapters do not need to implement these hooks.
- If `lowerNavigation` is absent, keep current `EffectIR.navigate` behavior.
- If present, `navigationTransition`, `navigationJsxTransition`, and
  `staticNavigationTransitions` must use the adapter-provided effect/read/write
  set. The Next adapter will return `seq([navigate, assign slot vars, assign
  finite phase vars])`.
- `locationVars` still returns `sys:route` and `sys:history`. `routeTreeVars`
  returns additional system vars so old code remains compatible.

Files:

- `src/extract/engine/spi/index.ts`
- `src/extract/engine/ts/transition/navigation.ts`
- `src/extract/engine/ts/static-navigation.ts`
- `src/cli/features/extract/command.ts`
- `test/extraction/architecture.test.ts`

Stop condition:

- Stop and report if this hook forces changes to `EffectIR.navigate` or the
  checker for non-Next apps. It should be additive.

### Step 3 — Add Next route tree types

Create `src/extract/sources/next/types.ts`.

Define internal types independent of `RouteNode`:

```ts
export type NextRouterKind = "app" | "pages";
export type NextSegmentKind =
  | "static"
  | "dynamic"
  | "catch-all"
  | "optional-catch-all"
  | "group"
  | "parallel-slot"
  | "intercept";

export interface NextRouteTreeNode {
  id: string;
  router: NextRouterKind;
  pattern: string;
  segment: string;
  segmentKind: NextSegmentKind;
  parentId?: string;
  slot?: string;              // e.g. "children", "@modal"
  file?: string;              // page file for UI routes
  layoutFile?: string;
  templateFile?: string;
  loadingFile?: string;
  errorFile?: string;
  defaultFile?: string;
  notFoundFile?: string;
  routeFile?: string;         // app route handler
  apiFile?: string;           // pages API route
  groupNames: readonly string[];
  params: readonly NextParam[];
  intercept?: NextInterceptInfo;
  kind: "page" | "index" | "layout" | "resource";
}
```

Store these on `RouteNode.metadata` by extending `RouteNode` with:

```ts
metadata?: Record<string, Value>;
```

Do not force generic code to understand this metadata.

Files:

- `src/extract/engine/spi/index.ts`
- `src/extract/sources/next/types.ts`

### Step 4 — Discover App Router filesystem routes

Create `src/extract/sources/next/discover.ts`.

Implement `discoverRoutes(ctx: RouteDiscoveryCtx): Promise<RouteInventory>`.

Requirements:

- Search under `app/` and `src/app/`.
- Support page files: `page.{js,jsx,ts,tsx,mdx}`.
- Support route handler files: `route.{js,ts}` as `kind: "resource"`.
- Support special files: `layout`, `template`, `loading`, `error`,
  `not-found`, `default`, `forbidden`, `unauthorized`, metadata files as
  metadata/no-op unless they affect status transitions.
- Support route groups `(marketing)` by excluding the group from the URL pattern
  but preserving it in node ids and layout ancestry.
- Support dynamic `[id]`, catch-all `[...slug]`, and optional catch-all
  `[[...slug]]`.
- Support parallel slots `@slot` by preserving slot identity and producing slot
  vars later.
- Support intercepting route markers `(.)`, `(..)`, `(...)` and record enough
  metadata for soft navigation overlay vs hard navigation full page.
- Detect `redirect(...)`, `permanentRedirect(...)`, `notFound()`,
  `forbidden()`, `unauthorized()` literals in page/layout/server files when
  statically present and record `redirectTo` or finite status metadata.
- Sort routes deterministically.

The resulting `RouteInventory.routes` should include:

- UI pages as `page` or `index`.
- Layout-only nodes as `layout`.
- App route handlers as `resource`.
- Redirect-only pages as `page` with `redirectTo`.

Tests:

- `src/extract/sources/next/discover.test.ts`
  - route groups do not affect URLs.
  - dynamic/catch-all/optional catch-all route patterns match official Next
    forms.
  - parallel slots are discovered.
  - intercepting routes preserve soft-navigation metadata.
  - route handlers are resources.
  - `src/app` works.

### Step 5 — Discover Pages Router filesystem routes

Extend `src/extract/sources/next/discover.ts`.

Requirements:

- Search under `pages/` and `src/pages/`.
- Support `index`, nested pages, dynamic `[id]`, catch-all `[...slug]`,
  optional catch-all `[[...slug]]`.
- Exclude `_app`, `_document`, and Pages metadata/build-only files from
  `sys:route` but classify `_app` as shared layout/provider surface for client
  extraction.
- Classify `pages/api/**` as `resource`.
- Detect `getStaticProps`, `getStaticPaths`, `getServerSideProps`, and
  `getInitialProps` exports for later server-effect modeling.
- Preserve Pages Router state preservation behavior for same page component
  navigations; dynamic param changes do not necessarily remount the component
  unless keyed by user code. Model this through mount scopes based on page module
  identity, not raw URL pattern, for pages dynamic routes.

Tests:

- `pages/blog/[slug].tsx` -> `/blog/:slug`.
- `pages/shop/[[...slug]].tsx` -> `/shop/*?` or the local normalized optional
  pattern agreed by existing `normalizeRouteTarget` helpers.
- `pages/api/post/[pid].ts` is a resource and excluded from client route state.
- `_app.tsx` is included in render/interaction surface as a shared layout.

### Step 6 — Add Next route-tree system vars

Create `src/extract/sources/next/routes.ts`.

Export:

- `locationVars(inventory, options, lowering): readonly StateVarDecl[]`
- `routeTreeVars(inventory, options): readonly StateVarDecl[]`
- `lowerNextNavigation(intent, ctx): { effect, reads, writes, confidence }`
- `mountScopeForComponent(componentName, inventory): StateVarDecl["scope"]`
- var-id helpers:
  - `nextSlotVarId(slotKey)`
  - `nextPhaseVarId(boundaryId)`
  - `nextCacheVarId(key)`

Model:

- Always emit existing `sys:route` and `sys:history` with the same shapes as
  React Router's `locationVars`.
- Emit `sys:next:slot:<slotKey>` enum vars for route-tree slots. Values are
  route tree node ids plus `"__none"`.
- Emit `sys:next:phase:<boundaryId>` enum vars where a route segment has
  `loading`, `error`, `not-found`, `forbidden`, or `unauthorized` boundaries.
  Domain should start minimal:
  `["ready", "loading", "error", "not-found", "forbidden", "unauthorized"]`.
- For cache components and revalidation, emit cache vars only when source
  analysis discovers cache tags/paths. Do not eagerly create cache vars for
  every route.
- `lowerNextNavigation` should produce a `seq` effect:
  1. current `navigate` effect
  2. slot assignments for the target route tree
  3. phase assignments to `loading` or `ready` depending on whether the target
     route has `loading.tsx` / dynamic server data
  4. intercepting route assignments for soft navigation overlays
- For unknown dynamic targets, over-approximate by `choose`/`havoc` over allowed
  slot domains and emit a model-slack warning.

Mount scopes:

- Page components: mounted when their leaf page node is active in the relevant
  slot.
- Layout components: mounted when their layout node remains in the active
  ancestor chain.
- Template components: mounted when their template node is active for the exact
  navigation instance. If no explicit template instance counter exists, reset on
  every navigation that re-enters the template boundary.
- Parallel route components: mounted when their slot var equals that branch node.
- Intercepted modal route components: mounted when the overlay/intercept slot is
  active; hard navigation mounts the full page branch instead.

Stop condition:

- Stop and report if template remounting appears to require unbounded instance
  ids. Use finite route-tree phase/slot vars only; if a specific app needs
  unbounded template identity, emit a bound-hit/model-slack warning.

### Step 7 — Add Next navigation classification

Create `src/extract/sources/next/navigation.ts`.

Support App Router:

- `import Link from "next/link"` / `<Link href="...">`
- `useRouter` from `next/navigation`:
  - `router.push(href, options?)`
  - `router.replace(href, options?)`
  - `router.back()`
  - `router.refresh()`
  - `router.prefetch()` as metadata/no-op unless `onInvalidate` callback is
    statically provided; then model callback as env transition.
- `redirect`, `permanentRedirect`, `notFound`, `forbidden`, `unauthorized`,
  `refresh` from `next/navigation` in server modules as server-side effects.
- `usePathname`, `useParams`, `useSearchParams`, `useSelectedLayoutSegment`,
  `useSelectedLayoutSegments` as reads of route-tree/system vars where used in
  guards/effects. For search params, default to token/finite overlay-driven
  domains.

Support Pages Router:

- `useRouter` from `next/router`:
  - `router.push(url, as?, options?)`
  - `router.replace(url, as?, options?)`
  - `router.back()`
  - `router.reload()` as refresh env transition.
  - `router.prefetch()` metadata/no-op.
  - `router.beforePopState()` warning + over-approx back behavior.
- `withRouter(Page)` should route component mapping to the wrapped component.

Route target normalization:

- String literal and static object `{ pathname, query }` targets should resolve
  to route patterns.
- Dynamic target expressions should over-approximate to known route patterns and
  warn.
- External URLs are not route transitions.
- Unsanitized `javascript:` targets should be reported as a security caveat, but
  do not block extraction.

Tests:

- App `router.push`, `router.replace`, `router.back`, `router.refresh`.
- Pages `router.push({ pathname: "/post/[pid]", query: { pid } })`.
- `<Link href="/dashboard">`.
- Dynamic href over-approximates and records a warning.

### Step 8 — Add Next module role classification

Create `src/extract/sources/next/module-roles.ts`.

Rules:

- `"use client"` modules are `client`.
- `"use server"` modules and exported server functions are `server`.
- App Router files are server by default unless `"use client"`.
- Client interaction surface includes client components imported by server
  pages/layouts.
- Render surface may traverse server components to find client islands and
  props, but interaction surface must exclude server-only code except modeled
  server effect APIs.
- Route handlers (`route.ts`), Pages API routes, `getStaticProps`,
  `getStaticPaths`, `getServerSideProps`, `getInitialProps`, Server Actions,
  metadata functions, and proxy are server entries.
- Asset imports (`.css`, images, fonts) are `asset` and no-op.
- `next/image`, `next/font/*`, `next/script`, metadata modules are no-op unless
  user callbacks are present.

Implement:

- `classifyNextModule(ctx): ModuleClassification`
- `nextModuleEntryExports(ctx): readonly ModuleEntryExport[]`
- `classifyNextImportEdge(ctx): ImportEdgeContext`
- `isNextServerOnlyModule(fileName): boolean`

Tests:

- App page without `"use client"` excludes event handlers unless a client island
  is imported.
- `"use client"` component imported from a server page is included in
  interaction surface.
- `"use server"` action file is excluded from client surface but contributes
  server effect APIs.
- CSS/image/font imports do not drag modules into interaction surface.

### Step 9 — Model server effects and actions

Create `src/extract/sources/next/server-effects.ts`.

Model these as nondeterministic async effect APIs:

- Server Actions / Server Functions:
  - inline function body with `"use server"`
  - file-level `"use server"` exported functions
  - form `action={fn}`
  - button `formAction={fn}`
  - client calls to imported server functions
- App Route Handlers:
  - `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` exports in
    `app/**/route.ts`
- Pages API Routes:
  - `pages/api/**`
- Pages data functions:
  - `getStaticProps`
  - `getStaticPaths`
  - `getServerSideProps`
  - `getInitialProps`
- Server component `fetch` and configured effect APIs.

Operation ids:

- Server Action: `ACTION <module>#<exportOrLocalName>`
- Route Handler: `<METHOD> <route-pattern>`
- Pages API: `<METHOD> /api/...`
- Data function: `DATA <function> <route-pattern>`
- Server fetch: `<METHOD> <normalized-path>`

Effects:

- Invocations enqueue pending ops using existing async CPS machinery.
- Outcomes default to `success | error`, with payload domain `tokens(1)` unless
  statically inferable from TypeScript return type.
- Server redirects become navigation effects in the success continuation.
- `notFound`, `forbidden`, `unauthorized` assign the relevant finite phase var.
- Server functions are externally reachable via POST; report a data-security
  caveat if a discovered Server Action is exported and no obvious auth/guard
  check is statically visible. This is a warning only.

Integration points:

- `src/cli/features/extract/project.ts` currently discovers `fetch(...)` effect
  APIs from interaction text. Extend this with adapter-provided server effect
  discovery so server-only files can contribute effect APIs without entering the
  client interaction surface.
- Add optional `NavigationAdapter.discoverEffectApis?` or keep the function
  inside Next adapter and call it from `runExtractCommand` when router id is
  `"next"`. Prefer the SPI hook if it can stay generic.

Stop condition:

- Stop and report if this requires executing user modules. It must be static AST
  analysis only.

### Step 10 — Model cache and revalidation as finite state

Create `src/extract/sources/next/cache.ts`.

Support:

- `"use cache"`, `"use cache: private"`, `"use cache: remote"` directives.
- `cacheTag(tag)`
- `cacheLife(...)`
- `revalidateTag(tag, profile?)`
- `updateTag(tag)`
- `revalidatePath(path)`
- `unstable_cache`
- `unstable_noStore` / `connection` as dynamic-request markers.
- Previous-model `fetch` cache options when statically visible:
  `{ cache: "force-cache" | "no-store" }`, `next: { revalidate, tags }`.

Finite abstraction:

- For each discovered cache key/tag/path relevant to modeled code:
  `sys:next:cache:<key>` enum:
  `["empty", "fresh", "stale", "refreshing", "error"]`.
- `revalidateTag(tag, "max")` transitions fresh->stale and may enqueue a
  background refresh.
- `updateTag(tag)` transitions immediately to refreshing/fresh for
  read-your-own-writes.
- `revalidatePath(path)` over-approximates all cache vars associated with that
  route path.
- `no-store` / request-only data marks route phase as dynamic and skips cache
  vars.

Tests:

- Server Action calls `updateTag("posts")`: cache var is invalidated immediately.
- Route Handler calls `revalidateTag("posts", "max")`: stale-while-revalidate
  state is reachable.
- `revalidatePath("/profile")` affects path-associated cache vars.

### Step 11 — Parse next.config route-affecting options

Create `src/extract/sources/next/config.ts`.

Support static `next.config.{js,mjs,cjs,ts}` where feasible:

- `basePath`
- `trailingSlash`
- `redirects`
- `rewrites`
- `headers`
- `i18n`
- `pageExtensions`
- `typedRoutes` as metadata/no-op
- `cacheComponents` as cache-model switch
- `serverActions.allowedOrigins` as metadata/security caveat context

Do not execute arbitrary config code. Parse object literals and async function
returns when statically obvious. Otherwise warn and continue with defaults.

Effects:

- Static redirects become route-bound replace transitions.
- Rewrites become masked-route transitions preserving browser `sys:route` where
  appropriate; if exact masking cannot be represented, over-approximate and warn.
- Headers/cookies matchers affect proxy/server request vars only when source
  code reads headers/cookies.
- i18n expands route domain with locale-prefixed variants only if configured
  statically.

### Step 12 — Create Next adapter factory and harness

Create `src/extract/sources/next/index.ts` and `harness.ts`.

Factory:

```ts
export interface NextSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function nextAdapter(options?: NextSourceOptions): NavigationAdapter;
export const nextSource = nextAdapter;
export default nextAdapter;
```

Adapter fields:

- `id: "next"`
- `version: "0.1.0"`
- `packageNames: ["next"]`
- `discoverRoutes`
- `classifyNavigationCall`
- `classifyNavigationJsx`
- `routeForComponent`
- `mountScopeForComponent`
- `classifyModule`
- `moduleEntryExports`
- `classifyImportEdge`
- `isServerOnlyModule`
- `locationVars`
- `routeTreeVars`
- `lowerNavigation`
- `harness`

Harness:

- `setup` returns handles from initial state.
- `observe` reads current `sys:route` plus route-tree vars if available.
- `navigate` should call the app/router harness eventually; for now mirror
  router harness behavior and mutate observed location state in abstract tests.

### Step 13 — Register and export Next support

Edit `src/cli/registry/index.ts`:

- Import `nextAdapter` from `modality-ts/extract/sources/next`.
- Choose router priority:
  - If project has `next`, use `nextAdapter()`.
  - Else if project has `react-router`/`react-router-dom`, use
    `reactRouterAdapter()`.
  - If user passes `routerPlugin`, honor it.
  - If user disables `"next"`, do not use it.
- Do not instantiate both router adapters; exactly one router remains active.

Edit `package.json` exports:

- `./extract/sources/next`
- `./extract/sources/next/harness`

Update `test/extraction/architecture.test.ts` root package exports loop to
include `next`.

### Step 14 — Wire route-tree vars into extraction

Edit `src/cli/features/extract/command.ts`:

- After `routeVars = routerAdapter.locationVars(...)`, append
  `routerAdapter.routeTreeVars?.(...) ?? []`.
- Pass route-tree vars into `synthesizeSystemVars`.
- Include route-tree vars in route coverage/model report as system vars.
- Ensure `buildLocationLowering` uses `adapter.lowerNavigation` effects when
  collecting push targets/origins, or collects from both `navigate` and
  adapter-assigned slot effects.

Edit `src/extract/engine/ts/react-source-transitions.ts`:

- When creating local `useState`, ask
  `routerPlugin?.mountScopeForComponent?.(component, inventory)`.
- Fallback to current provider/global/route-local logic when undefined.
- Do the same for custom hook state in `components.ts` and concurrent state in
  `transition/concurrent.ts`.

Stop condition:

- Stop and report if component-to-layout mapping cannot be determined by file
  inventory. Do not guess layout scope from component name alone; fall back to
  route-local and emit a warning.

### Step 15 — Docs and specs

Update:

- `docs/_specs/01-ir.md`
  - add `mount-local` scope and mountedness reset semantics.
- `docs/_specs/02-extraction.md`
  - add Next.js extraction section.
  - document server effects as nondeterministic async APIs.
  - document streaming/cache finite-state approximations.
- `docs/architecture/navigation.md`
  - extend flat route model with optional route-tree vars.
  - state that `sys:route` remains compatibility leaf-route state.
- Add `docs/sources/next.md` if docs source pages are maintained for source
  adapters. Keep it concise and user-facing.

Do not update generated `docs/build/**`.

## 7. Per-Step Files To Edit

| Step | Files |
| --- | --- |
| 1 | `src/core/ir/types.ts`, `src/core/ir/validator.ts`, `src/check/slicing/slice-model.ts`, `src/cli/features/export/command.ts`, `crates/checker/src/*.rs`, `docs/_specs/01-ir.md` |
| 2 | `src/extract/engine/spi/index.ts`, `src/extract/engine/ts/transition/navigation.ts`, `src/extract/engine/ts/static-navigation.ts`, `src/cli/features/extract/command.ts`, `test/extraction/architecture.test.ts` |
| 3 | `src/extract/sources/next/types.ts`, `src/extract/engine/spi/index.ts` |
| 4 | `src/extract/sources/next/discover.ts`, `src/extract/sources/next/discover.test.ts` |
| 5 | `src/extract/sources/next/discover.ts`, `src/extract/sources/next/discover.test.ts` |
| 6 | `src/extract/sources/next/routes.ts`, `src/extract/sources/next/navigation.test.ts` |
| 7 | `src/extract/sources/next/navigation.ts`, `src/extract/sources/next/navigation.test.ts` |
| 8 | `src/extract/sources/next/module-roles.ts`, `src/extract/sources/next/module-roles.test.ts`, `src/cli/features/extract/project.ts` |
| 9 | `src/extract/sources/next/server-effects.ts`, `src/cli/features/extract/project.ts`, `src/cli/features/extract/command.ts` |
| 10 | `src/extract/sources/next/cache.ts`, `src/extract/sources/next/server-effects.ts` |
| 11 | `src/extract/sources/next/config.ts`, `src/cli/features/extract/command.ts` |
| 12 | `src/extract/sources/next/index.ts`, `src/extract/sources/next/harness.ts` |
| 13 | `src/cli/registry/index.ts`, `package.json`, `test/extraction/architecture.test.ts` |
| 14 | `src/cli/features/extract/command.ts`, `src/extract/engine/ts/react-source-transitions.ts`, `src/extract/engine/ts/components.ts`, `src/extract/engine/ts/transition/concurrent.ts` |
| 15 | `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`, `docs/architecture/navigation.md`, optionally `docs/sources/next.md` |

## 8. Acceptance Criteria

1. Existing React Router tests pass unchanged.
2. Existing hand-written models using `route-local` still validate, check, slice,
   and export exactly as before.
3. A minimal `app/page.tsx` Next app with `<Link href="/dashboard">` discovers
   `/` and `/dashboard`, emits `sys:route`, `sys:history`, and route-tree vars,
   and navigation updates both flat route and slot state.
4. A Next layout with `useState` preserves layout state across sibling page
   navigations while page state resets on page remount.
5. A `template.tsx` with `useState` resets when navigating through the template
   boundary.
6. Parallel routes under `@modal` and the default `children` slot produce
   independent slot vars; modal/intercepted soft navigation can overlay a route
   without losing the underlying page slot.
7. Dynamic routes `[slug]`, catch-all `[...slug]`, and optional catch-all
   `[[...slug]]` are discovered for both App Router and Pages Router.
8. App Route Handlers and Pages API routes are classified as resources and do
   not enter client `sys:route`, but they do contribute async effect API ids.
9. Server Actions invoked from a form enqueue nondeterministic pending ops and
   can resolve success/error.
10. `revalidateTag`, `updateTag`, and `revalidatePath` update finite cache vars
    when statically discoverable.
11. `next/image`, `next/font`, metadata files, CSS, and static assets do not
    inflate client interaction surface unless a user callback is present.
12. `createBuiltinModalityRegistry({ dependencies: { next: "..." } })` selects
    the Next adapter; projects without `next` keep existing router behavior.
13. Route coverage reports App pages as modeled, App route handlers/pages API
    as resource/API, and unsupported dynamic cases with clear reasons.

## 9. Tests To Add Or Update

### Core mountedness

- Add tests in `test/kernel/kernel.test.ts` or a new
  `test/kernel/mounted-scope.test.ts`:
  - `route-local` compatibility.
  - `mount-local` active/inactive reset.
  - self-referential mount guard validation error.
  - transition touching unmounted mounted-local var is disabled.
- Add Rust tests near current route-local tests in:
  - `crates/checker/src/model.rs`
  - `crates/checker/src/navigation.rs`
  - `crates/checker/src/property.rs`

### Next adapter unit tests

- `src/extract/sources/next/discover.test.ts`
  - App routes, groups, dynamic, catch-all, optional catch-all.
  - Layout/template/loading/error files.
  - Parallel slots.
  - Intercepting routes.
  - Route handlers.
  - Pages routes and API routes.
- `src/extract/sources/next/navigation.test.ts`
  - App Router `next/link`, `next/navigation`.
  - Pages Router `next/router`.
  - Dynamic href over-approx.
  - `router.refresh`.
- `src/extract/sources/next/module-roles.test.ts`
  - RSC default server modules.
  - `"use client"` islands.
  - `"use server"` action files.
  - asset imports.

### End-to-end extraction tests

Add cases to `src/cli/features/extract/command.test.ts` or a new focused file:

- Minimal App Router project.
- Layout state preservation.
- Template state reset.
- Parallel route modal.
- Server Action form.
- Route Handler/API effect API discovery.
- Pages Router dynamic page with `getServerSideProps`.
- `next.config` static redirect/rewrite.

### Architecture and exports

- Update `test/extraction/architecture.test.ts` to include Next package exports.
- Add registry test for Next adapter selection.

## 10. Verification Commands

Run commands with `rtk` as required by repo instructions:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
rtk git diff --check
```

Targeted during development:

```bash
rtk pnpm vitest run src/extract/sources/next
rtk pnpm vitest run test/kernel/mounted-scope.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk cargo test --manifest-path crates/checker/Cargo.toml
```

After `rtk pnpm fix`, run `rtk git diff --quiet` if the implementation expected
formatting to be clean.

## 11. Risks, Ambiguities, And Stop Conditions

- **STOP** if full route-tree fidelity appears to require a new `EffectIR` node
  kind. Prefer adapter-provided `seq` effects using existing `navigate`,
  `assign`, `choose`, `havoc`, and `enqueue`/`dequeue`.
- **STOP** if `mount-local.when` cannot be evaluated safely in Rust without
  self-reference or cyclic dependency. Add validator checks; do not ship a scope
  that can depend on its own var.
- **STOP** if Next route discovery would require executing user code or
  `next.config`. Static AST/object parsing only.
- **STOP** if route-tree vars explode for a realistic app. Report the route/slot
  count and add a bound or approximation proposal instead of silently flattening.
- **STOP** if component-to-route-tree mapping is ambiguous. Fall back to
  route-local with a warning only for the specific component; do not assign
  layout scope by name guessing.
- **STOP** if React Router behavior changes. The Next adapter must be selected
  only for `next` projects or explicit user config.
- **Risk — Pages Router dynamic remount semantics**: Next preserves state when
  navigating between routes handled by the same page component unless user code
  keys the component. Model by page module identity, not path parameter value.
  If exact key detection is hard, emit a warning and preserve state by default.
- **Risk — Intercepting routes**: soft navigation vs hard navigation differs.
  Model both with finite slot states. If a target can be reached both ways,
  produce separate transitions with distinct labels/ids.
- **Risk — Proxy/middleware matcher parsing**: matchers can be complex regexes.
  Support static strings/arrays first; over-approx complex regex matchers and
  report model slack.
- **Risk — Cache Components are evolving**: keep cache modeling behind static
  source detection and warnings. Do not assume every app uses
  `cacheComponents: true`.
- **Risk — Server Action security**: direct POST reachability is modeled as an
  async effect API. Security/auth caveats should be warnings in the trust ledger,
  not extraction blockers.
- **Do not edit generated artifacts** under `dist`, `native`, `.modality`, or
  `docs/build`.
