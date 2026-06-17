# Cache Storage Provider and Registry Bundle

Status: implementation plan.
Date: 2026-06-17.
Plan family: C - Adapter SPI Consolidation.
Split sequence: 260617-21-3.

## 1. Goal

Make framework cache/storage modeling a first-class adapter capability and
finish the registry-owned adapter bundle so extraction no longer imports private
Next cache internals.

The intended end state of this plan is:

- `CacheStorageProvider` is part of the public SPI;
- Next cache modeling is exposed through a provider implemented in the Next
  adapter slice;
- `src/cli/features/extract/command.ts` collects cache/storage fragments from
  registered providers;
- the registry summary has one coherent adapter bundle rather than scattered
  top-level capability fields;
- direct CLI imports of `discoverNextCacheFromSources` are deleted;
- Jotai and Zustand storage warning internals remain in their state-source
  slices until structured caveat cleanup in plan 4.

## 2. Non-goals

- Do not implement a full cache/runtime/storage interpreter.
- Do not add third-party cache adapters such as TanStack Query.
- Do not migrate Jotai or Zustand storage metadata into cache providers in this
  plan.
- Do not replace warning strings with structured caveats here unless needed for
  provider shape; plan 4 owns structured caveat cleanup.
- Do not migrate replay observation.
- Do not edit generated `dist/` or `docs/build/` artifacts.

## 3. Current-State Findings

- `src/extract/sources/next/cache.ts` already discovers Next cache vars and
  transitions through `discoverNextCacheFromSources()`.
- `src/cli/features/extract/command.ts` imports
  `discoverNextCacheFromSources()` directly and only calls it when
  `routerAdapter.id === "next"`.
- `PluginProvenance.kind` does not yet include `cache-storage`.
- Registry output currently exposes source plugins, domain refinements, and a
  router/navigation adapter; plan 2 may have added module-role/effect provider
  fields or an initial `adapters` bundle.
- Jotai and Zustand storage approximations currently live in source-specific
  metadata and warning paths, not a shared provider surface.

## 4. Exact File Paths and Relevant Symbols

Primary files:

- `src/extract/engine/spi/index.ts`
  - `StateVarDecl`
  - `Transition`
  - `ExtractionCaveat`
  - new `CacheStorageProvider`
  - new `CacheStorageDiscoveryCtx`
  - new `CacheStorageFragment`
- `src/extract/sources/next/cache.ts`
  - `discoverNextCacheFromSources()`
  - `nextCacheVarId()`
- `src/extract/sources/next/index.ts`
  - Next provider exports
- `src/cli/registry/index.ts`
  - `ModalityPluginRegistry`
  - `BuiltinRegistryOptions`
  - `RegistrySummary`
  - `createBuiltinModalityRegistry()`
  - `createModalityRegistry()`
- `src/cli/features/extract/command.ts`
  - `runExtractCommand()`
  - Next cache discovery call site
  - `pluginProvenance()`
  - `createExtractionCaveats()`
- `src/cli/registry/index.test.ts`
- `src/extract/sources/next/cache.test.ts`
- `src/cli/features/extract/command.test.ts`

## 5. Existing Patterns to Follow

- Adapter capability interfaces live in `src/extract/engine/spi/index.ts`.
- Built-in provider construction lives in `src/extract/sources/<framework>/`.
- Registry construction is the only place that knows which built-ins activate
  for package dependencies.
- Extraction command code should consume provider outputs generically.
- Provider output should be plain IR fragments: vars, transitions, caveats, and
  optional reductions if already required by the underlying discovery.
- Prefer capability arrays over id-based special cases.

## 6. Atomic Implementation Steps

### Step 1 - Add cache/storage SPI types

Files to edit:

- `src/extract/engine/spi/index.ts`

Implementation:

1. Add:

   ```ts
   export interface CacheStorageDiscoveryCtx {
     rootDir?: string;
     files: readonly { path: string; text: string }[];
     inventory?: RouteInventory;
     options: ResolvedOptions;
   }

   export interface CacheStorageFragment {
     vars: readonly StateVarDecl[];
     transitions: readonly import("modality-ts/core").Transition[];
     caveats: readonly ExtractionCaveat[];
     reductions?: readonly NumericReduction[];
   }

   export interface CacheStorageProvider extends ModalityAdapterBase {
     kind: "cache-storage";
     discoverCacheStorage(ctx: CacheStorageDiscoveryCtx): CacheStorageFragment;
   }
   ```

2. Include only fields current Next cache discovery actually needs.
3. Use `readonly []` for empty fragment values.

Acceptance criteria:

- Cache providers can be implemented without importing CLI-private types.

### Step 2 - Wrap Next cache discovery as a provider

Files to edit:

- `src/extract/sources/next/index.ts`
- `src/extract/sources/next/cache.ts`
- optional new file `src/extract/sources/next/cache-provider.ts`

Implementation:

1. Export `nextCacheStorageProvider()` from the Next source package.
2. Implement `discoverCacheStorage()` by adapting the existing
   `discoverNextCacheFromSources()` return shape into `CacheStorageFragment`.
3. Keep low-level discovery helpers in `cache.ts`.
4. If `discoverNextCacheFromSources()` currently returns warnings as strings,
   either map them to temporary caveats only when already structured, or leave
   caveats empty and preserve warnings through existing CLI paths. Plan 4 owns
   full structured caveat conversion.
5. Do not import CLI command/project modules from the provider.

Acceptance criteria:

- Next cache provider returns vars/transitions through the public SPI.
- Existing cache tests can call the provider directly.

### Step 3 - Complete the registry adapter bundle

Files to edit:

- `src/cli/registry/index.ts`
- `src/cli/registry/index.test.ts`

Implementation:

1. Define or finalize a registry bundle with this shape:

   ```ts
   adapters: {
     navigation?: NavigationAdapter;
     moduleRoles: readonly ModuleRoleAdapter[];
     effectApis: readonly EffectApiProvider[];
     cacheStorage: readonly CacheStorageProvider[];
     stateSources: readonly StateSourcePlugin[];
     domainRefinements: readonly DomainRefinementProvider[];
     observations: readonly [];
   }
   ```

   Leave `observations` as an explicit empty tuple/array slot in this plan.
   Plan 5 introduces `ObservationProvider` and replaces this placeholder with
   real observation providers. Do not invent replay behavior here.

2. Prefer replacing scattered top-level registry fields over duplicating them.
   Because backward compatibility is not a constraint, remove direct fields when
   all local callers are updated in the same diff.
3. Add `extraCacheStorageProviders?: readonly CacheStorageProvider[]` to
   `BuiltinRegistryOptions` and equivalent manual registry input.
4. Validate cache/storage providers with common adapter shape and
   `discoverCacheStorage` function checks.
5. Register `nextCacheStorageProvider()` when Next is active.
6. Do not register cache providers for Jotai/Zustand yet.

Acceptance criteria:

- Registry output has one authoritative `adapters` bundle.
- Registry tests cover valid and invalid cache/storage providers.

### Step 4 - Collect cache/storage fragments during extraction

Files to edit:

- `src/cli/features/extract/command.ts`

Implementation:

1. Remove direct import of `discoverNextCacheFromSources`.
2. Delete the `routerAdapter.id === "next"` gate around cache discovery.
3. Iterate over `registry.adapters.cacheStorage`.
4. Pass provider-appropriate context:
   - project files;
   - route inventory;
   - resolved options;
   - root directory when available.
5. Merge returned vars, transitions, caveats, and reductions into the same model
   positions used by current Next cache discovery.
6. Preserve deterministic ordering by provider id, then fragment order.
7. If a provider throws or returns invalid fragments, fail the extraction with a
   clear provider-labeled error. Do not silently skip it.

Acceptance criteria:

- CLI extraction can include Next cache vars/transitions through the provider.
- No CLI code imports `src/extract/sources/next/cache.ts`.

### Step 5 - Update provenance labels for cache providers minimally

Files to edit:

- `src/core/ir/types.ts`
- `src/cli/registry/index.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/cli/features/extract/command.ts`

Implementation:

1. If plan 4 has not yet expanded provenance kinds, add only the minimal
   `"cache-storage"` kind required to stamp active cache providers.
2. Include cache providers in registry/plugin provenance.
3. Avoid broad report formatting changes here; plan 4 owns complete provenance
   and confidence reporting.

Acceptance criteria:

- Active cache providers are visible in model metadata or registry plugin
  provenance.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/spi/index.ts`.
- Step 2: `src/extract/sources/next/index.ts`,
  `src/extract/sources/next/cache.ts`, optional
  `src/extract/sources/next/cache-provider.ts`.
- Step 3: `src/cli/registry/index.ts`,
  `src/cli/registry/index.test.ts`.
- Step 4: `src/cli/features/extract/command.ts`.
- Step 5: `src/core/ir/types.ts`, `src/cli/registry/index.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `src/cli/features/extract/command.ts`.

## 8. Acceptance Criteria

- `CacheStorageProvider`, `CacheStorageDiscoveryCtx`, and
  `CacheStorageFragment` exist in the public SPI.
- Next cache discovery is available through a registered cache/storage provider.
- Registry output exposes `adapters.cacheStorage`.
- `src/cli/features/extract/command.ts` has no direct import of
  `discoverNextCacheFromSources`.
- Extraction no longer checks a navigation adapter id to decide cache discovery.
- Existing Next cache behavior remains equivalent.

## 9. Tests to Add or Update

- `src/cli/registry/index.test.ts`
  - validates cache/storage provider shape;
  - registers Next cache provider when Next is active;
  - omits it when Next is disabled.
- `src/extract/sources/next/cache.test.ts`
  - calls `nextCacheStorageProvider().discoverCacheStorage()`;
  - asserts vars/transitions match the existing low-level discovery behavior;
  - asserts caveat/warning behavior is preserved pending plan 4.
- `src/cli/features/extract/command.test.ts`
  - verifies provider fragments are merged into extracted model vars and
    transitions;
  - verifies disabling Next/cache provider removes cache vars without id-based
    extraction branches.
- `test/extraction/architecture.test.ts`
  - add or prepare an assertion that CLI extraction code does not import private
    Next cache modules.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/cli/registry/index.test.ts
rtk pnpm vitest run src/extract/sources/next/cache.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts
rtk grep -n "discoverNextCacheFromSources|routerAdapter\\.id ===|adapter\\.id ===" src/cli src/extract
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if `discoverNextCacheFromSources()` needs command-specific
  context that does not belong in public SPI. Add a generic context field only
  if it would make sense for another framework cache provider.
- Stop and report if registry callers still need old top-level fields after the
  bundle is added. Update callers rather than duplicating registry state.
- Stop and report if cache provider provenance requires broad schema/report
  churn. Add the minimal kind here and leave display polish to plan 4.

## 12. Must Not Change

- Do not execute app code to model cache/storage.
- Do not move Jotai/Zustand storage warnings into cache providers yet.
- Do not add adapter-id checks.
- Do not import built-in cache providers from the extraction engine.
