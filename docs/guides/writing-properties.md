---
id: writing-properties
title: Writing properties
sidebar_label: Writing properties
---

Properties live in a file such as `app.props.ts` beside the component. Import builders from
`modality-ts/properties` and call them at module top level — each call registers a spec that
the CLI loader harvests and finalizes against the extracted model. Predicates are built from
[combinators](../concepts/properties.md); they are serializable data, evaluated by the
[Rust checker](../architecture/checker.md), not arbitrary functions.

```ts
import {
  always,
  alwaysStep,
  leadsToWithin,
  reachable,
  reachableFrom,
  and,
  or,
  not,
  eq,
  neq,
  enabled,
  stepEnqueued,
  stepResolved,
} from "modality-ts/properties";
import { auth, step } from "./App.vars";

always(
  "checkoutOnlySucceedsForUsers",
  or(not(eq(step, "success")), eq(auth, "user")),
);
```

Use `group("prefix", () => { ... })` to namespace property names.

## Choosing the right combinator

```mermaid
flowchart TD
  q1{"is the rule about a STATE<br/>or about an ACTION?"}
  q1 -->|state| q2{"must always hold,<br/>or just be possible?"}
  q1 -->|action| step["alwaysStep<br/>(constrains edges)"]
  q2 -->|always| always["always<br/>(safety invariant)"]
  q2 -->|possible| q3{"from a given state,<br/>or anywhere?"}
  q3 -->|anywhere| reach["reachable<br/>(sanity / vacuity)"]
  q3 -->|from a state| rf["reachableFrom<br/>(conditional reachability)"]
  q4{"must something HAPPEN<br/>within k steps after a trigger?"}
  q4 -->|yes| ltw["leadsToWithin<br/>(bounded response)"]
```

## Pattern: state invariant (`always`)

"While on `/admin`, the session must be authenticated."

```ts
import { route } from "modality-ts/vars";
import { sessionAtom } from "./store";

always(
  "adminRequiresAuth",
  or(not(eq(route, "/admin")), eq(sessionAtom, "authenticated")),
);
```

## Pattern: action invariant (`alwaysStep`)

Prefer `alwaysStep` whenever the English says "cannot trigger" / "must not clear". The
state-invariant version is often *reachably wrong*: a guest who logs out while a request
is in flight legally produces `guest ∧ pending`.

```ts
import { authAtom } from "./store";

alwaysStep("guestCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(authAtom, "guest"),
});
```

The `step` matcher exposes `stepEnqueued(op)`, `stepResolved(op, outcome?)`,
`stepTransitionId(id)`, and `stepAny()`. On enqueue/resolve edges you can also read the
operation's argument snapshot (`opArgs`) to write **snapshot-staleness** rules without
temporal operators.

For focused postconditions on one handler, prefer a **negated bad-step** pattern:

```ts
alwaysStep(
  "submitDoesNotLeaveDraftDirty",
  {
    negate: true,
    step: stepTransitionId("Component.onSubmit"),
    post: /* bad post-state condition */,
  },
  { enabledTransitions: ["Component.onSubmit"] },
);
```

## Pattern: bounded response (`leadsToWithin`)

"After submitting, the order must settle to success or error within 3 environment steps."

```ts
import { order } from "./App.vars";

leadsToWithin(
  stepEnqueued("api.placeOrder"),
  or(eq(order, "success"), eq(order, "error")),
  { name: "submitResolves", budget: { environment: 3 } },
);
```

By default only environment/library/internal steps count toward the goal. Set
`allowUserEvents: true` only when you genuinely want adversarial user interference.

## Pattern: conditional reachability (`reachableFrom`)

"From any state with a valid payment method, the review step remains reachable."

```ts
import { payment, step } from "./App.vars";

reachableFrom(
  eq(payment, "valid"),
  eq(step, "review"),
  { name: "reviewStaysReachable" },
);
```

Counterexamples for `reachableFrom` are non-replayable by nature (they assert path
*absence*) — the report shows a trace to the witness `when`-state plus an exhausted-search
certificate.

## Pattern: enabledness (`enabled`)

"Logout must remain possible in every error state." `enabled(transitionId)` is exact because
guards are structured IR.

```ts
import { enabled } from "modality-ts/properties";
import { order } from "./App.vars";

always(
  "logoutAvailableOnError",
  or(not(eq(order, "error")), enabled("Header.logout")),
);
```

## The `reads` list

Each property may declare a `reads` array in the trailing options object. The loader infers
it from the predicate automatically, but declaring it explicitly is recommended for clarity
and for [slicing](../concepts/state-space-control.md). An `enabled(t)` reference
automatically pulls in `t`'s guard read-set and the route variable. When extraction
disambiguates duplicate handler ids with stable hash suffixes, use
`enabledTransitionPrefix(baseId)` instead of relying on the unsuffixed base id.

## Component state handles

Extraction emits one sibling handle module for each source file with `useState` locals.
Import `useState` locals from the generated `*.vars` module:

```ts
import { step } from "./App.vars";

always("guestCannotReachSuccess", not(and(eq(auth, "guest"), eq(step, "success"))));
```

For example, `app/home/home.tsx` produces `app/home/home.vars.ts`. The CLI loader
rewrites and strips generated handle imports at check time.

Imported atoms and stores resolve through symbol rewriting when their declaration anchors
appear in `model.metadata.varAnchors`; otherwise use the `var` export directly, usually
with an alias such as `import { var as stateVar } from "modality-ts/properties"`.
Use `stateVar("swr:...")` or `stateVar("sys:timer:...")` for synthesized ids that do
not have a stable importable handle.

## Naming and verdicts

Give every property a stable `name` — it is the key for trace filenames, report verdicts,
and CI gating. Verdicts are `verified-within-bounds`, `violated`, `reachable`,
`vacuous-warning`, or `error`. A `vacuous-warning` (e.g. a `reachable` premise never
witnessed, or a `leadsToWithin` trigger that never fires) is **not** a pass — investigate
it, because an over-constrained model "verifies" everything.
