# Layered Plugins — Phases 3–4: Render-Boundary + Effect/Concurrency Ownership

> Part 4 of 6. Specs: `docs/_specs/plugin-layering/03-use-case-spis.md §2`,
> `06-migration-roadmap.md` (Phases 3–4). Depends on Part 2 (framework SPI). Two related,
> independently-shippable slices in one plan. **Identity-preserving: zero golden-snapshot diffs.**

## 1. Goal

Move the remaining React leaf semantics out of the engine and behind the `frameworks/react` plugin,
while the engine keeps the **generic** machinery:

- **Phase 3 (render boundaries):** `<Suspense>` / `React.lazy` / `use()` recognition moves into
  `frameworks/react.recognizeRenderBoundary`; the engine keeps a generic
  `gateTransitionForBoundary` that consumes a `RenderBoundary` without knowing it is React.
- **Phase 4 (effects/concurrency):** `useEffect` / `useLayoutEffect` / `useInsertionEffect` /
  `useTransition` / `useDeferredValue` / `flushSync` recognition and phase ordinals move into the
  react plugin; effect **summarization** (CPS lowering, phase scheduling) stays generic in the engine.

## 2. Non-goals

- Do not move timer/websocket effect models (those are Part 5 — they are environment effects, not
  React hooks).
- Do not move router forms (Part 5).
- Do not change CPS lowering, phase-scheduling math, or boundary-gating math — only relocate the
  *recognition* of which node is a boundary / effect hook.
- Do not change transition ordering or the IR.

## 3. Current-state findings

- Render-boundary recognition: `isSuspenseElement` (`ast.ts:101-112`), `isReactLazyCall`
  (`ast.ts:114-124`), `isUseCall` (`ast.ts:126-132`). The Suspense **gating domain** is built inline
  in `react-source-transitions.ts` and was lifted into `frameworks/react/render-boundaries.ts` in
  Part 2 (the factory exists; this part makes the engine *consume* it).
- Effect/concurrency recognition: `reactEffectHookName`/`isUseEffectCall` (`ast.ts:39-61`),
  `isUseTransitionCall` (`ast.ts:63-71`), `isUseDeferredValueCall` (`ast.ts:73-81`),
  `isStartTransitionCall` (`ast.ts:83-91`), `isFlushSyncCall` (`ast.ts:93-99`).
- Phase ordinals: `reactEffectPhase` (`transition/effects.ts:313`, `useEffect → 1`, else `0`),
  consumed by `useEffectWritesModeledState` and the surrounding summarization in
  `transition/effects.ts` and `statement-summary.ts`.
- The walker `react-source-transitions.ts` (1353 lines) currently calls these predicates directly
  and performs gating + phase scheduling in the same pass.
- Part 2 introduced `FrameworkPlugin.recognizeHook` (returns `HookCall.kind`
  `effect|transition|deferred|...` with `phase`) and `recognizeRenderBoundary` (returns
  `RenderBoundary` with optional `domain`). After Part 2 the tables live in the plugin but the engine
  still also matches inline (delegating wrappers). This part removes the inline matching at the
  consumer sites.

## 4. Atomic implementation steps

### Phase 3 — render boundaries
1. **Generalize gating.** Refactor the boundary-gating code in `react-source-transitions.ts` into a
   generic `gateTransitionForBoundary(boundary: RenderBoundary, …)` that takes a `RenderBoundary`
   (kind + domain) and applies the existing gating effect, with no `Suspense`/`lazy`/`use` strings.
2. **Recognize via the plugin.** At the JSX/expression walk sites, replace `isSuspenseElement` /
   `isReactLazyCall` / `isUseCall` calls with `framework.recognizeRenderBoundary(node, ctx)`; pass
   the returned boundary to `gateTransitionForBoundary`.
3. **Remove engine-side boundary strings.** Delete `isSuspenseElement` / `isReactLazyCall` /
   `isUseCall` from `ast.ts` (or reduce them to thin re-exports used only by the react plugin's own
   tests, not the engine).

### Phase 4 — effects / concurrency
4. **Recognize effects via the plugin.** Replace `reactEffectHookName` / `isUseTransitionCall` /
   `isUseDeferredValueCall` / `isStartTransitionCall` / `isFlushSyncCall` consumer calls with
   `framework.recognizeHook(call, ctx)` switches on `HookCall.kind`. The returned `phase` replaces
   `reactEffectPhase`.
5. **Keep summarization generic.** Leave `useEffectWritesModeledState` and the CPS/phase-scheduling
   logic in `transition/effects.ts` / `statement-summary.ts`; they now receive `kind` + `phase` from
   the plugin instead of computing them from strings.
6. **Remove engine-side effect strings.** Delete the migrated predicates and `reactEffectPhase` from
   `ast.ts` / `effects.ts` once tests confirm identity; the phase map lives only in
   `frameworks/react/hooks.ts`.

## 5. Tests to add or update

- Extend `test/frameworks/react/react-framework.test.ts`: `recognizeRenderBoundary` returns the same
  gating domain for `<Suspense>`, `React.lazy`, `use()`; `recognizeHook` returns correct `phase` for
  each effect hook and the right kind for transition/deferred/flushSync.
- Add `test/extraction/render-boundary-gating.test.ts`: a Suspense fixture gates the same transitions
  before/after, asserting identical model output.
- Add `test/extraction/effect-phase-ordering.test.ts`: useEffect vs useLayoutEffect ordering and a
  useTransition/flushSync fixture produce identical transitions.
- **Identity gate:** full snapshot suite, zero diffs, after **each** phase (land Phase 3, verify;
  then Phase 4, verify).

## 6. Verification

```bash
rtk pnpm vitest run test/frameworks/react test/extraction/render-boundary-gating.test.ts test/extraction/effect-phase-ordering.test.ts
rtk pnpm typecheck
rtk pnpm test        # zero golden-snapshot diffs — run after Phase 3 and again after Phase 4
rtk pnpm phase7
rtk pnpm architecture
rtk pnpm ci:examples
rtk pnpm fix
```

## 7. Acceptance criteria

- The engine recognizes no React render boundary or effect hook by string literal; all go through
  `framework.recognizeRenderBoundary` / `framework.recognizeHook`.
- `reactEffectPhase` lives only in `frameworks/react`; the engine consumes the plugin-provided phase.
- `gateTransitionForBoundary` is generic (no React strings) and consumes a `RenderBoundary`.
- Zero golden-snapshot diffs after Phase 3 and after Phase 4; `pnpm phase7`, `pnpm architecture`,
  `pnpm ci:examples` green.

## 8. Risks, ambiguities, and stop conditions

- **Two-step identity:** land and verify Phase 3 before starting Phase 4 so any snapshot drift is
  attributable. Do not batch both then debug.
- **`flushSync`/`startTransition` are calls, not hooks:** they are recognized via `recognizeHook`
  returning a transition-kind result, but they may appear outside component bodies. Preserve the exact
  current call-site guards; stop if a fixture uses them in a context the plugin path doesn't cover.
- **Suspense domain identity:** the domain factory was lifted in Part 2; if the engine previously
  mutated/augmented that domain inline after construction, replicate that in the plugin or in
  `gateTransitionForBoundary` — stop and diff if a Suspense fixture changes.
- If `useEffect` phase scheduling reads more than `phase` (e.g. effect-cleanup ordering), ensure
  `HookCall` carries enough; extend `HookCall` rather than leaking the hook name back into the engine.
