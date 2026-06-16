---
id: navigation
title: Navigation
sidebar_label: Navigation
---

Routing is owned by a **framework-agnostic adapter**, not hardcoded into the extraction
engine. Exactly one router is active per app (unlike state sources, which compose), so
it is a sibling contract to the [state-source SPI](./state-sources.md): the
`NavigationAdapter` (the older name `RouterPlugin` remains as a `@deprecated` alias; the
react-router factory is `reactRouterAdapter()`).

## The model: nodes are routes, edges are intents

```mermaid
flowchart LR
  manifest["route manifest"] -->|discoverRoutes| inv["RouteInventory<br/>(classified RouteNodes)"]
  inv --> dom["sys:route enum<br/>(page + index routes)"]
  src["navigate()/&lt;Link&gt;/redirect"] -->|adapter classifies| intent["NavIntent<br/>push / replace / back"]
  intent --> nav["navigate effect → sys:route / sys:history"]
```

- **Nodes = the route manifest.** The route domain is driven by the manifest (a
  classified `RouteInventory`), not scavenged from literal `navigate()`/`<Link>` targets.
  This fixes the old failure where low-traffic routes that nothing navigated to *by
  literal* were simply missing from `sys:route`.
- **Edges = navigation intents** (`push` / `replace` / `back`), classified by the
  adapter from navigation calls and JSX.
- **`sys:route` / `sys:history`** remain the fixed lowering target — the checker's
  location state. A single navigation-lowering step produces them; they are not
  hand-wired across the codebase.

## The engine is framework-blind

The extraction engine contains **zero** react-router-specific identifiers. It only ever
asks the adapter:

| Adapter method | Responsibility |
| --- | --- |
| `discoverRoutes` | parse the manifest into a `RouteInventory` |
| `classifyNavigationCall` | is this call a `push`/`replace`/`back`? to where? |
| `classifyNavigationJsx` | is this JSX element a navigation (e.g. `<Link>`)? |
| `routeForFile` | which route does this module belong to? |
| `locationVars` | the location state variables |
| `classifyModule` / `moduleEntryExports` / `classifyImportEdge` / `isServerOnlyModule` | optional server/client module-boundary hints (used by P0) |

The same engine has been driven by a second, fake Next.js-style adapter in tests —
proving the abstraction is real and not react-router in disguise.

## Route classification

`RouteKind` is `page | index | layout | resource`. **Modeled routes** (which enter the
`sys:route` enum) are `page` + `index`; `layout` and `resource` (e.g. API/`.ts` routes)
are excluded and listed with a reason in the **route-coverage report**. A redirect-only
page *is* modeled, with an automatic edge (below).

## Redirects lower to existing IR

A loader/route `redirect(T)` becomes an automatic route-bound `replace` transition —
`{ kind: "navigate", mode: "replace", to: lit(T) }`. There is **no** new `EffectIR` or
label kind; redirects reuse the existing `navigate` effect, so the IR validator, the
checker, and the TLA+ export need no navigation-specific changes. (`forward`/`go` are
out of scope until the IR is extended.)

## History domain reduction (sound)

`sys:route` grows to all UI routes, but the `sys:history` **inner** domain is reduced to
the navigation-relevant subset (push origins ∪ push targets ∪ initial). When an
unbound/global push exists, it falls back to the **full** `sys:route` domain — a sound
over-approximation. If the reduced subset cannot be proven sound for a given app, the
adapter falls back to the full set rather than guessing a smaller one. `maxHistory`
defaults to 4.

## Default scope: client UI transitions

Default extraction models **client UI transitions** only. Server/full-route execution
(loaders, actions, initial data loading) is future work. Server-only modules are
excluded from the client model via the adapter's module-classification hints, so they do
not inflate it.
