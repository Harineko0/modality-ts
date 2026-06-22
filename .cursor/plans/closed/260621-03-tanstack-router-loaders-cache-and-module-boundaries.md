# TanStack Router Support Plan 3: Loaders, Cache, Redirects, and Module Boundaries

## 1. Goal

Add TanStack Router-aware module classification, route loader/beforeLoad effect surfaces, redirect lowering, and bounded router-cache state so extraction remains client-focused and does not inflate models with server/data-loading internals.

This plan depends on:

- `260621-01-tanstack-router-route-inventory.md`
- `260621-02-tanstack-router-navigation-and-route-state.md`

Official documentation checked:

- https://tanstack.com/router/latest/docs/guide/data-loading
- https://tanstack.com/router/latest/docs/guide/router-context
- https://tanstack.com/router/latest/docs/faq
- https://tanstack.com/router/latest/docs/guide/search-params

Relevant TanStack findings:

- Route loading runs route matching, search validation, `beforeLoad`, route component preload, and route `loader`.
- TanStack Router has built-in stale-while-revalidate route loader caching.
- Router context is passed through matching routes and can be augmented through `beforeLoad`.
- `beforeLoad` can restrict access and redirect.
- Search params are structured JSON-like URL state and can be validated.

## 2. Non-goals

- Do not symbolically execute loader or beforeLoad bodies.
- Do not implement TanStack Query.
- Do not model network timing or Suspense streaming exactly.
- Do not implement TanStack Start server functions or full-stack behavior in this plan.
- Do not broaden extraction to arbitrary server modules imported only by loaders.

## 3. Current-State Findings

- React Router module boundaries are handled by `src/extract/sources/router/module-roles.ts`.
- React Router route `action()` functions are discovered by `src/extract/sources/router/server-effects.ts`.
- Next has separate module-role, effect-api, and cache-storage providers under `src/extract/sources/next/`.
- The registry supports separate `ModuleRoleAdapter`, `EffectApiProvider`, and `CacheStorageProvider` capabilities in `src/cli/registry/index.ts`.
- `buildClientProjectSurface` in `src/cli/features/extract/extraction-project.ts` already accepts module-role adapters and effect API providers.
- `discoverCacheStorageFragments` already collects cache/storage providers and merges vars/transitions/caveats/reductions.
- The extraction spec explicitly says default extraction models client UI transitions only and server/full-route execution is future work unless represented as effect APIs.

## 4. Existing Patterns to Follow

- Add TanStack-specific capability factories from `src/extract/sources/tanstack-router/index.ts`:
  - `tanstackRouterModuleRoleAdapter`
  - `tanstackRouterEffectApiProvider`
  - `tanstackRouterCacheStorageProvider`
- Mirror the separation used by Next and React Router. Do not add module-role or cache methods to `NavigationAdapter`.
- Represent loaders/beforeLoad as effect operations and bounded environment transitions, not as executed code.
- Store all model slack and safety notes in structured caveats where possible, with terminal warning strings only as display output.

## 5. Atomic Implementation Steps

1. Create `src/extract/sources/tanstack-router/module-roles.ts`.
   - Recognize imports from `@tanstack/react-router`.
   - Classify route files containing exported `Route = createFileRoute(...)({...})` as `shared` by default.
   - Treat route option fields `loader`, `beforeLoad`, `validateSearch`, `params.parse`, `head`, `headers`, and any explicit server-like helper modules as non-interaction surfaces unless their results are read by client components through TanStack hooks.
   - Preserve component surfaces from `component`, `pendingComponent`, `errorComponent`, and `notFoundComponent` if they are local or statically imported React components.
   - Treat type-only imports as `type`.
   - Treat `.server.` files and `/server/` paths as server-only.
   - Return `unknown` for ambiguous import edges rather than excluding them.

2. Implement `moduleEntryExports`.
   - Route files should expose the component-related client entries.
   - Loader/beforeLoad-like option functions should be server/data-loading entries for effect discovery.
   - Root route files should be handled as layout/client component entries plus any data-loading entries.

3. Implement `shouldDiscoverEffectApis`.
   - Discover effect APIs from route files and server/data-loading entries where `loader` or `beforeLoad` are present.
   - Avoid scanning pure client utility modules unless reachable from loader/beforeLoad surfaces.

4. Create `src/extract/sources/tanstack-router/server-effects.ts`.
   - Discover route loader operations:
     - `LOADER <routePattern>`
     - `BEFORE_LOAD <routePattern>`
   - Record source location and producer metadata.
   - Support both direct function form (`loader: () => ...`) and object handler form if official/current code supports it.
   - Treat `validateSearch` as a validation/refinement source for search-domain caveats, not a user-triggered effect operation.

5. Model redirects from `beforeLoad`/`loader`.
   - Detect static `redirect({ to: "..." })` calls from `@tanstack/react-router`.
   - Detect static `throw redirect(...)` and returned redirect forms if present in fixtures.
   - Add `redirectTo` to the corresponding `RouteNode` during discovery or effect discovery.
   - Ensure existing automatic route-bound redirect transition generation sees TanStack `redirectTo`.
   - Use replace semantics unless official docs/tests prove a push-like redirect mode.

6. Implement route cache/storage provider.
   - Create `src/extract/sources/tanstack-router/cache-provider.ts`.
   - Emit bounded vars for loader cache entries only for routes with discovered loaders.
   - Suggested domain: `empty | fresh | stale | refreshing | error`.
   - Keep ids compact, e.g. `sys:tanstack:loader-cache:<safeRouteId>`.
   - Add environment transitions for stale/revalidate/error only where they are route-relevant and bounded.
   - If loader count is high, emit model-slack warnings and keep cache vars only for current route plus explicitly navigated routes.

7. Connect cache/provider caveats to reports.
   - Use `ExtractionCaveat` entries for model slack, stale/read cache approximations, and skipped dynamic loaders.
   - Do not rely on unstructured warnings for behavior-critical caveats.

8. Register TanStack module-role/effect/cache providers.
   - Update `src/cli/registry/index.ts` so `@tanstack/react-router` activates:
     - `tanstackRouterAdapter()`
     - `tanstackRouterModuleRoleAdapter()`
     - `tanstackRouterEffectApiProvider()`
     - `tanstackRouterCacheStorageProvider()`
   - Respect `disabledPlugins: ["tanstack-router"]`.
   - Keep `next` priority above TanStack if both are present.

9. Update docs/spec.
   - In `docs/architecture/navigation.md`, add TanStack Router module-role/effect/cache notes.
   - In `docs/_specs/02-extraction.md`, add a TanStack Router extraction subsection after React Router and before/near Next.
   - Document that loaders/beforeLoad are modeled as effect APIs and cache states, not executed.

## 6. Tests to Add or Update

- Add `src/extract/sources/tanstack-router/module-roles.test.ts`.
  - Route module with component + loader keeps component interaction surface and excludes loader-only imports from client interaction.
  - `.server.` and `/server/` paths are server-only.
  - `beforeLoad` and `loader` are effect-discovery surfaces.
  - Ambiguous shared imports stay included with warnings.

- Add `src/extract/sources/tanstack-router/server-effects.test.ts`.
  - `loader: () => fetchPosts()` discovers `LOADER /posts`.
  - `beforeLoad: () => ...` discovers `BEFORE_LOAD /private`.
  - Static `redirect({ to: "/login" })` is captured.
  - Dynamic redirect target is caveated/unsupported, not exact.

- Add `src/extract/sources/tanstack-router/cache.test.ts`.
  - Loader route emits bounded cache var.
  - Cache provider emits deterministic ids.
  - High route count reduction behavior is tested if implemented.

- Update `src/cli/registry/index.test.ts`.
  - TanStack dependency registers navigation, module-role, effect-api, and cache-storage provider plugin provenance.
  - Disabling TanStack removes all four.

- Add an extraction-surface test.
  - A TanStack route loader importing server code does not inflate client interaction sources.
  - A route component importing client hooks still extracts handlers.

## 7. Verification

Run:

- `rtk pnpm test -- src/extract/sources/tanstack-router/module-roles.test.ts src/extract/sources/tanstack-router/server-effects.test.ts src/extract/sources/tanstack-router/cache.test.ts`
- `rtk pnpm test -- src/cli/registry/index.test.ts`
- `rtk pnpm test -- src/cli/features/extract`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- TanStack loader and beforeLoad code is not pulled wholesale into client interaction extraction.
- Loader and beforeLoad operations appear as effect APIs with source provenance.
- Static redirects become automatic route-bound replace transitions.
- TanStack route cache vars are finite, bounded, and caveated where approximate.
- Plugin provenance reports TanStack navigation, module-role, effect-api, cache-storage, and observation providers.
- Existing React Router and Next module-boundary tests still pass.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if TanStack loader/cache behavior requires modeling unbounded per-param cache keys; propose an overlay/refinement requirement.
- Stop and report if server/client boundaries are not inferable from static route option structure in a representative fixture.
- Stop and report if redirect semantics are ambiguous between push and replace; default to replace only with a caveat if implementation proceeds.
- Do not silently drop route data-loading effects that can change reachable UI state; model them as effect APIs or caveat them as unsupported.
