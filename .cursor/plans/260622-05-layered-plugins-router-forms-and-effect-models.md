# Layered Plugins — Phases 5–6: Router-Form + Effect-Model Ownership

> Part 5 of 6. Specs: `docs/_specs/plugin-layering/03-use-case-spis.md §4–§5`,
> `06-migration-roadmap.md` (Phases 5–6). Two independently-shippable slices.
> **Identity-preserving: zero golden-snapshot diffs.**

## 1. Goal

Move the last two library-specific recognition surfaces out of the engine:

- **Phase 5 (router forms):** `<Form>` / `useSubmit` / `useActionData` recognition moves behind
  `NavigationAdapter.recognizeFormSubmit`; the engine keeps generic location lowering.
- **Phase 6 (effect models):** timer (`setTimeout`/`setInterval`) and websocket recognition moves
  behind a new `EffectModelProvider` SPI; the engine keeps the universal CPS / enqueue-resolve
  lowering. Add `effectModels` to config and `"effect-model"` to `PluginProvenance.kind`.

## 2. Non-goals

- Do not change CPS lowering, pending-var construction, or location-var lowering — only relocate
  *recognition* of forms / timers / websockets.
- Do not add new routers or new effect channels beyond what the engine recognizes today.
- Do not change transition ordering or the IR.

## 3. Current-state findings

- Router form semantics (`Form`, `useSubmit`, `useActionData`) are recognized in the engine's router
  submit path (a `router-submit.ts`-style module within `src/extract/engine/ts/`); the generic
  location lowering is `buildLocationLowering` (`src/cli/features/extract/route-lowering.js`,
  consumed at `build-model.ts:293-308`).
- `NavigationAdapter` (`src/extract/engine/spi/index.ts`) already owns `discoverRoutes`,
  `classifyNavigationCall`, `locationVars`, `routeTreeVars?`, and a replay `harness`. It does **not**
  have `recognizeFormSubmit`.
- Timer/websocket recognition is inlined in the statement compiler
  (`src/extract/engine/ts/transition/statement-summary.ts`, 1156 lines) and the environment-callback
  path (`environment-callbacks.ts`, `timers.ts`-style modules). The CPS lowering (enqueue → pending
  var → resolve transition) is universal and lives alongside the recognition.
- `config.environment` (`EnvironmentEventConfig`, `src/extract/engine/ts/environment-config.ts`) is
  threaded through the pipeline (`build-model.ts:260`). This is the natural place for an
  `effectModels` list to ride alongside, or a sibling registry list.
- `PluginProvenance.kind` (`core/ir/types.ts:147-155`) does not include `"effect-model"`.
- The registry (`registry/index.ts`) auto-detects the active router via
  `resolveBuiltinNavigationBundle` (`registry/index.ts:149-211`); effect models would be built-in by
  default (timers/websockets are environment-universal, not dep-gated).

## 4. Atomic implementation steps

### Phase 5 — router forms
1. **Add the SPI method.** Add optional
   `recognizeFormSubmit?(node, ctx): FormSubmit | undefined` to `NavigationAdapter`
   (`spi/index.ts`), where `FormSubmit = { action?: RouteRef; effect: EffectIR; caveats? }`
   (`03-use-case-spis.md §4`).
2. **Implement in the router source.** Move the `Form`/`useSubmit`/`useActionData` recognition from
   the engine's submit module into `src/extract/sources/router/` (and `tanstack-router`/`next` where
   they have form semantics), returning the identical `EffectIR` the engine produced.
3. **Consume generically.** In the engine walker, replace the inline form recognition with a call to
   the active `routerAdapter.recognizeFormSubmit(node, ctx)`; treat the returned `effect` as a leaf
   wrapped by surrounding control flow. Keep `buildLocationLowering` untouched.
4. **Remove engine form strings.** Delete the migrated recognition once tests confirm identity.

### Phase 6 — effect models
5. **Add the SPI.** Add `src/extract/engine/spi/effect-model.ts`: `EffectModelProvider extends
   ModalityAdapterBase` with `kind:"effect-model"` and
   `recognizeEffect(call, ctx): EffectModel | undefined`, where
   `EffectModel = { channel; enqueue: EffectIR; resolution: { domain; effect }; caveats? }`
   (`03-use-case-spis.md §5`). Re-export from `spi/index.ts`.
6. **Implement built-in effect models.** Create `src/extract/frameworks/effects/` (or
   `src/extract/effect-models/`) with `timers` and `websocket` providers seeded from the current
   `timers.ts` / `environment-callbacks.ts` recognition, returning the identical enqueue/resolution
   IR. Add `package.json#exports` entries.
7. **Consume generically.** In `statement-summary.ts`, replace inline timer/websocket recognition
   with a dispatch to the registered `EffectModelProvider`s; the existing CPS lowering takes the
   returned `enqueue` + `resolution` unchanged.
8. **Wire config + registry + provenance.** Add `effectModels?: readonly EffectModelProvider[]` to
   `ModalityConfig` (the Part 1 placeholder) and `BuildExtractionModelOptions`; resolve explicit
   config-vs-default (built-in timers/websocket on by default) in `createBuiltinModalityRegistry`;
   add `validateEffectModelProvider`, a registry field, a `"effect-model"` provenance mapping block,
   and `"effect-model"` to `PluginProvenance.kind`. Add a depcruise boundary for the new effect-model
   location (sibling of `sources/*`, same import rules).

## 5. Tests to add or update

- Add `test/sources/router/form-submit.test.ts`: `recognizeFormSubmit` returns the identical effect
  for `<Form>`, `useSubmit`, `useActionData`; a fixture extraction is byte-identical before/after.
- Add `test/effect-models/timers.test.ts` and `websocket.test.ts`: `recognizeEffect` returns the
  identical enqueue/resolution IR; CPS-lowered transitions match the pre-change model.
- Update `src/cli/registry/index.test.ts`: effect-model providers registered/validated/stamped as
  `kind:"effect-model"`; explicit `config.effectModels` overrides defaults; `config.routerPlugin`
  with `recognizeFormSubmit` is exercised.
- **Identity gate:** full snapshot suite, zero diffs, after each phase.

## 6. Verification

```bash
rtk pnpm vitest run test/sources/router test/effect-models src/cli/registry/index.test.ts
rtk pnpm typecheck
rtk pnpm test        # zero golden-snapshot diffs — after Phase 5 and again after Phase 6
rtk pnpm phase7
rtk pnpm architecture
rtk pnpm ci:examples
rtk pnpm fix
```

## 7. Acceptance criteria

- `NavigationAdapter.recognizeFormSubmit` exists and the router sources implement it; the engine
  recognizes no form construct by string literal.
- `EffectModelProvider` SPI exists; timers + websocket recognition live in built-in effect-model
  providers; the engine's `statement-summary.ts` contains no timer/websocket strings, only the
  generic CPS lowering.
- `effectModels` is a config field; `PluginProvenance.kind` includes `"effect-model"`; the model
  metadata stamps active effect models.
- Zero golden-snapshot diffs after each phase; `pnpm phase7`, `pnpm architecture`, `pnpm ci:examples`
  green.

## 8. Risks, ambiguities, and stop conditions

- **CPS coupling:** timer/websocket recognition may be entangled with the CPS lowering in
  `statement-summary.ts` such that they are hard to separate cleanly. If the seam is unclear, stop
  and report the exact lines before splitting; do not partially move recognition and leave the engine
  half-aware.
- **Form effect identity:** `recognizeFormSubmit` must reproduce the exact `EffectIR` (including any
  caveats) the engine emitted; diff a `<Form>` fixture early.
- **Default effect models universality:** timers/websockets are environment-universal today (not
  dep-gated). Keep them on by default; gating them on a dependency would silently drop modeling. Stop
  and report if a config wants them off but a fixture relies on them.
- **Multiple form-capable routers:** exactly one router is active per app (Spec 05 §4), so
  `recognizeFormSubmit` lives on the single active adapter — no fan-out needed. Stop if a fixture
  somehow activates two routers.
