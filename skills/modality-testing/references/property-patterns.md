# Property Patterns

Use this reference before writing or repairing `*.props.ts` files.

## Imports And Handles

Properties are top-level registrations:

```ts
import {
  always,
  alwaysStep,
  and,
  eq,
  not,
  or,
  stepEnqueued,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { App } from "./App.modals";

always(
  "checkoutOnlySucceedsForUsers",
  or(not(eq(App.step, "success")), eq(App.auth, "user")),
);
```

Handle rules:

- Import local `useState` values and transition refs from generated sibling
  `*.modals.ts` modules through component objects, for example `App.step` or
  `App.onClick.save`.
- Import module-scoped atoms/stores directly from their defining module when the model
  records a `varAnchors` symbol. The loader rewrites imported symbols to model vars.
- Import `route`, `history`, and `pending` from `modality-ts/vars`.
- Use `variable(id)` from `modality-ts/properties` for synthesized IDs such as `swr:*`,
  parameterized `sys:*`, or a bare ID with no importable handle.
- Use `handle.at("field", "nested")` for records and string index segments such as
  `pending.at("0", "opId")`.

## Choosing A Combinator

- `always(name, predicate)`: state invariant over every reachable stabilized state.
- `alwaysStep(name, stepPredicate)`: edge/action invariant over every reachable edge.
  Use for "cannot trigger", enqueue/resolve, "must not mutate/clear on this action",
  stale-response, and handler postcondition rules.
- `reachable(name, predicate)`: existential sanity/vacuity witness.
- `reachableFrom(name, when, goal)`: from every `when` state, some cooperative path can
  reach `goal`. Counterexamples assert path absence and are not action-replayable.
- `leadsToWithin(name, trigger, goal, { budget })`: bounded response after a trigger.
- `property(name, ctlFormula, options?)`: advanced CTL formulas through `ctl` when the
  named convenience combinators do not express the exact temporal shape.

## Common Patterns

State invariant:

```ts
always(
  "adminRequiresAuth",
  or(not(eq(route, "/admin")), eq(App.session, "authenticated")),
);
```

Action invariant:

```ts
alwaysStep("guestCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(App.auth, "guest"),
});
```

Focused handler postcondition. Prefer a negated bad-step form, because it produces
clearer counterexamples and can enable targeted slicing when the step syntactically names
the transition:

```ts
import { alwaysStep, eq, stepTransitionId } from "modality-ts/properties";
import { App } from "./App.modals";

alwaysStep("submitDoesNotLeaveDraftDirty", {
  negate: true,
  step: stepTransitionId(App.onClick.submit),
  post: eq(App.draft, "dirty"),
});
```

Bounded async response:

```ts
import { leadsToWithin, or, eq, stepEnqueued } from "modality-ts/properties";
import { App } from "./App.modals";

leadsToWithin(
  "submitResolves",
  stepEnqueued("api.placeOrder"),
  or(eq(App.order, "success"), eq(App.order, "error")),
  { budget: { environment: 3 } },
);
```

Stale completion rule:

```ts
import {
  alwaysStep,
  and,
  eq,
  neq,
  readOpArg,
  stepResolved,
} from "modality-ts/properties";
import { App } from "./App.modals";

alwaysStep("orderSuccessMatchesUser", {
  negate: true,
  step: stepResolved("api.submitOrder", "success"),
  post: and(
    eq(App.step, "success"),
    neq(readOpArg("userId"), App.userId),
  ),
});
```

No mutation on a stale failure:

```ts
import { alwaysStep, eq, neq, pre, stepResolved } from "modality-ts/properties";
import { App } from "./App.modals";

alwaysStep("staleFailureDoesNotMutateGuestStatus", {
  negate: true,
  step: stepResolved("api.submitOrder", "error"),
  pre: eq(App.auth, "guest"),
  post: neq(App.submitStatus, pre(App.submitStatus)),
});
```

Conditional reachability:

```ts
import { reachableFrom, and, eq } from "modality-ts/properties";
import { App } from "./App.modals";

reachableFrom(
  "reviewCanReachSuccess",
  and(eq(App.auth, "user"), eq(App.step, "review")),
  eq(App.step, "success"),
);
```

Advanced CTL formula:

```ts
import { ctl, eq, property } from "modality-ts/properties";
import { App } from "./App.modals";

property(
  "validPaymentInevitablyCanReview",
  ctl.always(
    ctl.implies(
      ctl.holds(eq(App.payment, "valid")),
      ctl.eventually(ctl.holds(eq(App.step, "review"))),
    ),
  ),
);
```

Fair temporal check:

```ts
import { ctl, eq, property } from "modality-ts/properties";
import { App } from "./App.modals";

property("spinnerCanStopFairly", ctl.eventually(ctl.holds(eq(App.loading, false))), {
  fairness: [ctl.fairlyOften(ctl.holds(eq(App.network, "settled")), "network settles")],
});
```

Enabledness:

```ts
import { always, enabled, not, or, eq } from "modality-ts/properties";
import { App } from "./App.modals";

always(
  "logoutAvailableOnError",
  or(not(eq(App.order, "error")), enabled(App.onClick.logout)),
);
```

Use `enabledTransitionPrefix(prefix)` if extraction disambiguates duplicate handler IDs
with stable hash suffixes and an exact transition handle is not available.

## Helpers

- Boolean/expression helpers: `eq`, `neq`, `and`, `or`, `not`.
- Numeric helpers: `lessThan`, `lessThanOrEqual`, `greaterThan`,
  `greaterThanOrEqual`, `add`, `sub`, `mod`.
- Edge helpers: `stepEnqueued(op)`, `stepResolved(op, outcome?)`,
  `stepTransitionId(id)`, `stepAny()`, `stepChanged(varId)`,
  `stepChangedTo(varId, value)`.
- Snapshot helpers: `pre(handle)` for macro-step pre-state, `readOpArg(key)` for
  enqueue-time operation args.
- Registration options: `reads`, `enabledTransitions`, `includeUnmounted`, and
  `fairness` for temporal properties. The loader infers reads, but explicit `reads`
  can improve diagnostics and slicing clarity.

## CTL Surface

Use `property(name, formula, options?)` for advanced formulas that should still serialize
to the same structured property IR as the convenience helpers. Import `ctl` from
`modality-ts/properties`.

- `ctl.holds(predicate)`: lift a state predicate into a temporal atom.
- Boolean formula helpers: `ctl.negate`, `ctl.allOf`, `ctl.anyOf`, `ctl.implies`.
- Path/temporal helpers: `ctl.always` (`AG`), `ctl.canReach` (`EF`),
  `ctl.eventually` (`AF`), `ctl.canStayForever` (`EG`), `ctl.afterEveryStep` (`AX`),
  `ctl.afterSomeStep` (`EX`), `ctl.holdsUntil` (`AU`), and `ctl.canHoldUntil` (`EU`).
- Fairness helper: `ctl.fairlyOften(condition, name?)`, passed via the registration
  option `{ fairness: [...] }`.

Prefer `always`, `alwaysStep`, `reachable`, `reachableFrom`, and `leadsToWithin` for
standard frontend rules because they encode common intent. Reach for `property(...,
ctl...)` when you need an explicit CTL shape rather than a new ad hoc predicate style.

`inevitably(name, formula, options?)` is also exported as an alias for registering a
pre-built temporal formula.

## Verdict Guidance

- `verified` / `verified-within-bounds`: property held under the reported model,
  abstractions, bounds, and confidence.
- `violated`: inspect the shortest trace and replay if possible.
- `vacuous-warning`: the witness/trigger never appeared; fix the model, bounds, or
  property before trusting it.
- `error`: property loading, model validation, or search-limit failure.

Do not "fix" a property by weakening it until it passes. First decide whether the
counterexample is a real product behavior, a model abstraction issue, or a misformalized
English rule.
