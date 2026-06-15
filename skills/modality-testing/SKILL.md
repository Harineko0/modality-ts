---
name: modality-testing
description: Guide use of modality-ts for model-checking React and TypeScript state-transition behavior. Use when Codex needs to extract a finite model from React code, write or refine property files, run the modality CLI, inspect reports and counterexample traces, replay failures, configure CI artifacts, or decide whether a stateful UI workflow is a good fit for bounded model checking.
---

# Modality Testing

## Overview

Use modality-ts to verify bounded, deterministic React state transitions. Focus on app behavior represented in TypeScript state, router state, cache/source state, and named side effects; keep DOM layout, CSS, animation timing, browser quirks, and unbounded external systems covered by ordinary unit, integration, or end-to-end tests.

The built-in extraction pipeline can model React local state plus supported source plugins such as Jotai, SWR, and router state. When the target imports local modules, extraction follows relative TypeScript imports so atom definitions, SWR payload aliases, and helper handlers can contribute domains and transitions. Treat the generated model as the source of truth for exact variable IDs before writing properties.

The checker is Rust-backed and evaluates serializable property IR. `*.props.mjs` files may use JavaScript helper functions to build IR objects, but property predicates themselves must be plain JSON-like objects, not callbacks. Old predicates such as `predicate: (state) => ...` are rejected with a migration error.

## Workflow

1. Pick target components whose important behavior is finite enough to model.
2. Initialize the project when no Modality config exists:

```bash
modality init
```

3. Create `*.props.mjs` files next to target components when you want default source inference. `src/App.props.mjs` maps to `src/App.tsx`; multiple props files map to multiple sources.
4. Extract a model. With colocated props files, let the CLI infer sources and write `.modality/model.json` plus `.modality/app.model.ts`:

```bash
modality extract
```

Use explicit sources when inference is not desired:

```bash
modality extract src/App.tsx src/HomePage.tsx
```

5. Name modeled side-effect APIs when user flows depend on them:

```bash
modality extract --effect-api api.placeOrder
```

6. Inspect the extraction summary and report. Confirm that expected plugins are present, important handlers are not listed as unextractable, and key variables such as auth atoms, SWR data, route state, and `sys:pending` appear in the model.
7. Write property files that export serializable property objects. Prefer explicit `reads` for slicing and diagnostics, especially for hand-written object properties.
8. Check the model. With default paths, `modality check` reads `.modality/model.json`, loads all discovered `*.props.mjs`, and writes `.modality/report.json`, `.modality/traces`, `.modality/replay-tests`, and `.modality/action-replay-tests`:

```bash
modality check
```

9. Replay a failing counterexample when a property is violated. The trace path remains mandatory:

```bash
modality replay .modality/traces/noDoubleSubmit.violated.trace.json
```

10. Prefer CI artifacts when automating verification:

```bash
modality ci .modality/model.json src/app.props.mjs --artifacts .modality
```

## Property Patterns

Use `always` for invariants over every reachable state. Use `alwaysStep` for transition-sensitive rules, especially side-effect enqueue/resolve behavior. Use `reachable` or `reachableFrom` when the expected behavior is that a useful state can be reached. Use `leadsToWithin` for bounded response properties after a step trigger.

Import predicate IR helpers from `modality-ts/core`. Common helpers are `readVar`, `readPreVar`, `readOpArg`, `lit`, `eq`, `neq`, `andExpr`, `orExpr`, `notExpr`, `enabled`, `stepEnqueued`, `stepResolved`, `stepTransitionId`, and `stepAny`.

Accepted `*.props.mjs` export shapes:

```js
export const properties = [/* serializable properties */];

export default { schemaVersion: 1, properties: [/* serializable properties */] };

export function properties(model) {
  return [/* serializable properties, optionally built from model */];
}

export function propertiesFor(model) {
  return [/* serializable properties, optionally built from model */];
}
```

Do not put executable predicates inside property objects. This is invalid:

```js
export const properties = [
  { kind: "always", name: "legacy", predicate: (state) => !state.flag },
];
```

Build predicate IR instead:

```js
import {
  andExpr,
  eq,
  lit,
  neq,
  notExpr,
  orExpr,
  readOpArg,
  readPreVar,
  readVar,
  stepAny,
  stepEnqueued,
  stepResolved,
} from "modality-ts/core";

function atMostOnePendingOp(opId) {
  return andExpr(
    orExpr(
      neq(readVar("sys:pending", ["0", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["1", "opId"]), lit(opId)),
    ),
    orExpr(
      neq(readVar("sys:pending", ["0", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["2", "opId"]), lit(opId)),
    ),
    orExpr(
      neq(readVar("sys:pending", ["1", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["2", "opId"]), lit(opId)),
    ),
  );
}

export const properties = [
  {
    kind: "always",
    name: "noDoubleSubmit",
    reads: ["sys:pending"],
    predicate: atMostOnePendingOp("api.placeOrder"),
  },
  {
    kind: "alwaysStep",
    name: "guestCannotSubmit",
    reads: ["atom:authAtom", "sys:pending"],
    predicate: {
      negate: true,
      step: stepEnqueued("api.placeOrder"),
      pre: eq(readVar("atom:authAtom"), lit("guest")),
    },
  },
  {
    kind: "alwaysStep",
    name: "successMatchesUser",
    reads: ["local:App.auth", "local:App.userId", "local:App.step", "sys:pending"],
    predicate: {
      negate: true,
      step: stepResolved("api.placeOrder", "success"),
      post: andExpr(
        eq(readVar("local:App.step"), lit("success")),
        notExpr(
          andExpr(
            eq(readVar("local:App.auth"), lit("user")),
            eq(readOpArg("userId"), readVar("local:App.userId")),
          ),
        ),
      ),
    },
  },
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
  {
    kind: "alwaysStep",
    name: "invalidQuoteCannotEnterBilling",
    reads: ["local:App.quoteStatus", "local:App.step"],
    predicate: {
      negate: true,
      step: stepAny(),
      pre: eq(readVar("local:App.quoteStatus"), lit("invalid")),
      post: eq(readVar("local:App.step"), lit("billing")),
    },
  },
  {
    kind: "reachableFrom",
    name: "reviewCanReachSuccess",
    reads: ["local:App.auth", "local:App.step", "local:App.submitStatus"],
    when: andExpr(
      eq(readVar("local:App.auth"), lit("user")),
      eq(readVar("local:App.step"), lit("review")),
      eq(readVar("local:App.submitStatus"), lit("idle")),
    ),
    goal: eq(readVar("local:App.step"), lit("success")),
  },
];
```

For properties built through the model-aware builders `always(model, predicate, options)`, `alwaysStep(model, predicate, options)`, `reachable(model, predicate, options)`, `reachableFrom(model, when, goal, options)`, and `leadsToWithin(model, trigger, goal, options)`, reads can be inferred by walking IR. For direct object properties, declare `reads` explicitly when the property touches model variables. Use state keys as they appear in the extracted model, commonly `local:<Component>.<stateName>`, `sys:pending`, `sys:route`, `atom:<atomName>`, and SWR cache entries such as `swr:<key>:data`, `swr:<key>:error`, or `swr:<key>:isValidating`.

`readVar("id", ["field", "nested"])` reads nested record fields. For bounded lists such as `sys:pending`, use string path segments for indices, for example `readVar("sys:pending", ["0", "opId"])`. Use `readPreVar` and `readOpArg` only inside step predicates such as `alwaysStep` or `leadsToWithin`; ordinary state predicates for `always`, `reachable`, and `reachableFrom` are evaluated over one state.

Flat step predicates can match transition metadata: `{ transitionId: "App.onSubmit" }`, `{ transitionClass: "user" }`, `{ labelKind: "click" }`, `{ enqueued: "api.placeOrder" }`, `{ resolved: ["api.placeOrder", "success"] }`, `{ navigated: true }`, `{ navigatedTo: "/checkout" }`, `{ opId: "api.placeOrder" }`, `{ continuation: "success" }`, or `{ opArgs: { userId: "tok1" } }`. Composite step predicates add optional `pre`, required `step`, optional `post`, and optional `negate`.

For Jotai, prefer properties over the atom variable, for example `atom:authAtom`, and use the extracted tagged-union shape when the atom type is a discriminated union. For SWR, read the extracted data variable and nested payload fields through IR when the payload type is finite, for example `readVar("swr:event_snapshot_userId:data", ["application", "applied"])`. If the exact SWR key ID is not obvious, inspect `.modality/model.json` or the generated app model before writing the property.

## Failure Triage

When a check fails, inspect the report first, then open the trace for the shortest counterexample. Decide whether the result reveals a real bug, an overly broad model, a missing side-effect API, an incorrect property, or behavior that should be bounded differently.

Use replay to confirm the failure sequence. If the model diverges from the intended app behavior, update the extraction target, side-effect declarations, finite domains, or property file before treating the result as a product bug.

Extraction caveats matter. An `Unextractable handler` means the flow is not represented directly and may need a simpler handler shape, a supported helper pattern, or an overlay. An `over-approx` transition is useful for bug finding but is not a precise proof; inspect havoc writes and refine code, domains, or overlays when a property needs proof-level confidence. If a modeled side effect has lifecycle behavior that is not in the model, such as aborting or clearing pending requests, encode that behavior with an overlay or keep the property scoped to the modeled semantics.

## Command Reference

```bash
npm i -D modality-ts
npx modality init
npx modality extract [source.tsx ...]
npx modality check [model.json] [props.mjs ...]
npx modality replay <trace.json>
npx modality conform --count 8 --depth 4
npx modality export
npx modality ci <model.json> [props.mjs] --artifacts .modality
```
