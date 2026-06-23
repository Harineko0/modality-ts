# Layered Plugins — Phase 1: `FrameworkPlugin` SPI + `frameworks/react`

> Part 2 of 6. Specs: `docs/_specs/plugin-layering/03-use-case-spis.md §2`,
> `06-migration-roadmap.md` (Phase 1). Depends on Part 1 (config reception) for the
> `framework` config field plumbing. **Identity-preserving: zero golden-snapshot diffs.**
> This is "the proof" that React can become an ordinary L4 plugin.

## 1. Goal

Introduce a `FrameworkPlugin` L3 SPI and a `frameworks/react` L4 plugin that **owns React's leaf
semantics** — the hook-name tables, effect-phase ordinals, and render-boundary recognition that are
currently hardcoded in the extraction engine. The engine consults an **injected** framework plugin
instead of matching string literals inline. Output is held identity-stable: the react plugin returns
the exact same names, phases, and domains the engine produced before, so no snapshot changes.

## 2. Non-goals

- Do not yet move useState **binding** consolidation (Part 3), render-boundary **ownership** of
  gating (Part 4), router forms (Part 5), or effect models (Part 5). This part introduces the SPI
  and the recognition tables; later parts migrate each consumer.
- Do not change the IR, the checker, or transition ordering.
- Do not make the react plugin a state source — `useState` semantics stay in
  `sources/use-state`; the framework plugin only *classifies* a hook call and hands state hooks off.
- Do not add a second framework implementation; design the SPI to allow one, ship only React.
- Do not introduce import-alias support as a behavior change that alters snapshots; alias-awareness
  is available but the identity gate means existing fixtures (bare identifiers) must still match.

## 3. Current-state findings

- React hook recognition is hardcoded in `src/extract/engine/ts/ast.ts:13-157`:
  `isUseStateCall` (13), `isUseReducerCall` (21), `isUseRefCall` (31),
  `reactEffectHookName`/`isUseEffectCall` (39-61, returns `useEffect|useLayoutEffect|useInsertionEffect`),
  `isUseTransitionCall` (63), `isUseDeferredValueCall` (73), `isStartTransitionCall` (83),
  `isFlushSyncCall` (93), `isSuspenseElement` (101-112), `isReactLazyCall` (114-124),
  `isUseCall` (126-132), and the `useCallback` unwrap in `extractableHandlerInitializer` (144-157).
  All match `node.expression.text === "<name>"` verbatim — **not** import-alias-aware.
- Effect-phase ordinals: `reactEffectPhase` in
  `src/extract/engine/ts/transition/effects.ts:313` (`useEffect → 1`, else `0`).
- The Suspense gating domain is constructed inline in
  `src/extract/engine/ts/react-source-transitions.ts` (1353 lines); there is **no** `suspense.ts`
  module and **no** `SUSPENSE_DOMAIN` constant — grep confirms `Suspense` appears only in `ast.ts`
  and `react-source-transitions.ts`.
- `react-source-transitions.ts` is the main walker; it imports the `ast.ts` predicates directly and
  is invoked from `src/extract/engine/ts/pipeline/` orchestration.
- The SPI directory is `src/extract/engine/spi/` with a single `index.ts`. It already defines
  `ModalityAdapterBase` (`id`, `version?`, `packageNames`) and re-exports adapter contracts.
- `PluginProvenance.kind` (`src/core/ir/types.ts:144-157`) is a closed union of eight kinds; it does
  **not** include `"framework"`.
- The registry (`src/cli/registry/index.ts`) validates each adapter category with a `validate*`
  function and stamps provenance in `createModalityRegistry` (`registry/index.ts:318-374`).
- depcruise (`tools/depcruise.config.cjs`) forbids the engine from importing `check`/`cli`/`sources`
  (`:16-20`) and constrains `extract/sources/*` (`:43-65`). There is no `extract/frameworks` rule.
- L1 `SymbolPort.importBinding` (Part 6 spec) does not exist yet; until Part 6, the react plugin
  resolves hooks via the existing `SemanticTypeContext` (`spi/index.ts`) and the bare-identifier
  match, keeping identity. Alias-awareness is wired through a thin `resolveImportedName` helper that
  currently falls back to the bare name.

## 4. Atomic implementation steps

1. **Define the SPI.** Add `src/extract/engine/spi/framework.ts` exporting `FrameworkPlugin`
   (extends `ModalityAdapterBase`), `HookCall`, `RenderBoundary`, `FrameworkCtx`, `ComponentRole`
   per `03-use-case-spis.md §2`. Re-export from `spi/index.ts`. Methods:
   `recognizeHook(call, ctx): HookCall | undefined`,
   `recognizeRenderBoundary(node, ctx): RenderBoundary | undefined`,
   `classifyComponent?(decl, ctx): ComponentRole | undefined`.

2. **Create the react plugin package.** Add `src/extract/frameworks/react/`:
   - `hooks.ts` — the name tables seeded verbatim from `ast.ts:13-157` and the phase map from
     `effects.ts:313`; an `import-alias-aware` resolver `resolveImportedName(node, ctx)` that
     currently returns the bare identifier text (identity), with a TODO to consume L1
     `importBinding` in Part 6.
   - `render-boundaries.ts` — `Suspense` / `React.lazy` / `use()` recognition mirroring
     `ast.ts:101-132`, plus the Suspense gating-domain factory lifted from the inline construction in
     `react-source-transitions.ts` (return the identical `AbstractDomain`).
   - `index.ts` — `reactFramework(): FrameworkPlugin` with `id:"react"`, `version`,
     `packageNames:["react"]`, assembling `recognizeHook`/`recognizeRenderBoundary`/`classifyComponent`.
   - Add `package.json#exports` entry `./extract/frameworks/react`.

3. **Inject the framework into the engine.** Change the `ast.ts` predicates from module-level string
   matches to functions that consult an injected `FrameworkPlugin` (passed through an options object).
   Keep thin wrapper predicates for call sites that cannot yet take the framework, delegating to a
   default `reactFramework()` so behavior is unchanged. Thread a `framework: FrameworkPlugin` field
   through `react-source-transitions.ts` options and `pipeline/` so the engine never re-imports the
   tables.

4. **Wire config + registry.** Add `framework?: FrameworkPlugin` to `ModalityConfig`
   (`build-model.ts:68-81`, the placeholder from Part 1) and `BuildExtractionModelOptions`. In
   `createBuiltinModalityRegistry`, resolve the active framework: explicit `config.framework` wins;
   else default to `reactFramework()` when `react` is a dependency (matching today's implicit
   universality). Add `validateFrameworkPlugin` and a `framework` field to `RegistrySummary`; pass it
   into the pipeline via `runProjectExtractionPipeline` options (`build-model.ts:251-268`).

5. **Provenance + boundaries.** Add `"framework"` to `PluginProvenance.kind`
   (`core/ir/types.ts:147-155`); add a framework mapping block to the registry `plugins` assembly
   (`registry/index.ts:318-374`), sorted into the existing kind/id order. Add a
   `tools/depcruise.config.cjs` rule for `extract/frameworks/*` as a **sibling** of `sources/*`
   (may import `core`, `extract/engine/spi`, shared `extract/engine/ts`; may not import `check`,
   `cli/*` product slices, or `extract/sources/*` except `shared`). Extend the engine rule
   (`depcruise.config.cjs:16-20`) so the engine may not import `extract/frameworks`.

## 5. Tests to add or update

- Add `test/frameworks/react/react-framework.test.ts`:
  - Plugin shape (`id`, `packageNames`, `version`), `recognizeHook` returns the right `HookCall.kind`
    for each of useState/useReducer/useRef (→state), useEffect (phase 1),
    useLayoutEffect/useInsertionEffect (phase 0), useTransition, useDeferredValue, useCallback
    (callback unwrap target), useContext.
  - `recognizeRenderBoundary` classifies `<Suspense>`, `React.lazy(...)`, `use(...)`, and returns the
    identical gating domain the engine produced before.
  - Alias resolver currently returns bare identifier (identity); add an xfail/TODO test asserting the
    alias case is recognized once Part 6 lands.
- Update `src/cli/registry/index.test.ts`: framework is registered, validated, and stamped as
  `kind:"framework"`; explicit `config.framework` overrides the default; provenance ordering is
  stable.
- Add a depcruise focused test (or rely on `pnpm architecture`) asserting `extract/frameworks/react`
  importing `cli` fails.
- **Identity gate:** run the full extraction snapshot suite; assert **zero** diffs.

## 6. Verification

```bash
rtk pnpm vitest run test/frameworks/react/react-framework.test.ts src/cli/registry/index.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm test        # zero golden-snapshot diffs is the gate
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
```

## 7. Acceptance criteria

- `FrameworkPlugin` SPI exists in `src/extract/engine/spi/` and `reactFramework()` is exported from
  `modality-ts/extract/frameworks/react`.
- The engine recognizes React hooks / render boundaries **only** through the injected framework; no
  `ast.ts` predicate hardcodes a hook name anymore (or they delegate to the injected framework).
- `config.framework` overrides the default; absent config, React is auto-selected when `react` is a
  dependency.
- `PluginProvenance.kind` includes `"framework"` and the model metadata stamps the active framework.
- `pnpm architecture` passes with the new `extract/frameworks/*` boundary; the engine cannot import
  it.
- **Zero** golden-snapshot diffs across `pnpm test`, `pnpm phase7`, `pnpm ci:examples`.

## 8. Risks, ambiguities, and stop conditions

- **Snapshot drift** is the canary: any diff means a recognition table was transcribed imperfectly or
  the Suspense domain factory differs. Stop and reconcile against the original inline construction in
  `react-source-transitions.ts` before proceeding.
- **`use()` ambiguity:** the bare identifier `use` is a common variable name; preserve the exact
  current guard (call-expression on identifier `use`) — do not broaden it, or fixtures with a local
  `use` will change.
- **Default-framework universality:** today React hooks are recognized even when `react` is not in
  deps (predicates are unconditional). If a fixture has no `react` dep yet uses hooks, defaulting on
  `react` presence would change its output. Mirror today's universality: default to
  `reactFramework()` unless explicitly disabled, not gated solely on the dep. Stop and report if this
  conflicts with the Part 1 detection model.
- **`importBinding` not available** until Part 6: keep the alias resolver as a bare-name fallback;
  do not attempt real alias resolution here or you risk snapshot drift.
- If injecting the framework into `ast.ts` forces a large signature cascade through the pipeline,
  prefer a single `EngineFrameworkContext` carrier threaded once, rather than adding a parameter to
  every predicate.
