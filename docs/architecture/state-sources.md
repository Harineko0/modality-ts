---
id: state-sources
title: State sources & the plugin SPI
sidebar_label: State sources & SPI
---

Supporting a new state library is the most common way `modality-ts` grows. The
architecture makes it a **vertical slice**: one new package under
`src/extract/sources/`, with *zero* diffs elsewhere. The built-in sources
(`use-state`, `jotai`, `swr`, `zustand`, `tanstack-query`, `redux`, `router`) use **exactly** the public contract —
they are its permanent conformance suite.

## The `StateSourcePlugin` contract

Defined in `modality-ts/extract/engine/spi`, consumed by the pipeline, the harness, and
conformance. Methods are grouped by pipeline phase; each receives a narrow context object
(never the whole pipeline) so the contract is implementable out of tree.

```ts
interface StateSourcePlugin {
  id: string;                  // 'jotai' | 'swr' | 'zustand' | ...
  packageNames: string[];      // npm packages whose imports activate the plugin
  version?: string;

  // ── extraction (Node) ──────────────────────────────────────────────
  discover(ctx): SourceDecl[];                       // P1: find state declarations
  domainHints?(decl, ctx): AbstractDomain | undefined; // P2: library-specific domains
  writeChannels(ctx): WriteChannel[];                // P5: every write API of this source
  summarizeWrite?(call, ctx): EffectIR | "unsupported"; // P4: translate a write call
  safetyWarnings?(ctx): ExtractionWarning[];          // structured warnings with optional caveat,
                                                      // confidence, and producer metadata
  template?(decl, options): TemplateFragment;        // library-behaviour model (SWR: yes)

  // ── replay (jsdom; from 'modality-ts/extract/sources/*/harness') ────
  harness: {
    setup(ctx): HarnessHooks;                        // providers/stores; observation handles
    observe(varId, handles): ObservedRead | "unobservable";
    witness?(domain, varId): WitnessFactory | undefined;
  };

  // ── conformance (Node + jsdom) ─────────────────────────────────────
  conformance?: { templateProbes?: ProbeWalk[]; testedVersions: string };
}
```

## Why this shape is E1-safe

The [E1 invariant](../soundness/e1-invariant.md) survives plugin-authoring errors in
only one direction:

- **`writeChannels` omissions are safe.** A write through an undeclared channel is seen
  by [escape analysis](./extraction-pipeline.md#p5--escape-analysis-the-e1-enforcer) as
  an unknown call → taint → loud over-approximation. A plugin *cannot* cause a silent
  missed write by under-declaring; it can only cause noise.
- **`summarizeWrite` is the one place a plugin can lie dangerously** — returning wrong
  IR for a recognized write. That is exactly what the
  [conformance probes and per-transition pass-rates](./conformance-and-replay.md) exist
  to catch.

Plugin authors are part of the trusted base, and the contract's doc comments say so. The
registry stamps each active plugin's ID + version into the
[trust ledger](../soundness/trust-ledger.md) — the report must say which code produced
the model.

## Extraction / harness split inside one package

Each source package has two entry points via `exports`: `"."` (Node, may import the TS
compiler types) and `"./harness"` (jsdom, may import the library itself as a *peer*
dependency). The pipeline loads `"."`; generated tests import `"./harness"`. This keeps
heavy static-analysis deps out of test bundles and app-facing deps out of the CLI — and
it is enforced by the [dependency rules](./index.md), not convention.

## A source package as a vertical slice

```text
src/extract/sources/jotai/
├── imports.ts        # module + alias resolution
├── ids.ts            # store/family-qualified var IDs
├── discover.ts       # P1: atoms + utility creators + family instances
├── domains.ts        # P2 classification
├── derived-writes.ts # writable-derived-atom summarization
├── writes.ts         # P3/P5 channels + safety warnings
├── harness.ts        # observation handles
└── index.ts          # assembles and exports the plugin
```

## Registration and gating

`modality.config` lists plugins; built-ins auto-register when their `packageNames` match
the app's dependencies, and config can disable any of them
(`--disable-plugin <id>`). Third-party plugins are ordinary npm packages exporting a
`StateSourcePlugin`; the registry validates the contract shape at load.

## Adapter capabilities beyond state sources

Built-in framework adapters compose several **orthogonal capabilities** through
the CLI registry bundle (`RegistryAdaptersBundle`):

| Capability | Interface | Responsibility |
| --- | --- | --- |
| Navigation | `NavigationAdapter` | route discovery, navigation classification/lowering, location vars, mount scopes, navigation harness |
| Module roles | `ModuleRoleAdapter` | server/client/shared classification, entry exports, import-edge context, server-only exclusion |
| Effect APIs | `EffectApiProvider` | discover server actions, route handlers, and other nondeterministic async surfaces |
| Cache/storage | `CacheStorageProvider` | framework cache vars and invalidation transitions (Next.js, TanStack Router loader cache) |
| Observation | `ObservationProvider` | replay `setup` / `observe` / optional `witness` for state sources and navigation |
| Domain refinement | `DomainRefinementProvider` | schema-driven finite domains (Zod, ArkType) |
| Handler wrapper | `HandlerWrapperProvider` | unwrap form-library submit wrappers (e.g. `handleSubmit(cb)`) so that the inner callback body is extractable; contributes no state variables |

Exactly one `NavigationAdapter` is active per app. Module-role, effect-API, and
cache/storage providers may register in parallel when their `packageNames`
match app dependencies. Observation providers are synthesized from active state
sources and navigation. See [Navigation](./navigation.md) and
[Conformance & replay](./conformance-and-replay.md).

Handler-wrapper providers are also parallel-registerable and have no interaction with
state-source or navigation capabilities. Built-in: [React Hook Form](../sources/react-hook-form.md).

## Capability matrix

| Source | Discovery | Write channels | Template | Observation | Page |
| --- | --- | --- | --- | --- | --- |
| `useState` | hook calls | setter symbols | none | DOM projection / probe | [details](../sources/use-state.md) |
| Jotai | `atom()` + utility creators + families | `useSetAtom`/`useAtom`/`store.set` | none | store handle (direct) | [details](../sources/jotai.md) |
| SWR | `useSWR` key sites | `mutate` | **yes** (cache lifecycle) | cache `Map` (direct) | [details](../sources/swr.md) |
| Zustand | `create`/`createStore` | actions / `setState` | none | store handle (direct) | [details](../sources/zustand.md) |
| TanStack Query | `useQuery` / `useMutation` | QueryClient cache APIs, `mutate` | **yes** (query + mutation lifecycle) | `QueryClient` handle | [details](../sources/tanstack-query.md) |
| Redux | `configureStore` / slices | `dispatch`, thunks | **yes** (RTK Query cache) | store `getState()` + Provider | [details](../sources/redux.md) |
| Router | route manifest (adapter) | — | location semantics | router test API | [details](./navigation.md) |
| TanStack Router | route manifest + loader cache (adapters) | — | loader cache semantics | router harness + branch vars | [details](../sources/tanstack-router.md) |

A future source like **XState** fits especially well (machines *are* transition systems
— a direct machine→IR import, bypassing the M0 interpreter). **React Context as state**
does *not* fit — its writes are unanalyzable, so it stays a documented taint, not a
plugin.
