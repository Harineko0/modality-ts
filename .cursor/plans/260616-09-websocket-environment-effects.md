# WebSocket Environment Effects

## 1. Goal

Fix `docs/_issues/coffee-dx-websocket-effects-unextractable.md` by teaching extraction to model environment-driven callbacks registered from React effects, with `WebSocket` as the first supported registration family.

The concrete target shape is:

```ts
useEffect(() => {
  const ws = new WebSocket(url);
  ws.onopen = () => setConnected(true);
  ws.onclose = () => setConnected(false);
  ws.onerror = () => setError("connection");
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    switch (message.type) {
      case "snapshot":
        setOrders(message.orders);
        break;
      case "order-updated":
        setOrders((orders) => updateOrder(orders, message.order));
        break;
    }
  };
  return () => ws.close();
}, []);
```

Extraction should emit guarded `env` transitions for `onopen`, `onclose`, `onerror`, and configured `onmessage` variants instead of classifying the whole `useEffect` as unextractable. This should make Coffee DX drip and cashier models represent snapshot loading, order updates, brew-unit updates, reconnect or close behavior, and connection errors without hand-authoring the entire route model.

Implement this as a reusable environment-callback extraction mechanism, not as Coffee DX-specific logic.

## 2. Non-goals

- Do not hard-code Coffee DX route names, message names, field names, or state variable IDs.
- Do not implement a general JavaScript event-loop or browser API simulator.
- Do not execute `JSON.parse`, constructors, callbacks, or user code during extraction.
- Do not attempt full structural precision for arbitrary message payload transforms in the first pass.
- Do not make all callbacks assigned inside `useEffect` become environment events. Only supported registration families should be modeled.
- Do not weaken unextractable reporting. Unsupported callback bodies must still surface typed caveats.
- Do not depend on backward compatibility; this tool is experimental.
- Do not refactor checker search, stabilization, router semantics, or unrelated source plugins.

## 3. Current-State Findings

- `docs/_issues/coffee-dx-websocket-effects-unextractable.md` reports that Coffee DX drip and cashier pages derive most UI state from `WebSocket` `onmessage`, `onopen`, `onclose`, and `onerror` callbacks registered inside `useEffect`, and extraction currently reports `Unextractable effect DripHome.useEffect` and `Unextractable effect CashierHome.useEffect`.
- `src/extract/engine/ts/react-source-transitions.ts` detects React effect hooks near the bottom of `extractReactSourceTransitions` and delegates to `transitionsFromUseEffect`.
- `src/extract/engine/ts/transition/effects.ts` currently converts effect bodies that write modeled state into `internal` transitions via `transitionsFromUseEffect`. It already passes an `EffectExtractionContext` containing `envTransitions`, `timerRegistrations`, `timerIndex`, and `transitionBindings`.
- `src/extract/engine/ts/transition/statement-summary.ts` already has the extension point needed for this work: `StatementSummaryOptions.envTransitions` lets statement summarization append additional environment transitions while returning a normal summary for the registration statement.
- `src/extract/engine/ts/transition/timers.ts` is the closest pattern. `registerTimerFromScheduleCall` creates a system state var, a scheduling summary, and a guarded `env` fire transition. `statement-summary.ts` appends the fire transition via `state.envTransitions`.
- `src/extract/engine/ts/transition/concurrent.ts` follows the same pattern for `startTransition`: a synchronous scheduling summary plus an environment resolve transition.
- `src/core/ir/types.ts` already supports transition class `cls: "env"`, but `EventLabel` only has specialized labels such as `resolve`, `timer`, and `focus-revalidate`. There is no generic environment-message label.
- `src/core/ir/types.ts` has no `sys:websocket:*` state convention. `docs/_specs/01-ir.md` documents system vars for pending ops, timers, suspense, routes, and cache-shaped templates, but not externally-pushed streams.
- `src/extract/engine/ts/transition/expressions.ts` supports local bindings, modeled reads, literals, object field updates, nullish optional reads, boolean expressions, and simple conditionals. It does not parse `JSON.parse(event.data)` into a structured payload, which is why message variants need a config-assisted binding surface rather than AST-only inference.
- `src/core/overlay/index.ts` currently supports replacement transitions, domain refinements, locators, and ignored vars. The docs mention richer payload/outcome overlay APIs, but the implemented overlay builder does not currently include `refinePayload`, `outcomes`, or `assume`.
- `src/cli/features/extract/command.ts` defines `ModalityConfig` with `effectApis`, bounds, plugin options, router options, and navigation options. There is no config surface for environment event/message variants yet.
- `src/cli/features/extract/command.ts` synthesizes system vars by scanning transitions for `sys:timer:` and `sys:suspense:` IDs. A new `sys:websocket:` state var family should be registered through the same pattern or an equivalent generalized collector.

## 4. Exact File Paths and Relevant Symbols

- `src/core/ir/types.ts`
  - `EventLabel`
  - `Transition`
  - `StateVarDecl`
- `src/core/ir/validator.ts`
  - `validateTransition`
  - label validation and read/write validation helpers
- `src/extract/engine/ts/transition/effects.ts`
  - `EffectExtractionContext`
  - `transitionsFromUseEffect`
  - `effectSummaryOptions`
  - `cleanupSummaries`
  - `summarizeEffectStatements`
  - `reactEffectWritesModeledState`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `StatementSummaryOptions`
  - `StatementSummaryState`
  - `summarizeStatements`
  - `summarizeStatement`
  - `fallbackResult`
  - `summarizeTimerScheduleCall`
- `src/extract/engine/ts/transition/timers.ts`
  - `TimerRegistration`
  - `timerStateVarDecl`
  - `registerTimerFromScheduleCall`
  - `timerClearSummaryFromCall`
- New file to add:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- `src/extract/engine/ts/transition/expressions.ts`
  - `valueExpr`
  - `setterArgumentExpr`
  - `readBinding`
  - `stateVarForName`
- `src/extract/engine/ts/transition/guards.ts`
  - `andGuard`
  - `parseGuardExpression`
- `src/extract/engine/ts/ids.ts`
  - `safeId`
  - `uniqueStrings`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `ReactSourceTransitionOptions`
  - effect-hook visit branch
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `HandlerExtractorOptions`
  - `runExtractionPipeline`
- `src/cli/features/extract/command.ts`
  - `ModalityConfig`
  - `runExtractCommand`
  - `synthesizeSystemVars`
  - `collectSystemVarIds`
  - `createExtractionReport`
- `src/core/report/types.ts`
  - extraction report shape if environment config provenance or message caveats need report fields
- `test/extraction/extraction.test.ts`
  - `describe("useState inventory", ...)`
  - existing `useEffect` and timer tests
- `src/cli/features/extract/command.test.ts`
  - config-loading tests
  - extraction-report tests
- `docs/_specs/01-ir.md`
  - system variables and event labels
- `docs/_specs/02-extraction.md`
  - effect body and environment outcome extraction
- `docs/guides/modeling-side-effects.md`
  - timers and environment event guidance
- `docs/reference/config-and-overlay-api.md`
  - config table and overlay caveats
- `docs/_issues/coffee-dx-websocket-effects-unextractable.md`
  - optionally update with the chosen resolution plan after implementation

## 5. Existing Patterns To Follow

- Follow the timer registration shape:
  - registration statement produces a synchronous summary;
  - a `sys:*` state var tracks whether the environment event can fire;
  - the actual callback body becomes a guarded `env` transition;
  - system vars are synthesized after transition extraction by scanning transition reads/writes.
- Keep `useEffect` registration work as an `internal` transition only when it changes model state directly. Callback bodies should not run as part of registering the effect.
- Use `summary.effect.kind === "havoc"` and `confidence: "over-approx"` when callback writes are identifiable but not expressible.
- Use `unextractableEffectCaveat` or a new typed caveat only when the extractor cannot construct any sound environment event representation for callback writes.
- Keep stable IDs readable and deterministic, using component name, API family, callback name, and message variant where available.
- Use config-assisted abstraction for payloads. The extractor should bind configured message variants into callback locals instead of trying to infer arbitrary `JSON.parse(event.data)` shapes.
- Prefer a generic environment-callback abstraction with a WebSocket adapter over special-casing all logic directly in `effects.ts` or `statement-summary.ts`.

## 6. Atomic Implementation Steps

1. Add a generic environment event label.

   Update `src/core/ir/types.ts` so `EventLabel` includes a generic environment label, for example:

   ```ts
   | { kind: "env"; key: string; outcome?: string }
   ```

   Use it for WebSocket lifecycle and message events:

   - `key: "DripHome.websocket.onopen"`
   - `key: "DripHome.websocket.onmessage"`
   - `outcome: "snapshot"` for configured message variants

   Update any exhaustive label handling in `src/core/ir/validator.ts`, report formatting, trace formatting, replay formatting, and tests. If no exhaustive handling exists, add tests anyway so the schema change is intentional.

2. Define environment callback config types.

   Add a narrow config type that can be threaded from CLI config to extraction:

   ```ts
   export interface EnvironmentEventConfig {
     webSockets?: readonly WebSocketEnvironmentConfig[];
   }

   export interface WebSocketEnvironmentConfig {
     id?: string;
     url?: string;
     messages?: readonly WebSocketMessageVariant[];
   }

   export interface WebSocketMessageVariant {
     type: string;
     bind?: Record<string, import("modality-ts/core").Value>;
   }
   ```

   Keep `bind` intentionally simple in the first pass: literal abstract values only. It is enough to bind `message.type`, `message.orders`, `message.order`, `message.brewUnits`, or similar abstract placeholders when Coffee DX message handlers read those fields.

   Thread this through:

   - `ModalityConfig` in `src/cli/features/extract/command.ts`
   - `ExtractCommandOptions` only if tests need direct injection
   - `ExtractionPipelineOptions` in `src/extract/engine/pipeline/index.ts`
   - `ReactSourceTransitionOptions` in `src/extract/engine/ts/react-source-transitions.ts`
   - `EffectExtractionContext` and `StatementSummaryOptions`

   Name the field `environment` or `environmentEvents`; use one name consistently.

3. Add `environment-callbacks.ts`.

   Create `src/extract/engine/ts/transition/environment-callbacks.ts` with small focused helpers:

   - `EnvironmentRegistration`
   - `WebSocketRegistration`
   - `environmentStateVarDecl(varId)`
   - `webSocketVarId(component, context, index)`
   - `isWebSocketConstructor(node)`
   - `bindWebSocketHandle(declaration, varId, bindings)`
   - `isWebSocketCallbackAssignment(statement, bindings)`
   - `registerWebSocketCallbackAssignment(...)`
   - `webSocketCleanupSummaryFromCall(...)`

   Use a state domain such as:

   ```ts
   { kind: "enum", values: ["idle", "connecting", "open", "closed", "error"] }
   ```

   Initial value should be `"idle"`.

4. Recognize `new WebSocket(...)` registrations inside effect bodies.

   In statement summarization:

   - Detect `const ws = new WebSocket(url)` and bind `ws` to a generated `sys:websocket:<...>` var.
   - Return a summary that assigns the websocket state to `"connecting"`.
   - If the URL is a string literal or template route pattern, use it in the stable ID suffix via `safeId`; otherwise use the per-effect index.
   - Add the registration so `react-source-transitions.ts` can synthesize the state var, mirroring `timerRegistrations`.

   Do not add a browser-network pending op for WebSocket construction; this is a long-lived environment source, not an awaited operation.

5. Convert lifecycle callback assignments into `env` transitions.

   Support at least these callback assignment forms inside the same effect block:

   - `ws.onopen = () => { ... }`
   - `ws.onclose = () => { ... }`
   - `ws.onerror = () => { ... }`
   - `ws.onmessage = (event) => { ... }`
   - `ws.addEventListener("open", () => { ... })`
   - `ws.addEventListener("close", () => { ... })`
   - `ws.addEventListener("error", () => { ... })`
   - `ws.addEventListener("message", (event) => { ... })`

   For `onopen`, create an `env` transition guarded on `connecting` or `closed` if reconnect is represented, with an effect sequence:

   - assign websocket state to `"open"`;
   - apply summarized callback writes.

   For `onclose`, guard on `connecting` or `open`, assign `"closed"`, then apply callback writes.

   For `onerror`, guard on `connecting` or `open`, assign `"error"`, then apply callback writes.

   If a lifecycle callback body has identifiable writes but cannot be summarized exactly, use havoc summaries and `confidence: "over-approx"` instead of dropping the transition.

6. Add message variant binding.

   For `onmessage`, build one transition per configured message variant for that WebSocket registration. Each transition should:

   - be `cls: "env"`;
   - use label `{ kind: "env", key: "<component>.websocket.onmessage", outcome: variant.type }`;
   - guard on websocket state `"open"`;
   - bind callback parameter locals so common code shapes can be summarized.

   Required bindings:

   - callback param such as `event` should expose `event.data` as a configured abstract payload token or record;
   - local `const message = JSON.parse(event.data)` should bind `message` to a record literal based on the variant;
   - `message.type` should equal `variant.type`;
   - keys in `variant.bind` should become fields on `message`.

   Example config:

   ```ts
   environment: {
     webSockets: [
       {
         id: "coffee-orders",
         messages: [
           {
             type: "snapshot",
             bind: { orders: "many", brewUnits: "many" },
           },
           {
             type: "order-updated",
             bind: { order: "token" },
           },
           {
             type: "order-removed",
             bind: { orderId: "token" },
           },
         ],
       },
     ],
   }
   ```

   The first implementation can match by registration order when `id` or `url` is absent. If multiple WebSockets exist in one component and no config entry can be matched deterministically, emit a caveat and require `id` or `url`.

7. Add a small binding helper for parsed JSON payload locals.

   Extend `statement-summary.ts` or add helpers in `environment-callbacks.ts` so callback summarization can bind:

   ```ts
   const message = JSON.parse(event.data);
   ```

   to a `BoundExpr` literal record. Keep this limited to:

   - `const <name> = JSON.parse(<eventParam>.data)`
   - optional `const <name> = JSON.parse(String(<eventParam>.data))` only if cheap and obvious

   Do not add a general expression evaluator.

8. Ensure callback registration statements do not poison the parent `useEffect` summary.

   When a statement is recognized as WebSocket construction or callback registration:

   - return the registration summary or an empty summary as appropriate;
   - append generated `env` transitions to `state.envTransitions`;
   - avoid falling through to `fallbackResult`, which would incorrectly treat nested callback setter calls as immediate internal `useEffect` writes.

   This is the behavioral core of the fix.

9. Model cleanup close calls.

   Support cleanup bodies like:

   ```ts
   return () => ws.close();
   ```

   If the `ws` handle can be resolved, return a cleanup summary that assigns the websocket state to `"closed"`. This cleanup remains an `internal` transition because it is React lifecycle cleanup, not an external event.

   Do not try to model `close(code, reason)` payloads in this change.

10. Register websocket system vars.

   Mirror the timer path:

   - add a `webSocketRegistrations` or more generic `environmentRegistrations` collection to `EffectExtractionContext`;
   - have `react-source-transitions.ts` register state var declarations after `transitionsFromUseEffect`;
   - have `synthesizeSystemVars` in `src/cli/features/extract/command.ts` collect `sys:websocket:` IDs from transition reads/writes if needed, like `sys:timer:` and `sys:suspense:`.

   Prefer one source of truth. If `react-source-transitions.ts` can return the vars directly, avoid duplicate synthesis; if CLI synthesis is the established pattern for system vars, follow it.

11. Emit typed caveats for unsupported callback cases.

   Add a helper in `src/extract/engine/ts/caveats.ts` only if existing caveats are too vague, for example:

   ```ts
   environmentCallbackCaveat(id, reason, source)
   ```

   Otherwise use `modelSlackCaveat` for over-approximation and `unextractableHandlerCaveat` or `unextractableEffectCaveat` only when no sound transition can be emitted.

   Required caveat cases:

   - `onmessage` exists but there are no configured message variants;
   - multiple WebSocket registrations cannot be matched to config;
   - callback parameter or `JSON.parse(event.data)` binding is not in the supported subset;
   - callback body writes modeled state but cannot be summarized or safely havoced.

12. Add focused extraction tests.

   In `test/extraction/extraction.test.ts`, add a new describe block such as `describe("environment callbacks", ...)`.

   Cover:

   - `useEffect` with `new WebSocket`, `onopen`, and `onclose` emits lifecycle `env` transitions and no unextractable effect warning;
   - `onerror` writes modeled error state;
   - cleanup `ws.close()` emits an internal cleanup transition assigning websocket state to `"closed"`;
   - `onmessage` with configured variants emits one `env` transition per variant;
   - `JSON.parse(event.data)` plus `switch (message.type)` is summarized when variants are configured;
   - unsupported message callback still surfaces a caveat rather than silently dropping state writes.

13. Add CLI config tests.

   In `src/cli/features/extract/command.test.ts`, add coverage that writes `modality.config.ts` with `environment.webSockets` and verifies:

   - config loads;
   - extraction report warnings do not include `Unextractable effect App.useEffect` for the supported fixture;
   - the model includes `env` transitions for configured message types.

14. Update specs and docs.

   Update:

   - `docs/_specs/01-ir.md` to document `sys:websocket:*` and generic environment labels.
   - `docs/_specs/02-extraction.md` to document environment callback registrations from effect bodies.
   - `docs/guides/modeling-side-effects.md` to add a short section after timers explaining WebSocket streams and message variants.
   - `docs/reference/config-and-overlay-api.md` to add the new `environment.webSockets` config surface and avoid documenting overlay methods that are not implemented.

15. Optional Coffee DX verification note.

   If `/Users/hari/proj/coffee-dx/apps/web` is available after implementation, run the original repros from `docs/_issues/coffee-dx-websocket-effects-unextractable.md` with an appropriate `modality.config.ts` environment section and confirm:

   - drip and cashier reports no longer classify their WebSocket effects as unextractable;
   - the cashier model has nonzero transitions for live server/order events;
   - relevant transitions write the snapshot/order/brew-unit/connection state vars.

## 7. Per-Step Files To Edit

- Step 1:
  - `src/core/ir/types.ts`
  - `src/core/ir/validator.ts`
  - trace/report formatting files if exhaustive label handling fails typecheck
- Step 2:
  - `src/cli/features/extract/command.ts`
  - `src/extract/engine/pipeline/index.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/ts/transition/effects.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
- Step 3:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- Step 4:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
- Step 5:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
- Step 6:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - `src/extract/engine/ts/transition/expressions.ts` only if a reusable local-binding helper is needed
- Step 7:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/locals.ts` only if existing binding helpers are the right home
- Step 8:
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - `src/extract/engine/ts/transition/effects.ts`
- Step 9:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/effects.ts`
- Step 10:
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/cli/features/extract/command.ts`
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- Step 11:
  - `src/extract/engine/ts/caveats.ts`
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- Step 12:
  - `test/extraction/extraction.test.ts`
- Step 13:
  - `src/cli/features/extract/command.test.ts`
- Step 14:
  - `docs/_specs/01-ir.md`
  - `docs/_specs/02-extraction.md`
  - `docs/guides/modeling-side-effects.md`
  - `docs/reference/config-and-overlay-api.md`
- Step 15:
  - `docs/_issues/coffee-dx-websocket-effects-unextractable.md` only if issue docs are updated with verification outcomes

## 8. Acceptance Criteria

- A fixture with `useEffect(() => { const ws = new WebSocket("/ws"); ws.onopen = () => setConnected(true); }, [])` emits:
  - a websocket system var;
  - a registration/internal transition assigning it to `"connecting"`;
  - an `env` transition for `onopen` assigning it to `"open"` and `local:*.connected` to `true`;
  - no `Unextractable effect *.useEffect` warning.
- `onclose` and `onerror` callbacks become guarded `env` transitions and can write modeled local state.
- `return () => ws.close()` becomes a cleanup/internal transition that closes the websocket state.
- `onmessage` emits one `env` transition per configured message variant.
- A supported `JSON.parse(event.data)` plus `switch (message.type)` callback only applies the matching switch branch for each configured message variant.
- Unsupported message parsing or missing variants produces a structured warning/caveat instead of silent omission.
- Callback setter calls are not modeled as immediate `useEffect` internal writes during registration.
- Existing timer extraction tests still pass.
- Existing simple `useEffect` setter-body tests still pass.
- Existing async `await` operation splitting is unchanged.
- The original Coffee DX drip and cashier repros can be modeled by adding environment message variants to config, without writing manual replacement transitions for the whole route.

## 9. Tests To Add Or Update

- Add `test/extraction/extraction.test.ts` tests:
  - `models WebSocket onopen as guarded environment transition`;
  - `models WebSocket onclose and cleanup close separately`;
  - `models WebSocket onerror as environment transition`;
  - `models WebSocket addEventListener lifecycle callbacks`;
  - `models configured WebSocket message variants from JSON.parse event.data`;
  - `does not treat registered WebSocket callback setters as immediate useEffect writes`;
  - `reports missing WebSocket message variants for onmessage writes`;
  - `preserves existing timer callback behavior`.

- Add `src/cli/features/extract/command.test.ts` tests:
  - config file accepts `environment.webSockets`;
  - CLI extraction produces message variant `env` transitions from config;
  - extraction report contains no unextractable effect caveat for the supported fixture.

- Update existing snapshots or schema tests only where the new `EventLabel` variant requires it.

- Add docs tests only if the repo has a docs build or markdown validation command already covering changed docs.

## 10. Verification Commands

Run from `/Users/hari/proj/modality-ts` and prefix commands with `rtk`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts src/cli/features/extract/command.test.ts test/extract/effect-ordering.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If checker-facing validation or trace formatting changes beyond labels, also run:

```bash
rtk pnpm test -- test/kernel test/check src/cli/features/check/command.test.ts
rtk pnpm phase7
```

Optional Coffee DX verification after implementation:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality extract app/_drip/home.tsx --report .modality/probe-drip.extraction-report.json
rtk pnpm exec modality extract app/_cashier/home.tsx --report .modality/probe-cashier.extraction-report.json
```

Then inspect the reports for absence of:

```text
Unextractable effect DripHome.useEffect
Unextractable effect CashierHome.useEffect
```

and inspect the model for `env` transitions with labels keyed to websocket lifecycle/message events.

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if Coffee DX uses a wrapper around `WebSocket` rather than direct `new WebSocket(...)`; that should become a generic configurable environment adapter, not a one-off AST patch.
- Stop and report if Coffee DX has multiple WebSockets in the same component and config cannot identify which variants belong to which registration. Require `id` or URL matching rather than guessing.
- Stop and report if message handlers depend on deep payload transforms that cannot be represented by literal abstract `bind` values or safe havoc writes. Do not fake exact payload semantics.
- Stop and report if adding a new `EventLabel` kind ripples into replay or exporter behavior more broadly than expected. It is acceptable to make generic env events checkable but not replayable in the first implementation, as long as the report says so.
- Be careful not to turn callback assignment statements into internal effect writes. That would preserve the current bug under a different shape.
- Be careful with lifecycle guards. `message` should not fire before `open`; `open` should not fire after terminal cleanup unless reconnect is deliberately modeled.
- Be careful with route or mount scoping. Environment transitions for a route-local component must not fire after that component is unmounted.
- Do not add a full overlay payload API in this fix unless the implemented overlay builder is expanded deliberately and covered by tests. A config surface is enough for this issue.
- Do not hide unsupported cases as `model-slack` if no sound transition exists. Use an unextractable caveat when state writes are present and cannot be represented.
- Do not let config variants silently go unused. If an environment config entry matches no registration, report drift or a warning similar to overlay drift.
