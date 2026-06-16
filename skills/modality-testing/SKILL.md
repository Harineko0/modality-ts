---
name: modality-testing
description: Guide use of modality-ts for bounded model checking of React and TypeScript state-transition behavior. Use when Codex needs to choose whether a UI flow is a good fit, extract a finite model, write or refine serializable property files, model async side effects, use overlays/configuration, run modality CLI checks, inspect trust-ledger reports, debug/replay counterexamples, tune search limits, configure CI artifacts, or work with supported sources such as useState, Jotai, Zustand, SWR, Next.js, React Router, timers, effects, Suspense, and route state.
---

# Modality Testing

## Fit

Use `modality-ts` for bounded, deterministic exploration of React state transitions:
local state, route/history state, atoms/stores, cache templates, async effects, timers,
and named side effects. Keep DOM layout, CSS, animation timing, browser quirks,
unbounded server/database behavior, and visual correctness in ordinary unit,
integration, or end-to-end tests.

Treat the extracted model plus its trust ledger as the source of truth. Do not guess
variable IDs, transition IDs, bounds, or caveats from code alone; inspect
`.modality/model.json`, `.modality/app.model.ts`, and extraction/check reports.

## Core Workflow

1. Initialize a project when no local workspace/config exists:

```bash
npx modality init
```

2. Extract a model. With discovered/colocated property files, the CLI can infer sources:

```bash
npx modality extract
```

Target sources explicitly when needed, and write the trust ledger report when judging
model precision:

```bash
npx modality extract src/App.tsx \
  --effect-api api.placeOrder \
  --report .modality/extraction-report.json
```

Useful extraction flags:

```bash
npx modality extract [source.tsx ...] \
  --out .modality/model.json \
  --app-model .modality/app.model.ts \
  --overlay modality.overlay.ts \
  --config modality.config.ts \
  --disable-plugin <id> \
  --effect-api api.placeOrder
```

3. Inspect the trust ledger before writing or trusting properties. Confirm:

- expected plugins/adapters activated and route coverage is sensible;
- key variables appear with usable domains;
- important handlers are not missing or only `unextractable`;
- async operations, pending bound `maxPending`, stale reads, unhandled rejections,
  over-approx/manual transitions, ignored vars, and bound-hit events are understood.

4. Write `*.props.mjs` files exporting serializable property objects. Prefer
`export function properties(model) { ... }` or `propertiesFor(model) { ... }` so
model-aware helpers can validate IDs and infer `reads`.

5. Check the model:

```bash
npx modality check
```

Default search limits are active. Override them deliberately:

```bash
npx modality check --max-states 50000 --max-edges 150000
npx modality check --no-search-limits
```

A search-limit hit is an `error` verdict, never verified. Use diagnostics
(`dominantVars`, slicing data, limit reason) to refine domains, bounds, or properties.

6. Replay violated traces when possible:

```bash
npx modality replay .modality/traces/noDoubleSubmit.violated.trace.json
npx modality replay .modality/traces/noDoubleSubmit.violated.trace.json \
  --mode action --harness test/replay-harness.ts
```

Replay verdicts mean:

- `reproduced`: real app behavior; fix the app and keep the generated test.
- `not-reproduced`: model divergence; inspect the diverging step provenance and refine
  extraction/overlay/modeling.
- `inconclusive`: harness, locator, provider, or timeout problem.

7. Use CI artifacts for automation:

```bash
npx modality ci .modality/model.json app.props.mjs --artifacts .modality
npx modality ci app.props.mjs --artifacts .modality
```

Gate hard on reproduced violations, stale model hashes, new severe trust-ledger caveats,
or conformance pass-rate drops. Treat not-reproduced violations as model-maintenance
signals until the model is stable enough to hard-fail them.

## Property Files

Predicates are data interpreted by the Rust checker. Do not put callback predicates in
property objects.

Accepted export shapes include:

```js
export const properties = [/* serializable properties */];
export default { schemaVersion: 1, properties: [/* serializable properties */] };
export function properties(model) { return [/* properties */]; }
export function propertiesFor(model) { return [/* properties */]; }
```

Import property and predicate helpers from `modality-ts/core`:

```js
import {
  always,
  alwaysStep,
  reachable,
  reachableFrom,
  leadsToWithin,
  andExpr,
  orExpr,
  notExpr,
  eq,
  neq,
  lit,
  readVar,
  readPreVar,
  readOpArg,
  enabled,
  stepAny,
  stepEnqueued,
  stepResolved,
  stepTransitionId,
} from "modality-ts/core";
```

Choose the property kind by intent:

- `always`: invariant over every reachable state.
- `alwaysStep`: edge/action invariant; prefer for "cannot trigger", enqueue/resolve,
  stale-response, and "must not clear/mutate on this transition" rules.
- `reachable`: sanity/vacuity witness that some useful state is reachable.
- `reachableFrom`: every state matching `when` can reach `goal`; counterexamples assert
  path absence and are not replayable by nature.
- `leadsToWithin`: bounded response after a trigger; set `budget` and use
  `allowUserEvents: true` only when adversarial user interference should count.

Model-aware helpers take `model` first and infer `reads` unless provided:

```js
export function properties(model) {
  return [
    always(
      model,
      orExpr(
        notExpr(eq(readVar("sys:route"), lit("/admin"))),
        eq(readVar("atom:sessionAtom"), lit("authenticated")),
      ),
      { name: "adminRequiresAuth" },
    ),
    alwaysStep(
      model,
      {
        negate: true,
        step: stepEnqueued("api.createTodo"),
        pre: eq(readVar("atom:authAtom"), lit("guest")),
      },
      { name: "guestCannotSubmit" },
    ),
    leadsToWithin(
      model,
      stepEnqueued("api.placeOrder"),
      orExpr(
        eq(readVar("local:App.order"), lit("success")),
        eq(readVar("local:App.order"), lit("error")),
      ),
      { name: "submitResolves", budget: { environment: 3 } },
    ),
  ];
}
```

Plain object properties are also valid. Declare `reads` explicitly when writing them by
hand, especially for useful slicing and focused diagnostics:

```js
export const properties = [
  {
    kind: "alwaysStep",
    name: "staleFailureDoesNotMutateStatus",
    reads: ["local:App.auth", "local:App.submitStatus", "sys:pending"],
    predicate: {
      negate: true,
      step: stepResolved("api.placeOrder", "error"),
      pre: eq(readVar("local:App.auth"), lit("guest")),
      post: neq(
        readVar("local:App.submitStatus"),
        readPreVar("local:App.submitStatus"),
      ),
    },
  },
];
```

Use `readVar("id", ["field", "nested"])` for nested records and string index segments
for bounded lists such as `readVar("sys:pending", ["0", "opId"])`. Use `readPreVar`
and `readOpArg` only inside step predicates/response properties where pre-state or
enqueue-time operation args exist.

Step predicates may use helper forms or flat metadata matchers such as
`transitionId`, `transitionClass`, `labelKind`, `enqueued`, `resolved`, `navigated`,
`navigatedTo`, `opId`, `continuation`, and `opArgs`. Composite step predicates are
`{ step, pre?, post?, negate? }`.

Verdicts include `verified-within-bounds`, `violated`, `reachable`,
`vacuous-warning`, and `error`. Investigate `vacuous-warning`; it is not a pass.

## Source And Variable Notes

Common variable IDs:

- `local:<Component>.<state>`: React `useState`, route-scoped and unmounted while
  outside its route.
- `atom:<name>` or `atom:<name>@store:<id>`: Jotai atoms.
- `store:<name>.<field>`: Zustand store fields; actions become write transitions.
- SWR cache/view variables derived from key classes, commonly data/error/validating
  projections; inspect the model for exact IDs.
- `sys:route`, `sys:history`, `sys:pending`, `sys:timer:*`, `sys:suspense:*`, and
  Next-specific `sys:next:slot:*` / `sys:next:phase:*`.

Supported sources and adapters:

- `useState`: exact finite domains from TypeScript where possible; functional updaters
  and React 18 batching are modeled.
- Jotai: primitive/derived/writable atoms, store scoping, hydration; default-store
  escape risks appear as global taints.
- Zustand: `create`/`createStore`, fields/actions, selectors, `set`/`get`, common
  middleware unwrapping, and many immer scalar/object mutations.
- SWR: trusted per-key cache template, data/error/validating states, revalidation,
  key windows, stale-data retention on failed revalidate.
- Router/Next: `sys:route` and bounded `sys:history`; Next takes priority when present
  and models App/Pages routes, layout/template/page mount scopes, route-tree vars, and
  server APIs as nondeterministic async effects.
- React features: effects become internal stabilization transitions; timers are env
  transitions; Suspense gates subtrees; transitions/deferred values are modeled at
  macro-step granularity.

Finite domains are essential. Literal unions, discriminated unions, boolean domains,
finite numeric aliases (`Bounded`, `Uint8`, etc.), and static schemas can be exact.
Unbounded strings/numbers default to tokens or caveats; refine them only when a property
needs sharper distinctions.

## Side Effects And Bounds

Name network/effect wrappers with repeated `--effect-api` flags or config. Async
handlers split into:

- a user transition for the synchronous prefix plus enqueue;
- environment resolve transitions for success/error outcomes;
- continuations guarded by outcome and pending operation identity.

The concurrency bound `maxPending`/`K` is load-bearing. Raise it when a property needs
multiple simultaneous requests, such as double-submit checks. Bound hits are recorded in
the trust ledger and qualify any verdict.

Continuations should reason about stale closures via `readOpArg` when values are captured
at enqueue. Stale-read caveats are reported; replay/conformance decides whether a
reported abstract failure is real app behavior.

## Overlays And Config

Use config for extraction shape and bounds: entry points/routes, plugins/adapters,
effect APIs, `maxDepth`, `maxPending`, `maxInternalSteps`, `maxHistory`, and replay
locator conventions.

Use overlays for additive, reviewable model refinements. Prefer overlays when:

- a `tokens` domain hides a property-relevant distinction;
- a handler is `unextractable`;
- the environment is too permissive;
- async outcome payloads/errors need classes;
- replay needs a missing locator;
- an irrelevant variable should be explicitly ignored.

Overlay examples:

```ts
import { overlay, enumOf, byTestId } from "modality-ts/core";

export default overlay(M)
  .transition("CheckoutPage.onRetry", {
    reads: ["local:CheckoutPage.order"],
    writes: ["local:CheckoutPage.order"],
    effect: (s) => ({
      ...s,
      "local:CheckoutPage.order": { kind: "submitting" },
    }),
  })
  .refineDomain("atom:cartTotal", enumOf("zero", "positive"), {
    witness: { zero: () => 0, positive: () => 42 },
  })
  .refinePayload("POST /api/quote", "total", {
    nonpositive: (t) => t <= 0,
    positive: (t) => t > 0,
  })
  .assume("POST /login", (o) => o.kind !== "success" || o.token !== null)
  .outcomes("POST /todos", { unauthorized: {}, server: {} })
  .locator("CheckoutPage.onRetry", byTestId("retry-btn"))
  .ignoreVar("local:DebugPanel.open");
```

Overlay entries override matching extracted entries. An entry matching nothing is drift
and should fail. Use `modality extract --explain-drift` after refactors.

## Failure Triage

Read the check report before changing code. For each failure, decide whether it is:

- a real product bug (`replay` reproduced);
- an overly broad model or domain abstraction;
- a missing/incorrect effect API declaration;
- an unextractable or over-approx transition that needs an overlay;
- an incorrect or vacuous property;
- a bound/search-limit issue;
- a harness/locator/provider problem.

For `violated`, open the shortest trace and inspect focused diffs over the property's
read set. For `leadsToWithin`, distinguish true non-convergence from a too-small budget.
For `reachableFrom`, use the witness state and nearest-miss/certificate rather than
expecting an action replay.

Trust-ledger caveats matter. A green run with new global taints, unsound-risk caveats,
stale model hashes, severe unextractables, or actual bound hits is not the same claim as
a clean `verified-within-bounds` run.

## Command Reference

```bash
npm i -D modality-ts
npx modality init
npx modality extract [source.tsx ...]
npx modality check [model.json] [props.mjs ...]
npx modality replay <trace.json>
npx modality conform --model .modality/model.json --count 8 --depth 4
npx modality export .modality/model.json --format tla --out .modality/model.tla
npx modality ci .modality/model.json [props.mjs] --artifacts .modality
```

Inside this repository, run validation commands through the project package manager:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
```
