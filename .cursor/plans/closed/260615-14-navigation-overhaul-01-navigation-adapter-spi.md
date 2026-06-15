# 260615 — Navigation Overhaul · Phase 01: NavigationAdapter SPI

Prereq: read `260615-navigation-overhaul-00-overview.md`. This phase is **additive and
model-neutral** — no extraction behavior changes; it only introduces the interface + types and
updates plugin validation. Keep all tests green.

## Goal

Define the framework-agnostic `NavigationAdapter` interface and its supporting types in the
extraction SPI, alias the old `RouterPlugin`, and update registry validation to the new shape
without breaking the existing react-router plugin.

## Non-goals (this phase)

- Do **not** implement any adapter method bodies (Phase 02).
- Do **not** change the engine, pipeline, or CLI behavior.
- Do **not** rename the `routerPlugin` field anywhere.

## Current-state findings

- SPI: `src/extract/engine/spi/index.ts:137-158` defines `RouterPlugin` with `routeVars`,
  `navigationCall`, `harness`. `ResolvedOptions` is at `:83-89`.
- Registry: `src/cli/registry/index.ts` imports `RouterPlugin` (`:2-5`), exposes it on
  `ModalityPluginRegistry`/`RegistrySummary`, and validates via `validateRouterPlugin`
  (`:126-146`).
- `routerPlugin` field appears in: `spi/index.ts` (`ExtractCtx.routerPlugin` `:70`),
  `engine/pipeline/index.ts` (`HandlerExtractorOptions`/`ExtractionPipelineOptions`),
  `cli/features/extract/command.ts` (`ModalityConfig`/`ExtractCommandOptions`), registry.
  **Keep the field name**; only its *type* changes (via the alias).

## Files to edit

- `src/extract/engine/spi/index.ts`
- `src/cli/registry/index.ts`
- `src/extract/sources/router/index.ts` (export-type only; no body change)
- `src/cli/registry/index.test.ts` (or wherever `validateRouterPlugin` is tested)

## Atomic steps

1. **Add nav value/types** to `spi/index.ts` (above `RouterPlugin`):
   ```ts
   export type NavMode = "push" | "replace" | "back";
   export interface NavIntent { mode: NavMode; to?: string }
   export type RouteKind = "page" | "index" | "layout" | "resource";
   export interface RouteNode {
     pattern: string; kind: RouteKind; file?: string; redirectTo?: string;
   }
   export interface RouteInventory { routes: readonly RouteNode[] }
   export interface RouteDiscoveryCtx {
     rootDir?: string;
     files: readonly { path: string; text: string }[];
     readFile(path: string): Promise<string>;
   }
   export interface LocationLowering {
     pushTargets: readonly string[];   // literal `to` of push/replace effects
     pushOrigins: readonly string[];   // route bindings of components that emit push/replace
     hasUnboundPush: boolean;          // a push/replace not provably route-bound
   }
   ```
2. **Define `NavigationAdapter`** (new interface) with:
   - `id`, `version?`, `packageNames` (as today);
   - `discoverRoutes(ctx: RouteDiscoveryCtx): Promise<RouteInventory>`;
   - `classifyNavigationCall(callee: string, args: readonly unknown[]): NavIntent | "unsupported"`;
   - `classifyNavigationJsx?(tag: string, attrs: ReadonlyMap<string, unknown>): NavIntent | "unsupported"`;
   - `routeForComponent?(componentName: string, inventory: RouteInventory): string | undefined`
     (name/inventory heuristic — the engine only has component names, not per-file boundaries,
     because sources are concatenated; see Phase 03 findings);
   - `locationVars(inventory: RouteInventory, options: ResolvedOptions, lowering: LocationLowering): readonly StateVarDecl[]`;
   - `harness` (unchanged shape: `setup`/`observe`/`navigate`).
3. **Alias the old name**: `/** @deprecated use NavigationAdapter */ export type RouterPlugin = NavigationAdapter;`
   Keep the legacy `navigationCall(callee,args)` and `routeVars(routes,options)` **off** the new
   interface (they move into the adapter impl in Phase 02 / are superseded by
   `classifyNavigationCall` + `locationVars`). Update `ExtractCtx.routerPlugin?: NavigationAdapter`.
4. **Registry types**: in `src/cli/registry/index.ts` change the imported/used type
   `RouterPlugin` → `NavigationAdapter` on `ModalityPluginRegistry`, `BuiltinRegistryOptions`,
   `RegistrySummary` (field names unchanged: `routerPlugin`/`routerPluginId`).
5. **Registry validation**: rewrite `validateRouterPlugin` to require the new shape —
   `discoverRoutes`, `classifyNavigationCall`, `locationVars`, and
   `harness.{setup,observe,navigate}` are functions. (Keep the function name
   `validateRouterPlugin` to minimize churn; or rename to `validateNavigationAdapter` and keep a
   thin alias — your call, but do not change call sites' behavior.)
6. **Re-export** the new types from `src/extract/sources/router/index.ts` only if it already
   re-exports SPI types; otherwise leave imports pointing at `modality-ts/extract/engine/spi`.
   Run typecheck.

## Acceptance criteria

- `pnpm typecheck` passes. The existing react-router plugin will **not** yet satisfy the new
  interface — that is expected; Phase 02 implements it. To keep this phase compiling, either
  (a) land Phase 01+02 together before running the full build, or (b) temporarily keep the old
  `routeVars`/`navigationCall` members on `NavigationAdapter` as optional and remove them at the
  end of Phase 02. **Pick (a) if unsure** (smaller window of red).
- No behavior change; no model output change.

## Tests to add/update

- Update `validateRouterPlugin` unit tests to the new required methods (a fake adapter object).
- Add a type-level test/fixture: an object literal satisfying `NavigationAdapter` typechecks.

## Verification

```bash
rtk pnpm typecheck
rtk pnpm exec vitest run src/cli/registry
```

## Risks / stop conditions

- If keeping the interface compiling without Phase 02 is awkward, **proceed straight into
  Phase 02** (they are designed to land together). Do not weaken the interface to optional-all
  just to go green.
