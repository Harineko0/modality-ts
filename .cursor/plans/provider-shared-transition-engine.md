# Provider Shared Transition Engine Plan

## Goal

Make every built-in source provider in `src/extract/sources/` benefit from the shared TypeScript transition extractor in `src/extract/engine/ts/transition/`, including the newly supported syntax in the working tree such as async handlers, sequential statements, loops, `if`/`switch`/`try`, guard returns, and TypeScript expression wrappers.

The implementation must stay DRY: transition summarization logic should live in the engine, while source providers only describe their state variables, write channels, templates, harnesses, and provider-specific call classification.

## Non-goals

- Do not duplicate statement-walking, async, loop, guard, or expression parsing logic inside `src/extract/sources/jotai`, `src/extract/sources/swr`, or `src/extract/sources/router`.
- Do not change the public IR shapes in `modality-ts/core`.
- Do not broaden provider discovery semantics beyond what is required for transition extraction.
- Do not emit duplicate transitions when multiple providers are enabled together.
- Do not remove existing `extractUseStateSkeleton` / `extractUseStateVars` compatibility exports.
- Do not commit generated `dist/` output.

## Current-State Findings

- Working-tree transition-engine changes exist under `src/extract/engine/ts/transition/`; `git diff --cached -- src/extract/engine/ts/transition` is empty, so these are not staged in the Git index at inspection time.
- `src/extract/engine/ts/transition/statement-summary.ts` is a new shared summarizer. It centralizes:
  - `summarizeHandlerStatements`
  - `summarizeStatements`
  - `summarizeAsyncSegment`
  - `setterCallFrom`
  - `settersWrittenIn`
  - `effectFromSummaries`
  - loop fallback/havoc behavior
- `src/extract/engine/ts/transition/handlers.ts` now delegates sequential extraction to `summarizeHandlerStatements` and async support to `transitionsFromAsyncHandler`.
- `src/extract/engine/ts/react-source-transitions.ts` is already the shared React handler extraction entry point. It accepts:
  - `stateVars`
  - `writeChannels`
  - `sourcePlugins`
  - `routerPlugin`
  - `routePatterns`
  - `effectApis`
- `src/extract/engine/pipeline/index.ts` already performs one generic call to `extractReactSourceTransitions(...)` using all discovered vars/channels/templates/plugins/router. This is currently what lets Jotai, SWR, and router participate in end-to-end CLI extraction.
- `src/extract/sources/use-state/transitions.ts` directly wraps `extractReactSourceTransitions(...)` for legacy/direct use-state extraction APIs.
- `src/extract/sources/jotai/index.ts` currently exposes `discover`, `writeChannels`, `safetyWarnings`, and `harness`, but no provider-level transition extraction helper.
- `src/extract/sources/swr/index.ts` currently exposes `discover`, `writeChannels`, `template`, and `harness`, but no provider-level transition extraction helper.
- `src/extract/sources/router/index.ts` is a `RouterPlugin`, not a `StateSourcePlugin`; its transition participation is via `navigationCall`, consumed by `src/extract/engine/ts/transition/navigation.ts`.
- Existing CLI tests already assert the desired end-to-end behavior for staged/provider syntax:
  - `src/cli/features/extract/command.test.ts` around the test `"extracts Jotai writes inside async and loop handlers"`
  - `src/cli/features/extract/command.test.ts` around the test `"extracts SWR mutate writes inside simple, async, and loop handlers"`
  - `src/cli/features/extract/command.test.ts` around the test `"extracts router navigation inside async continuations through the shared transition extractor"`
  - `src/cli/features/extract/command.test.ts` around the test `"does not duplicate shared handler transitions when useState, Jotai, and SWR are enabled together"`

## Exact File Paths and Relevant Symbols

- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `ReactSourceTransitionOptions`
  - `ReactSourceTransitionResult`
- `src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromResolvedHandler`
  - `sequentialTransitionFromHandler`
  - `loopWriteTransitions`
  - `conditionalTransitionFromHandler`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `summarizeHandlerStatements`
  - `summarizeStatements`
  - `effectFromSummaries`
  - `setterCallFrom`
  - `settersWrittenIn`
- `src/extract/engine/ts/transition/plugin-calls.ts`
  - `pluginWriteTransition`
  - `swrMutateTransition`
  - `callArgumentValue`
- `src/extract/engine/ts/transition/navigation.ts`
  - `navigationTransition`
  - `navigationCall`
  - `navigationEffect`
  - `appendEffect`
- `src/extract/engine/pipeline/index.ts`
  - `runExtractionPipeline`
  - `HandlerExtractorOptions`
  - `ExtractionPipelineOptions`
- `src/extract/engine/spi/index.ts`
  - `StateSourcePlugin`
  - `RouterPlugin`
  - `ExtractCtx`
  - `SourceExtractionResult`
  - `WriteChannel`
- `src/extract/sources/use-state/transitions.ts`
  - `extractUseStateVars`
  - `extractUseStateSkeleton`
- `src/extract/sources/use-state/index.ts`
  - `useStateSource`
  - `discoverUseState`
  - `discoverUseStateWriteChannels`
- `src/extract/sources/jotai/index.ts`
  - `jotaiSource`
- `src/extract/sources/jotai/writes.ts`
  - `discoverJotaiWriteChannels`
  - `discoverJotaiSafetyWarnings`
- `src/extract/sources/swr/index.ts`
  - `swrSource`
- `src/extract/sources/swr/writes.ts`
  - `discoverSwrReadChannels`
- `src/extract/sources/router/index.ts`
  - `routerSource`
- `src/extract/sources/router/navigation.ts`
  - `navigationCall`

## Existing Patterns to Follow

- Follow `src/extract/sources/use-state/transitions.ts`: provider-facing transition helpers should delegate to `extractReactSourceTransitions(...)` instead of walking TypeScript syntax themselves.
- Follow `src/extract/engine/pipeline/index.ts`: collect all provider `discover(...)`, `writeChannels(...)`, templates, and router plugin data first, then run one shared React transition extraction pass over the combined context.
- Follow `src/extract/engine/ts/react-source-transitions.ts`: bind external write channels into `SetterBinding`s before JSX handler extraction.
- Follow `src/extract/engine/ts/transition/plugin-calls.ts`: keep provider-specific write summaries behind `StateSourcePlugin.summarizeWrite`, and use the engine for statement/handler structure.
- Follow `src/extract/engine/ts/transition/navigation.ts`: keep router-specific call shape recognition in `RouterPlugin.navigationCall`, and use the engine for where/when navigation calls occur.
- Follow `test/extraction/architecture.test.ts`: built-in source slices may import `../../engine/ts/...` and `../../engine/spi/...`, but should not import broad non-engine package surfaces.

## Atomic Implementation Steps

### 1. Add a shared provider extraction adapter

Create a small helper module, for example:

- `src/extract/sources/shared/react-transition-extract.ts`

Export one function:

- `extractSharedReactTransitions(ctx: ExtractCtx): SourceExtractionResult`

Implementation:

- Import `extractReactSourceTransitions` from `../../engine/ts/react-source-transitions.js`.
- Pass through `ctx.sourceText`, `ctx.fileName`, `ctx.route`, `ctx.effectApis`, `ctx.routePatterns`, `ctx.stateVars`, `ctx.writeChannels`, `ctx.sourcePlugins`, and `ctx.routerPlugin`.
- Return only `{ transitions, warnings }` from the engine result.

This module is the only source-provider helper that should call the transition engine.

Files to edit:

- `src/extract/sources/shared/react-transition-extract.ts` (new)

Stop and ask/report if:

- `src/extract/sources/shared/` already exists with a conflicting convention.
- Import rules reject `src/extract/sources/**` importing `../../engine/ts/...`.

### 2. Replace direct use-state transition wrapping with the shared adapter

Update `src/extract/sources/use-state/transitions.ts` so `extractUseStateSkeleton(...)` calls the new `extractSharedReactTransitions(...)` helper instead of importing `extractReactSourceTransitions(...)` directly.

Details:

- Preserve the existing `UseStateExtractionOptions` API.
- Build an `ExtractCtx`-compatible object from the existing options.
- Preserve current default `fileName = "App.tsx"` and `route = "/"`.
- Preserve conditional inclusion of `routerPlugin`.
- Preserve the return shape expected by `ExtractedModelSkeleton`.

Files to edit:

- `src/extract/sources/use-state/transitions.ts`
- `src/extract/sources/use-state/types.ts` only if type imports must be tightened

Stop and ask/report if:

- The adapter creates circular imports between `sources/use-state` and `engine`.

### 3. Expose direct transition helpers for Jotai without duplicating pipeline extraction

Add a Jotai-facing direct helper, not a `StateSourcePlugin.extract` hook unless the pipeline is also changed to avoid duplicate extraction.

Recommended file:

- `src/extract/sources/jotai/transitions.ts`

Export:

- `extractJotaiSkeleton(sourceText: string, options?: JotaiExtractionOptions): ExtractedModelSkeleton`

Implementation:

- Discover Jotai vars with `discoverJotaiAtoms(...)`.
- Discover Jotai write/read channels with `discoverJotaiWriteChannels(...)`.
- Include `discoverJotaiSafetyWarnings(...)` in returned warnings, merged with shared engine warnings.
- Call `extractSharedReactTransitions(...)` with:
  - `stateVars`: discovered Jotai vars plus `options.stateVars ?? []` if the API supports external vars
  - `writeChannels`: discovered Jotai channels plus `options.writeChannels ?? []`
  - `sourcePlugins`: include `jotaiSource()` plus any `options.sourcePlugins` needed for `summarizeWrite`
  - `routerPlugin`: pass through
- Reuse the `ExtractedModelSkeleton` shape from `use-state/types.ts` or introduce a provider-neutral type if preferred.

Do not add `extract: extractSharedReactTransitions` directly to `jotaiSource()` unless `runExtractionPipeline(...)` is changed to ensure only one shared extraction pass runs. The existing pipeline already performs the shared extraction generically.

Files to edit:

- `src/extract/sources/jotai/transitions.ts` (new)
- `src/extract/sources/jotai/index.ts` to export the new helper
- Optionally `src/extract/sources/jotai/types.ts` if provider-specific options are clearer than importing use-state types

Stop and ask/report if:

- Public API policy says no new provider-specific `extract*Skeleton` exports.
- Adding a helper would require package export changes outside `src/`.

### 4. Expose direct transition helpers for SWR without duplicating pipeline extraction

Add an SWR-facing direct helper, not a `StateSourcePlugin.extract` hook unless the pipeline is also changed to avoid duplicate extraction.

Recommended file:

- `src/extract/sources/swr/transitions.ts`

Export:

- `extractSwrSkeleton(sourceText: string, options?: SwrExtractionOptions): ExtractedModelSkeleton`

Implementation:

- Discover SWR declarations with `discoverSwrHooks(...)`.
- Convert SWR declarations through `templateForSwrDecl(...)` and include template vars in `stateVars`.
- Discover SWR channels with `discoverSwrReadChannels(...)`; these include `mutate` write channels.
- Include template transitions in the final returned `transitions`, matching pipeline behavior for provider templates.
- Call `extractSharedReactTransitions(...)` with discovered/template vars and SWR write channels.
- Ensure `mutate(...)` inside simple, async, loop, and conditional handlers is summarized by the shared engine through `setterCallFrom(...)` and write-channel binding, not through a new SWR statement walker.

Files to edit:

- `src/extract/sources/swr/transitions.ts` (new)
- `src/extract/sources/swr/index.ts` to export the new helper
- Optionally `src/extract/sources/swr/types.ts`

Stop and ask/report if:

- Direct SWR helper semantics should exclude template transitions. The pipeline includes template transitions, so excluding them would create inconsistent direct vs pipeline behavior.

### 5. Keep router provider thin and document its transition integration point

Do not add a router statement extractor. Router is a `RouterPlugin`, and transition extraction should continue to happen through:

- `src/extract/engine/ts/transition/navigation.ts`
- `RouterPlugin.navigationCall(...)`
- `extractSharedReactTransitions(...)` / `extractReactSourceTransitions(...)`

If a direct router helper is desired, add a thin helper such as:

- `src/extract/sources/router/transitions.ts`
- `extractRouterTransitions(sourceText, options)` that passes `routerPlugin: routerSource(options)` into `extractSharedReactTransitions(...)`

Only do this if the public API needs direct router extraction outside the pipeline. Otherwise, update tests/docs to show that `routerSource()` is consumed by the shared engine via `routerPlugin`.

Files to edit if adding helper:

- `src/extract/sources/router/transitions.ts` (new)
- `src/extract/sources/router/index.ts`

Files to edit if not adding helper:

- Tests only, to assert router transition support through pipeline/shared engine.

Stop and ask/report if:

- The task owner expects `RouterPlugin` itself to gain an `extract` method; that would be a public SPI change and should not be done casually.

### 6. Prevent duplicate extraction in the pipeline

Before adding any `StateSourcePlugin.extract` implementation to built-in providers, decide one of these two paths:

Preferred path:

- Keep `runExtractionPipeline(...)` as the owner of the single shared extraction pass.
- Do not add `extract` hooks to `useStateSource()`, `jotaiSource()`, or `swrSource()`.
- Add provider direct helpers for convenience only.

Alternative path:

- Move the generic extraction pass out of `runExtractionPipeline(...)`.
- Add exactly one internal/shared provider extraction hook, not one per provider, so multiple enabled providers do not duplicate transitions.

Given existing tests and architecture, use the preferred path.

Files to edit:

- `src/extract/engine/pipeline/index.ts` only if Composer finds that direct provider `extract` hooks are required.

Stop and ask/report if:

- Any implementation step would produce multiple identical user transitions when `use-state`, `jotai`, and `swr` are enabled together.

### 7. Add focused provider regression tests

Add direct-provider tests for Jotai and SWR if new direct helper exports are added.

Recommended additions:

- `test/sources/jotai/jotai-source.test.ts`
  - Import `extractJotaiSkeleton`.
  - Assert an async Jotai handler produces `App.onClick.api.login.success` with an `assign` to `atom:authAtom`.
  - Assert a loop Jotai handler produces a single over-approx `havoc` transition for `atom:authAtom`.
  - Assert an `if`/guard-return Jotai handler produces an `if` effect or guarded sequence using the shared statement summarizer.
- `test/sources/swr/swr-template.test.ts`
  - Import `extractSwrSkeleton`.
  - Assert simple `mutate("full")` assigns `swr:api_todos:data`.
  - Assert async `await api.refresh(); mutate("empty")` places the SWR assignment in the async success continuation.
  - Assert loop `mutate(...)` havocs `swr:api_todos:data`.
- `test/sources/router/router-source.test.ts`
  - If a direct router helper is added, assert async navigation after `await api.save()` is extracted through the shared engine.
  - If no direct helper is added, keep this covered in CLI/pipeline tests and do not force a router API expansion.

Also keep or update the existing end-to-end CLI tests:

- `src/cli/features/extract/command.test.ts`
  - `"extracts Jotai writes inside async and loop handlers"`
  - `"extracts SWR mutate writes inside simple, async, and loop handlers"`
  - `"extracts router navigation inside async continuations through the shared transition extractor"`
  - `"does not duplicate shared handler transitions when useState, Jotai, and SWR are enabled together"`

### 8. Update architecture tests if new helper files are added

Confirm `test/extraction/architecture.test.ts` still passes:

- The test currently permits source files importing `../../engine/ts/...` and `../../engine/spi/...`.
- If `src/extract/sources/shared/react-transition-extract.ts` imports only those surfaces, no architecture test change should be needed.
- If package exports must expose new direct helpers from provider indexes, update package export tests only if a new subpath is added.

Files to edit:

- `test/extraction/architecture.test.ts` only if a deliberate architecture boundary changes.
- `package.json` only if adding new public subpath exports, not for index-level re-exports.

## Acceptance Criteria

- Jotai handlers using `useAtom`, `useSetAtom`, and store-style `store.set(atom, value)` support the same handler syntax as use-state:
  - simple calls
  - async continuations after awaited modeled effects
  - loops as over-approximate havoc
  - `if`/`switch`/`try` where supported by `statement-summary.ts`
  - TypeScript wrappers such as `as`, `satisfies`, non-null, and parentheses
- SWR `mutate(...)` write channels support the same handler syntax as use-state.
- Router navigation calls recognized by `RouterPlugin.navigationCall(...)` are extracted when they appear in supported handler syntax, including async continuations.
- Multiple enabled providers do not duplicate shared handler transitions.
- Provider code remains thin: no new AST statement walkers for async/loop/if are introduced under `src/extract/sources/jotai`, `src/extract/sources/swr`, or `src/extract/sources/router`.
- Existing `extractUseStateSkeleton(...)` behavior and tests continue to pass.
- Pipeline behavior remains consistent with direct helper behavior where helpers are added.

## Tests to Add or Update

- Add direct Jotai transition tests in `test/sources/jotai/jotai-source.test.ts` if `extractJotaiSkeleton(...)` is added.
- Add direct SWR transition tests in `test/sources/swr/swr-template.test.ts` if `extractSwrSkeleton(...)` is added.
- Add or retain end-to-end CLI tests in `src/cli/features/extract/command.test.ts` for:
  - Jotai async + loop writes
  - SWR simple + async + loop `mutate`
  - router async navigation
  - no duplicate transitions with use-state + Jotai + SWR
- Add a focused regression for `if`/guard-return syntax using an external provider write channel, either in `test/extraction/extraction.test.ts` or provider-specific tests.
- Add a focused regression for TypeScript expression wrappers on Jotai/SWR setter arguments.

## Verification Commands

Run commands with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/sources/jotai/jotai-source.test.ts test/sources/swr/swr-template.test.ts test/sources/router/router-source.test.ts
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm architecture
```

If transition semantics change beyond provider wiring, also run:

```bash
rtk pnpm phase7
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Adding `extract` directly to every built-in `StateSourcePlugin` will duplicate transitions because `runExtractionPipeline(...)` already runs `extractReactSourceTransitions(...)` once generically. Use direct helper exports or change the pipeline first.
- Risk: SWR direct extraction must merge template vars before handler extraction; otherwise `mutate` channels can bind to vars that are missing from the result.
- Risk: Jotai read channels from `useAtom` are represented as `WriteChannel`s today so reads can resolve through `stateVarForName(...)`; do not rename that mechanism without a larger SPI change.
- Risk: Router is not a state source plugin. Treating it as one would require an SPI change and could blur route var ownership.
- Ambiguity: The user said “changes ... in staging,” but inspection found no cached diff. Treat the current working-tree transition changes as the intended staged context unless the Git index changes.
- Stop and report if any architecture test forbids the new shared helper import path.
- Stop and report if provider direct helpers require package export changes that are outside the desired public API surface.
- Stop and report if an implementation creates duplicate user transitions when `use-state`, `jotai`, and `swr` are all enabled.
