---
id: package-entry-points
title: Package entry points
sidebar_label: Package entry points
---

`modality-ts` is a single package with subpath exports aligned to the
[architecture](../architecture/index.md)'s package-like boundaries and runtime contexts.
The `modality` CLI binary is the default product surface.

## CLI surfaces

| Entry point | Purpose |
| --- | --- |
| `modality-ts` | package root |
| `modality-ts/cli` | programmatic CLI API |
| `modality-ts/cli/extract`, `/check`, `/replay`, `/conform`, `/ci`, `/export-tla`, `/overlay` | per-command programmatic entry points |
| `modality-ts/cli/harness` | replay-harness runtime (jsdom) |
| `modality-ts/cli/runtime` | dev-build runtime assertions (kernel-light) |

## Kernel and engine

| Entry point | Purpose |
| --- | --- |
| `modality-ts/core` | the [kernel](../architecture/index.md): IR types, domain helpers, property combinators, traces, reports, overlay, numeric aliases |
| `modality-ts/core/props` | property helper APIs |
| `modality-ts/check` | the [checker](../architecture/checker.md) API (`checkModel`) — Rust-backed |
| `modality-ts/extract` | extraction APIs |
| `modality-ts/extract/engine` | extraction engine APIs |
| `modality-ts/extract/engine/pipeline` | the P0–P7 pipeline |
| `modality-ts/extract/engine/spi` | the [`StateSourcePlugin` / `NavigationAdapter`](../architecture/state-sources.md) SPI plus `ModuleRoleAdapter`, `EffectApiProvider`, `CacheStorageProvider`, `ObservationProvider`, and `DomainRefinementProvider` |

## Type-library adapters

Schema libraries register as **domain refinement providers** (not state sources).
See [Type-library adapters](../architecture/type-library-adapters.md).

| Entry point | Adapter |
| --- | --- |
| `modality-ts/extract/plugins/type/zod` | Zod numeric schema initializer refinement |
| `modality-ts/extract/plugins/type/arktype` | ArkType static schema initializer refinement |

## State-source slices

Each source has a Node entry (`"."`) and a jsdom harness entry (`"./harness"`) — the
[extraction/harness split](../architecture/state-sources.md#extraction--harness-split-inside-one-package):

| Entry point | Source |
| --- | --- |
| `modality-ts/extract/plugins/state/use-state` (+ `/harness`) | [`useState`](../sources/use-state.md) |
| `modality-ts/extract/plugins/state/jotai` (+ `/harness`) | [Jotai](../sources/jotai.md) (peer dep: `jotai`) |
| `modality-ts/extract/plugins/state/swr` (+ `/harness`) | [SWR](../sources/swr.md) (peer dep: `swr`) |
| `modality-ts/extract/plugins/state/zustand` (+ `/harness`) | [Zustand](../sources/zustand.md) (peer dep: `zustand`) |
| `modality-ts/extract/plugins/state/tanstack-query` (+ `/harness`) | [TanStack Query](../sources/tanstack-query.md) (peer dep: `@tanstack/react-query`) |
| `modality-ts/extract/plugins/state/redux` (+ `/harness`) | [Redux](../sources/redux.md) (peer deps: `@reduxjs/toolkit`, `react-redux`, `redux`) |
| `modality-ts/extract/plugins/route/router` (+ `/harness`) | [Router](../sources/router.md) — `reactRouterAdapter()`, `reactRouterModuleRoleAdapter()`, `reactRouterEffectApiProvider()` (peer dep: `react-router`) |
| `modality-ts/extract/plugins/route/next` (+ `/harness`) | [Next.js](../sources/next.md) — `nextAdapter()`, `nextModuleRoleAdapter()`, `nextEffectApiProvider()`, `nextCacheStorageProvider()` (peer dep: `next`) |

## Handler-wrapper adapters

Handler-wrapper adapters implement `HandlerWrapperProvider` (from `modality-ts/extract/engine/spi`)
rather than `StateSourcePlugin`. They have no harness entry because they contribute no
state variables and require no replay observation.

| Entry point | Adapter |
| --- | --- |
| `modality-ts/extract/plugins/framework/react-hook-form` | [React Hook Form](../sources/react-hook-form.md) — `reactHookFormSource()` (peer dep: `react-hook-form`) |

## Why the split

The boundaries follow **runtime contexts**, enforced by dependency-cruiser:

- a source's `"."` entry may import TS-analysis deps but **must not** import RTL/MSW;
- a source's `"./harness"` entry may import the library itself but **must not** import the
  TS compiler tooling;
- `cli/runtime` (shipped in the app's dev bundle) depends only on the `core/props`
  subpath, so bundlers tree-shake everything else.

This keeps heavy static-analysis dependencies out of test bundles and app-facing
dependencies out of the CLI. See the [architecture overview](../architecture/index.md).
