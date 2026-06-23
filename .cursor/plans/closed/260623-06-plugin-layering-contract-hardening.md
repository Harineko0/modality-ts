# Plugin Layering Remediation — Part 2: Contract Hardening

## Goal

Make the plugin-layering contracts match `docs/_specs/plugin-layering` before any larger driver rewrite. The outcome is a single canonical Surface IR contract, a normalized plugin-construction API, language-neutral L3 SPIs, and strict dependency boundaries that prevent raw TypeScript AST or `engine/ts` implementation types from leaking into state, route, type, framework, effect, handler, module, cache, observation, or route-execution plugins.

This plan intentionally does not preserve backward compatibility. Delete interim bridge types and legacy-compatible API shapes instead of supporting both old and new contracts.

## Execution order correction (read first)

**This part must run AFTER Part 3 (`260623-07-plugin-layering-delete-legacy-driver`), not before it.** The numbering is misleading; the dependency runs the other way.

Reason: `src/extract/engine/spi/framework.ts:5` defines `SurfaceCall = ts.CallExpression` (and `SurfaceNode = ts.Node`) as a *deliberate dual-path bridge*. The legacy AST driver — `engine/ts/ast.ts`, `react-source-transitions.ts`, `transition/statement-summary.ts`, `transition/suspense.ts`, `transition/concurrent.ts` — passes raw `ts` nodes into the exact same `recognizeHook` / `recognizeRenderBoundary` / `recognizeEffect` contracts this part wants to de-`typescript`. That legacy driver is not deleted until Part 3.

If contract-hardening runs first, the still-live legacy driver must lower `ts.Node → Surface IR` at every plugin call boundary just to keep compiling — a throwaway adapter inside a module that Part 3 deletes. That violates the repo's "no stopgap fixes" principle.

Corrected sequence:
1. **Part 3 first** — promote L2 to production parity, make the L1→L2 Surface path the only driver, delete the legacy AST summarizer and React feature modules, and make `engine/pipeline/index.ts` framework-agnostic. After this, Surface IR is already the sole input to every plugin.
2. **Part 1 next (this plan)** — with no AST-facing caller left, removing `typescript` from the SPI and canonicalizing Surface IR is a pure type change with no bridge.
3. **Part 2 last** — relocate plugins into `src/extract/plugins/*`, normalize vocabulary, and update the `docs/_specs/plugin-layering` series to match.

Keep the file names as-is; only the execution order changes.

## Non-goals

- Do not rewrite the full transition driver in this part.
- Do not move every React, timer, WebSocket, or router semantic yet; that is Part 2.
- Do not keep compatibility aliases such as `SurfaceCall = ts.CallExpression`.
- Do not add new kernel IR node kinds.
- Do not preserve public exports that only exist to support the old AST-facing plugin contracts.
- Do not keep plain interface-only plugin construction as the primary authoring pattern.

## Current-state findings

- `src/extract/engine/spi/framework.ts` imports `typescript` and defines `SurfaceCall = ts.CallExpression`, `SurfaceNode = ts.Node`, and callback handlers as `ts.Expression`.
- `src/extract/engine/spi/effect-model.ts` imports `typescript` plus `engine/ts` types such as `TimerRegistration`, `WebSocketRegistration`, `TransitionBinding`, and `SetterBinding`.
- There are duplicate Surface IR definitions in `src/extract/engine/spi/surface-ir.ts` and `src/extract/lang/ts/surface-ir.ts`.
- `src/extract/compile/*` imports Surface IR from `engine/spi`, so L2 does not consume the L1-owned contract described by the spec.
- `src/extract/lang/ts/symbol-port.ts` exposes `nodeAt` on the primary `SymbolPort` implementation even though raw-node access should be L4-only through a narrow origin adapter.
- There is no common `createPlugin({ ... })` factory. Built-ins such as `useStateSource()`, `jotaiSource()`, `reactFramework()`, `timerEffectModelProvider()`, and router/type-library providers return plain interface-shaped objects.
- There are no category constructors such as `createStateSourcePlugin({ ... })`, `createRoutePlugin({ ... })`, or `createTypePlugin({ ... })`; validation is mostly centralized in the registry after the object has already been created.
- `src/extract/engine/spi/index.ts` is still broadly TypeScript-shaped: `DomainRefinementContext`, `SemanticTypeContext`, `DiscoverCtx`, `TypeCtx`, `ChannelCtx`, `ExtractCtx`, `NavigationAdapter`, and `HandlerWrapperProvider` expose `ts.TypeNode`, `ts.Expression`, `ts.VariableDeclaration`, `ts.SourceFile`, `ts.Node`, `ts.Symbol`, `ts.JsxAttribute`, or `../ts` implementation types.
- `src/extract/engine/spi/form-submit.ts` and `src/extract/engine/spi/effect-model.ts` still import TypeScript or `engine/ts` transition types, so route and effect hooks are not yet language-neutral.
- `SemanticTypeContext` is a TypeScript front-end service but is exported through the generic SPI. It should move behind `src/extract/lang/ts` as a TypeScript `TypePort`/origin service, while generic plugins consume `TypeView` and Surface IR.
- Naming is inconsistent across the public extraction surface: `Plugin`, `Adapter`, `Provider`, `Source`, `NavigationAdapter`, `DomainRefinementProvider`, `EffectModelProvider`, `HandlerWrapperProvider`, `sourcePlugins`, `routerPlugin`, and `effectModelProviders` describe similar extension points with different concepts.
- Plugin implementations are scattered across `src/extract/sources`, `src/extract/frameworks`, `src/extract/effect-models`, and `src/extract/type-libraries`, which makes plugin layering look like several unrelated adapter systems instead of one plugin system.
- `tools/depcruise.config.cjs` is green, but its rules still allow `frameworks/*` and `effect-models/*` to import `extract/engine/ts`, which is looser than the finished layering requires.

## Atomic implementation steps

1. **Introduce a common plugin factory foundation.**
   - Add a shared factory module under the new plugin system, for example `src/extract/plugins/create-plugin.ts`.
   - Implement `createPlugin({ id, kind, version, packageNames, ... })` as the base constructor used by every plugin category.
   - The base constructor should normalize `packageNames`, stamp/lock `kind`, reject missing ids and duplicate package names, and preserve type inference for category-specific fields.
   - Move common validation logic out of `src/cli/registry/index.ts` into reusable factory/validation helpers so plugin authors get failures at construction time as well as registry time.
   - Export `createPlugin` from the public extraction plugin API.

2. **Add category constructors that wrap `createPlugin`.**
   - Add `createStateSourcePlugin`, `createFrameworkPlugin`, `createRoutePlugin`, `createTypePlugin`, `createEffectPlugin`, and any needed `createModulePlugin`, `createCachePlugin`, `createObservationPlugin`, or `createRouteExecutionPlugin`. Do **not** add `createHandlerPlugin`: per Part 2's decision there is no top-level `handler` category — handler unwrap is an optional `unwrapHandler?` facet on `FrameworkPlugin`.
   - Normalize category type names at the same time: `NavigationAdapter` becomes `RoutePlugin`, `DomainRefinementProvider` becomes `TypePlugin` or a type-plugin facet, `EffectModelProvider` becomes `EffectPlugin` or an effect-plugin facet, and `HandlerWrapperProvider` collapses into the `FrameworkPlugin.unwrapHandler?` facet (no standalone `HandlerPlugin`).
   - Normalize option/config field names: `sourcePlugins` -> `statePlugins`, `routerPlugin` -> `routePlugin`, `effectModelProviders`/`effectModels` -> `effectPlugins`, and `domainRefinements` -> `typePlugins` or a clearly named type-plugin facet. Since backward compatibility is out of scope, delete the old names rather than aliasing them.
   - Ensure category constructors require the category's mandatory hooks and forbid hooks from unrelated categories.
   - Update built-ins to use the constructors, e.g. `const plugin = createStateSourcePlugin({ ... })` and return/export that plugin from the factory function.

3. **Canonicalize Surface IR under L1/shared API.**
   - Choose one canonical location for Surface IR that L1 owns and L2 consumes. Prefer `src/extract/lang/surface-ir.ts` or `src/extract/lang/ts/surface-ir.ts` re-exported from `src/extract/lang/index.ts`.
   - Delete `src/extract/engine/spi/surface-ir.ts`.
   - Update `src/extract/compile/*`, `src/extract/engine/spi/leaf-dispatch.ts`, and all tests to import the canonical Surface IR.

4. **Split symbol/type ports from raw-node origin access.**
   - Keep `SymbolPort` language-neutral: `resolve`, `localSymbolKey`, `importBinding`, and `typeOf`.
   - Move `nodeAt` into a separate L4-facing `OriginReader` / `TsOriginReader` contract.
   - Update TypeScript lowering to provide both objects where needed, but do not put raw `ts.Node` access on the generic `SymbolPort`.

5. **Rewrite all plugin contracts to consume Surface IR, ports, and factory-created base metadata.**
   - Remove `typescript` imports from `src/extract/engine/spi/framework.ts`.
   - Make `recognizeHook(call, ctx)` accept canonical `SurfaceCall`.
   - Make `recognizeRenderBoundary(node, ctx)` and `classifyComponent(decl, ctx)` accept canonical Surface IR nodes/declarations.
   - Replace `handler: ts.Expression` in callback recognition with a `NodeRef` or Surface function/body reference.
   - Move TypeScript-specific origin inspection into `src/extract/plugins/framework/react/*` via the new origin reader.
   - Remove `typescript` imports from `src/extract/engine/spi/effect-model.ts`.
   - Replace `EffectSurfaceCall = ts.CallExpression | ts.NewExpression` with canonical `SurfaceCall` plus any needed call-kind metadata.
   - Replace `recognizeEffectAssignment(statement: ts.ExpressionStatement, ...)` with an assignment/statement-shaped Surface IR method.
   - Remove engine-specific context fields such as timer/websocket registration arrays from `EffectCtx`; providers should return pure recognition/model fragments, while L2 owns CPS and registration threading.
   - Rewrite `StateSourcePlugin` discovery, type, channel, and extraction contexts to use `SourceUnit`, `SurfaceModule`, `SymbolPort`, `TypeView`, and source anchors. They must not expose `SemanticTypeContext`, raw source-file objects, or `engine/ts` helper callbacks.
   - Rewrite route/form hooks so `RoutePlugin` receives Surface JSX/form/event descriptors and handler references, not `ts.JsxAttribute`, `ExtractableHandler`, `ParsedGuard`, or `SetterBinding` from `engine/ts`.
   - Rewrite type-plugin/domain hooks so they receive canonical `TypeView`, Surface declarations/initializers, and optional origin-reader capabilities. No generic type plugin contract may contain `ts.TypeNode`, `ts.Expression`, or `ReadonlyMap<string, ts.TypeNode>`.
   - Rewrite handler, module-role, effect-api, cache-storage, observation, and route-execution extension points as plugin categories or plugin facets with the same language-neutral contracts.
   - Move the TypeScript-only `SemanticTypeContext` replacement into `src/extract/lang/ts` and expose it to plugins only through narrow origin-reader/TypeScript plugin helper modules.

6. **Update L4 plugins to the new contracts and constructors.**
   - Update `src/extract/plugins/framework/react/*` to consume Surface IR and origin reader helpers.
   - Update `src/extract/plugins/effect/timers/*` and `src/extract/plugins/effect/websocket/*` to consume Surface IR.
   - Update any router/form or source plugin code affected by Surface IR imports.
   - Replace every built-in plain object return with a category constructor call.

7. **Tighten dependency-cruiser boundaries.**
   - Change `framework-slices-use-extraction-spi-only` so frameworks may import `core`, canonical `extract/lang` Surface types, and `extract/engine/spi`, but not `extract/engine/ts`.
   - Change effect-model boundaries the same way.
   - Keep `extract/compile` limited to `core`, canonical Surface IR, and `extract/engine/spi`.
   - Ensure `extract/engine` does not import `extract/lang` directly except through a tiny wiring module that can be removed in Part 3 if no longer needed.
   - Remove interim exports from `src/extract/engine/spi/index.ts` that expose deleted AST aliases.
   - Update `package.json` export maps if they mention deleted bridge modules.
   - Remove or rewrite tests that assert AST-facing SPI behavior.

## Tests to add or update

- Add SPI contract tests that fail if `framework.ts` or `effect-model.ts` imports `typescript` or `engine/ts`.
- Add SPI contract tests that fail if any file under `src/extract/engine/spi` imports `typescript`, imports `../ts`, or mentions `ts.` in a public contract.
- Add factory tests for `createPlugin`, `createStateSourcePlugin`, `createFrameworkPlugin`, `createRoutePlugin`, `createTypePlugin`, `createEffectPlugin`, `createHandlerPlugin`, and any remaining plugin-category constructors.
- Add tests proving category constructors reject missing required hooks and unrelated-category hooks.
- Update `test/lang/ts/surface-ir.test.ts` to assert the canonical Surface IR import path.
- Update `test/compile/*` to use the canonical Surface IR path.
- Update `test/frameworks/react/react-framework.test.ts` for Surface IR plus origin-reader recognition.
- Update `test/effect-models/*` for Surface IR recognition.
- Add architecture tests that specifically reject `src/extract/plugins/** -> src/extract/engine/ts/**` and reject legacy implementation directories.
- Add naming tests or export-map tests that reject old public names such as `NavigationAdapter`, `DomainRefinementProvider`, `EffectModelProvider`, `HandlerWrapperProvider`, `sourcePlugins`, `routerPlugin`, and `effectModelProviders`.

## Verification

- `rtk pnpm typecheck`
- `rtk pnpm vitest run test/lang/ts test/compile test/frameworks/react test/effect-models`
- `rtk pnpm vitest run test/extraction/architecture.test.ts test/frameworks/react/architecture.test.ts`
- `rtk pnpm architecture`
- `rtk pnpm test`
- `rtk pnpm fix`
- `rtk rg -n "typescript|ts\\.|SourceFile|TypeNode|CallExpression|Jsx|SemanticTypeContext|\\.\\./ts" src/extract/engine/spi` returns no product-code matches.
- `rtk rg -n "NavigationAdapter|DomainRefinementProvider|EffectModelProvider|HandlerWrapperProvider|sourcePlugins|routerPlugin|effectModelProviders" src/extract src/cli docs test package.json` returns no product-code or public-doc matches after renamed tests are updated.

## Acceptance criteria

- There is exactly one canonical Surface IR definition.
- `createPlugin({ ... })` exists and is the base used by category constructors.
- Built-in plugins use category constructors such as `createStateSourcePlugin({ ... })` rather than returning plain interface object literals.
- No generic SPI file under `src/extract/engine/spi` contains `typescript` imports, `ts.` public shapes, `SemanticTypeContext`, or imports from `src/extract/engine/ts`.
- All public plugin and option names follow one vocabulary: `XPlugin` plus `createXPlugin`, and `statePlugins`/`routePlugin`/`typePlugins`/`frameworkPlugin`/`effectPlugins` fields.
- L3 context objects do not expose engine implementation state such as timer/websocket registration arrays.
- Plugins cannot import `src/extract/engine/ts/**`.
- All updated plugin and compiler tests pass.
- Architecture rules enforce the intended L1/L2/L3/L4 boundaries.

## Risks, ambiguities, and stop conditions

- Stop if the current Surface IR cannot represent a necessary call, new-expression, assignment, or JSX shape without giving L4 raw AST access. Add the missing Surface IR shape instead of reintroducing `ts.Node` into L3.
- Stop if moving `nodeAt` out of `SymbolPort` reveals framework code depending on broad AST traversal. Replace that traversal with a narrow origin reader method for the exact shape.
- Watch for duplicated type definitions after export rewiring; delete duplicates rather than aliasing them indefinitely.
- Stop if a category cannot be represented by a `createPlugin` base plus a narrow category extension. That indicates the category boundary is wrong; reshape the plugin category instead of bypassing the common factory.
- Do not keep deprecated compatibility exports for external users.
