# Client Module Context Boundaries

## Goal

Fix `docs/issues/react-router-server-imports-inflate-client-models.md` by making extraction build a client-reachable module surface instead of concatenating every local import reachable from a route file. The default route/component extraction should model UI-reachable client behavior and should not let server-only `loader`, `action`, or server-helper imports add unrelated operations to `sys:pending`.

The fix should be framework-agnostic: introduce a reusable module-context boundary in the extraction project loader, and let router adapters describe framework-specific module defaults, file directives, entry exports, import-edge purpose, and server-only module patterns. The abstraction must distinguish render-surface discovery from interaction-surface extraction so frameworks like Next.js can start from server-rendered route modules while still finding client islands that contain event handlers.

## Non-goals

- Do not add a stopgap `--ignore-server-imports` or React Router-only string filter as the primary fix.
- Do not model full server route flows, loader/action execution, initial data loading, or resource routes in this change.
- Do not change IR semantics, checker behavior, pending queue semantics, or `EffectIR`/`ExprIR` node kinds.
- Do not remove existing support for imported client components such as `Button`, `UploadForm`, route root components, shared custom hooks, or type aliases used by client code.
- Do not introduce a TypeScript type-checker-wide refactor. Use AST-level reachability first; stop if exact symbol resolution becomes necessary.
- Do not make `.server` filename checks the only boundary. They can be one adapter rule, but imports used only by server entry exports must be excluded even when the file name is neutral.
- Do not assume every route render module is an interaction module. Server-rendered pages/layouts may be needed to discover child client components without themselves contributing handlers or fetch operations to the client model.

## Current-State Findings

- `runExtractCommand` loads a project, computes `project.sourceText`, then passes one concatenated string into `runExtractionPipeline` at `src/cli/features/extract/command.ts:96` and `src/cli/features/extract/command.ts:139`.
- `loadExtractionProject` follows local imports for both single-file and directory extraction and joins all imported source text into `sourceText` at `src/cli/features/extract/command.ts:336`.
- `sourceWithLocalImports` is a breadth-first traversal over every local import declaration. It has no notion of client/server/type context and queues all resolved imports at `src/cli/features/extract/command.ts:589`.
- `fetchEffectApis` scans the concatenated source text for every literal `fetch(...)` and feeds those values into `pendingVars`, so server helper fetches can inflate the `sys:pending` op domain even if no client transition enqueues them. Relevant code is `src/cli/features/extract/command.ts:793` and `src/cli/features/extract/command.ts:1567`.
- The source-plugin and router SPI exists in `src/extract/engine/spi/index.ts`. `NavigationAdapter` already centralizes route discovery, navigation-call classification, JSX navigation, route-to-component mapping, and location var lowering at `src/extract/engine/spi/index.ts:169`.
- The React Router adapter currently provides only routing/navigation behavior in `src/extract/sources/router/index.ts:16`; it does not classify module defaults, directives, route module exports, import edges, or server-only modules.
- `discoverRoutes` classifies route nodes and treats API/resource routes as non-client state in `src/extract/sources/router/discover.ts:51`, which is a useful pattern to follow for route-surface classification.
- Existing tests under `src/cli/features/extract/command.test.ts` verify that directory extraction follows client component imports and reports source files, especially the React Router app-directory case around `src/cli/features/extract/command.test.ts:1660`.
- Spec 05 says built-in sources must use public plugin contracts and keep the kernel stable; this fix should extend the public extraction/router SPI rather than adding private React Router hooks.

## Exact File Paths And Relevant Symbols

- `src/cli/features/extract/command.ts`
  - `runExtractCommand`
  - `ExtractionProject`
  - `loadExtractionProject`
  - `loadMultiFileExtractionProject`
  - `sourceWithLocalImports`
  - `localImportSpecifiers`
  - `resolveImportPath`
  - `sourceHashes`
  - `fetchEffectApis`
  - `pendingVars`
  - `createExtractionReport`
- `src/extract/engine/spi/index.ts`
  - `NavigationAdapter`
  - `RouteNode`
  - `RouteInventory`
  - new generic module-context, module-role, and import-edge types plus optional adapter methods
- `src/extract/sources/router/index.ts`
  - `reactRouterAdapter`
- `src/extract/sources/router/discover.ts`
  - `discoverRoutes`
  - `classifyRouteKind`
  - new React Router route-module role helpers if kept near route discovery
- `src/core/report/types.ts`
  - `ExtractionReport`
  - optional additive report fields for effect-operation provenance
- `src/core/artifacts/index.ts`
  - `parseExtractionReportArtifact`; should continue accepting optional additive fields
- `src/cli/features/extract/command.test.ts`
  - add CLI-level regressions using temporary apps
- `src/extract/engine/navigation-adapter-fit.test.ts`
  - update fake Next-style adapter compile/fit tests if the SPI gains optional methods
- `docs/specs/02-extraction.md`
  - document P0 client-reachable module surface, server-only route exports, and operation provenance
- `docs/specs/05-architecture.md`
  - document the router-adapter extension point if needed

## Existing Patterns To Follow

- Keep feature orchestration in `src/cli/features/extract/command.ts`, but move cohesive helper logic into small local functions or a new nearby feature helper only if `command.ts` becomes harder to read.
- Keep framework-specific knowledge inside `NavigationAdapter` implementations, mirroring `classifyNavigationCall`, `classifyNavigationJsx`, and `routeForComponent`.
- Preserve additive schema evolution. `ExtractionReport` may gain optional fields, and `parseExtractionReportArtifact` should continue requiring only current mandatory fields.
- Preserve deterministic output ordering with `uniqueStrings`, sorted arrays, and stable report entries.
- Preserve existing source plugin boundaries: source plugins should see the same client-pruned `sourceText` unless a future server/full-route mode is explicitly added.
- Preserve E1 soundness posture from Spec 02: if a client-reachable import edge cannot be classified precisely, prefer including it and reporting why instead of silently under-approximating modeled client writes.

## Atomic Implementation Steps

1. Add generic module-context and import-edge SPI types.

   Edit `src/extract/engine/spi/index.ts`:
   - Add a context vocabulary:
     - `export type ModuleRuntimeContext = "client" | "server" | "shared" | "type";`
     - `export type ModuleDirective = "use client" | "use server";`
     - `export type ImportEdgeContext = "client-value" | "server-value" | "render-value" | "type" | "asset" | "unknown";`
     - `export type ModuleExtractionSurface = "render" | "interaction";`
     - `export interface ModuleClassification { defaultContext: ModuleRuntimeContext | "unknown"; directives?: readonly ModuleDirective[]; serverOnly?: boolean; reason?: string; }`
     - `export interface ModuleEntryExport { name: "default" | string; context: ModuleRuntimeContext; reason: string; }`
     - `export interface ModuleRoleCtx { fileName: string; sourceText: string; route?: RouteNode; }`
     - `export interface ImportEdgeCtx { importer: string; specifier: string; imported?: string; isTypeOnly: boolean; importerContext: ModuleRuntimeContext | "unknown"; surface: ModuleExtractionSurface; }`
   - Add optional `classifyModule?(ctx: ModuleRoleCtx): ModuleClassification` to `NavigationAdapter`.
   - Add optional `moduleEntryExports?(ctx: ModuleRoleCtx): readonly ModuleEntryExport[]` to `NavigationAdapter`.
   - Add optional `classifyImportEdge?(ctx: ImportEdgeCtx): ImportEdgeContext` to `NavigationAdapter`.
   - Add optional `isServerOnlyModule?(fileName: string): boolean`.
   - Keep methods optional so external adapters and the fake Next adapter remain valid without immediate implementation.
   - Default behavior in the project loader must be: no adapter classification means current broad client behavior for non-route modules, except type-only imports remain type context.
   - Treat `render` and `interaction` as distinct surfaces:
     - `render` means a module/declaration may be walked to discover child components, props, and client islands.
     - `interaction` means the module/declaration may contribute modeled event handlers, effects, state writes, and discovered effect APIs.

2. Implement React Router route-module roles.

   Edit `src/extract/sources/router/index.ts` and, if useful, `src/extract/sources/router/discover.ts`:
   - Add `moduleEntryExports` to `reactRouterAdapter`.
   - Add `classifyModule` that returns `shared`/`unknown` for ordinary route/client modules and `server` with `serverOnly: true` for `.server` or server-directory files.
   - Add `classifyImportEdge` that maps type-only imports to `type` and otherwise leaves React Router value imports as `unknown` unless they originate from known server route exports.
   - For route modules, return server entries for named exports `loader` and `action`.
   - Treat known server-only exports such as `headers` as server too if they appear, but do not overreach into ambiguous exports like `meta` unless tests or docs confirm they are server-only in this repo's supported React Router mode.
   - Return client entries for `default`, PascalCase exported function/const components, and exported hooks only if they are not server entries.
   - Add `isServerOnlyModule` that returns true for filename segments matching `.server.` and `/server/` or `\\server\\`. This is an additional optimization, not the main correctness rule.
   - Keep `clientLoader` and `clientAction` out of default UI-event extraction for now unless an existing test proves they must be modeled. If they are encountered, include them only in report provenance as not modeled, or leave them unclassified and include client code only when referenced by UI roots.

3. Replace all-import BFS with a surface-aware project source builder.

   Edit `src/cli/features/extract/command.ts`; prefer extracting helper functions near `sourceWithLocalImports` or into `src/cli/features/extract/project.ts` if the patch gets large.
   - Replace `sourceWithLocalImports` with `sourceWithReachableImports(entries, tsconfig, adapter?, inventory?)`.
   - Track modules as `{ path, text, classification, renderText, interactionText, included: boolean, excludedReason?: string }`.
   - Parse top-level import declarations and top-level declarations for each file.
   - Seed entry modules:
     - For a route module that maps to a `RouteNode`, use `adapter.classifyModule` and `adapter.moduleEntryExports`.
     - Server/render entries may be walked on the `render` surface to find JSX child components/client islands, but they must not contribute event handlers, useEffect transitions, or discovered fetch/effect APIs to the `interaction` surface.
     - Client/shared entries are eligible for both `render` and `interaction` surfaces unless an adapter narrows them.
     - For root/app shell files, seed `default` and exported PascalCase components/hooks as render roots; include them in interaction only if classified client/shared or no adapter classification exists.
     - Include route manifest files only for route discovery, not extraction text.
     - For direct single-file extraction without route inventory, preserve current broad behavior by treating top-level client-looking components and exports as client roots. If this would drop existing tests, fall back to including the entry file broadly.
   - For each included declaration, collect referenced identifiers. Add same-file top-level declarations that define those identifiers, repeating to a fixpoint while preserving the current surface:
     - render-surface references continue render discovery;
     - interaction-surface references continue interaction extraction;
     - a render-surface JSX reference to an imported component can become interaction-surface only if the target module/declaration is classified client/shared, or if no adapter classification exists.
   - For referenced import bindings, resolve the import and call `adapter.classifyImportEdge` when present. Queue only the imported declaration(s) needed by the current surface.
   - For type-only imports and type references in included declarations, include only type declarations/interfaces/enums and their type dependencies. Do not include value declarations from a type-only module.
   - If a referenced import resolves to an adapter `isServerOnlyModule` file or a module classified `serverOnly` from an interaction declaration, keep it excluded and emit a warning such as `Client import skipped server-only module <path> from <importer>`. This is an E1 stop/report condition because a true client dependency on server code indicates unsupported app structure.
   - If a namespace import or re-export cannot be resolved precisely and it is referenced from client code, include the target module broadly and emit an over-approx warning. This preserves soundness.
   - Add a small generic directive parser that recognizes exact directive prologues (`"use client";`, `'use server';`) and stores them in `ModuleClassification`. React Router may ignore them; Next-style adapters can use them.

4. Build extraction text from interaction-surface declarations, while retaining render discovery.

   Edit `src/cli/features/extract/command.ts`:
   - Add `renderText` and `interactionText` per project source, or an equivalent structure that avoids feeding server-render-only declarations into `extractReactSourceTransitions`.
   - `interactionText` should contain:
     - import declarations whose local bindings are referenced by interaction declarations;
     - included top-level value declarations on the interaction surface;
     - included type declarations needed for domain inference;
     - harmless bare imports only when they are in a client-included module and are local/client-reachable.
   - `renderText` may be used only internally by the project builder to discover child components; do not pass it to the current generic React transition extractor unless it is also interaction text.
   - Use `project.sourceText = project.sources.map((entry) => entry.interactionText).join("\n")`.
   - Keep `project.sources` as the original text for source hashes only for files that contributed included text or were needed for route discovery.
   - Keep `project.sourceFiles` aligned with the files that contributed to the model/report. Do not list server-helper files excluded from client extraction unless a separate optional excluded list is added.
   - Stop and report if pruning produces no render surface for the requested entry route. If it produces render surface but no interaction surface, extraction may emit a zero-transition client model with a clear warning rather than failing.

5. Make effect API discovery use included client source and record provenance.

   Edit `src/cli/features/extract/command.ts`:
   - Replace `fetchEffectApis(sourceText: string): string[]` with a helper that scans each interaction source fragment and returns entries like `{ opId, source: { file, line, column } }`.
   - Compute `project.effectApis` from interaction fragments only.
   - Keep config/options `effectApis` as explicit global additions, since users may intentionally declare abstract operations not present in source.
   - Ensure `pendingVars` still receives only op IDs, but only client-discovered fetches and explicit config/options entries can populate `sys:pending`.
   - Add an internal map `effectApiProvenance` or similar to `ExtractionProject` for report output.

6. Add optional effect-operation provenance to the extraction report.

   Edit `src/core/report/types.ts`:
   - Add optional `effectOperations?: readonly { opId: string; source?: string; line?: number; column?: number; origin: "source" | "config" | "option"; }[]` to `ExtractionReport`.
   - If you prefer not to touch core report types in this patch, add only an internal CLI report field in the created object. But typed optional schema support is better and future-proof.
   - Edit `createExtractionReport` in `src/cli/features/extract/command.ts` to emit sorted `effectOperations`.
   - Do not make `parseExtractionReportArtifact` require this optional field.
   - If output rendering has an existing good place for it, add a compact human line only when useful; otherwise keep it JSON-only.

7. Preserve existing route/component import behavior.

   Edit `src/cli/features/extract/command.ts` and tests:
   - Verify that the React Router app-directory test still includes imported components like `UploadForm`, `Button`, and `TopBar`.
   - If route manifest files are no longer included in `sourceFiles`, update only if that is intentional and documented. Prefer keeping `app/routes.ts` in report source files as route-discovery input, while excluding it from `sourceText` scanned for handlers/effects.

8. Add regression tests for server-only route imports.

   Edit `src/cli/features/extract/command.test.ts`:
   - Add a temporary React Router app with:
     - `app/routes.ts`
     - `app/routes/ingest.$sessionId.tsx`
     - `app/services/ingest.server.ts`
     - a route `loader` or `action` importing server helpers that fetch external URLs
     - a default component with a client form/button that fetches or sets client state
   - Assert the `sys:pending` opId domain does not include server helper operations like Google/Jina/FCM/OAuth URLs.
   - Assert the client operation remains present when the component has a client-side `fetch`.
   - Assert excluded server helper files are not in `result.report.sourceFiles` unless they contributed type-only declarations.
   - Assert `result.report.effectOperations` names the client op source.

9. Add mixed-module and type-only tests.

   Edit `src/cli/features/extract/command.test.ts`:
   - Mixed module test: a neutral helper module exports both `ClientButton` or a client hook and `serverSubmit`. Route `action` imports `serverSubmit`; component imports `ClientButton`. Assert only client-reachable fetches/handlers are modeled.
   - Type-only test: a component imports `type Phase` from a module that also exports a server helper with `fetch("https://example.com/server")`. Assert `local:<Component>.phase` still gets the `Phase` enum domain and `sys:pending` does not include the server fetch.
   - Shared dependency test: if a helper is imported by both server and client roots, only declarations reachable from the client root should be emitted into `includedText`; if the same declaration is genuinely used by the client, include it.

10. Add adapter fit coverage.

    Edit `src/extract/engine/navigation-adapter-fit.test.ts`:
    - Ensure a fake Next-style adapter still compiles without implementing optional module-context methods.
    - Optionally add a fake adapter that marks `generateMetadata` or an equivalent export as server and asserts the generic project builder can use adapter-provided export roles. Keep this minimal if the project builder remains private to the CLI feature.

11. Update docs/specs.

    Edit `docs/specs/02-extraction.md`:
    - In P0, describe the client-reachable module surface, route adapter module roles, server-only roots, and type-only dependencies.
    - State the default: route/component extraction models client UI transitions, while server/full-route extraction is future work.
    - State the safety rule: ambiguous client-reachable imports are included with warnings; server-only imports used only by server roots are excluded.

    Edit `docs/specs/05-architecture.md` only if the `NavigationAdapter` SPI changes need to be documented there.

## Per-Step Files To Edit

- Step 1: `src/extract/engine/spi/index.ts`
- Step 2: `src/extract/sources/router/index.ts`, optionally `src/extract/sources/router/discover.ts`
- Steps 3-5 and 7: `src/cli/features/extract/command.ts`, optionally new `src/cli/features/extract/project.ts`
- Step 6: `src/core/report/types.ts`, `src/cli/features/extract/command.ts`, optionally `src/cli/features/extract/output.ts`
- Steps 8-9: `src/cli/features/extract/command.test.ts`
- Step 10: `src/extract/engine/navigation-adapter-fit.test.ts`
- Step 11: `docs/specs/02-extraction.md`, optionally `docs/specs/05-architecture.md`

## Acceptance Criteria

- Extracting a React Router route with `loader`/`action` imports no longer adds server-only helper fetches to the `sys:pending` opId domain.
- Client-side operations in route components and imported client components remain modeled.
- Type-only imports can still support domain inference without pulling value-side server code into extraction.
- Adapter-specific server/client knowledge lives behind optional public SPI methods, not private React Router checks in the CLI.
- The project loader distinguishes render-surface traversal from interaction-surface extraction so server-rendered route modules can reveal client islands without contributing server effects to `sys:pending`.
- The SPI has enough vocabulary for Next-style adapters to use file directives, default server components, route/API files, metadata/server exports, and client island import edges without another redesign.
- Existing app-directory React Router extraction tests still pass or are updated only for intentional report-source-file semantics.
- `ExtractionReport` can identify where each source-discovered pending/effect operation came from.
- Artifact parsers remain backward-compatible with reports that omit new optional fields.
- No generated artifacts or `dist/` output are committed.

## Tests To Add Or Update

- Add a CLI regression test named along the lines of `excludes React Router server-only imports from client pending ops`.
- Add a CLI regression test for a mixed server/client helper module.
- Add a CLI regression test for type-only imports from a module that also contains server fetch code.
- Update the existing React Router app-directory extraction test if report `sourceFiles` intentionally changes after client-surface pruning.
- Update `navigation-adapter-fit.test.ts` for optional SPI compatibility.
- Add or update adapter fit coverage with a fake Next-style adapter using `"use client"` and a server-rendered page that imports a client component.
- Update `test/kernel/artifacts.test.ts` only if `parseExtractionReportArtifact` validation changes.

## Verification Commands

Run these from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm test -- src/extract/engine/navigation-adapter-fit.test.ts
rtk pnpm test -- test/kernel/artifacts.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If the sibling GDGJP wiki app is available, also manually verify the original reproduction after building this package:

```bash
rtk pnpm build
cd /Users/hari/proj/gdgjp/wiki
rtk node /Users/hari/proj/modality-ts/dist/cli/cli.js extract 'app/routes/ingest.$sessionId.tsx' \
  --out .modality/ingest-session.model.json \
  --app-model .modality/ingest-session.model.ts \
  --report .modality/ingest-session.extraction-report.json
rtk node -e 'const m=require("./.modality/ingest-session.model.json"); console.log(JSON.stringify(m.vars.find(v=>v.id==="sys:pending").domain.inner.fields.opId.values, null, 2))'
```

The second command should not list server-only Google/Jina/FCM/OAuth operations unless they are genuinely reachable from client UI code or explicitly configured as `effectApis`.

## Risks, Ambiguities, And Stop Conditions

- Stop and report if AST-level import/declaration reachability cannot preserve existing imported component behavior without a much larger symbol-resolution refactor.
- Stop and report if render-surface traversal discovers a client island but the builder cannot isolate its interaction declarations from surrounding server declarations.
- Stop and report if a client component imports a server-only module and the imported value is actually used by a client handler/component. That app structure is unsupported by default client extraction and should be surfaced clearly.
- Stop and report if `sourceText` pruning breaks source anchors badly enough that transition/report line numbers become misleading. Prefer per-file included fragments over one anonymous synthetic file.
- Be careful with React Router export semantics. `loader` and `action` are the must-fix server roots. Add other export names only when confident.
- Namespace imports and export-star chains are hard to prune precisely. Include with an over-approx warning when they are client-reachable; exclude only when they are reachable solely from server roots.
- If new optional report fields cause snapshot churn, keep them sorted and additive. Do not bump `schemaVersion` for optional additive fields.
- If a route has both server and client code in one declaration, do not try to split inside a function in this patch. Include client-reachable declarations and warn when mixed contexts cannot be separated.

## Next-Style Adapter Fit Notes

The SPI added by this plan should let a future Next adapter express these rules without changing the CLI project builder again:

- `classifyModule` can mark modules with `"use client"` as client, modules with `"use server"` as server, `app/**/route.ts` as server-only, and ordinary `page.tsx`/`layout.tsx` as server-render roots by default.
- `moduleEntryExports` can mark `generateMetadata`, `generateStaticParams`, and server actions as server entries while keeping JSX render entries available for render traversal.
- `classifyImportEdge` can let a server-render page import a client component as a render edge that becomes an interaction root only at the imported `"use client"` module boundary.
- The project builder should pass only interaction-surface client island text into `extractReactSourceTransitions`, while still using render-surface traversal to discover those islands from server-render roots.
