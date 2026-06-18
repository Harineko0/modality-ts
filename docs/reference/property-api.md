---
id: property-api
title: Property API
sidebar_label: Property API
---

Helpers exported from `modality-ts/core` (and `modality-ts/core/props`) for building
[properties](../concepts/properties.md). Predicates are serializable data; the
[Rust checker](../architecture/checker.md) interprets them.

## Combinators

Each takes the `model` first and returns a `Property` object. The `model` lets the
combinator infer two fields from the predicate: `reads` (the variables the predicate
touches) and `enabledTransitions` (any transitions referenced through `enabled()` /
`enabledTransitionPrefix()`). Pass either option explicitly to override the inference.

| Helper | Signature | Kind |
| --- | --- | --- |
| `always` | `(model, predicate, options?)` | `G p` — state invariant |
| `alwaysStep` | `(model, stepPredicate, options?)` | action invariant over edges |
| `reachable` | `(model, predicate, options?)` | `EF p` — existential witness |
| `reachableFrom` | `(model, when, goal, options?)` | `AG(when → EF goal)` |
| `leadsToWithin` | `(model, trigger, goal, options & { budget, allowUserEvents? })` | bounded response |

`options` is `{ name?, reads?, enabledTransitions?, includeUnmounted? }`. The `budget` is
`{ steps?, environment? }`. When `name` is omitted it defaults to the combinator kind
(`"always"`, `"alwaysStep"`, etc.). `includeUnmounted` keeps mount-local variables in the
read set even when their owning component is unmounted.

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
| `enabled(model, transitionId)` | the [enabledness](../concepts/properties.md) accessor (exact id) |
| `enabledTransitionPrefix(model, prefix)` | true when some enabled transition id starts with `prefix` |

## Numeric expressions

[Finite numeric domains](./domains.md) (`boundedInt`, `intSet`, and the branded aliases
such as `Uint8`) can be compared and combined with arithmetic. These nodes have **no
helper functions** — write the `ExprIR` object directly. Every operand is coerced to an
integer first; a non-integer operand (or division by zero) makes the node fall back as
noted below.

Comparisons build a boolean `ExprIR` (use them like `eq`):

| Node | Means | When an operand is not an integer |
| --- | --- | --- |
| `{ kind: "lt", args: [a, b] }` | `a < b` | the comparison is `false` |
| `{ kind: "lte", args: [a, b] }` | `a ≤ b` | the comparison is `false` |
| `{ kind: "gt", args: [a, b] }` | `a > b` | the comparison is `false` |
| `{ kind: "gte", args: [a, b] }` | `a ≥ b` | the comparison is `false` |

Arithmetic builds an integer `ExprIR` to nest inside a comparison:

| Node | Means | Notes |
| --- | --- | --- |
| `{ kind: "add", args: [a, b] }` | `a + b` | |
| `{ kind: "sub", args: [a, b] }` | `a − b` | |
| `{ kind: "mod", args: [a, b] }` | `a mod b` | floored — the result has the sign of `b`, so it is non-negative for a positive `b`; `b = 0` is undefined |

Arithmetic here is unbounded — the variable's [`overflow` policy](./domains.md#numeric-overflow-policy)
(`forbid` / `wrap` / `saturate`) only governs what happens when a value is *assigned back*
into a finite domain, not intermediate predicate math.

```ts
// "count never exceeds capacity, even after one more increment"
always(
  model,
  notExpr({
    kind: "lt",
    args: [readVar("local:Cart.capacity"), { kind: "add", args: [readVar("local:Cart.count"), lit(1)] }],
  }),
  { name: "withinCapacity" },
);
```

## Step predicate helpers

For `alwaysStep` and as `leadsToWithin` triggers:

| Helper | Matches |
| --- | --- |
| `stepEnqueued(op)` | an edge that enqueues `op` |
| `stepResolved(op, outcome?)` | an edge resolving `op` (optionally to a specific outcome) |
| `stepTransitionId(id)` | a specific transition |
| `stepAny()` | any edge |

Each helper returns a flat step matcher (`StepPredicateFlat`). Beyond the helpers above,
a flat matcher object accepts more fields directly — there is no dedicated helper, so
write the object literal:

| Field | Matches |
| --- | --- |
| `transitionClass` | edges whose transition class is one of `user`, `nav`, `env`, `internal`, `library` |
| `labelKind` | edges whose event label kind matches (e.g. `click`, `submit`, `input`, `navigate`, `resolve`) |
| `changed` | any edge that assigns the given var |
| `changedTo` | an edge that assigns the var to a specific value |
| `opId` | an edge whose pending op has this id |
| `continuation` | an edge resolving to a specific continuation |
| `opArgs` | an edge whose op `args` snapshot matches these values |

A full step predicate may be composite: `{ step, pre?, post?, negate? }` — `pre`/`post`
are `ExprIR` over the edge endpoints, and `negate` flips the match. On enqueue/resolve
edges, read the operation's enqueue-time `args` snapshot from within `pre`/`post` using
`readOpArg(key)`.

For focused handler postconditions, prefer `negate: true` with a bad `post` on
`stepTransitionId(id)` rather than `{ step: stepTransitionId(id), post: goodCondition }`:
the latter is checked on every explored edge, not as an implication over the target edge
only. When slicing is enabled, a negated bad-step property with syntactic
`stepTransitionId(...)` in the step matcher (not `enabledTransitions` alone) may use
targeted edge slicing.

## Example file

```ts
import {
  always, alwaysStep, leadsToWithin,
  andExpr, orExpr, notExpr, eq, lit, readVar, stepEnqueued,
} from "modality-ts/core";
import type { PropertyFactory } from "modality-ts/core";

export const properties: PropertyFactory = (_model) => [
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
```

See the [writing-properties guide](../guides/writing-properties.md) for patterns.
