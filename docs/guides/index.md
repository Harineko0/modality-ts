---
id: guides
title: Guides
sidebar_label: Guides
---

These guides cover the day-to-day workflow: extract a model, make it precise enough, check properties, and turn failures into small reproducible traces.

## Extract a model

Start with the default discovery flow:

```bash
npx modality extract
```

For a single component or fixture, pass files explicitly:

```bash
npx modality extract examples/checkout-app/App.tsx --out .modality/model.json
```

If a handler calls an API that should be modeled as an async operation, name it with `--effect-api`:

```bash
npx modality extract examples/todo-app/App.tsx --effect-api api.createTodo
```

Repeat `--effect-api` for each side-effect function the model should expose to properties and replay.

## Inspect extraction output

Extraction writes the model and, when requested, a report:

```bash
npx modality extract src/App.tsx --report .modality/extraction-report.json
```

Use the report to find:

- Extracted state variables and domains.
- Generated transitions and their source anchors.
- Caveats where extraction had to over-approximate.
- Missing locator or replay information.

## Check properties

Run all discovered properties:

```bash
npx modality check
```

Run a specific model and property file:

```bash
npx modality check .modality/model.json app.props.mjs
```

Write report and trace artifacts to explicit locations:

```bash
npx modality check .modality/model.json app.props.mjs \
  --report .modality/report.json \
  --traces .modality/traces
```

## Add a step property

Use `alwaysStep` when the rule is about a transition. This example rejects a guest user enqueueing a create request:

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

## Replay a failing trace

When a property fails, replay the emitted trace:

```bash
npx modality replay .modality/traces/guestCannotSubmit.violated.trace.json
```

Use action mode with a harness when you want to drive DOM interactions:

```bash
npx modality replay .modality/traces/guestCannotSubmit.violated.trace.json \
  --mode action \
  --harness test/replay-harness.ts
```

## Export to TLA+

Export the model when you want an external model-checking view:

```bash
npx modality export .modality/model.json --format tla --out .modality/model.tla
```

Opaque overlay effects are exported as conservative havoc over their declared writes, so the export remains an over-approximation.

## Keep CI focused

Use CI mode for pull requests:

```bash
npx modality ci .modality/model.json app.props.mjs --artifacts .modality
```

For semantics-sensitive changes inside this repository, also run:

```bash
pnpm phase7
```
