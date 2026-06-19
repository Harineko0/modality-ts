---
id: properties
title: Properties
sidebar_label: Properties
---

Properties say what must hold across the explored graph. `modality-ts` deliberately
does **not** expose raw LTL/CTL. Instead it offers a small, **closed** set of
combinators whose predicates are built from IR expressions. The design principle:
*usability at the surface, standard modal logic underneath.*

## Why a closed combinator set

- Frontend developers are the audience; `G (admin → auth)` vs `AG` vs `U`-operator
  precedence is a wall, and LTL formulas cannot be type-checked against app state.
- Standard notation does **not** prevent *mis*-formalization. `G(guest → ¬pending)` is
  perfectly standard LTL and is exactly the *wrong* encoding of "a guest cannot
  *trigger* a submit" — logging out while a request is in flight legally yields
  `guest ∧ pending`. What prevents the mistake is a combinator shaped like the intent
  (`alwaysStep` + `step.enqueued`).
- The set is closed so verdicts stay falsifiable and exportable: every combinator has
  **normative formal semantics**, and the TLA+ export and differential tests are checked
  against those definitions, not against the implementation.

Missing expressiveness is met by adding *one* well-defined combinator — never by opening
the surface to raw temporal logic.

## The combinators and their semantics

Over the stabilized LTS `M = (S, S₀, A, →)`:

| Combinator | Normative meaning |
| --- | --- |
| `always(p)` | `G p` — `p` holds in every reachable (stabilized) state. |
| `alwaysStep(q)` | action invariant: `q(s, t, s′)` holds for **every reachable edge** `s —t→ s′` (the TLA `□[A]` tradition). |
| `reachable(p)` | existential witness `EF p`; exhaustion without a witness is a **vacuity warning**, not a pass. |
| `reachableFrom(when, goal)` | `AG(when → EF goal)` — from every `when`-state some path (with a cooperative environment) reaches `goal`. Checked by backward reachability. |
| `leadsToWithin(trigger, goal, k)` | bounded response: from every edge satisfying `trigger`, **all** scheduler-admitted continuations reach `goal` within budget `k`. |
| `enabled(t)` | state predicate: `guard_t(s) ∧ mounted_t(s)` — exact, since guards are structured IR. |

## Building predicates

State predicates are `ExprIR` trees, built with helpers from `modality-ts/properties`:

```ts
import { always, or, not, eq } from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { sessionAtom } from "./store";

// "while on /admin, the session must be authenticated"
always(
  "authGuard",
  or(not(eq(route, "/admin")), eq(sessionAtom, "authenticated")),
);
```

Reference state with handles: import module-scoped atoms/stores directly, import generated
`useState` locals from `./.modality/vars/<Component>`, import stable system handles from
`modality-ts/vars`, or use `varHandle(id)` (plus `handle.at(...path)`) for synthesized ids
such as `swr:*` and parameterized `sys:*`. Other helpers: `pre(handle)` / `readOpArg(key)`,
`eq` / `neq`, `and` / `or` / `not`, numeric comparisons and arithmetic, and
`enabled(transitionId)`. See the
[property API reference](../reference/property-api.md).

## Step properties: constraining actions, not states

Use `alwaysStep` when the English rule is about a *transition* ("cannot trigger", "must
not clear"). The step predicate exposes IR-level facts about the executed edge:

```ts
import { alwaysStep, eq, stepEnqueued } from "modality-ts/properties";
import { authAtom } from "./store";

// "a guest must never enqueue api.createTodo"
alwaysStep("guestCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(authAtom, "guest"),
});
```

`stepEnqueued(op)`, `stepResolved(op, outcome?)`, `stepTransitionId(id)`, and `stepAny()`
build the `step` matcher; `pre`/`post` are `ExprIR` over the edge's endpoints; `negate`
flips the match. On enqueue/resolve edges the pending operation's **argument snapshot**
(`op.args`) is available — this is how snapshot-staleness properties are written without
temporal operators (e.g. "an order success whose `args.userId` differs from the current
user must not advance the flow").

Step properties are evaluated on **every edge**, including edges into already-visited
states — a violating edge between two known-good states is still caught.

## Bounded response (`leadsToWithin`)

```ts
import { leadsToWithin, or, eq, stepEnqueued } from "modality-ts/properties";
import { order } from "./.modality/vars/App";

leadsToWithin(
  stepEnqueued("api.placeOrder"),
  or(eq(order, "success"), eq(order, "error")),
  { name: "submitResolves", budget: { environment: 3 } },
);
```

`budget` counts macro-steps by class. By default, after the trigger fires only
`env`/`library`/`internal` steps are considered — the property asks "does the app *by
itself* settle?". Set `allowUserEvents: true` to admit adversarial user interference
(rarely what you want — random clicks trivially falsify most response properties). A
deadlock (no enabled steps, goal unmet) is a violation: it catches forgotten
continuations such as unhandled rejection paths.

This replaces unbounded liveness + fairness for now, deliberately: it is easier to
implement correctly, needs no fairness annotations, and produces *finite, replayable*
counterexamples. The cost — a true-but-slow convergence reports as a violation — makes
the repair (raise the budget) obvious.

## Vacuity is always checked

An over-constrained model "verifies" everything, so a built-in vacuity suite runs every
time: transitions never enabled, enum values never inhabited, `leadsToWithin` triggers
that never fire. `reachable` used as a premise that is never witnessed reports as a
warning, not a pass.

The [reference](../reference/property-api.md) lists every helper; the
[writing-properties guide](../guides/writing-properties.md) shows patterns end to end.
