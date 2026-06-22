# TanStack Router Support Plan 1: Route Inventory and Adapter Foundation

## 1. Goal

Add the foundational TanStack Router adapter surface for `@tanstack/react-router`, with route discovery that produces a sound `RouteInventory` for both file-based and code-based TanStack Router apps.

This is plan 1 of 4. It must land before:

- `260621-02-tanstack-router-navigation-and-route-state.md`
- `260621-03-tanstack-router-loaders-cache-and-module-boundaries.md`
- `260621-04-tanstack-router-docs-examples-and-conformance.md`

Official documentation checked:

- https://tanstack.com/router/latest/docs/routing/route-trees
- https://tanstack.com/router/latest/docs/routing/file-based-routing
- https://tanstack.com/router/latest/docs/routing/code-based-routing
- https://tanstack.com/router/latest/docs/faq

Relevant TanStack findings:

- TanStack Router is built around a nested route tree.
- File-based routing is the preferred and recommended configuration path, but code-based routing uses the same route tree concept.
- File-based routing supports directory routes, flat routes, mixed flat/directory routes, pathless layout routes prefixed with `_`, dynamic segments prefixed with `$`, and splat/catch-all routes.
- `routeTree.gen.ts` is generated but should be committed and treated as runtime source, not as disposable build output.
- Route modules commonly export `Route = createFileRoute("...")({...})`; code-based routing commonly uses `createRootRoute`, `createRoute`, `addChildren`, and `createRouter({ routeTree })`.

## 2. Non-goals

- Do not classify navigation calls, `<Link>`, `<Navigate>`, loader redirects, router cache state, or replay behavior in this plan. Those belong to later plans.
- Do not add TanStack Start-specific filesystem semantics beyond plain TanStack Router conventions.
- Do not execute user route modules or generated `routeTree.gen.ts`; use static TypeScript AST analysis only.
- Do not change trusted checker/core IR semantics.
- Do not touch generated `dist/`.
- Do not refactor React Router or Next adapters except for tiny shared helpers where the duplication is obvious and covered by existing tests.

## 3. Current-State Findings

- Navigation is intentionally adapter-owned through `NavigationAdapter` in `src/extract/engine/spi/index.ts`.
- Built-in router selection lives in `src/cli/registry/index.ts`. It currently chooses `nextAdapter()` when `next` is present, `reactRouterAdapter()` when `react-router` or `react-router-dom` is present, and React Router by default when dependencies are unavailable.
- React Router support is under `src/extract/sources/router/`; Next support is under `src/extract/sources/next/`.
- `attachRouteInventory` in `src/cli/features/extract/extraction-project.ts` currently has React Router-specific manifest fallback behavior: it searches for nearest `app/routes.ts`.
- `resolveRouterDiscoveryRoot` currently infers roots from `app/` and `pages/`, which is suitable for Next but not TanStack Router's usual `src/routes`.
- `RouteInventory` currently has generic `RouteNode` fields: `pattern`, `kind`, `file`, `redirectTo`, and free-form `metadata`.
- Existing tests to follow:
  - `src/extract/sources/router/discover.test.ts`
  - `src/extract/sources/next/discover.test.ts`
  - `src/cli/registry/index.test.ts`
  - `src/extract/engine/navigation-adapter-fit.test.ts`

## 4. Existing Patterns to Follow

- Add a new built-in source directory: `src/extract/sources/tanstack-router/`.
- Match adapter factory shape from `src/extract/sources/router/index.ts` and `src/extract/sources/next/index.ts`.
- Keep route discovery pure and AST/file-list driven, like the existing React Router and Next discoverers.
- Put TanStack-specific metadata under `RouteNode.metadata.tanstackRouteTree`, not top-level ad hoc fields.
- Use `route.kind` consistently:
  - `index` for `/`
  - `page` for UI leaf routes
  - `layout` for root/pathless/layout route nodes that should not enter `sys:route`
  - `resource` only for files that are clearly non-UI resources, if any are supported later
- Preserve package export style from `package.json` by adding `./extract/sources/tanstack-router` and `./extract/sources/tanstack-router/harness` only after source files exist.

## 5. Atomic Implementation Steps

1. Create `src/extract/sources/tanstack-router/types.ts`.
   - Define metadata types for TanStack route nodes: route id, full path, file path, parent id, segment kind, route kind, pathless/layout marker, generated-route-tree provenance, and discovery mode (`file`, `generated`, `code`).
   - Keep metadata JSON-compatible because `RouteNode.metadata` stores `Value`.

2. Create `src/extract/sources/tanstack-router/discover.ts`.
   - Export `discoverRoutes(ctx: RouteDiscoveryCtx): Promise<RouteInventory>`.
   - Export focused helpers for tests, for example `tanstackFilePathToPattern`, `parseTanstackCreateFileRoute`, and `parseTanstackCodeRoutes`.

3. Implement file-based route discovery from `routes/` roots.
   - Detect `routes/` and `src/routes/` files from `ctx.files`.
   - Also detect absolute paths that contain `/routes/` or `/src/routes/` after normalizing path separators.
   - Ignore `routeTree.gen.ts`, test files, declaration files, and obvious non-route support files unless they contain a `createFileRoute(...)` route export.
   - Treat `__root.tsx` as a root/layout node with no `sys:route` entry.
   - Treat `index.tsx` and nested `index.tsx` as exact/index routes for the parent URL.
   - Convert `$param` segments into `:param` in Modality route patterns.
   - Convert `$` splat segments into `*`.
   - Treat `_pathless` or `_pathlessLayout` route segments as pathless layout metadata and do not add the `_...` segment to the URL pattern.
   - Support both directory and flat-route naming because official docs say both forms can be mixed.

4. Parse `createFileRoute("...")` calls as the authoritative path when present.
   - Recognize imports from `@tanstack/react-router`.
   - Find exported `Route` declarations that call `createFileRoute`.
   - Use the string literal argument as the route path/source id.
   - Normalize TanStack dynamic `$param` path syntax into Modality `:param`.
   - Preserve the source file in `RouteNode.file`.
   - Fall back to file path conventions only if no literal `createFileRoute` path is available.

5. Parse committed generated route trees as an optional enrichment source.
   - If `routeTree.gen.ts` is present in `ctx.files`, parse it without executing it.
   - Use it to improve parent-child metadata and to discover route files that are not in the initial file list.
   - Read missing referenced files through `ctx.readFile` when paths are static string literals and under the discovered project root.
   - Do not require `routeTree.gen.ts`; official docs recommend committing it, but users may extract before generation.

6. Implement code-based route discovery.
   - Detect calls to `createRootRoute`, `createRootRouteWithContext`, `createRoute`, `createRouter`, and `.addChildren(...)` from `@tanstack/react-router`.
   - Resolve simple variable declarations in the same file.
   - Extract literal `path`, `id`, `getParentRoute`, and component references where present.
   - Build parent-child relationships for simple same-file and same-project static declarations.
   - Support index routes where `path: "/"`.
   - Support pathless code routes where `id` exists but `path` is absent; classify as `layout`.
   - If the route tree is too dynamic to statically resolve, return discovered static routes and emit a warning later when warning plumbing exists; do not guess missing paths.

7. Implement route sorting and duplicate handling.
   - Sort deterministically by pattern, then kind, then file.
   - Deduplicate exact duplicate `(pattern, kind, file)` nodes.
   - If two UI routes produce the same `pattern` but different files, keep both only if metadata distinguishes route ids; otherwise keep one deterministic node and plan a caveat in plan 4.

8. Add `routeForComponent(componentName, inventory)`.
   - Follow the basename matching strategy from React Router and Next.
   - For TanStack file routes, also match `component` option identifiers from parsed route options when statically visible.
   - Return `undefined` on ambiguity.

9. Create `src/extract/sources/tanstack-router/routes.ts`.
   - For now, export `locationVars` equivalent to React Router's flat `sys:route` / `sys:history` implementation.
   - Keep this local to TanStack Router so plan 2 can extend it with route-tree vars if needed.

10. Create `src/extract/sources/tanstack-router/harness.ts`.
    - Implement the same minimal abstract navigation harness shape as React Router for now: `setup`, `observe`, and `navigate`.
    - Keep route/history var ids as `sys:route` and `sys:history` unless plan 2 changes route-tree state.

11. Create `src/extract/sources/tanstack-router/index.ts`.
    - Export `tanstackRouterAdapter(options?)`.
    - Use id `tanstack-router`, version `0.1.0`, and package names `["@tanstack/react-router"]`.
    - Export discovery helpers useful to tests.
    - Do not export module-role or effect-api providers in this plan.

12. Register the adapter in `src/cli/registry/index.ts`.
    - Import `tanstackRouterAdapter`.
    - Choose priority: `next` first, then `@tanstack/react-router`, then React Router.
    - Respect `disabledPlugins`.
    - Use disabled id `tanstack-router`.
    - Do not enable TanStack Router by default when dependencies are unavailable; keep the existing no-dependencies default to React Router.

13. Generalize route inventory attachment.
    - Refactor `attachRouteInventory` so React Router-specific `app/routes.ts` fallback only runs for the React Router adapter.
    - Add a generic route-root fallback for TanStack Router that discovers nearby `src/routes`, `routes`, and committed `routeTree.gen.ts` files when extracting from a directory or from a file inside a TanStack app.
    - Avoid broad file-system crawling beyond bounded depth and obvious route roots.
    - Preserve existing React Router behavior.

14. Add package exports in `package.json`.
    - Add `./extract/sources/tanstack-router`.
    - Add `./extract/sources/tanstack-router/harness`.

15. Update `docs/architecture/navigation.md` and `docs/_specs/02-extraction.md`.
    - Add TanStack Router to the built-in adapter table.
    - Describe file-based and code-based route discovery at a high level.
    - Keep docs aligned with the actual implemented scope from this plan.

## 6. Tests to Add or Update

- Add `src/extract/sources/tanstack-router/discover.test.ts`.
  - File-based route fixtures for `__root.tsx`, `index.tsx`, `about.tsx`, `posts/$postId.tsx`, `posts.$postId.edit.tsx`, `_pathlessLayout.route-a.tsx`, and `files.$.tsx`.
  - Mixed flat/directory route fixture matching official docs.
  - `createFileRoute` literal path wins over file convention.
  - Dynamic `$param` normalizes to `:param`.
  - Splat `$` normalizes to `*`.
  - Pathless layout is `layout` and does not enter UI route domain.
  - Code-based route fixture with `createRootRoute`, `createRoute`, `addChildren`, and `createRouter`.
  - Ambiguous `routeForComponent` returns `undefined`.

- Update `src/cli/registry/index.test.ts`.
  - `@tanstack/react-router` dependency activates `tanstack-router`.
  - `next` wins over TanStack Router if both dependencies exist.
  - `disabledPlugins: ["tanstack-router"]` prevents activation.
  - React Router still activates when only `react-router-dom` is present.

- Add or update extraction-project tests.
  - Extracting a directory with `src/routes` attaches TanStack inventory.
  - Extracting a single file inside `src/routes` can resolve its route from inventory.
  - React Router `app/routes.ts` fallback still works.

## 7. Verification

Run:

- `rtk pnpm test -- src/extract/sources/tanstack-router/discover.test.ts src/cli/registry/index.test.ts`
- `rtk pnpm test -- src/cli/features/extract`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm fix`

If `pnpm test` invokes the Rust build and fails for native-toolchain reasons unrelated to TypeScript changes, run the focused Vitest command with the repo's existing pattern and report the native blocker.

## 8. Acceptance Criteria

- A project with `@tanstack/react-router` dependencies activates the TanStack adapter.
- TanStack file-based routes in `src/routes` or `routes` produce deterministic `RouteInventory` entries.
- TanStack code-based routes with static same-file route trees produce deterministic `RouteInventory` entries.
- Dynamic and splat path syntax are normalized to existing Modality route pattern conventions.
- Pathless/root layout routes are represented but excluded from `sys:route` UI values.
- React Router and Next tests still pass.
- No generated `dist/` files are changed.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if route tree generation syntax in real fixtures differs materially from the official docs and cannot be parsed without executing modules.
- Stop and report if `RouteNode.metadata` cannot carry enough parent-child data without broad SPI changes.
- Stop and report if `attachRouteInventory` requires an unbounded source crawl; propose a bounded route-root discovery helper instead.
- Treat dynamic code-based route construction as partially supported with explicit warnings rather than inventing route patterns.
- Do not attempt backward compatibility aliases; this project is experimental and should keep the adapter clean.
