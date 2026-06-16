# Fix WebSocket Environment Review Findings

## 1. Goal

Fix the two review blockers in `/Users/hari/proj/modality-ts-worktrees/websocket-environment-effects` after the WebSocket environment-callback implementation:

1. Configured `onmessage` transitions are currently unreachable when a component registers `onmessage` but no explicit `onopen` handler.
2. Configured `JSON.parse(event.data)` payload binding does not actually bind message variants, so `switch (message.type)` falls back to over-approximate havoc instead of applying the matching configured branch.

The target behavior is:

- `onmessage` variants can fire after WebSocket construction even when the source does not define an `onopen` callback.
- `const message = JSON.parse(event.data)` and `const message = JSON.parse(String(event.data))` bind `message` to the configured variant record.
- For configured variants, `if (message.type === "...")` and `switch (message.type)` summarize only the matching branch where the discriminant is statically known from the configured payload.
- Tests assert effects and reachability, not just transition labels.

## 2. Non-goals

- Do not reimplement the whole WebSocket extraction feature.
- Do not add a JavaScript evaluator or execute `JSON.parse`.
- Do not support arbitrary payload parsing shapes beyond the explicitly supported subset.
- Do not model browser networking, readyState, close codes, reconnect timers, or event-loop scheduling.
- Do not make all event listeners environment transitions; keep this scoped to the existing supported WebSocket registration family.
- Do not refactor checker search, replay, router semantics, or unrelated source plugins.
- Do not change the public config shape unless a small compatibility-free clarification is necessary.
- Do not hide unsupported message shapes by silently emitting dead or empty transitions.

## 3. Current-State Findings

- In `src/extract/engine/ts/transition/environment-callbacks.ts`, `registerWebSocketConstructor` emits only an internal summary assigning the socket system var to `"connecting"`.
- `messageVariantTransition` guards every configured `onmessage` transition on the socket var being `"open"`.
- If the source registers only `ws.onmessage = ...`, there is no generated transition that writes the socket var to `"open"`, so the message transitions are unreachable.
- The new CLI test in `src/cli/features/extract/command.test.ts` uses an `onmessage`-only fixture and only asserts that an `env` transition with the configured label exists, not that the transition is reachable.
- `bindJsonParseEventData` currently checks `ts.isIdentifier(unwrapped.expression)` and compares `unwrapped.expression.text` to `"JSON.parse"`.
- TypeScript parses `JSON.parse(event.data)` as a `CallExpression` whose `expression` is a `PropertyAccessExpression`, not an `Identifier`, so configured message locals are never bound for the primary supported syntax.
- Because the message local is not bound, `switch (message.type)` is summarized through fallback/havoc. The current extraction test only checks for two labels, so it does not catch that both variants write `local:App.orders` with `havoc`.
- `modeledReadExpr` already gained support for reading fields out of literal object locals. Once the JSON.parse binding is fixed, this should allow `message.type`, `message.orders`, and `message.order` to resolve to configured literal values.
- `summarizeSwitchStatement` already builds conditional effects from a parsed discriminant and literal cases. It may still preserve dead branches as `if` effects unless constant condition simplification exists or is added.

## 4. Exact File Paths and Relevant Symbols

- `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `registerWebSocketConstructor`
  - `messageVariantTransition`
  - `bindMessageLocalsForVariant`
  - `bindJsonParseEventData`
  - `webSocketStateGuard`
  - `webSocketStateAssign`
  - `lifecycleGuardStates`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `summarizeIfStatement`
  - `summarizeSwitchStatement`
  - `effectFromSummaries`
  - `identityEffect`
  - `fallbackSummaries`
- `src/extract/engine/ts/transition/guards.ts`
  - `parseGuardExpression`
  - `andGuard`
- `src/extract/engine/ts/transition/expressions.ts`
  - `modeledReadExpr`
  - `valueExpr`
  - `propertyAccessPath`
- `test/extraction/extraction.test.ts`
  - `describe("environment callbacks", ...)`
  - `models configured WebSocket message variants from JSON.parse event.data`
  - `does not treat registered WebSocket callback setters as immediate useEffect writes`
- `src/cli/features/extract/command.test.ts`
  - `loads environment.webSockets from modality config`

## 5. Existing Patterns To Follow

- Follow the timer extraction shape where possible: scheduling/registration creates state that enables later environment transitions.
- Keep WebSocket construction as an internal effect and callbacks as `env` transitions.
- Keep environment callback logic inside `environment-callbacks.ts`; touch `statement-summary.ts` only for generic constant-branch simplification if needed.
- Prefer small AST predicates over broad expression evaluation.
- Use existing literal `BoundExpr` behavior in `expressions.ts` instead of adding a separate payload read mechanism.
- Existing summaries can return `havoc` for genuinely unrepresentable writes, but configured message variants should not degrade to havoc solely because `JSON.parse(event.data)` was not recognized.
- Existing tests often use `toMatchObject`, but these regressions need stronger assertions on guards, effects, confidence, and absence of havoc where exact modeling is expected.

## 6. Atomic Implementation Steps

1. Add regression tests that fail on the current implementation.

   In `test/extraction/extraction.test.ts`, update or add fixtures for:

   - `onmessage` without `onopen` emits a reachable path from construction to a message transition.
   - `JSON.parse(event.data)` with configured variants produces exact branch-specific effects.
   - `JSON.parse(String(event.data))` also binds the message local if that support is intended by the current code.

   The tests must inspect transition effects, not just labels. For a fixture like:

   ```ts
   switch (message.type) {
     case "snapshot":
       setOrders(message.orders);
       break;
     case "order-updated":
       setOrders((current) => [...current, message.order]);
       break;
   }
   ```

   Assert that:

   - the `"snapshot"` transition writes `local:App.orders` from the configured `orders` value, or at least is `confidence: "exact"` and not `havoc`;
   - the `"order-updated"` transition uses the configured `order` value in the functional update, or at least is exact and not the same unconditional havoc as `"snapshot"`;
   - neither transition is silently empty;
   - the message transition guard can be satisfied after registration in an `onmessage`-only fixture.

2. Fix `JSON.parse(event.data)` AST matching.

   In `bindJsonParseEventData`, replace the identifier-only check with a helper such as `isJsonParseExpression(expression)`:

   - return true for `JSON.parse` represented as `PropertyAccessExpression` with base identifier `JSON` and name `parse`;
   - optionally keep no support for aliasing or destructuring;
   - do not accept arbitrary `obj.parse`.

   Keep the argument predicate narrow:

   - accept `<eventParam>.data`;
   - accept `String(<eventParam>.data)`;
   - require the base of `.data` to be the callback parameter if practical, not any identifier in scope.

3. Bind the actual callback event parameter.

   `bindJsonParseEventData` currently only checks that `.data` is accessed from some identifier. Tighten this by deriving the callback parameter name in `bindMessageLocalsForVariant`.

   - If the callback has exactly one identifier parameter, pass that name into the JSON parse matcher.
   - Accept `event.data` only when `event` matches that callback parameter.
   - If the callback has no parameter or a destructured parameter, fail the binding and emit the existing unsupported payload warning when writes are present.

4. Make configured message branches exact.

   After JSON payload locals are bound, inspect the extracted effect for `switch (message.type)` and `if (message.type === "...")` fixtures.

   If the existing summarizer already produces exact conditional effects with literal conditions, add a small constant-folding helper in `statement-summary.ts` or a nearby transition utility:

   - simplify `eq(lit(a), lit(b))` and `neq(lit(a), lit(b))` to literal booleans;
   - simplify `if` effects with literal boolean conditions to the selected branch;
   - optionally simplify empty `seq` effects after branch selection.

   Keep this generic and local to summary construction. Do not add a general evaluator.

5. Fix the unreachable `onmessage` state flow.

   Decide on one minimal, sound model and implement it consistently:

   - Preferred: create an implicit WebSocket open environment transition when a registration has an `onmessage` handler but no explicit `onopen` callback. This transition should move the socket var from `"connecting"` to `"open"` and use a label such as `{ kind: "env", key: "<Component>.websocket.onopen" }` or a clearly documented generic open label.
   - Alternative: allow configured message transitions to be guarded on `"connecting"` or `"open"` and sequence an `"open"` assignment before the message callback effect when starting from `"connecting"`.

   Prefer the implicit-open transition because it preserves the existing lifecycle meaning: messages still require an open socket, and opening remains a separate environment event.

6. Avoid duplicate open transitions.

   If the source explicitly registers `onopen`, do not add a second implicit open transition for the same WebSocket registration.

   Implementation options:

   - Track registered callback events on `WebSocketRegistration`, or
   - Track local per-effect callback registrations while processing assignments, then add implicit opens after effect summarization.

   Keep the data structure small. A registration-local set of events is enough.

7. Ensure implicit open transitions are emitted before message transitions are used.

   The order in the transition array does not define model reachability, but tests and readability benefit from deterministic output.

   - Use stable IDs.
   - Include the socket var in reads/writes.
   - Guard implicit open on `"connecting"` or `"closed"` following the same guard semantics as explicit `onopen`.
   - Write the socket var to `"open"`.
   - Use `confidence: "exact"`.

8. Improve CLI test assertions.

   In `src/cli/features/extract/command.test.ts`, extend `loads environment.webSockets from modality config` so it fails if the transition is unreachable or only havoc:

   - assert there is either an explicit or implicit open transition writing the same `sys:websocket:*` var to `"open"`;
   - assert the configured message transition guard references that same var;
   - assert the configured message transition effect is not `havoc` for a directly bound payload assignment.

9. Keep unsupported cases visible.

   Add or preserve tests that unsupported message payload parsing emits a warning/caveat instead of producing silently useless transitions.

   Examples:

   - `const message = decode(event.data)`;
   - callback parameter is destructured;
   - `JSON.parse(other.data)` where `other` is not the callback event parameter.

10. Run focused verification and inspect output.

   Use a one-off extractor probe only while debugging if needed. Do not commit generated output.

   Confirm the fixed output for an `onmessage`-only fixture contains:

   - construction/internal transition to `"connecting"`;
   - implicit or explicit open transition to `"open"`;
   - configured message transition guarded on `"open"`;
   - exact non-havoc effect from configured payload fields.

## 7. Per-Step Files To Edit

- Step 1:
  - `test/extraction/extraction.test.ts`
  - `src/cli/features/extract/command.test.ts`
- Step 2:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- Step 3:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- Step 4:
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - `src/extract/engine/ts/transition/expressions.ts` only if literal field reads need a small correction
  - `test/extraction/extraction.test.ts`
- Step 5:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts` only if callback registration tracking lives there
- Step 6:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - `src/extract/engine/ts/transition/effects.ts` only if a post-effect finalization hook is needed
- Step 7:
  - `src/extract/engine/ts/transition/environment-callbacks.ts`
- Step 8:
  - `src/cli/features/extract/command.test.ts`
- Step 9:
  - `test/extraction/extraction.test.ts`
  - `src/extract/engine/ts/transition/environment-callbacks.ts` only if warning behavior needs adjustment
- Step 10:
  - no committed files unless verification exposes another targeted fix

## 8. Acceptance Criteria

- `JSON.parse(event.data)` is recognized for a normal WebSocket `onmessage` callback parameter.
- `JSON.parse(String(event.data))` is recognized if this remains documented/supported by the implementation.
- `JSON.parse(other.data)` does not bind when `other` is not the callback event parameter.
- Configured message variants bind `message.type` and configured fields such as `message.orders`, `message.order`, `message.brewUnits`, and `message.orderId`.
- `switch (message.type)` applies only the matching configured case for each emitted variant transition.
- `if (message.type === "...")` applies only the matching branch for each emitted variant transition.
- Configured message transitions for supported fixtures are `confidence: "exact"` unless the callback body itself contains an unsupported write.
- Supported configured payload fixtures do not produce `havoc` solely because of the JSON.parse binding.
- An `onmessage`-only WebSocket fixture has a reachable path to message transitions.
- Explicit `onopen` fixtures do not receive duplicate open transitions.
- Callback setter calls are still not modeled as immediate `useEffect` writes.
- Missing or unsupported message payload config still emits a structured warning/caveat.
- Existing timer extraction behavior is unchanged.

## 9. Tests To Add Or Update

- Update `test/extraction/extraction.test.ts`:
  - Strengthen `models configured WebSocket message variants from JSON.parse event.data` to assert exact effects and no `havoc`.
  - Add `models onmessage-only WebSocket as reachable through implicit open` or equivalent.
  - Add `does not duplicate implicit open when explicit onopen is registered`.
  - Add `binds JSON.parse(String(event.data)) for configured WebSocket variants` if that syntax is supported.
  - Add `reports unsupported WebSocket message parse when parse source is not callback event data`.

- Update `src/cli/features/extract/command.test.ts`:
  - Strengthen `loads environment.webSockets from modality config` to assert open reachability and non-havoc payload effect.

- Keep existing tests:
  - `models WebSocket onopen as guarded environment transition`;
  - `models WebSocket onclose and cleanup close separately`;
  - `models WebSocket onerror as environment transition`;
  - `models WebSocket addEventListener lifecycle callbacks`;
  - `does not treat registered WebSocket callback setters as immediate useEffect writes`;
  - `reports missing WebSocket message variants for onmessage writes`;
  - `preserves existing timer callback behavior`.

## 10. Verification Commands

Run from `/Users/hari/proj/modality-ts-worktrees/websocket-environment-effects`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts src/cli/features/extract/command.test.ts test/extract/effect-ordering.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If the fix changes generic effect simplification in `statement-summary.ts`, also run:

```bash
rtk pnpm test -- test/check src/cli/features/check/command.test.ts
rtk pnpm phase7
```

Optional manual probe while developing:

```bash
rtk pnpm exec tsx -e '<small extractReactSourceTransitions probe for an onmessage-only WebSocket fixture>'
```

Do not commit probe output.

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if fixing exact branch selection requires broad IR evaluation or checker changes. The intended fix is local constant simplification and payload binding.
- Stop and report if the existing effect IR cannot represent the configured payload assignment exactly enough for Coffee DX without expanding value domains.
- Stop and report if implicit open transitions conflict with route unmount or cleanup semantics in a way that requires broader lifecycle modeling.
- Do not let implicit open fire after cleanup if the existing model can distinguish cleanup as terminal. If it cannot, document the limitation rather than adding a large lifecycle refactor.
- Do not allow message transitions directly from `"idle"`; construction should still be required.
- Do not accept arbitrary `JSON.parse` aliases or custom parse helpers in this fix.
- Do not make unsupported message handlers disappear just because configured variants exist.
- Be careful when adding constant simplification: it must preserve reads where needed for reporting, and it must not rewrite non-literal conditions.
- If tests reveal that existing switch summaries intentionally preserve conditional effects rather than reducing them, add simplification only at the WebSocket variant boundary instead of changing all switch extraction behavior.
- Preserve the current architecture boundaries. If a dependency-cruiser violation appears, move helper functions to the existing transition layer rather than importing upward.
