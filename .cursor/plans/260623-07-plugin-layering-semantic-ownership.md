# Plugin Layering Remediation — Part 3: Semantic Ownership

## Goal

Move remaining library- and environment-specific semantics out of `src/extract/engine/ts/**` and into the appropriate L4 plugins, then relocate those plugins into one coherent plugin tree. After this part, engine and L2 compiler code may own traversal, control flow, dataflow, CPS shape, guards, and IR composition, but must not recognize React hook names, React context helper names, useState var-id shapes, router form tags, timer APIs, WebSocket APIs, or type-library grammars directly.

This plan intentionally does not preserve backward compatibility. Delete old engine-side recognizers once their plugin equivalents exist.

## Execution order correction (read first)

This plan runs **last** of the three remediation parts: after `260623-07` (delete legacy driver, make the pipeline framework-agnostic) and `260623-05` (de-`typescript` the SPI, canonical Surface IR, plugin factory). Relocation and vocabulary normalization are structural finishing work and depend on the new contracts and the deleted legacy driver already existing. See the ordering note in those two plans.

## Decision — no top-level `handler` category

The current `HandlerWrapperProvider` (`engine/spi/index.ts:497`) has a single method, `unwrapHandler`, that takes a callback-wrapping expression (`form.handleSubmit(cb)`) and returns the inner callback to compile. That is a *leaf-unwrap facet*, not a fifth use case. The spec L3 catalogue (`03-use-case-spis.md`) defines exactly five categories: state, framework, effect, route, type. Do **not** introduce a sixth `handler` category.

Resolution (replaces every "handler" hedge in the steps below):
- Express handler unwrap as an **optional facet** any plugin may implement, e.g. `unwrapHandler?` on `FrameworkPlugin`, surfaced through `LeafDispatch` before handler-body compilation. It is not its own plugin kind.
- Place the react-hook-form built-in at **`src/extract/plugins/framework/react-hook-form`** (a form-framework adapter that implements only the `unwrapHandler` facet). Do not create `plugins/handler/*`.
- Drop `createHandlerPlugin` / `HandlerPlugin` from the Part 1 factory set; use the facet on `FrameworkPlugin` instead. The canonical plugin tree is `plugins/{state,route,type,framework,effect}` with no `handler` subdirectory.

## Non-goals

- Do not preserve legacy AST summarizer behavior as a fallback.
- Do not complete the thin-driver deletion; that is Part 3.
- Do not add compatibility adapters that translate old plugin AST hooks into new Surface IR hooks.
- Do not change checker semantics or kernel IR.
- Do not leave plugin implementations split across legacy `sources/`, `frameworks/`, `effect-models/`, and `type-libraries/` directories once their new home exists.

## Current-state findings

- `src/extract/engine/ts/context.ts` still special-cases the `"use-state"` plugin, assumes `local:${component}.` var-id prefixes, and hardcodes React helper names such as `useCallback`, `useMemo`, and `useContext`.
- `src/extract/engine/ts/transition/timers.ts` still owns timer recognition for `setTimeout`, `setInterval`, `clearTimeout`, and `clearInterval`.
- `src/extract/engine/ts/transition/environment-callbacks.ts` still owns `WebSocket` constructor and callback assignment recognition.
- `src/extract/effect-models/timers/index.ts` and `src/extract/effect-models/websocket/index.ts` currently wrap engine helper functions instead of owning recognition and model fragments.
- `src/extract/engine/ts/transition/statement-summary.ts` still directly handles framework hook categories such as `flush-sync` and `start-transition`.
- Router form recognition is partially behind `NavigationAdapter.recognizeFormSubmit`, but confirm no residual `<Form>`, `useSubmit`, or `useActionData` matching remains in engine files.
- Type-library plugins already exist under `src/extract/type-libraries`, but numeric/domain helpers and native alias processing still live under `src/extract/engine/ts`, making the type-plugin boundary incomplete.
- The desired physical layout is a plugin tree such as `src/extract/plugins/{state,route,type,framework,effect,handler}` rather than several top-level adapter folders.
- `package.json`, `src/cli/features/init/command.ts`, `src/cli/extraction/build-model.ts`, `src/cli/features/extract/extraction-project.ts`, docs, and architecture tests still refer to old implementation paths such as `modality-ts/extract/sources/*`, `extract/frameworks/*`, `extract/effect-models/*`, and `extract/type-libraries/*`.
- Public configuration and code names still say `sourcePlugins`, `routerPlugin`, `effectModelProviders`, `NavigationAdapter`, `DomainRefinementProvider`, and `EffectModelProvider`, which hides the intended `state`/`route`/`type`/`effect` plugin categories.
- `src/extract/engine/navigation-adapter-fit.test.ts` and navigation tests still encode the old route extension vocabulary and import the React extraction driver from `engine/ts`.

## Atomic implementation steps

1. **Create the canonical plugin directory layout and relocate built-ins.**
   - Add `src/extract/plugins/` as the only home for built-in plugin implementations.
   - Use category subdirectories: `plugins/state/*`, `plugins/route/*`, `plugins/type/*`, `plugins/framework/*`, `plugins/effect/*`, and `plugins/handler/*` if handler-wrapper plugins remain separate.
   - Move existing implementations:
     - `sources/use-state`, `jotai`, `swr`, `zustand`, `tanstack-query`, `redux` -> `plugins/state/*`.
     - `sources/router`, `sources/next`, `sources/tanstack-router` -> `plugins/route/*`.
     - `type-libraries/zod`, `type-libraries/arktype` -> `plugins/type/*`.
     - `frameworks/react` -> `plugins/framework/react`.
     - `effect-models/timers`, `effect-models/websocket` -> `plugins/effect/*`.
     - `sources/react-hook-form` -> `plugins/handler/react-hook-form` unless folded into a route/state category.
   - Update public exports, package export maps, registry imports, CLI build-model imports, CLI extraction-project imports, `modality init` generated config imports, architecture tests, examples, and docs to the new paths. Do not keep old-path re-exports.
   - Delete old implementation directories after relocation. Keeping empty compatibility barrels or stale tests under those paths is not acceptable.

2. **Normalize plugin vocabulary across config, options, and tests.**
   - Rename `sourcePlugins` to `statePlugins` everywhere.
   - Rename `routerPlugin` to `routePlugin` everywhere.
   - Rename `domainRefinements` / type-library provider plumbing to `typePlugins` or to a clearly named `typePlugin` facet.
   - Rename `effectModelProviders` and `effectModels` to `effectPlugins`.
   - Rename tests and files with old adapter vocabulary, for example `navigation-adapter-fit.test.ts`, to route-plugin terminology.
   - Update `modality init` output so generated `modality.config.ts` explicitly declares `createStateSourcePlugin`/built-in state plugins, route plugins, framework plugins, type plugins, and effect plugins from `modality-ts/extract/plugins/...`.

3. **Move React context and helper semantics into the React framework plugin.**
   - Add React framework methods or returned hook roles for `useCallback`, `useMemo`, `useContext`, provider value extraction, and custom hook context-return classification.
   - Update `src/extract/engine/ts/context.ts` callers to ask `FrameworkPlugin` instead of checking React names.
   - Delete local helpers in `context.ts` that match `useCallback`, `useMemo`, or `useContext` by string.

4. **Move local useState binding ownership fully into the use-state state plugin.**
   - Remove engine assumptions about the `"use-state"` plugin id and `local:${component}.` prefixes.
   - Add/extend source-plugin APIs so the engine can request local setter bindings from all active state sources by component/file/symbol, not by hardcoded id.
   - Ensure `useStateSource` owns local var-id shapes, setter aliases, provider-exposed setter mapping, and `decodeBinding`.

5. **Move timer recognition and model construction into `plugins/effect/timers`.**
   - Relocate timer recognition helpers from `src/extract/engine/ts/transition/timers.ts` into `src/extract/plugins/effect/timers/`.
   - Keep only engine-generic scheduling/CPS utilities in L2/engine if they do not mention timer API names.
   - Make timer provider return pure effect-model fragments and metadata needed by L2 to register pending vars and resolve transitions.
   - Delete engine-side `setTimeout`, `setInterval`, `clearTimeout`, and `clearInterval` string recognition.

6. **Move WebSocket recognition and model construction into `plugins/effect/websocket`.**
   - Relocate `WebSocket` constructor recognition, callback assignment recognition, cleanup recognition, and lifecycle event mapping into the WebSocket effect-model plugin.
   - Keep generic environment callback/CPS composition outside the plugin only if it is library-neutral.
   - Delete engine-side `WebSocket` string recognition.

7. **Move framework concurrency leaves out of statement summary.**
   - Move recognition for `startTransition`, `useTransition`, `flushSync`, and deferred values into `FrameworkPlugin` outputs.
   - Let L2/engine compile the callback body and scheduling shape generically after the framework plugin identifies the leaf kind.
   - Delete direct framework hook handling from `statement-summary.ts`.

8. **Complete route/type ownership and add no-library-string guardrails.**
   - Search engine files for `Form`, `useSubmit`, `useActionData`, and router-specific strings.
   - Move any remaining recognition into `src/extract/plugins/route/*` behind `RoutePlugin.recognizeFormSubmit` or other route SPI methods.
   - Keep generic location-var lowering in engine code.
   - Move Zod/ArkType/native type-library grammar and domain-refinement ownership into `src/extract/plugins/type/*`; leave only language-neutral finite-domain operations outside plugins.
   - Add a targeted test or lint script that scans `src/extract/engine/ts` and `src/extract/compile` for forbidden library API names from the plugin-layering coupling inventory.
   - Allow only documented false positives in tests or comments outside product code.

9. **Update the `docs/_specs/plugin-layering` series to match the new vocabulary and layout.**
   - The specs are normative and currently contradict Parts 1–3: `03-use-case-spis.md` names `NavigationAdapter`, `EffectModelProvider`, `DomainRefinementProvider`; `00-overview.md`/`02-semantic-compiler.md` §3.1 still place numeric abstraction and L4 plugins under `src/extract/engine/ts/numeric/`, `src/extract/sources/*`, `src/extract/frameworks/*`. The verification grep gates in this plan and Part 1 (which scan `docs`) would fail against this stale spec text.
   - Rewrite the L0–L5 table in `00-overview.md` so L4 reads `src/extract/plugins/*` and L2/formalization reads `src/extract/compile/*`.
   - Rewrite `03-use-case-spis.md` to the normalized SPI names (`RoutePlugin`, `EffectPlugin`, `TypePlugin`, `FrameworkPlugin`, `StateSourcePlugin`) and record the "no top-level `handler` category" decision above.
   - Update `02-semantic-compiler.md` §3.1 and `§5`/`§8` references from `engine/ts/numeric` to `src/extract/compile/numeric`, and the dependency-rule prose to the final boundaries.
   - Update `06-migration-roadmap.md` so the per-phase paths match the delivered layout, or append a short "remediation parts" addendum mapping Phases to `260623-05/06/07`.
   - Run `pnpm fix` on the edited Markdown.

## Tests to add or update

- Add use-state binding tests proving local state binding still works without engine checking plugin id or var-id prefix.
- Add React framework tests for `useCallback`, `useMemo`, `useContext`, provider value extraction, `startTransition`, `useTransition`, `flushSync`, and deferred values.
- Update timer tests so timer recognition passes through `plugins/effect/timers` with no engine helper import.
- Update WebSocket tests so constructor/callback/cleanup recognition passes through `plugins/effect/websocket` with no engine helper import.
- Update router form tests to assert navigation plugin ownership.
- Update Zod/ArkType/native type-plugin tests to assert they live under `plugins/type/*` and do not import engine internals.
- Add export-map tests or package-entry tests proving old plugin implementation paths are gone and new `plugins/*` paths work.
- Add CLI init snapshot tests proving generated config imports from `modality-ts/extract/plugins/...` and uses normalized field names.
- Add docs/reference tests or grep gates proving user-facing docs no longer direct plugin authors to `sources/`, `frameworks/`, `effect-models/`, or `type-libraries/`.
- Update architecture tests to reject old implementation directories and old public plugin vocabulary.
- Add forbidden-string architecture tests for engine/compile product code.

## Verification

- `rtk pnpm typecheck`
- `rtk pnpm vitest run test/sources/use-state test/frameworks/react test/effect-models test/sources/router`
- `rtk pnpm vitest run test/extraction/architecture.test.ts test/frameworks/react/architecture.test.ts`
- `rtk pnpm architecture`
- `rtk pnpm phase7`
- `rtk pnpm ci:examples`
- `rtk pnpm test`
- `rtk pnpm fix`
- `rtk rg -n "extract/(sources|frameworks|effect-models|type-libraries)|modality-ts/extract/(sources|frameworks|effect-models|type-libraries)" src docs test package.json` returns no product-code, public-doc, or export-map matches.
- `rtk rg -n "NavigationAdapter|DomainRefinementProvider|EffectModelProvider|sourcePlugins|routerPlugin|effectModelProviders" src docs test package.json` returns no remaining public API or configuration matches.

## Acceptance criteria

- `src/extract/engine/ts/**` and `src/extract/compile/**` contain no direct recognition of React, React Router, JSX/DOM event names, DOM form/input tags, Suspense/lazy/use render-boundary names, browser timer/WebSocket/fetch/confirm APIs, Jotai, SWR, Zustand, TanStack Query, or Redux API names.
- Plugin implementations live under `src/extract/plugins/{state,route,type,framework,effect}` or an explicitly justified additional category.
- Old implementation directories `src/extract/sources`, `src/extract/frameworks`, `src/extract/effect-models`, and `src/extract/type-libraries` are deleted or reduced to non-implementation docs only. Do not keep compatibility re-exports.
- Public entry points, docs, CLI generated config, examples, and architecture tests all use `src/extract/plugins/...` / `modality-ts/extract/plugins/...`.
- Public option/config names use `statePlugins`, `routePlugin`, `typePlugins`, `frameworkPlugin`, and `effectPlugins`, with no compatibility aliases.
- `context.ts` no longer hardcodes `"use-state"`, `local:` prefixes, `useCallback`, `useMemo`, or `useContext`.
- Timer and WebSocket effect-model providers own their API recognition without importing `engine/ts/transition/timers.ts` or `engine/ts/transition/environment-callbacks.ts`.
- Framework concurrency and context recognition are owned by `src/extract/plugins/framework/react`.
- Router form recognition is owned by `src/extract/plugins/route/*`.
- Type-library grammar/domain-refinement recognition is owned by `src/extract/plugins/type/*`.
- Existing extraction snapshots and conformance probes remain semantically equivalent unless Part 2 deliberately exposes a previously hidden over-approximation caveat.

## Risks, ambiguities, and stop conditions

- Stop if a plugin cannot express a leaf with existing `EffectIR`/`ExprIR`; file a kernel-IR design issue instead of smuggling semantics through plugin-specific nodes.
- Stop if forbidden strings are needed for a generic diagnostic. Move those strings to plugin-owned diagnostics or make the diagnostic generic.
- Watch for moving too much control flow into plugins. Plugins should identify leaves and return pure fragments; L2 should still own `if`, loops, sequencing, dataflow, and CPS composition.
- Stop if a plugin category does not fit `state`, `route`, `type`, `framework`, `effect`, or `handler`; name the missing use-case category explicitly instead of hiding it under `sources`.
- Do not retain engine helper files that only exist for old plugin wrappers.
