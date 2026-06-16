---
id: next
title: Next.js
sidebar_label: Next.js
---

Next.js is modeled through the built-in **`nextAdapter()`** navigation adapter. It
auto-activates when `next` appears in your app dependencies (and takes priority over
React Router). See [Navigation architecture](../architecture/navigation.md) for the
full adapter contract.

## What is modeled

- **Filesystem routes** — App Router (`app/`, `src/app/`) and Pages Router (`pages/`,
  `src/pages/`) including dynamic segments, catch-alls, route groups, parallel slots,
  and intercepting routes.
- **`sys:route` / `sys:history`** — leaf URL and back-stack (same contract as React
  Router).
- **Route-tree vars** — `sys:next:slot:*` and `sys:next:phase:*` for layout-scoped
  mountedness, parallel routes, and finite loading/error phases.
- **Navigation** — `next/link`, `next/navigation`, and `next/router` intents lower
  to `navigate` effects (often updating both flat route and slot state).
- **Server APIs** — Server Actions, Route Handlers, Pages API routes, data fetching
  exports, and server `fetch` calls become nondeterministic async effect APIs (not
  symbolically executed).
- **Mount scopes** — layout `useState` survives sibling page navigations; template and
  page state reset on remount.

## What is not modeled exactly

- React Flight / HTML streaming byte timing
- Arbitrary server or database logic
- Build output (`.next/`) — discovery is source-only
- Image, font, metadata, and CSS unless they expose user callbacks or cache behavior

## Route coverage

Layouts, templates, Route Handlers, and API routes appear in the route-coverage report
with classifications (`layout`, `resource`, `api`, …). Only UI `page` / `index` routes
enter the `sys:route` enum.

## Disabling

```bash
modality extract --disable-plugin next …
```

Or pass an explicit `routerPlugin` in `modality.config.ts` to force React Router or a
custom adapter.
