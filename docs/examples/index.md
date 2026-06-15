---
id: examples
title: Examples
sidebar_label: Examples
---

The repository includes small apps under `examples/` that exercise common modeling patterns.

## Todo App

The todo example combines local state, a Jotai auth atom, an SWR query, and an async create operation.

```tsx
export const authAtom = atom<"guest" | "user">("guest");

export function App() {
  const setAuth = useSetAtom(authAtom);
  const [draft, setDraft] = useState<"empty" | "nonEmpty">("empty");
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "posting" | "failed"
  >("idle");
  const { data } = useSWR<TodosData>("/api/todos", api.fetchTodos);

  return (
    <button
      type="button"
      disabled={saveStatus === "posting"}
      onClick={async () => {
        setSaveStatus("posting");
        await api.createTodo();
        setDraft("empty");
        setSaveStatus("idle");
      }}
    >
      Add
    </button>
  );
}
```

Its properties check rules such as:

- A create request should not be enqueued for a guest.
- Empty drafts should not be submitted.
- Stale completions should not reset the current draft.
- There should not be more than one pending create operation.

Run it:

```bash
npx modality extract examples/todo-app/App.tsx --effect-api api.createTodo
npx modality check .modality/model.json examples/todo-app/app.props.mjs
```

## Checkout App

The checkout example models a multi-step flow with auth, plan selection, quote loading, payment setup, review, submit, and success states.

Good properties for this shape include:

- Guests cannot advance into billing or review.
- Submit is possible only for authenticated users with a selected plan.
- The success step is reached only after a successful submit.
- Async quote failures do not validate a stale plan.

Run it:

```bash
npx modality extract examples/checkout-app/App.tsx \
  --effect-api api.fetchQuote \
  --effect-api api.submitOrder
npx modality check .modality/model.json examples/checkout-app/app.props.mjs
```

## Demo App

The demo fixture intentionally contains modeled bugs:

- Double-submit behavior for an order flow.
- Guest navigation into an admin route.
- SWR cache visibility after auth changes.

It is useful when validating that extraction and checking still find known failures.

```bash
npx modality extract examples/demo-app/App.tsx --effect-api api.placeOrder
npx modality check .modality/model.json examples/demo-app/app.props.mjs
```

## Example Property Pattern

This step property says a guest must not enqueue `api.createTodo`:

```js
import { eq, lit, readVar, stepEnqueued } from "modality-ts/core";

export function properties() {
  return [
    {
      kind: "alwaysStep",
      name: "guestCannotSubmit",
      reads: ["atom:authAtom", "sys:pending"],
      predicate: {
        negate: true,
        step: stepEnqueued("api.createTodo"),
        pre: eq(readVar("atom:authAtom"), lit("guest")),
      },
    },
  ];
}
```
