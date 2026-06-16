---
id: property-api
title: Property API
sidebar_label: Property API
---

Helpers exported from `modality-ts/core` (and `modality-ts/core/props`) for building
[properties](../concepts/properties.md). Predicates are serializable data; the
[Rust checker](../architecture/checker.md) interprets them.

## Combinators

Each takes the `model` first (so it can infer the `reads` set and validate variable IDs)
and returns a `Property` object.

| Helper | Signature | Kind |
| --- | --- | --- |
| `always` | `(model, predicate, options?)` | `G p` — state invariant |
| `alwaysStep` | `(model, stepPredicate, options?)` | action invariant over edges |
| `reachable` | `(model, predicate, options?)` | `EF p` — existential witness |
| `reachableFrom` | `(model, when, goal, options?)` | `AG(when → EF goal)` |
| `leadsToWithin` | `(model, trigger, goal, options & { budget, allowUserEvents? })` | bounded response |

`options` is `{ name?, reads?, enabledTransitions?, includeUnmounted? }`. The `budget` is
`{ steps?, environment? }`. If `reads` is omitted it is inferred from the predicate.

## Expression helpers

State predicates are `ExprIR` trees:

| Helper | Builds |
| --- | --- |
| `readVar(id, path?)` | read a model variable |
| `readPreVar(id, path?)` | read the macro-step pre-state snapshot (batching) |
| `readOpArg(key)` | read an enqueue-time snapshot from a pending op |
| `lit(value)` | a literal |
| `eq(a, b)` / `neq(a, b)` | equality / inequality |
| `andExpr(...)` / `orExpr(...)` / `notExpr(x)` | boolean composition |
| `enabled(model, transitionId)` | the [enabledness](../concepts/properties.md) accessor |

The numeric comparisons (`lt`, `lte`, `gt`, `gte`) and arithmetic (`add`, `sub`, `mod`)
are available as `ExprIR` node kinds for [finite numeric domains](./domains.md).

## Step predicate helpers

For `alwaysStep` and as `leadsToWithin` triggers:

| Helper | Matches |
| --- | --- |
| `stepEnqueued(op)` | an edge that enqueues `op` |
| `stepResolved(op, outcome?)` | an edge resolving `op` (optionally to a specific outcome) |
| `stepTransitionId(id)` | a specific transition |
| `stepAny()` | any edge |

A full step predicate may be composite: `{ step, pre?, post?, negate? }` — `pre`/`post`
are `ExprIR` over the edge endpoints, and `negate` flips the match. On enqueue/resolve
edges, `StepFacts` also exposes the operation's `args` snapshot.

## Example file

```js
import {
  always, alwaysStep, leadsToWithin,
  andExpr, orExpr, notExpr, eq, lit, readVar, stepEnqueued,
} from "modality-ts/core";

export function properties() {
  return [
    {
      kind: "always",
      name: "adminRequiresAuth",
      reads: ["sys:route", "atom:sessionAtom"],
      predicate: orExpr(
        notExpr(eq(readVar("sys:route"), lit("/admin"))),
        eq(readVar("atom:sessionAtom"), lit("authenticated")),
      ),
    },
    {
      kind: "alwaysStep",
      name: "guestCannotSubmit",
      reads: ["atom:authAtom"],
      predicate: {
        negate: true,
        step: stepEnqueued("api.createTodo"),
        pre: eq(readVar("atom:authAtom"), lit("guest")),
      },
    },
    {
      kind: "leadsToWithin",
      name: "submitResolves",
      trigger: stepEnqueued("api.placeOrder"),
      goal: orExpr(
        eq(readVar("local:App.order"), lit("success")),
        eq(readVar("local:App.order"), lit("error")),
      ),
      budget: { environment: 3 },
    },
  ];
}
```

See the [writing-properties guide](../guides/writing-properties.md) for patterns.
