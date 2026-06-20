---
id: tanstack
title: TanStack Router
sidebar_label: TanStack Router
---

TanStack Router is modeled through the built-in **`tanstackRouterAdapter()`**
navigation adapter and companion providers (`tanstackRouterModuleRoleAdapter()`,
`tanstackRouterEffectApiProvider()`, `tanstackRouterCacheStorageProvider()`).
It auto-activates when `@tanstack/react-router` appears in your app dependencies
and `next` is absent. See [Navigation architecture](../architecture/navigation.md)
for the full adapter contract.

## What is modeled

- **File-based routes** — discovery from `routes/` and `src/routes/` using TanStack
  filename conventions (flat dot routes, directory routes, `$param`, splat `$`, and
  pathless `_layout` segments). Literal `createFileRoute("...")` paths override filename
  inference.
- **Code-based route trees** — static trees built with `createRootRoute`,
  `createRoute`, `.addChildren(...)`, and `createRouter` when declarations resolve
  without executing generated output.
- **`routeTree.gen.ts`** — committed generated trees may enrich parent/child metadata
  and pull in referenced route modules without running the generated module.
- **`sys:route` / `sys:history`** — leaf URL and bounded back-stack (same contract as
  React Router).
- **Route-tree branch state** — optional `sys:tanstack:branch` for pathless layout
  mountedness when a static tree is discoverable.
- **Navigation** — `useNavigate`, `<Link>`, and `<Navigate>` with TanStack `to` /
  `params` / `search` / `replace` options lower to `navigate` effects when targets are
  statically known.
- **Loader / beforeLoad** — discovered as `LOADER <route>` and `BEFORE_LOAD <route>`
  effect APIs with source provenance (bodies are not symbolically executed).
- **Loader cache** — bounded `sys:tanstack:loader-cache:*` vars plus stale/revalidate/error
  environment transitions for routes with loaders.

## Extraction invocation

```bash
modality extract src/routes/index.tsx --route /
```

Point extraction at a route module or a project directory with
`@tanstack/react-router` in `package.json`. The CLI selects the TanStack adapter
automatically (Next still wins when both are present).

## Caveats and conservative limits

- **Commit `routeTree.gen.ts`.** File-based apps should check in the generated route
  tree so discovery can see the full static manifest.
- **Static route trees extract best.** Dynamic code-based route construction, runtime
  route registration, and non-literal `createFileRoute` paths may need overlay/config
  help or emit `model-slack` caveats.
- **Loader/cache modeling is bounded.** Per-route loader cache vars are capped; high
  loader counts and dynamic cache keys are reduced with structured caveats rather than
  unbounded state.
- **Search-only navigation** and unknown dynamic `to` targets are over-approximated.
- **Ambiguous component-to-route mapping** returns `undefined` mount scope rather than
  guessing when multiple routes share a component basename.

## Route coverage

Layouts and resource routes appear in the route-coverage report with reasons. Only UI
`page` / `index` routes enter the `sys:route` enum. Redirect-only routes are classified
when `redirect({ to: "..." })` is statically visible in loader/beforeLoad.

## Disabling

```bash
modality extract --disable-plugin tanstack-router …
```

Or pass an explicit `routerPlugin` (`NavigationAdapter`) in `modality.config.ts` to force
React Router, Next, or a custom adapter.
