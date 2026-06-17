# Adapter SPI Consolidation

## Goal

Make library and framework support in `modality-ts` explicit, composable, and testable by consolidating the adapter SPI around narrowly scoped contracts instead of hidden conventions or private cross-slice imports.

This plan should turn the current monolithic-ish `NavigationAdapter` plus `StateSourcePlugin` shape into a capability-based adapter surface that covers:

- navigation and route topology;
- state sources;
- effect API discovery;
- schema/domain refinement;
- client/server module roles;
- cache/storage abstractions;
- replay harness observation;
- structured caveats and confidence metadata.

The implementation should prefer deleting old aliases and special cases over preserving compatibility. The end state should make built-in adapters prove the public contracts, and make future library/framework support possible without editing unrelated engine or CLI internals.

## Non-goals

- Do not implement a new library adapter such as TanStack Query, Redux, XState, or another router.
- Do not change checker semantics except where provenance or structured metadata requires schema validation updates.
- Do not implement a full cache/runtime/storage interpreter.
- Do not preserve `RouterPlugin` as a compatibility alias.
- Do not keep `NavigationAdapter` as the owner of every framework capability if a separate SPI better represents the contract.
- Do not add global mutable registries.
- Do not loosen dependency-cruiser rules to allow engine-to-source or CLI-to-source private imports.
- Do not edit generated `dist/` artifacts.

## Current-State Findings

- `src/extract/engine/spi/index.ts` is the central SPI file. It already defines `StateSourcePlugin`, `DomainRefinementProvider`, `NavigationAdapter`, `ModuleClassification`, `ImportEdgeContext`, `EffectApiDiscoveryCtx`, `DiscoveredEffectApi`, harness observation shapes, and `ExtractionWarning`.
- `NavigationAdapter` currently owns several distinct capabilities:
  - route discovery and navigation lowering;
  - module role classification and import-edge classification;
  - server effect API discovery;
  - route tree vars, mount scopes, and harness navigation.
- `src/extract/engine/spi/index.ts` still exports `RouterPlugin` as a deprecated alias for `NavigationAdapter`. Many files still import or type options as `RouterPlugin`.
- The CLI has private framework wiring:
  - `src/cli/features/extract/command.ts` imports `routerSource` / `parseReactRouterRoutes` from `modality-ts/extract/sources/router`.
  - It imports `discoverNextServerEffectApis`, `discoverNextCacheFromSources`, and Next config helpers directly from `src/extract/sources/next/*`.
  - It checks `routerAdapter.id === "next"` and `routerAdapter.id === "router"` for behavior that should be expressed as adapter capabilities.
- `src/cli/features/extract/project.ts` has hardcoded framework decisions inside `sourceWithReachableImports`, including `adapter.id === "next"` / `adapter.id === "router"` checks when deciding server surfaces for `discoverEffectApis`.
- `src/extract/engine/pipeline/index.ts` accepts `routerPlugin?: RouterPlugin`, calls `routerPlugin.locationVars`, and converts plugin safety warning strings with a `"Global taint "` prefix into structured caveats. This is a hidden warning-string convention.
- `StateSourcePlugin.safetyWarnings` returns `ExtractionWarning[]`, but docs in `docs/architecture/state-sources.md` still show `safetyWarnings?(ctx): ExtractionCaveat[]`. The implementation and documentation are drifting.
- `PluginProvenance.kind` in `src/core/ir/types.ts` currently supports `"state-source" | "router" | "domain-refinement"`. There is no provenance kind for separate effect API, module role, cache/storage, or replay observation adapters.
- `src/extract/sources/next/cache.ts` already models cache vars/transitions for Next cache usage, but it is consumed directly by the CLI rather than through a cache/storage SPI.
- Jotai and Zustand storage metadata lives in source-specific metadata and warning paths:
  - `src/extract/sources/jotai/types.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/zustand/types.ts`
  - `src/extract/sources/zustand/writes.ts`
- Replay harness observation is embedded in `StateSourcePlugin.harness` and `NavigationAdapter.harness`. There is no common observation contract or provenance surface for non-state capabilities like cache/storage or framework phase vars.
- Existing tests already exercise some SPI seams:
  - `src/extract/engine/navigation-adapter-fit.test.ts`
  - `src/cli/registry/index.test.ts`
  - `test/extraction/architecture.test.ts`
  - `test/extraction/next-module-boundaries.test.ts`
  - source-specific tests under `test/sources/*`
  - Next cache tests under `src/extract/sources/next/cache.test.ts`

## Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`
  - `DomainRefinementProvider`
  - `StateSourcePlugin`
  - `NavigationAdapter`
  - `RouterPlugin`
  - `ModuleRuntimeContext`
  - `ModuleClassification`
  - `ModuleEntryExport`
  - `ImportEdgeContext`
  - `EffectApiDiscoveryCtx`
  - `DiscoveredEffectApi`
  - `HarnessHooks`
  - `ObservedRead`
  - `ExtractionWarning`
- `/Users/hari/proj/modality-ts/src/core/ir/types.ts`
  - `PluginProvenance`
  - `ExtractionCaveat`
  - `Transition.confidence`
  - `Model.metadata.plugins`
  - `Model.metadata.extractionCaveats`
- `/Users/hari/proj/modality-ts/src/cli/registry/index.ts`
  - `ModalityPluginRegistry`
  - `BuiltinRegistryOptions`
  - `RegistrySummary`
  - `createBuiltinModalityRegistry`
  - `createModalityRegistry`
  - `validateRouterPlugin`
  - `validateStateSourcePlugin`
  - `validateDomainRefinementProvider`
- `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runExtractionPipeline`
  - `createPluginRegistry`
  - `provenanceForRouter`
  - `pluginSafetyWarning`
- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `ModalityConfig`
  - `ExtractCommandOptions`
  - `runExtractCommand`
  - `withServerEffectDiscovery`
  - `buildClientProjectSurface`
  - `runProjectExtractionPipeline`
  - `pluginProvenance`
  - `createExtractionCaveats`
  - `applyMountScopesFromRouter`
- `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts`
  - `sourceWithReachableImports`
  - `classifyModule`
  - `moduleEntryExports`
  - `classifyImportEdge`
  - `isServerOnlyTarget`
  - `discoverFetchOps`
  - `EffectApiProvenanceEntry`
  - `ModuleRecord`
- `/Users/hari/proj/modality-ts/src/extract/sources/next/index.ts`
  - `nextAdapter`
  - `NextSourceOptions`
- `/Users/hari/proj/modality-ts/src/extract/sources/router/index.ts`
  - `reactRouterAdapter`
  - `routerSource`
- `/Users/hari/proj/modality-ts/src/extract/sources/next/cache.ts`
  - `discoverNextCacheFromSources`
  - `nextCacheVarId`
- `/Users/hari/proj/modality-ts/src/extract/sources/next/server-effects.ts`
  - `discoverNextServerEffectApis`
- `/Users/hari/proj/modality-ts/src/extract/sources/router/server-effects.ts`
  - `discoverReactRouterActionEffectApis`
- `/Users/hari/proj/modality-ts/src/extract/sources/next/module-roles.ts`
  - `classifyNextModule`
  - `nextModuleEntryExports`
  - `classifyNextImportEdge`
  - `isNextServerOnlyModule`
- `/Users/hari/proj/modality-ts/src/extract/sources/router/module-roles.ts`
  - `classifyReactRouterModule`
  - `reactRouterModuleEntryExports`
  - `classifyReactRouterImportEdge`
  - `isServerOnlyModulePath`
- `/Users/hari/proj/modality-ts/src/extract/sources/jotai/writes.ts`
  - `discoverJotaiSafetyWarnings`
- `/Users/hari/proj/modality-ts/src/extract/sources/zustand/writes.ts`
  - `discoverZustandSafetyWarnings`
- `/Users/hari/proj/modality-ts/docs/architecture/state-sources.md`
- `/Users/hari/proj/modality-ts/docs/architecture/navigation.md`
- `/Users/hari/proj/modality-ts/docs/architecture/type-library-adapters.md`
- `/Users/hari/proj/modality-ts/docs/reference/schemas.md`
- `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md`
- `/Users/hari/proj/modality-ts/docs/_specs/05-architecture.md`

## Existing Patterns to Follow

- Keep contracts in `src/extract/engine/spi/index.ts`; adapters implement contracts from source/type-library slices.
- Keep built-in registration in `src/cli/registry/index.ts`; do not make the extraction engine import built-in adapters.
- Keep adapter output as plain IR, `StateVarDecl[]`, `Transition[]`, and typed caveats.
- Keep domain refinement providers under `src/extract/type-libraries/*`, not under `src/extract/sources/*`.
- Keep source-specific tests as conformance tests for the public SPI.
- Keep route/navigation semantics framework-neutral in the engine. Adapter-specific syntax belongs under `src/extract/sources/<framework>/`.
- Prefer explicit `undefined`/empty-array capability absence over id-based branching.
- Prefer structured caveats at creation sites over parsing warning strings later.

## Target Contract Shape

Implement the consolidation by adding explicit capability interfaces and a registry-owned bundle type. Suggested names are intentionally precise; adjust names only if a clearer local convention emerges during implementation.

```ts
export interface ModalityAdapterBase {
  id: string;
  version?: string;
  packageNames: readonly string[];
}

export interface NavigationAdapter extends ModalityAdapterBase {
  kind: "navigation";
  discoverRoutes(ctx: RouteDiscoveryCtx): Promise<RouteInventory>;
  classifyNavigationCall(callee: string, args: readonly unknown[]): NavIntent | "unsupported";
  classifyNavigationJsx?(tag: string, attrs: ReadonlyMap<string, unknown>): NavIntent | "unsupported";
  routeForComponent?(componentName: string, inventory: RouteInventory): string | undefined;
  locationVars(inventory: RouteInventory, options: ResolvedOptions, lowering: LocationLowering): readonly StateVarDecl[];
  routeTreeVars?(inventory: RouteInventory, options: ResolvedOptions): readonly StateVarDecl[];
  lowerNavigation?(intent: NavIntent, ctx: NavigationLoweringCtx): NavigationLoweringResult;
  mountScopeForComponent?(componentName: string, inventory: RouteInventory): StateVarDecl["scope"] | undefined;
  harness: NavigationHarness;
}

export interface ModuleRoleAdapter extends ModalityAdapterBase {
  kind: "module-roles";
  classifyModule(ctx: ModuleRoleCtx): ModuleClassification;
  moduleEntryExports(ctx: ModuleRoleCtx): readonly ModuleEntryExport[];
  classifyImportEdge(ctx: ImportEdgeCtx): ImportEdgeContext;
  isServerOnlyModule(fileName: string, classification?: ModuleClassification): boolean;
  shouldDiscoverEffectApis?(ctx: EffectApiSurfaceCtx): boolean;
}

export interface EffectApiProvider extends ModalityAdapterBase {
  kind: "effect-api";
  discoverEffectApis(ctx: EffectApiDiscoveryCtx): readonly DiscoveredEffectApi[];
  discoverClientEffectApis?(ctx: ClientEffectApiDiscoveryCtx): readonly DiscoveredEffectApi[];
}

export interface CacheStorageProvider extends ModalityAdapterBase {
  kind: "cache-storage";
  discoverCacheStorage(ctx: CacheStorageDiscoveryCtx): CacheStorageFragment;
}

export interface ObservationProvider extends ModalityAdapterBase {
  kind: "observation";
  setup(ctx: HarnessCtx): HarnessHooks;
  observe(varId: string, handles: HarnessHooks): ObservedRead | "unobservable";
  witness?(domain: AbstractDomain, varId: string): WitnessFactory | undefined;
}

export interface AdapterBundle {
  navigation?: NavigationAdapter;
  moduleRoles?: readonly ModuleRoleAdapter[];
  effectApis?: readonly EffectApiProvider[];
  cacheStorage?: readonly CacheStorageProvider[];
  stateSources: readonly StateSourcePlugin[];
  domainRefinements: readonly DomainRefinementProvider[];
  observations: readonly ObservationProvider[];
}
```

This target shape is a guide, not a requirement to over-abstract in one diff. The implementation should keep diffs atomic, but it should not preserve the old `RouterPlugin` alias or id-based branches.

## Atomic Implementation Steps

1. Define common adapter base and capability-specific result types.
   - Edit `src/extract/engine/spi/index.ts`.
   - Add `ModalityAdapterBase`.
   - Add `NavigationLoweringCtx` and `NavigationLoweringResult` to replace the inline `lowerNavigation` return object.
   - Add `StructuredExtractionWarning` or update `ExtractionWarning` so warnings can carry a required `caveat?: ExtractionCaveat`, `confidence?: Transition["confidence"]`, and `producer?: { kind; id }`.
   - Do not change behavior yet.

2. Delete the `RouterPlugin` alias.
   - Remove `export type RouterPlugin = NavigationAdapter` from `src/extract/engine/spi/index.ts`.
   - Replace all `RouterPlugin` imports/usages with `NavigationAdapter`.
   - Expected files include:
     - `src/cli/features/extract/command.ts`
     - `src/extract/engine/pipeline/index.ts`
     - `src/extract/engine/ts/react-source-transitions.ts`
     - `src/extract/engine/ts/transition/handlers.ts`
     - `src/extract/sources/jotai/transitions.ts`
     - `src/extract/sources/swr/transitions.ts`
     - `src/extract/sources/zustand/transitions.ts`
     - `test/extraction/architecture.test.ts`
     - `test/extraction/extraction.test.ts`
   - Update docs to stop mentioning `RouterPlugin`.
   - Do not keep a compatibility export.

3. Split module-role classification out of `NavigationAdapter`.
   - Add `ModuleRoleAdapter` to `src/extract/engine/spi/index.ts`.
   - Move these optional methods from `NavigationAdapter` to `ModuleRoleAdapter`:
     - `classifyModule`
     - `moduleEntryExports`
     - `classifyImportEdge`
     - `isServerOnlyModule`
   - Add a `shouldDiscoverEffectApis?(ctx)` method or equivalent so the CLI project traversal no longer checks adapter ids.
   - Update `src/cli/features/extract/project.ts` to accept `moduleRoleAdapters: readonly ModuleRoleAdapter[]` instead of reading those methods from `NavigationAdapter`.
   - Provide a small engine/CLI helper that composes multiple module-role adapters deterministically:
     - first exact classification wins;
     - `serverOnly: true` wins over unknown;
     - type-only/asset import-edge classifications win over unknown;
     - conflicts produce a structured caveat, not a silent choice.

4. Split effect API discovery out of `NavigationAdapter`.
   - Add `EffectApiProvider` to `src/extract/engine/spi/index.ts`.
   - Move `discoverEffectApis` from `NavigationAdapter` to `EffectApiProvider`.
   - Update `src/extract/sources/router/index.ts` to export a React Router effect API provider based on `discoverReactRouterActionEffectApis`.
   - Update `src/extract/sources/next/index.ts` to export a Next effect API provider based on `discoverNextServerEffectApis`.
   - Delete `withServerEffectDiscovery` from `src/cli/features/extract/command.ts`.
   - Update `sourceWithReachableImports` to receive `effectApiProviders` and call providers only when the module-role SPI says a module is an eligible server/effect surface.

5. Split cache/storage discovery into a first-class provider.
   - Add `CacheStorageProvider`, `CacheStorageDiscoveryCtx`, and `CacheStorageFragment` to `src/extract/engine/spi/index.ts`.
   - `CacheStorageFragment` should contain:
     - `vars: readonly StateVarDecl[]`
     - `transitions: readonly Transition[]`
     - `caveats: readonly ExtractionCaveat[]`
     - optional `numericReductions` only if needed later
   - Update `src/extract/sources/next/cache.ts` so `discoverNextCacheFromSources` is wrapped by a Next cache provider exported from `src/extract/sources/next/index.ts` or a new `cache-provider.ts`.
   - Keep Jotai/Zustand storage warnings in their state-source slices for now, but convert their safety warnings to structured caveats in step 7.
   - Update `src/cli/features/extract/command.ts` to collect cache/storage fragments from registered providers rather than importing Next cache directly.
   - Delete direct `discoverNextCacheFromSources` imports from the CLI.

6. Add an adapter bundle to registry results.
   - Edit `src/cli/registry/index.ts`.
   - Extend `RegistrySummary` with an `adapters` or `bundle` object containing:
     - `navigation`
     - `moduleRoles`
     - `effectApis`
     - `cacheStorage`
     - `stateSources`
     - `domainRefinements`
     - `observations`
   - Keep top-level fields only if they are immediately removed in the same plan. Because backward compatibility is not a constraint, prefer replacing direct fields over duplicating them.
   - Update `createBuiltinModalityRegistry` to register:
     - Next navigation adapter when `next` dependency exists.
     - Next module-role adapter when `next` dependency exists.
     - Next effect API provider when `next` dependency exists.
     - Next cache/storage provider when `next` dependency exists.
     - React Router navigation adapter when React Router dependency exists or dependencies are unknown.
     - React Router module-role adapter and effect API provider when React Router is active.
     - state sources as today.
     - Zod/ArkType domain refinements as today.
   - Do not use adapter ids in extraction flow after registry construction.

7. Replace warning-string conventions with structured caveats.
   - Edit `src/extract/engine/spi/index.ts` so adapter/source warning APIs return structured warnings whose caveat is created by the adapter/source at the point of imprecision.
   - Remove `pluginSafetyWarning` from `src/extract/engine/pipeline/index.ts`.
   - Update source plugins:
     - `src/extract/sources/jotai/plugin.ts`
     - `src/extract/sources/jotai/writes.ts`
     - `src/extract/sources/zustand/plugin.ts`
     - `src/extract/sources/zustand/writes.ts`
     - any SWR/use-state safety warnings if present
   - Replace `"Global taint ..."` parsing with direct `globalTaintCaveat(...)`.
   - Add caveats for cache/storage approximations where Next cache discovery currently returns plain warning strings.
   - Update `createExtractionCaveats` in `src/cli/features/extract/command.ts` to only collect `warning.caveat`; do not parse warning messages.

8. Add confidence/provenance metadata to adapter outputs.
   - Extend structured result types for:
     - navigation lowering;
     - source plugin extraction;
     - effect API discovery;
     - cache/storage discovery.
   - Require each provider result to make confidence explicit where it creates transitions:
     - `"exact"` for exact lowered semantics;
     - `"over-approx"` when using bounded or broad abstractions;
     - `"manual"` only for overlay/manual artifacts, not adapter guesses.
   - Update reports/docs so users can see which adapter produced caveats and over-approximations.
   - If `PluginProvenance.kind` becomes too coarse, expand it to include:
     - `"navigation"`
     - `"module-roles"`
     - `"effect-api"`
     - `"cache-storage"`
     - `"observation"`
     - `"state-source"`
     - `"domain-refinement"`

9. Normalize replay observation as a separate capability.
   - Add `ObservationProvider` or a shared `ObservationCapability` type to `src/extract/engine/spi/index.ts`.
   - Adapt `StateSourcePlugin.harness` and `NavigationAdapter.harness` to either implement this capability directly or expose an observation provider through the registry bundle.
   - Update replay/conformance code to consume observation providers rather than hardcoding source/navigation harness assumptions where possible.
   - Expected files:
     - `src/cli/codegen/replay-test.ts`
     - `src/cli/features/replay/command.ts`
     - `test/harness/replay.test.ts`
     - `test/harness/jsdom-replay.test.ts`
     - `docs/architecture/conformance-and-replay.md`
   - Keep generated replay behavior equivalent, but make missing observations an explicit structured replay-blocking condition.

10. Remove private CLI imports from built-in adapter slices.
    - After steps 3-6, `src/cli/features/extract/command.ts` should not import:
      - `discoverNextServerEffectApis`
      - `discoverNextCacheFromSources`
      - `routerSource`
    - Prefer not importing `parseReactRouterRoutes` in the CLI either. If a route manifest bootstrap is still needed, move it behind a registered route-discovery/bootstrap capability or a generic project loader hook.
    - Add architecture tests that fail if `src/cli/features/extract/*` imports from `src/extract/sources/next/*` or `src/extract/sources/router/*` private modules.

11. Update built-in adapters to prove the public contracts.
    - Update `src/extract/sources/next/index.ts` to assemble/export capability objects.
    - Update `src/extract/sources/router/index.ts` to assemble/export capability objects.
    - Keep state sources (`use-state`, `jotai`, `swr`, `zustand`) using only `StateSourcePlugin`.
    - Keep Zod/ArkType using only `DomainRefinementProvider`.
    - Do not let built-ins call private engine helpers that third-party adapters could not reasonably use.

12. Update docs/specs.
    - Update `docs/architecture/state-sources.md` so `safetyWarnings` matches implementation and returns structured warnings/caveats.
    - Update `docs/architecture/navigation.md` to describe only navigation/topology responsibilities.
    - Add or update an adapter SPI architecture doc section covering module roles, effect API discovery, cache/storage, and observation.
    - Update `docs/reference/package-entry-points.md` if public entry points change.
    - Update `docs/reference/schemas.md` if `PluginProvenance.kind` changes.
    - Update `docs/_specs/02-extraction.md` and `docs/_specs/05-architecture.md` so they no longer describe `RouterPlugin` or hidden module-role methods as part of navigation.

13. Tighten architecture tests and import boundaries.
    - Update `test/extraction/architecture.test.ts`.
    - Add rules/tests that:
      - `src/extract/engine/**` does not import `src/extract/sources/**` or `src/extract/type-libraries/**`.
      - `src/cli/features/extract/**` does not import private files under `src/extract/sources/*`.
      - built-in adapters implement only public SPI types.
      - no `RouterPlugin` string remains outside historical closed plans.
      - no `adapter.id === "next"` or `adapter.id === "router"` checks remain in extraction flow.

14. Update focused behavioral tests.
    - Update `src/extract/engine/navigation-adapter-fit.test.ts` to use separate fake navigation, module-role, effect API, cache/storage, and observation capabilities.
    - Update `src/cli/registry/index.test.ts` for capability validation and provenance.
    - Update `test/extraction/next-module-boundaries.test.ts` for `ModuleRoleAdapter`.
    - Update `src/extract/sources/next/cache.test.ts` for `CacheStorageProvider`.
    - Update `src/extract/sources/next/module-roles.test.ts` and router module-role tests for provider contracts.
    - Update `src/cli/features/extract/command.test.ts` assertions for plugin labels/provenance and structured caveats.

15. Delete obsolete compatibility paths.
    - Delete:
      - `RouterPlugin` alias.
      - `routerSource` export if no test or public doc still needs it.
      - `withServerEffectDiscovery`.
      - `pluginSafetyWarning`.
      - id-based `next`/`router` special cases in extraction.
    - Run `rtk rg -n "RouterPlugin|routerSource|withServerEffectDiscovery|pluginSafetyWarning|adapter\\.id ===|routerAdapter\\.id ===|Global taint " src test docs` and remove or justify every remaining hit.

## Per-Step Files to Edit

- Steps 1-5:
  - `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`
  - `/Users/hari/proj/modality-ts/src/core/ir/types.ts`
- Steps 2, 7, 15:
  - `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/jotai/transitions.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/swr/transitions.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/zustand/transitions.ts`
- Steps 3-6, 10:
  - `/Users/hari/proj/modality-ts/src/cli/registry/index.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts`
- Steps 4-6, 11:
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/index.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/server-effects.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/cache.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/router/index.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/router/server-effects.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/module-roles.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/router/module-roles.ts`
- Step 7:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/caveats.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/jotai/plugin.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/jotai/writes.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/zustand/plugin.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/zustand/writes.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/cache.ts`
- Step 9:
  - `/Users/hari/proj/modality-ts/src/cli/codegen/replay-test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/replay/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/harness/index.ts`
- Steps 12-14:
  - `/Users/hari/proj/modality-ts/docs/architecture/state-sources.md`
  - `/Users/hari/proj/modality-ts/docs/architecture/navigation.md`
  - `/Users/hari/proj/modality-ts/docs/architecture/conformance-and-replay.md`
  - `/Users/hari/proj/modality-ts/docs/reference/package-entry-points.md`
  - `/Users/hari/proj/modality-ts/docs/reference/schemas.md`
  - `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md`
  - `/Users/hari/proj/modality-ts/docs/_specs/05-architecture.md`
  - `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/navigation-adapter-fit.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/registry/index.test.ts`
  - `/Users/hari/proj/modality-ts/test/extraction/next-module-boundaries.test.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/cache.test.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/next/module-roles.test.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`

## Acceptance Criteria

- `RouterPlugin` is removed from source, tests, and docs, except historical closed plans if they are intentionally not edited.
- `NavigationAdapter` owns only navigation/topology/mount/navigation-harness responsibilities.
- Module role classification is implemented through an explicit `ModuleRoleAdapter` or equivalent capability.
- Effect API discovery is implemented through an explicit `EffectApiProvider` or equivalent capability.
- Next cache/storage modeling is implemented through an explicit `CacheStorageProvider` or equivalent capability.
- Replay observation has a shared capability surface, or a clearly documented adapter-bundle path that does not require private harness assumptions.
- `src/cli/features/extract/command.ts` no longer imports private Next or React Router implementation files for server effects/cache.
- Extraction flow contains no `adapter.id === "next"` or `adapter.id === "router"` special cases.
- Built-in adapters are registered as capability bundles in `src/cli/registry/index.ts`.
- Structured caveats are created at the source of imprecision; no production code parses `"Global taint "` or `"Unextractable handler "` warning strings to recover typed caveats.
- Plugin/provider provenance includes all adapter capabilities that can affect model vars, transitions, domains, caveats, or replay observability.
- Docs and internal specs describe the consolidated SPI and no longer present hidden navigation methods as the generic extension story.
- Architecture tests enforce the new dependency boundaries.

## Tests to Add or Update

- `src/cli/registry/index.test.ts`
  - validates each capability interface independently;
  - rejects incomplete module-role/effect/cache providers;
  - stamps provenance for every active capability;
  - auto-registers Next and React Router capability bundles from dependencies.
- `src/extract/engine/navigation-adapter-fit.test.ts`
  - fake navigation adapter works without module-role or effect API methods;
  - fake module-role adapter drives client/server surface selection;
  - fake effect API provider discovers server actions without navigation id checks;
  - fake cache/storage provider contributes vars/transitions/caveats.
- `test/extraction/next-module-boundaries.test.ts`
  - Next module role classification still excludes server-only helper fetches from client pending ops through `ModuleRoleAdapter`.
- `src/extract/sources/next/cache.test.ts`
  - Next cache provider returns vars/transitions/caveats through the new `CacheStorageProvider`.
- `src/extract/sources/next/module-roles.test.ts`
  - Next module-role provider classifies `"use client"`, `"use server"`, server-only files, metadata, and import edges.
- `src/extract/sources/router/server-effects.test.ts`
  - React Router action effect provider discovers `ACTION <route>` operations through `EffectApiProvider`.
- `src/cli/features/extract/command.test.ts`
  - plugin labels/provenance include new capability kinds;
  - structured caveats survive into model metadata and extraction report;
  - disabling a capability by id removes that capability without id-based extraction branches.
- `test/extraction/architecture.test.ts`
  - no `RouterPlugin` imports;
  - no CLI imports from private source adapter files;
  - no id-based Next/Router checks in extraction flow;
  - engine imports only public SPI/contracts, not built-in adapters.
- `test/harness/replay.test.ts` and `test/harness/jsdom-replay.test.ts`
  - observation provider path still observes route, useState, Jotai, SWR, and Zustand values;
  - missing observation produces an explicit replay-blocking reason.

## Verification Commands

- `rtk pnpm vitest run src/cli/registry/index.test.ts`
- `rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm vitest run test/extraction/next-module-boundaries.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/cache.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/module-roles.test.ts`
- `rtk pnpm vitest run src/extract/sources/router/server-effects.test.ts`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run test/extraction/architecture.test.ts`
- `rtk pnpm vitest run test/harness/replay.test.ts test/harness/jsdom-replay.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm test`
- `rtk pnpm fix`
- `rtk git diff --check`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if splitting all capabilities in one change becomes too large to review. The acceptable split is:
  - remove `RouterPlugin` and split module-role/effect APIs first;
  - cache/storage provider second;
  - replay observation provider third;
  - structured caveat cleanup throughout each part.
- Stop and report if a built-in adapter requires a private CLI import after a public capability is added. Add or adjust the SPI instead of preserving the import.
- Stop and report if provenance expansion breaks artifact readers in a way that requires broad schema churn. Do not omit provenance silently; either update readers/tests or narrow the provenance shape with an explicit reason.
- Stop and report if multiple module-role adapters produce contradictory non-unknown classifications for the same module. Emit a structured caveat and pick a deterministic over-approximation rather than guessing exactness.
- Stop and report if replay observation cannot be split cleanly without changing generated replay APIs. In that case, document the minimum shared observation capability and defer only the codegen migration.
- Do not add compatibility aliases for deleted SPI names.
- Do not model framework cache/storage by executing app code.
- Do not add adapter id checks in new code.
- Do not use warning message parsing as a substitute for typed caveats.
- Do not move schema/domain providers into state-source packages.
- Do not make the extraction engine import built-in adapters.
