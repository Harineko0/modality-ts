---
id: property-api
title: Property API
sidebar_label: Property API
---

Helpers exported from `modality-ts/properties` for building
[properties](../concepts/properties.md). Predicates are serializable data; the
[Rust checker](../architecture/checker.md) interprets them.

Property builders register specs at module load time. The CLI loader imports the props
file, harvests the registered specs, and finalizes them against the extracted `Model`
(inferring `reads` and `enabledTransitions`).

## Combinators

Each builder registers a property when the module is evaluated. Pass `reads` or
`enabledTransitions` in the optional trailing `options` object to override inference.

| Helper | Signature | Kind |
| --- | --- | --- |
| `always` | `(name, predicate, options?)` | `G p` — state invariant |
| `alwaysStep` | `(name, stepPredicate, options?)` | action invariant over edges |
| `reachable` | `(name, predicate, options?)` | `EF p` — existential witness |
| `reachableFrom` | `(when, goal, options?)` | `AG(when → EF goal)` — `name` in options |
| `leadsToWithin` | `(trigger, goal, options & { budget, allowUserEvents? })` | bounded response — `name` in options |
| `group` | `(prefix, fn)` | prefixes registered property names |

`options` is `{ name?, reads?, enabledTransitions?, includeUnmounted? }`. The `budget` is
`{ steps?, environment? }`. `includeUnmounted` keeps mount-local variables in the read set
even when their owning component is unmounted.

## Expression helpers

State predicates are `ExprIR` trees. Operands accept a `VarHandle`, an `ExprIR`, or a plain
`Value` literal — primitives are lifted to literals automatically, so there is no `lit(...)`
wrapper. Reference state through handles, never by raw id in a wrapper call:

- **Module-scoped state** (atoms, stores, signals, context, consts): `import { sessionAtom }
  from "./store"` and use it directly. The loader resolves the imported symbol to its model
  variable, so IDE renames stay in sync.
- **`useState` locals**: import generated handles from sibling `*.vars` modules, such
  as `./App.vars`.
- **Stable system vars**: import `{ pending, route, history }` from `modality-ts/vars`.
- **Other synthesized vars** (`swr:*`, parameterized `sys:*`) or a bare id: the `var`
  export, usually imported with an alias because `var` is a reserved local binding
  (`import { var as stateVar } from "modality-ts/properties"`).

| Helper | Builds |
| --- | --- |
| `var(id, domain?, path?)` | a handle for a variable id without an importable symbol |
| `handle.at(...segments)` | extend a handle with nested record/list path segments |
| `pre(handle)` | read the macro-step pre-state snapshot of a variable (batching) |
| `readOpArg(key)` | read an enqueue-time snapshot from a pending op |
| `eq(a, b)` / `neq(a, b)` | equality / inequality |
| `and(...)` / `or(...)` / `not(x)` | boolean composition |
| `lessThan` / `lessThanOrEqual` / `greaterThan` / `greaterThanOrEqual` | numeric comparisons |
| `add` / `sub` / `mod` | numeric arithmetic |
| `enabled(transitionId)` | the [enabledness](../concepts/properties.md) accessor (exact id) |
| `enabledTransitionPrefix(prefix)` | true when some enabled transition id starts with `prefix` |
| `s(component, idOverride?)` | quick untyped handles for `useState` locals (`s({ name: "App" }).step`) |

Generated component modules are real TypeScript files written beside the source file,
for example `app/home/home.tsx` produces `app/home/home.vars.ts`. The CLI rewrites
each imported handle to `var("local:<Component>.<state>")` and strips the import
at check time.

## Numeric expressions

[Finite numeric domains](./domains.md) (`boundedInt`, `intSet`, and branded aliases such as
`Uint8`) can be compared and combined with the numeric helpers above. Every operand is coerced
to an integer first; a non-integer operand (or division by zero for `mod`) makes comparisons
fall back to `false` and leaves arithmetic undefined at evaluation time.

Arithmetic here is unbounded — the variable's [`overflow` policy](./domains.md#numeric-overflow-policy)
only governs assignments back into a finite domain, not intermediate predicate math.

```ts
import { always, not, lessThan, add } from "modality-ts/properties";
import { capacity, count } from "./Cart.vars";

always("withinCapacity", not(lessThan(capacity, add(count, 1))));
```

## Step predicate helpers

For `alwaysStep` and as `leadsToWithin` triggers:

| Helper | Matches |
| --- | --- |
| `stepEnqueued(op)` | an edge that enqueues `op` |
| `stepResolved(op, outcome?)` | an edge resolving `op` (optionally to a specific outcome) |
| `stepTransitionId(id)` | a specific transition |
| `stepAny()` | any edge |

Each helper returns a flat step matcher (`StepPredicateFlat`). A full step predicate may be
composite: `{ step, pre?, post?, negate? }` — `pre`/`post` are `ExprIR` over the edge
endpoints, and `negate` flips the match. On enqueue/resolve edges, read enqueue-time `args`
from within `pre`/`post` using `readOpArg(key)`.

For focused handler postconditions, prefer `negate: true` with a bad `post` on
`stepTransitionId(id)` rather than `{ step: stepTransitionId(id), post: goodCondition }`.

## Example file

```ts
import {
  always,
  alwaysStep,
  leadsToWithin,
  or,
  not,
  eq,
  stepEnqueued,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { sessionAtom, authAtom } from "./store";
import { step } from "./App.vars";

always(
  "adminRequiresAuth",
  or(not(eq(route, "/admin")), eq(sessionAtom, "authenticated")),
);

alwaysStep("guestCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(authAtom, "guest"),
});

leadsToWithin(stepEnqueued("api.placeOrder"), or(eq(step, "success"), eq(step, "error")), {
  name: "submitResolves",
  budget: { environment: 3 },
});
```

See the [writing-properties guide](../guides/writing-properties.md) for patterns.
