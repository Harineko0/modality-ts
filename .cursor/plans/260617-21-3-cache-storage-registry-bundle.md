# Adapter SPI Consolidation 3: Cache Storage Providers and Registry Bundle

## Goal

Make cache/storage discovery a first-class adapter capability and update built-in registry output so extraction consumes a capability bundle instead of scattered top-level plugin fields.

This plan depends on `260617-21-1-adapter-spi-foundation.md` and `260617-21-2-module-roles-effect-api.md`.

## Non-goals

- Do not implement a full cache/runtime/storage interpreter.
- Do not move Jotai or Zustand storage modeling out of state-source plugins in this plan.
- Do not normalize replay observation in this plan.
- Do not complete structured warning-string cleanup except for cache/storage provider outputs that are touched here.
- Do not preserve duplicate old registry fields unless the same plan removes them.
- Do not edit generated `dist/` artifacts.

## Current-state Findings

- `src/extract/sources/next/cache.ts` already models Next cache vars and transitions.
- The CLI imports `discoverNextCacheFromSources` directly from the Next source slice, which creates private framework wiring.
- Built-in registration currently exposes source plugins, router/navigation adapters, and domain refinements without a single bundle shape for all capabilities.
- Later plans need one registry-owned object containing navigation, module roles, effect APIs, cache/storage, state sources, domain refinements, and observation providers.

## Exact File Paths and Relevant Symbols

- `src/extract/engine/spi/index.ts`
  - `CacheStorageProvider`
  - `CacheStorageDiscoveryCtx`
  - `CacheStorageFragment`
  - `StateVarDecl`
  - `Transition`
  - `ExtractionCaveat`
- `src/extract/sources/next/cache.ts`
  - `discoverNextCacheFromSources`
  - `nextCacheVarId`
- `src/extract/sources/next/index.ts`
  - Next built-in capability exports
- `src/cli/registry/index.ts`
  - `ModalityPluginRegistry`
  - `BuiltinRegistryOptions`
  - `RegistrySummary`
  - `createBuiltinModalityRegistry`
  - `createModalityRegistry`
  - `validateRouterPlugin`
  - `validateStateSourcePlugin`
  - `validateDomainRefinementProvider`
- `src/cli/features/extract/command.ts`
  - `runExtractCommand`
  - `buildClientProjectSurface`
  - `runProjectExtractionPipeline`
  - `pluginProvenance`
  - `createExtractionCaveats`

## Existing Patterns to Follow

- Keep provider contracts in `src/extract/engine/spi/index.ts`.
- Keep built-in dependency probing and provider selection in `src/cli/registry/index.ts`.
- Built-in adapters should export public provider objects from their package-facing source index files.
- The CLI should consume registry output and not import private framework implementation files.
- Prefer replacing old registry fields over duplicating them because backward compatibility is not a constraint.

## Atomic Implementation Steps

1. Add cache/storage SPI types.
   - Edit `src/extract/engine/spi/index.ts`.
   - Add:
     - `CacheStorageProvider`
     - `CacheStorageDiscoveryCtx`
     - `CacheStorageFragment`
   - `CacheStorageFragment` should include:
     - `vars: readonly StateVarDecl[]`
     - `transitions: readonly Transition[]`
     - `caveats: readonly ExtractionCaveat[]`
     - optional `numericReductions` only if the existing Next cache code already requires it.

2. Wrap Next cache discovery in a provider.
   - Add a Next cache provider in `src/extract/sources/next/index.ts` or a new adjacent file such as `cache-provider.ts`.
   - The provider should call `discoverNextCacheFromSources`; do not duplicate cache analysis logic.
   - Preserve current Next cache vars/transitions behavior.

3. Remove direct Next cache imports from extraction command.
   - Edit `src/cli/features/extract/command.ts`.
   - Collect cache/storage fragments from registered `CacheStorageProvider[]`.
   - Merge returned vars, transitions, and caveats into the same places where Next cache output is merged today.
   - Delete direct imports of `discoverNextCacheFromSources`.

4. Add an adapter bundle type.
   - Edit `src/extract/engine/spi/index.ts` or `src/cli/registry/index.ts`.
   - Prefer keeping the reusable type in SPI if third-party registry code should use it.
   - Shape:
     ```ts
     export interface AdapterBundle {
       navigation?: NavigationAdapter;
       moduleRoles: readonly ModuleRoleAdapter[];
       effectApis: readonly EffectApiProvider[];
       cacheStorage: readonly CacheStorageProvider[];
       stateSources: readonly StateSourcePlugin[];
       domainRefinements: readonly DomainRefinementProvider[];
       observations: readonly ObservationProvider[];
     }
     ```
   - If `ObservationProvider` does not exist yet, either add a placeholder-free empty array with a minimal forward declaration only if TypeScript permits it cleanly, or omit `observations` until plan 4 and document the omission in comments/tests.

5. Update registry summary and creation.
   - Edit `src/cli/registry/index.ts`.
   - Extend or replace `RegistrySummary` with `bundle` or `adapters`.
   - Register:
     - Next navigation adapter when `next` dependency exists;
     - Next module-role adapter when `next` dependency exists;
     - Next effect API provider when `next` dependency exists;
     - Next cache/storage provider when `next` dependency exists;
     - React Router navigation adapter when React Router dependency exists or dependencies are unknown;
     - React Router module-role and effect API providers when React Router is active;
     - existing state sources;
     - existing Zod/ArkType domain refinements.
   - Avoid adapter id checks after registry construction.

6. Add provider validation.
   - Add validation functions for module-role, effect API, and cache/storage providers.
   - Keep validation shallow and structural, matching the style of existing plugin validators.
   - Update registry tests to reject incomplete providers.

7. Update command call sites to consume the bundle.
   - Replace uses of old top-level registry fields with the bundle fields.
   - Keep the public command behavior and flags the same unless a flag was only a compatibility alias.

## Per-step Files to Edit

- Steps 1 and 4:
  - `src/extract/engine/spi/index.ts`
- Step 2:
  - `src/extract/sources/next/index.ts`
  - `src/extract/sources/next/cache.ts`
  - optional `src/extract/sources/next/cache-provider.ts`
- Steps 3, 7:
  - `src/cli/features/extract/command.ts`
- Steps 5-6:
  - `src/cli/registry/index.ts`
  - `src/cli/registry/index.test.ts`
- Related tests:
  - `src/extract/sources/next/cache.test.ts`
  - `src/extract/engine/navigation-adapter-fit.test.ts`
  - `src/cli/features/extract/command.test.ts`

## Acceptance Criteria

- Next cache modeling is exposed through `CacheStorageProvider`.
- `src/cli/features/extract/command.ts` no longer imports `discoverNextCacheFromSources`.
- Registry output contains a coherent capability bundle or equivalent single object.
- Built-in registration includes navigation, module-role, effect API, cache/storage, state-source, and domain-refinement capabilities.
- Provider validation exists for cache/storage providers and any module/effect providers added in plan 2.
- Extraction behavior for Next cache vars and transitions remains equivalent.

## Tests to Add or Update

- `src/cli/registry/index.test.ts`
  - validates cache provider shape;
  - validates module-role and effect provider shape if not already covered;
  - confirms Next registration includes a cache/storage provider when `next` is detected;
  - confirms React Router registration does not create a cache/storage provider.
- `src/extract/sources/next/cache.test.ts`
  - Next cache provider returns vars, transitions, and caveats through `CacheStorageProvider`.
- `src/extract/engine/navigation-adapter-fit.test.ts`
  - fake cache/storage provider contributes vars/transitions/caveats without navigation involvement.
- `src/cli/features/extract/command.test.ts`
  - extraction command merges cache/storage provider fragments into model output.

## Verification Commands

- `rtk rg -n "discoverNextCacheFromSources" src/cli src/extract`
- `rtk pnpm vitest run src/cli/registry/index.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/cache.test.ts`
- `rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm typecheck`
- `rtk git diff --check`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if registry consumers require both old and new registry shapes for a large migration. Prefer a single bundle and update all local call sites in this plan.
- Stop and report if Next cache discovery returns warning strings that cannot be represented as `ExtractionCaveat` without broader warning cleanup. Preserve behavior and leave the cleanup to plan 4 with a clear TODO.
- Do not move Jotai/Zustand storage warnings to `CacheStorageProvider` yet.
- Do not add adapter id checks in command code to select cache behavior.
