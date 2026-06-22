# Plugin Layering Remediation — Part 1: Delete Legacy AST Driver

## Goal

Make the L1 Surface IR plus L2 compiler the only extraction path for statement/control-flow semantics, consolidate language-agnostic formalization outside `engine/ts`, then delete the legacy AST summarizer and reduce the remaining React transition walker into a thin driver. This is the capstone remediation for `docs/_specs/plugin-layering`: no compatibility flag, no legacy fallback, no React in core engine modules, and no 1k-line layered-plugin monoliths.

This plan intentionally does not preserve backward compatibility. Remove the legacy AST summarizer entirely.

## Execution order correction (read first)

**Despite the "Part 3" numbering, this plan runs FIRST of the three remediation parts.** Parts 1 and 2 (`260623-05`, `260623-06`) depend on the legacy AST driver already being gone:

- Part 1 (contract hardening) cannot remove `SurfaceCall = ts.CallExpression` from the SPI while the legacy driver here still passes raw `ts` nodes into the same plugin hooks. De-`typescript`-ing the SPI is only a clean, bridge-free type change *after* this part makes Surface IR the sole plugin input.
- Part 2 (relocation + vocabulary + spec update) is cosmetic/structural and belongs last.

So: run this plan → then `260623-05` → then `260623-06`.

## Additional required step — make the pipeline orchestrator framework-agnostic

The current-state findings below omit a core-engine coupling that directly blocks "remove React from `src/extract/engine/` completely":

- `src/extract/engine/pipeline/index.ts:23-24,277` imports `extractReactSourceTransitions` and the `ReactExtractionProjectSummary` type, then calls the React driver as `genericExtraction`. The pipeline — a core engine orchestrator, not a TS/React module — is hardwired to React.

This part must additionally:
- Remove the direct `extractReactSourceTransitions` / `ReactExtractionProjectSummary` imports from `engine/pipeline/index.ts`.
- Have the pipeline select an L1 language frontend (`src/extract/lang/ts`) and a registered `FrameworkPlugin` generically, then drive L2, rather than naming the React driver.
- Replace the React-specific `ReactExtractionProjectSummary` typing with a language/framework-neutral extraction-summary type.
- Add an architecture test: `src/extract/engine/pipeline/**` must not import `engine/ts/react-source-transitions` or any `*react*` module, and must contain no React/TSX recognition string.

Until `engine/pipeline/index.ts` is framework-agnostic, the no-React-core acceptance criterion below is not met even if `engine/ts` is emptied.

## Non-goals

- Do not keep `useSurfaceCompiler` or any compatibility switch.
- Do not keep legacy summarizer exports for external callers.
- Do not add new IR node kinds.
- Do not preserve transition ordering if the new thin driver has a better deterministic order; update snapshots deliberately.
- Do not reintroduce library-specific leaf recognition into L2 to compensate for plugin gaps.
- Do not leave language-agnostic extraction utilities under `src/extract/engine/ts`.

## Current-state findings

- `src/extract/engine/ts/transition/statement-summary.ts` is 1062 lines and still defaults to legacy AST summarization unless `useSurfaceCompiler === true`.
- `src/extract/engine/ts/react-source-transitions.ts` is 1406 lines.
- `src/extract/engine/ts/transition/handlers.ts` is 1391 lines.
- `src/extract/compile/compile-stmt.ts` exists but is incomplete compared with legacy behavior: assignment statements, unknown-call taint, helper calls, async segments, callback bodies, local dataflow, loop over-approximation, and effect-model scheduling must be made production-complete before deleting fallback code.
- `src/extract/engine/ts/transition/dispatch-node.ts` is currently a bridge around `compileStatements`, not the sole driver.
- `src/extract/engine/ts/surface-bridge-slot.ts` and `src/extract/wiring/install.ts` are interim installation shims.
- Language-agnostic logic remains under `src/extract/engine/ts`, including numeric abstraction (`numeric/abstraction.ts`), native numeric alias policy (`numeric/native-aliases.ts`), domain inference/lowering helpers (`domains.ts`, `type-domains.ts`, `domain-refinements.ts`), caveat formatting, id stabilization/safe-id helpers, and input-domain value enumeration.
- TSX/React feature logic remains spread across `src/extract/engine/ts/transition/suspense.ts`, `components.ts`, `input-transitions.ts`, `transition/component-props.ts`, `transition/ui.ts`, `static-navigation.ts`, `routes.ts`, `transition/navigation.ts`, `transition/async.ts`, `transition/concurrent.ts`, `transition/effects.ts`, and `react-source-transitions.ts`.
- `transition/suspense.ts` already delegates boundary recognition to `FrameworkPlugin`, but it still directly walks raw TS AST/JSX, creates React Suspense-specific state vars, and emits suspend/resolve transitions from an engine/ts module.
- `transition/ui.ts` and `input-transitions.ts` encode DOM/React event names (`onClick`, `onSubmit`, `onChange`, etc.), DOM form controls (`select`, `option`, radio `input`), event target paths, labels, and locators under `engine/ts`.
- `components.ts` and `transition/component-props.ts` encode React/TSX component shape, custom-hook naming, prop forwarding, host interactive tags, and JSX attribute semantics under `engine/ts`.
- `static-navigation.ts`, `routes.ts`, and `transition/navigation.ts` mix generic location lowering with TSX route-target parsing and route plugin dispatch.
- `transition/async.ts` mixes generic CPS/pending-queue lowering with TS AST recognition of `await`, `Promise.all`, `fetch`, and browser `confirm`.
- `src/extract/engine/navigation-adapter-fit.test.ts`, `react-source-navigation.test.ts`, and driver-facing tests still import React extraction internals from `engine/ts` and use old route adapter naming.
- Language-agnostic formalization is split awkwardly today. Numeric/domain/formula/id/caveat/source-anchor rules live in `engine/ts`, while partial control-flow lowering lives in `src/extract/compile`. The finished architecture needs one consolidated L2/formalization home with TypeScript-only readers isolated under `src/extract/lang/ts`.

## Atomic implementation steps

1. **Promote L2 compiler to production parity.**
   - Extend `src/extract/compile` to cover all statement and expression shapes currently handled by `statement-summary.ts`: assignments, setter calls, helper calls, returns, guarded rest, locals, snapshots, async segments, loops, and unknown-call taint.
   - Keep all control flow and dataflow in L2.
   - Route every library/environment leaf through `LeafDispatch`.

2. **Consolidate language-agnostic formalization outside `engine/ts`.**
   - Create one L2/formalization home: **`src/extract/compile/`** (decided — not `src/extract/formalize/*`; the spec already names L2 `extract/compile`, so reuse it and keep one name). Use focused submodules such as `expr`, `stmt`, `guards`, `effects`, `domains`, `numeric`, `location`, `render-boundary`, `events`, `ids`, `caveats`, and `source-anchors`. Do not scatter these helpers across engine, plugins, and language front ends.
   - Move numeric abstract-domain operations, widening thresholds, arithmetic/category formatting, number-literal formatting, and numeric reduction helpers into `src/extract/compile/numeric`.
   - Move generic domain construction, finite-domain value enumeration, and language-independent native domain policy into `src/extract/compile/domains`.
   - Move generic guard constructors/parsers, source-anchor formatting, caveat formatting, safe-id helpers, and transition id stabilization into `src/extract/compile/{guards,source-anchors,caveats,ids}`.
   - Move generic location/history formalization into `src/extract/compile/location`; route plugins may recognize route targets, but L2 owns the `locationEffect`/history IR pattern.
   - Move generic render-boundary gating and pending enqueue/dequeue composition into `src/extract/compile/render-boundary`; framework plugins recognize Suspense/lazy/use-like boundaries and provide defaults/domains.
   - Move generic event/input transition assembly into `src/extract/compile/events`; UI/platform plugins own event names, control kinds, labels, locators, and `event.target.*` conventions.
   - Move generic CPS, pending queue, async callback lowering, effect-phase composition, and scheduling shape into `src/extract/compile/effects`; effect/framework plugins own browser/library/API names.
   - Move TypeScript-specific type-node reading into `src/extract/lang/ts` and type plugins; L2 should consume `TypeView`/Surface IR, not `ts.TypeNode`.
   - Leave only TypeScript AST parsing/lowering and TS-only origin readers under `src/extract/lang/ts`.

3. **Make `LeafDispatch` the only leaf path.**
   - Ensure the dispatch adapter fans out in the spec order: framework hook, state write, navigation, effect model, default unknown-call rule.
   - Make duplicate/conflicting claims deterministic and loudly caveated or hard-failed as specified.
   - Remove direct calls from compiler/driver code to plugin-specific recognizers except through `LeafDispatch`.

4. **Replace call sites of legacy statement summarization.**
   - Update all production callers to use the L1 lowerer plus L2 compiler directly.
   - Remove `useSurfaceCompiler` from all option types and state objects.
   - Remove `summarizeStatements`, `summarizeHandlerStatements`, and other legacy entry points once call sites are migrated.

5. **Delete `statement-summary.ts` and split any reusable generic pieces.**
   - Move genuinely generic helpers into `src/extract/compile` or small engine driver utilities.
   - Move plugin-owned helpers into L4 plugin directories.
   - Delete `src/extract/engine/ts/transition/statement-summary.ts` instead of leaving it as a wrapper.

6. **Drain TSX/React feature modules out of `engine/ts`.**
   - Refactor `transition/suspense.ts` into two parts:
     - a language-neutral render-boundary compiler module that owns boundary vars, gating, pending enqueue/dequeue, and transition composition without importing `typescript`;
     - React-specific boundary recognition/domain/default-state logic in `src/extract/plugins/framework/react`.
   - Refactor `components.ts` into:
     - `src/extract/lang/ts` lowering/symbol extraction for component declarations, JSX nodes, custom-hook declarations, and source anchors;
     - framework-plugin methods for component classification, custom-hook naming, provider/context shape, and prop-forwarding semantics.
   - Refactor `input-transitions.ts` and `transition/ui.ts` into:
     - a language-neutral event/input transition builder that consumes Surface IR event descriptors and finite domains;
     - a UI/platform plugin, such as `src/extract/plugins/framework/react-dom` or `src/extract/plugins/ui/dom`, that owns DOM event names, labels, locators, `event.target.value`, `select`/`option`, radio inputs, and text extraction.
   - Refactor `transition/component-props.ts` into framework-owned prop semantics. The engine may ask a framework plugin for forwarded handler triggers, but it must not know host interactive tags or React prop naming conventions.
   - Refactor `static-navigation.ts`, `routes.ts`, and `transition/navigation.ts` so generic `locationEffect`/history lowering lives in L2 or a language-neutral route compiler, while TSX route-target extraction and JSX navigation classification live in route plugins under `src/extract/plugins/route/*`.
   - Refactor `transition/async.ts` so generic CPS/pending-queue lowering moves to `src/extract/compile/effects` and browser/library leaves (`fetch`, `Promise.all`, `confirm`) are recognized by effect plugins. L2 may understand `await` shape from Surface IR; it must not match browser API names.
   - Refactor `transition/concurrent.ts` and `transition/effects.ts` so generic scheduling/effect-phase composition stays in L2, while React hook kinds and phase ordinals stay in the React framework plugin.
   - Split remaining responsibilities in `react-source-transitions.ts` into focused modules: source setup, component discovery, handler discovery, transition assembly, render-boundary orchestration, plugin dispatch, and metadata/provenance stitching.
   - Move the driver out of `src/extract/engine/ts` if it remains React/TSX-specific. A generic engine driver may live under `src/extract/engine`, a TypeScript front-end driver may live under `src/extract/lang/ts`, and React-specific orchestration must be plugin-owned or plugin-driven.
   - The driver should orchestrate L1/L2/L3/L4, not compile statement, JSX, event, Suspense, route, or async semantics itself.
   - Target every file touched by layered-plugin transition logic to stay below 1000 lines.

7. **Reduce `transition/handlers.ts` below the red-flag threshold and remove bridge shims.**
   - Split generic handler extraction, JSX event handler collection, render-boundary gating, component-prop triggers, input/value transitions, and navigation handler assembly into separate modules with explicit ownership.
   - Keep plugin-specific handler wrappers, DOM event semantics, and framework prop semantics in plugin directories.
   - Ensure no new module becomes another broad catch-all.
   - Delete `src/extract/engine/ts/surface-bridge-slot.ts` and `src/extract/wiring/install.ts` if direct imports can replace runtime installation.
   - Update `package.json` exports.
   - Delete tests that only prove the old bridge/fallback behavior.

## Tests to add or update

- Add L2 parity tests for all control-flow cases previously covered by `statement-summary.ts`: `if`, guarded rest, switch, loops, returns, assignments, local const substitution, async callbacks, helper calls, unknown-call taint, and setter writes.
- Add language-boundary tests proving numeric abstraction, finite-domain value enumeration, source/caveat formatting, safe-id, and id stabilization do not import from `engine/ts`.
- Add formalization-location tests proving language-agnostic rules live under `src/extract/compile/**` (or one explicitly chosen `src/extract/formalize/**` tree) rather than being split between `engine/ts`, plugins, and language front ends.
- Add TypeScript boundary tests proving `src/extract/lang/ts` owns `ts.TypeNode` interpretation and L2 consumes only Surface IR / `TypeView`.
- Add render-boundary tests proving Suspense/lazy/use recognition is plugin-owned while boundary gating and pending transitions are language-neutral.
- Add UI/platform plugin tests for DOM event names, labels, locators, event target value, select/option, radio input, and text extraction.
- Add framework prop-forwarding tests proving host interactive tags and `onX` prop conventions do not live in `engine/ts`.
- Add route compiler/plugin tests proving static JSX route target extraction is route-plugin-owned and generic history/location lowering is language-neutral.
- Add effect plugin tests proving `fetch`, `Promise.all`, and `confirm` are not recognized in `engine/ts` or L2 product code.
- Add extraction snapshot tests proving representative React, router, timer, WebSocket, context, and state-source models still extract correctly through the new driver.
- Update tests that import legacy summarizer entry points to target `src/extract/compile` or the new thin driver.
- Add a file-size guard test for layered-plugin feature files: no product file in `src/extract/engine`, `src/extract/compile`, `src/extract/lang`, or `src/extract/plugins` may exceed 1000 lines without an explicit allowlist. Do not allowlist the current red-flag files or recreated equivalents.
- Add architecture tests proving `statement-summary.ts`, `surface-bridge-slot.ts`, and wiring install exports no longer exist.
- Add no-React-core tests proving `src/extract/engine/**` and `src/extract/compile/**` do not contain React, JSX/TSX, DOM, browser API, router, state-library, or type-library recognition strings in product code.
- Add no-TypeScript-core tests proving `src/extract/engine/**` and generic SPI/compile modules do not import `typescript`; TypeScript imports are allowed only in `src/extract/lang/ts/**`, TypeScript-specific plugin origin helpers, and tests.

## Verification

- `rtk pnpm typecheck`
- `rtk pnpm vitest run test/compile test/extraction test/frameworks/react test/effect-models test/sources/router`
- `rtk pnpm architecture`
- `rtk pnpm phase7`
- `rtk pnpm ci:examples`
- `rtk pnpm test`
- `rtk pnpm fix`
- Run a line-count check such as `rtk wc -l src/extract/engine/ts/react-source-transitions.ts src/extract/engine/ts/transition/handlers.ts` and confirm both are below 1000 lines or deleted/split.
- `rtk rg -n "React|react|JSX|jsx|TSX|Suspense|lazy|useState|useEffect|useRef|useTransition|useDeferredValue|useContext|useCallback|useMemo|startTransition|flushSync|Form|useSubmit|useActionData|setTimeout|setInterval|WebSocket|Promise\\.all|fetch|confirm|onClick|onSubmit|onChange|event\\.target|select|option|radio|Jotai|jotai|SWR|swr|zustand|TanStack|redux" src/extract/engine src/extract/compile` returns no product-code matches.
- `rtk rg -n "typescript|ts\\.|SourceFile|TypeNode|CallExpression|Jsx|SemanticTypeContext" src/extract/engine src/extract/compile src/extract/engine/spi` returns no product-code matches.
- `rtk rg -n "extract/(sources|frameworks|effect-models|type-libraries)|NavigationAdapter|DomainRefinementProvider|EffectModelProvider|sourcePlugins|routerPlugin|effectModelProviders" src docs test package.json` returns no public-code, public-doc, or export-map matches.

## Acceptance criteria

- `useSurfaceCompiler` no longer exists.
- `src/extract/engine/ts/transition/statement-summary.ts` no longer exists.
- No production extraction path uses the legacy AST summarizer.
- `src/extract/engine/ts/transition/suspense.ts` no longer exists as a TS/React feature module; its generic boundary compiler pieces live outside `engine/ts`, and React-specific pieces live under `plugins/framework/react`.
- DOM/React event names, input-control semantics, component prop forwarding, host interactive tags, Suspense/lazy/use recognition, browser async APIs, and TSX static navigation extraction no longer live in `src/extract/engine/ts/**` or `src/extract/compile/**`.
- No React/TSX/JSX/browser/router/state-library/type-library recognition strings live anywhere under `src/extract/engine/**`; core engine modules are framework-agnostic orchestration only.
- `react-source-transitions.ts` and `transition/handlers.ts` are each below 1000 lines or split/deleted.
- L2 owns all universal control flow and dataflow.
- Language-agnostic numeric, domain, formatting, id, guard, event, location, render-boundary, source-anchor, caveat, CPS, and scheduling formalization lives in one consolidated L2 tree, not under `src/extract/engine/ts` and not inside L4 plugins.
- `src/extract/engine/ts` is deleted or reduced to a temporary compatibility-free shell with no React/TSX semantics; preferred final ownership is `src/extract/lang/ts` for TypeScript front-end code plus framework/effect/route/state/type plugins for library semantics.
- L4 plugins own all library/environment leaf semantics.
- All tests, architecture checks, examples, and phase7 checks pass.

## Risks, ambiguities, and stop conditions

- Stop if deleting the legacy summarizer reveals an unmodeled statement shape that would silently drop writes. Add an L2 over-approximation with caveats before continuing.
- Stop if a plugin starts compiling `if`, loops, or sequencing. Move that logic back into L2.
- Stop if a supposedly generic helper still requires `ts.Node`/`ts.TypeNode`; split it into a TS reader in `lang/ts` plus a language-neutral operation in compile/domain code.
- Expect snapshot order changes. Review them deliberately and update snapshots only when the semantic model is equivalent or more conservative.
- Watch for temporary wrappers becoming permanent. This part should delete, not deprecate.
