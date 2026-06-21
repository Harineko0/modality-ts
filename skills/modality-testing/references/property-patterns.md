# Property Patterns

Use this reference before writing or repairing `*.props.ts` files.

## Imports And Handles

Properties live in files such as `app.props.ts`. Import builders from
`modality-ts/properties` and call them at module top level.

```ts
import { always, or, not, eq } from "modality-ts/properties";
import { App } from "./App.modals";

always(
  "checkoutOnlySucceedsForUsers",
  or(not(eq(App.step, "success")), eq(App.auth, "user")),
);
```

Handle rules:

- Run `modality generate` before authoring properties that need source handles.
- Import `useState` locals and transition refs from sibling `*.modals.ts` modules
  through component objects, for example `App.step` or `App.onClick.save`.
- Atoms are standalone exports; store/cache fields group under their source key,
  for example `sessionAtom.at("role")`, `useManagementStore.summaryStatus`, or
  `management_summary.data`.
- Import `route`, `history`, and `pending` from `modality-ts/vars`.
- Use `variable(id)` from `modality-ts/properties` only for synthesized IDs or
  bare IDs without a generated or built-in handle.

## Choosing A Combinator

- `always(name, predicate)`: state invariant, lowered to `AG p`.
- `alwaysStep(name, stepPredicate)`: action invariant over edges. Prefer it for
  "cannot trigger", enqueue/resolve, "must not mutate/clear on this action",
  stale-response, and focused handler postcondition rules.
- `reachable(name, predicate)`: existential reachability/sanity witness, lowered
  to `EF p`.
- `reachableFrom(name, when, goal)`: from every `when` state, some path can reach
  `goal`, lowered to `AG(when -> EF goal)`. Counterexamples assert path absence and
  are not action-replayable.
- `leadsToWithin(name, trigger, goal, { budget, allowUserEvents? })`: bounded
  response after a trigger. By default, only environment/library/internal steps
  count toward the goal.
- `property(name, ctlFormula, options?)`: explicit CTL formula built with `ctl`.
- `group("prefix", fn)`: namespace property names.

## Patterns

State invariant:

```ts
import { route } from "modality-ts/vars";
import { always, or, not, eq } from "modality-ts/properties";
import { sessionAtom } from "./store";

always(
  "adminRequiresAuth",
  or(not(eq(route, "/admin")), eq(sessionAtom, "authenticated")),
);
```

Action invariant:

```ts
import { alwaysStep, eq, stepEnqueued } from "modality-ts/properties";
import { authAtom } from "./store";

alwaysStep("guestCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(authAtom, "guest"),
});
```

Focused bad post-state:

```ts
import { alwaysStep, stepTransitionId } from "modality-ts/properties";

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

Conditional reachability:

```ts
import { reachableFrom, eq } from "modality-ts/properties";
import { App } from "./App.modals";

reachableFrom(
  "reviewStaysReachable",
  eq(App.payment, "valid"),
  eq(App.step, "review"),
);
```

Advanced CTL:

```ts
import { ctl, eq, property } from "modality-ts/properties";

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

Enabledness:

```ts
import { always, enabled, not, or, eq } from "modality-ts/properties";
import { App } from "./App.modals";

always(
  "logoutAvailableOnError",
  or(not(eq(App.order, "error")), enabled("Header.logout")),
);
```

Use `enabledTransitionPrefix(baseId)` when extraction disambiguates duplicate
handler IDs with stable hash suffixes.

## Helpers

- Boolean/expression: `eq`, `neq`, `and`, `or`, `not`.
- Numeric: `lessThan`, `lessThanOrEqual`, `greaterThan`,
  `greaterThanOrEqual`, `add`, `sub`, `mod`.
- Step matchers: `stepEnqueued(op)`, `stepResolved(op, outcome?)`,
  `stepTransitionId(id)`, `stepAny()`.
- Snapshots: `pre(handle)` for macro-step pre-state, `readOpArg(key)` for
  enqueue-time operation args.
- Registration options: `reads`, `enabledTransitions`, `includeUnmounted`, and
  `fairness` for temporal properties.

The loader infers reads and enabled transitions, but explicit options can make
slicing and diagnostics clearer.

## Verdict Guidance

- `verified` / `verified-within-bounds`: property held under the reported model,
  abstractions, bounds, and confidence.
- `reachable`: existential property was witnessed.
- `violated`: inspect the shortest trace and replay if possible.
- `vacuous-warning`: witness or trigger never appeared; do not treat as a pass.
- `error`: property loading, model validation, or search-limit failure.

Do not weaken a property until it passes. First decide whether the counterexample
is real product behavior, model abstraction slack, or a misformalized English rule.
