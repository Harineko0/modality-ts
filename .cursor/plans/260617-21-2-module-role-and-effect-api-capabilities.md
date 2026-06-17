# Module Role and Effect API Capabilities

Status: implementation plan.
Date: 2026-06-17.
Plan family: C - Adapter SPI Consolidation.
Split sequence: 260617-21-2.

## 1. Goal

Split module-role classification and effect API discovery out of
`NavigationAdapter` into explicit adapter capabilities, then update extraction
project traversal and built-in adapters to use those capabilities without
adapter-id branches.

The intended end state of this plan is:

- `NavigationAdapter` owns navigation/topology/mount/navigation-harness behavior
  only;
- module runtime classification is provided by `ModuleRoleAdapter`;
- server/action/API discovery is provided by `EffectApiProvider`;
- CLI project reachability receives capability arrays from the registry bundle;
- Next and React Router built-ins export module-role and effect API providers;
- `sourceWithReachableImports()` no longer checks `adapter.id === "next"` or
  `adapter.id === "router"` to decide server effect surfaces;
- `withServerEffectDiscovery()` is deleted.

## 2. Non-goals

- Do not implement cache/storage providers. That belongs in
  `260617-21-3-cache-storage-provider-and-registry-bundle.md`.
- Do not fully replace warning strings with structured caveats. That belongs in
  plan 4.
- Do not migrate replay observation. That belongs in plan 5.
- Do not rename user-facing CLI config keys unless required by the capability
  split.
- Do not introduce global mutable registries.
- Do not edit generated `dist/` or `docs/build/` artifacts.

## 3. Current-State Findings

- `NavigationAdapter` currently contains optional methods:
  `classifyModule`, `moduleEntryExports`, `classifyImportEdge`,
  `isServerOnlyModule`, and `discoverEffectApis`.
- `src/cli/features/extract/project.ts` takes one `NavigationAdapter` and uses
  it for module classification, import-edge classification, server-only checks,
  and effect API discovery.
- `sourceWithReachableImports()` has hardcoded `adapter.id === "next"` and
  `adapter.id === "router"` conditions when determining whether a shared module
  is a server effect surface.
- `src/cli/features/extract/command.ts` has `withServerEffectDiscovery()` to
  graft Next server effect discovery onto `nextAdapter()`.
- React Router already wires `discoverReactRouterActionEffectApis` through
  `reactRouterAdapter().discoverEffectApis`.
- Next server effects live in
  `src/extract/sources/next/server-effects.ts` but are imported directly by the
  CLI.
- Next and React Router module-role helpers already live in adapter-specific
  files and can be wrapped as providers.

## 4. Exact File Paths and Relevant Symbols

Primary files:

- `src/extract/engine/spi/index.ts`
  - `NavigationAdapter`
  - `ModuleRoleCtx`
  - `ModuleClassification`
  - `ModuleEntryExport`
  - `ImportEdgeCtx`
  - `ImportEdgeContext`
  - `EffectApiDiscoveryCtx`
  - `DiscoveredEffectApi`
- `src/cli/registry/index.ts`
  - `ModalityPluginRegistry`
  - `BuiltinRegistryOptions`
  - `RegistrySummary`
  - `createBuiltinModalityRegistry()`
  - `createModalityRegistry()`
  - `validateRouterPlugin()`
- `src/cli/features/extract/project.ts`
  - `sourceWithReachableImports()`
  - `classifyModule()`
  - `moduleEntryExports()`
  - `classifyImportEdge()`
  - `isServerOnlyTarget()`
  - `EffectApiProvenanceEntry`
- `src/cli/features/extract/command.ts`
  - `runExtractCommand()`
  - `buildClientProjectSurface()`
  - `runProjectExtractionPipeline()`
  - `withServerEffectDiscovery()`
- `src/extract/sources/next/index.ts`
  - `nextAdapter()`
- `src/extract/sources/next/module-roles.ts`
  - `classifyNextModule()`
  - `nextModuleEntryExports()`
  - `classifyNextImportEdge()`
  - `isNextServerOnlyModule()`
- `src/extract/sources/next/server-effects.ts`
  - `discoverNextServerEffectApis()`
- `src/extract/sources/router/index.ts`
  - `reactRouterAdapter()`
  - `routerSource`
- `src/extract/sources/router/module-roles.ts`
  - `classifyReactRouterModule()`
  - `reactRouterModuleEntryExports()`
  - `classifyReactRouterImportEdge()`
  - `isServerOnlyModulePath()`
- `src/extract/sources/router/server-effects.ts`
  - `discoverReactRouterActionEffectApis()`

## 5. Existing Patterns to Follow

- Keep public capability interfaces in `src/extract/engine/spi/index.ts`.
- Keep built-in adapter implementations in `src/extract/sources/<framework>/`.
- Keep registry construction in `src/cli/registry/index.ts`; the engine should
  not import built-in sources.
- Prefer capability absence (`[]` or `undefined`) over adapter-id checks.
- Use deterministic composition when multiple providers are active.
- Preserve existing project traversal behavior unless a current branch exists
  only to compensate for hidden navigation capabilities.

## 6. Atomic Implementation Steps

### Step 1 - Add capability interfaces

Files to edit:

- `src/extract/engine/spi/index.ts`

Implementation:

1. Add:

   ```ts
   export interface ModuleRoleAdapter extends ModalityAdapterBase {
     kind: "module-roles";
     classifyModule(ctx: ModuleRoleCtx): ModuleClassification;
     moduleEntryExports(ctx: ModuleRoleCtx): readonly ModuleEntryExport[];
     classifyImportEdge(ctx: ImportEdgeCtx): ImportEdgeContext;
     isServerOnlyModule(
       fileName: string,
       classification?: ModuleClassification,
     ): boolean;
     shouldDiscoverEffectApis?(ctx: EffectApiSurfaceCtx): boolean;
   }
   ```

2. Add `EffectApiSurfaceCtx` with enough data for current Next and React Router
   decisions:
   - `fileName`;
   - `sourceText`;
   - `route?`;
   - `classification`;
   - `entryExports`;
   - `isManifest`;
   - `surface?: ModuleExtractionSurface`.
3. Add:

   ```ts
   export interface EffectApiProvider extends ModalityAdapterBase {
     kind: "effect-api";
     discoverEffectApis(ctx: EffectApiDiscoveryCtx): readonly DiscoveredEffectApi[];
   }
   ```

4. Remove module-role and effect API methods from `NavigationAdapter`.
5. Do not add cache/storage or observation interfaces in this plan.

Acceptance criteria:

- A `NavigationAdapter` can be implemented without module-role or effect API
  methods.
- Module-role and effect API provider types compile independently.

### Step 2 - Add deterministic module-role composition

Files to edit:

- `src/cli/features/extract/project.ts`
- optional helper file under `src/cli/features/extract/` if the composition is
  large enough to deserve one

Implementation:

1. Change `sourceWithReachableImports()` to accept:
   - `navigation?: NavigationAdapter`;
   - `moduleRoleAdapters?: readonly ModuleRoleAdapter[]`;
   - `effectApiProviders?: readonly EffectApiProvider[]`.
2. Replace `classifyModule(adapter, ...)` with a helper that evaluates all
   module-role adapters and merges results:
   - explicit `client`, `server`, `shared`, or `type` beats `unknown`;
   - `serverOnly: true` wins over absent/false;
   - directives are unioned without duplicates;
   - conflicting non-unknown default contexts produce a warning for now. Plan 4
     can turn it into a structured caveat.
3. Replace `moduleEntryExports(adapter, ...)` with a helper that combines
   provider exports deterministically and falls back to
   `inferDefaultEntryExports()`.
4. Replace `classifyImportEdge(adapter, ctx)` with a helper that evaluates all
   module-role adapters:
   - `type` and `asset` win over `unknown`;
   - otherwise preserve the current default of `type` for type-only imports and
     `unknown` for others;
   - conflicting non-unknown classifications produce a warning.
5. Replace `isServerOnlyTarget(adapter, ...)` with provider-based checks plus
   `classification.serverOnly === true`.

Acceptance criteria:

- Project traversal no longer reads module-role methods from
  `NavigationAdapter`.
- Multiple module-role adapters are deterministic.

### Step 3 - Use effect API providers

Files to edit:

- `src/cli/features/extract/project.ts`
- `src/cli/features/extract/command.ts`

Implementation:

1. Replace `adapter?.discoverEffectApis` in `sourceWithReachableImports()` with
   iteration over `effectApiProviders`.
2. Ask module-role adapters whether effect APIs should be discovered through
   `shouldDiscoverEffectApis?(ctx)`.
3. If no module-role adapter answers, use a generic default:
   - discover on `classification.serverOnly === true`;
   - discover on `classification.defaultContext === "server"`;
   - do not use adapter ids.
4. Preserve fetch-op discovery from interaction text.
5. Delete `withServerEffectDiscovery()` from `src/cli/features/extract/command.ts`.
6. Remove direct import of `discoverNextServerEffectApis` from the CLI.

Acceptance criteria:

- `sourceWithReachableImports()` contains no `adapter.id === "next"` or
  `adapter.id === "router"` checks.
- Next server effect discovery is reached through an `EffectApiProvider`.
- React Router action discovery is reached through an `EffectApiProvider`.

### Step 4 - Export built-in providers

Files to edit:

- `src/extract/sources/next/index.ts`
- `src/extract/sources/router/index.ts`
- `src/extract/sources/next/module-roles.ts`
- `src/extract/sources/router/module-roles.ts`
- `src/extract/sources/next/server-effects.ts`
- `src/extract/sources/router/server-effects.ts`

Implementation:

1. Update `nextAdapter()` so it returns only navigation capabilities.
2. Export `nextModuleRoleAdapter()` or `nextModuleRoles()` that wraps the Next
   module-role helpers and implements `shouldDiscoverEffectApis()` for the
   current Next server/shared surface rules.
3. Export `nextEffectApiProvider()` that calls `discoverNextServerEffectApis()`.
4. Update `reactRouterAdapter()` so it returns only navigation capabilities.
5. Export `reactRouterModuleRoleAdapter()` that wraps React Router module-role
   helpers and implements the current action-discovery surface rule.
6. Export `reactRouterEffectApiProvider()` that calls
   `discoverReactRouterActionEffectApis()`.
7. Do not keep `routerSource` as a compatibility alias if it can be deleted in
   this plan. If deleting it causes broad docs/test churn, leave deletion to
   plan 6 and document the reason in the implementation notes.

Acceptance criteria:

- Navigation adapters do not expose module-role/effect API methods.
- Built-in provider exports use public SPI types.

### Step 5 - Register capability providers

Files to edit:

- `src/cli/registry/index.ts`
- `src/cli/features/extract/command.ts`
- `src/cli/registry/index.test.ts`

Implementation:

1. Add `moduleRoleAdapters` and `effectApiProviders` to registry inputs and
   summary, preferably under a new `adapters` bundle:

   ```ts
   adapters: {
     navigation?: NavigationAdapter;
     moduleRoles: readonly ModuleRoleAdapter[];
     effectApis: readonly EffectApiProvider[];
     stateSources: readonly StateSourcePlugin[];
     domainRefinements: readonly DomainRefinementProvider[];
     observations: readonly [];
   }
   ```

2. Validate each provider independently.
3. Register Next navigation, module-role, and effect API providers when the
   `next` dependency is active.
4. Register React Router navigation, module-role, and effect API providers when
   React Router is active, and keep the current default React Router behavior
   when dependencies are unknown.
5. Pass `registry.adapters.moduleRoles` and
   `registry.adapters.effectApis` into project extraction.

Acceptance criteria:

- Registry tests validate incomplete module-role and effect API providers.
- Extraction command receives capabilities from the registry bundle instead of
  grafting methods onto navigation adapters.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/spi/index.ts`.
- Step 2: `src/cli/features/extract/project.ts`.
- Step 3: `src/cli/features/extract/project.ts`,
  `src/cli/features/extract/command.ts`.
- Step 4: `src/extract/sources/next/index.ts`,
  `src/extract/sources/router/index.ts`,
  `src/extract/sources/next/module-roles.ts`,
  `src/extract/sources/router/module-roles.ts`,
  `src/extract/sources/next/server-effects.ts`,
  `src/extract/sources/router/server-effects.ts`.
- Step 5: `src/cli/registry/index.ts`,
  `src/cli/features/extract/command.ts`,
  `src/cli/registry/index.test.ts`.

## 8. Acceptance Criteria

- `NavigationAdapter` no longer contains module-role or effect API methods.
- `ModuleRoleAdapter` and `EffectApiProvider` are public SPI interfaces.
- `sourceWithReachableImports()` consumes module-role and effect API providers.
- `src/cli/features/extract/project.ts` has no adapter-id checks for Next or
  React Router.
- `withServerEffectDiscovery()` is deleted.
- The CLI no longer imports `discoverNextServerEffectApis` directly.
- Built-in Next and React Router providers prove the public contracts.

## 9. Tests to Add or Update

- `src/cli/registry/index.test.ts`
  - validates complete and incomplete `ModuleRoleAdapter`;
  - validates complete and incomplete `EffectApiProvider`;
  - asserts active Next dependencies register Next navigation, module-role, and
    effect API providers;
  - asserts active React Router dependencies register React Router navigation,
    module-role, and effect API providers.
- `src/extract/engine/navigation-adapter-fit.test.ts`
  - fake navigation adapter works without module-role/effect API methods;
  - fake module-role provider drives server/client surface selection;
  - fake effect API provider discovers server actions without navigation id
    checks.
- `test/extraction/next-module-boundaries.test.ts`
  - Next module-role provider still excludes server-only helper fetches from
    client pending ops.
- `src/extract/sources/next/module-roles.test.ts`
  - Next provider classifies `"use client"`, `"use server"`, metadata,
    server-only files, and import edges.
- `src/extract/sources/router/server-effects.test.ts`
  - React Router effect API provider discovers `ACTION <route>` operations.
- `src/cli/features/extract/command.test.ts`
  - command wiring passes module-role/effect providers through registry output.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/cli/registry/index.test.ts
rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts
rtk pnpm vitest run test/extraction/next-module-boundaries.test.ts
rtk pnpm vitest run src/extract/sources/next/module-roles.test.ts
rtk pnpm vitest run src/extract/sources/router/server-effects.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk grep -n "adapter\\.id ===|routerAdapter\\.id ===|withServerEffectDiscovery|discoverNextServerEffectApis" src/cli src/extract
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if module-role providers produce contradictory exact
  classifications for the same file and a deterministic over-approximation is
  not obvious.
- Stop and report if React Router or Next effect API eligibility requires data
  that is not available in `EffectApiSurfaceCtx`. Add the missing generic field
  instead of checking provider ids.
- Stop and report if deleting `routerSource` in this plan creates broad public
  docs churn. Defer only that export deletion to plan 6 with a clear note.
- Stop and report if registry bundle shape conflicts with cache/storage work.
  Prefer a bundle shape that can add `cacheStorage` in plan 3 without another
  broad API rewrite.

## 12. Must Not Change

- Do not add adapter-id checks in new extraction flow.
- Do not make the extraction engine import built-in adapters.
- Do not alter cache modeling or replay harness behavior.
- Do not preserve module-role/effect methods on `NavigationAdapter`.
