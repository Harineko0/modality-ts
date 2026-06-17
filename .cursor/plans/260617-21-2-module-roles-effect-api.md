# Adapter SPI Consolidation 2: Module Roles and Effect API Providers

## Goal

Split module-role classification and server effect API discovery out of `NavigationAdapter`, then update extraction traversal to consume explicit providers instead of adapter id checks.

This plan depends on `260617-21-1-adapter-spi-foundation.md`.

## Non-goals

- Do not implement cache/storage providers in this plan.
- Do not normalize replay observation in this plan.
- Do not rewrite structured warning/caveat handling except where provider APIs need caveat placeholders.
- Do not preserve id-based branches such as `adapter.id === "next"` or `adapter.id === "router"` in the extraction flow.
- Do not make the extraction engine import built-in source adapters.
- Do not edit generated `dist/` artifacts.

## Current-state Findings

- `NavigationAdapter` currently owns route discovery, navigation lowering, module classification, import-edge classification, and server effect API discovery.
- `src/cli/features/extract/project.ts` hardcodes framework behavior through `adapter.id === "next"` / `adapter.id === "router"` checks inside project traversal and effect API discovery decisions.
- React Router and Next already have source-specific module role and server effect helpers:
  - `src/extract/sources/next/module-roles.ts`
  - `src/extract/sources/router/module-roles.ts`
  - `src/extract/sources/next/server-effects.ts`
  - `src/extract/sources/router/server-effects.ts`
- The CLI currently wires some of those helpers directly rather than through public capability contracts.

## Exact File Paths and Relevant Symbols

- `src/extract/engine/spi/index.ts`
  - `NavigationAdapter`
  - `ModuleClassification`
  - `ModuleEntryExport`
  - `ImportEdgeContext`
  - `EffectApiDiscoveryCtx`
  - `DiscoveredEffectApi`
- `src/cli/features/extract/project.ts`
  - `sourceWithReachableImports`
  - `classifyModule`
  - `moduleEntryExports`
  - `classifyImportEdge`
  - `isServerOnlyTarget`
  - `discoverFetchOps`
  - `EffectApiProvenanceEntry`
  - `ModuleRecord`
- `src/cli/features/extract/command.ts`
  - `withServerEffectDiscovery`
  - `buildClientProjectSurface`
  - `runProjectExtractionPipeline`
  - `pluginProvenance`
- `src/extract/sources/next/index.ts`
  - `nextAdapter`
  - `NextSourceOptions`
- `src/extract/sources/router/index.ts`
  - `reactRouterAdapter`
- `src/extract/sources/next/module-roles.ts`
- `src/extract/sources/router/module-roles.ts`
- `src/extract/sources/next/server-effects.ts`
- `src/extract/sources/router/server-effects.ts`

## Existing Patterns to Follow

- Keep framework-specific syntax and file conventions under `src/extract/sources/<framework>/`.
- Keep the CLI dependent on public SPI and registered adapters, not private source implementation details.
- Prefer explicit provider arrays over a single overloaded adapter object.
- Compose multiple providers deterministically and report conflicts as structured caveats.
- Keep route/navigation semantics in `NavigationAdapter`; module role semantics belong in `ModuleRoleAdapter`.

## Atomic Implementation Steps

1. Add `ModuleRoleAdapter`.
   - Edit `src/extract/engine/spi/index.ts`.
   - Add an interface extending `ModalityAdapterBase` with `kind: "module-roles"`.
   - Move these responsibilities from `NavigationAdapter` to `ModuleRoleAdapter`:
     - `classifyModule(ctx)`
     - `moduleEntryExports(ctx)`
     - `classifyImportEdge(ctx)`
     - `isServerOnlyModule(fileName, classification?)`
   - Add `shouldDiscoverEffectApis?(ctx)` or an equivalent explicit method for server/effect surface eligibility.

2. Add `EffectApiProvider`.
   - In the same SPI file, add an interface extending `ModalityAdapterBase` with `kind: "effect-api"`.
   - Move `discoverEffectApis(ctx)` from `NavigationAdapter` to `EffectApiProvider`.
   - Leave `EffectApiDiscoveryCtx` and `DiscoveredEffectApi` in SPI unless a small rename improves clarity.

3. Implement module-role providers for built-ins.
   - Update Next and React Router source entry points to export provider objects.
   - The providers should wrap existing helper functions rather than duplicating logic.
   - Remove module-role methods from `nextAdapter` and `reactRouterAdapter`.

4. Implement effect API providers for built-ins.
   - Add Next and React Router `EffectApiProvider` objects.
   - Use `discoverNextServerEffectApis` and `discoverReactRouterActionEffectApis` internally.
   - Export the provider objects from the framework source index files.

5. Update project traversal to accept module-role providers.
   - Edit `src/cli/features/extract/project.ts`.
   - Change `sourceWithReachableImports` to receive `moduleRoleAdapters: readonly ModuleRoleAdapter[]`.
   - Replace direct `routerAdapter` module classification calls with a deterministic composition helper.
   - Composition rules:
     - first exact classification wins;
     - `serverOnly: true` wins over unknown;
     - type-only and asset import-edge classifications win over unknown;
     - contradictory non-unknown classifications produce a structured caveat and deterministic over-approximation.

6. Update project traversal to accept effect API providers.
   - Change effect API discovery to receive `effectApiProviders: readonly EffectApiProvider[]`.
   - Call providers only when module-role providers mark a module as an eligible server/effect surface.
   - Delete framework id checks from `discoverEffectApis` paths.

7. Delete CLI effect discovery wrapper.
   - Remove `withServerEffectDiscovery` from `src/cli/features/extract/command.ts`.
   - Replace direct wiring with registered `EffectApiProvider` objects.

8. Update tests for split capability behavior.
   - Update fake adapters in existing tests so navigation works without module-role or effect methods.
   - Add focused tests proving module-role and effect providers drive behavior without adapter id branches.

## Per-step Files to Edit

- Steps 1-2:
  - `src/extract/engine/spi/index.ts`
- Steps 3-4:
  - `src/extract/sources/next/index.ts`
  - `src/extract/sources/router/index.ts`
  - `src/extract/sources/next/module-roles.ts`
  - `src/extract/sources/router/module-roles.ts`
  - `src/extract/sources/next/server-effects.ts`
  - `src/extract/sources/router/server-effects.ts`
- Steps 5-7:
  - `src/cli/features/extract/project.ts`
  - `src/cli/features/extract/command.ts`
- Step 8:
  - `src/extract/engine/navigation-adapter-fit.test.ts`
  - `test/extraction/next-module-boundaries.test.ts`
  - `src/extract/sources/next/module-roles.test.ts`
  - `src/extract/sources/router/server-effects.test.ts`
  - `src/cli/features/extract/command.test.ts`

## Acceptance Criteria

- `NavigationAdapter` no longer contains module-role classification methods.
- `NavigationAdapter` no longer contains `discoverEffectApis`.
- Next and React Router expose explicit module-role providers.
- Next and React Router expose explicit effect API providers.
- `src/cli/features/extract/project.ts` does not use framework id checks to decide module roles or effect API discovery.
- Effect API discovery is gated by module-role provider eligibility rather than hardcoded framework identities.
- Conflicting module-role provider output is deterministic and visible through a structured caveat path.

## Tests to Add or Update

- `src/extract/engine/navigation-adapter-fit.test.ts`
  - fake navigation adapter works without module-role or effect API methods;
  - fake module-role adapter drives client/server surface selection;
  - fake effect API provider discovers server actions without navigation id checks.
- `test/extraction/next-module-boundaries.test.ts`
  - Next module role classification still excludes server-only helper fetches from client pending ops through `ModuleRoleAdapter`.
- `src/extract/sources/next/module-roles.test.ts`
  - provider classifies `"use client"`, `"use server"`, server-only files, metadata, and import edges.
- `src/extract/sources/router/server-effects.test.ts`
  - React Router action effect provider discovers `ACTION <route>` operations through `EffectApiProvider`.
- `src/cli/features/extract/command.test.ts`
  - extraction command consumes module-role and effect providers from registry output.

## Verification Commands

- `rtk rg -n "discoverEffectApis|classifyModule|classifyImportEdge|moduleEntryExports|isServerOnlyModule" src/extract/engine/spi/index.ts`
- `rtk rg -n "adapter\\.id ===|routerAdapter\\.id ===" src/cli/features/extract src/extract`
- `rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm vitest run test/extraction/next-module-boundaries.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/module-roles.test.ts`
- `rtk pnpm vitest run src/extract/sources/router/server-effects.test.ts`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm typecheck`
- `rtk git diff --check`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if module-role provider conflicts require a broader caveat plumbing change than this plan can safely include.
- Stop and report if an effect API provider needs direct CLI-only context. Add missing public context to SPI rather than importing private helpers.
- Do not start cache/storage registry work in this plan.
- Do not reintroduce adapter id checks as a shortcut.
