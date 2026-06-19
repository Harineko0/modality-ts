---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
---

This walks the full loop end to end: **extract → write a property → check → replay**.

## 1. Initialize

```bash
npx modality init
```

## 2. Extract a model

Discover models from your source automatically:

```bash
npx modality extract
```

Or target a single component, naming any side-effect APIs that should appear as
[async operations](../concepts/transitions.md#async-split-transitions):

```bash
npx modality extract src/App.tsx --effect-api api.placeOrder
```

Extraction writes `.modality/model.json` and, on request, an **extraction report**
(the [trust ledger](../soundness/trust-ledger.md)) describing exactly what was modeled
exactly, over-approximated, or left unextractable:

```bash
npx modality extract src/App.tsx --report .modality/extraction-report.json
```

## 3. Write a property

Properties live in files such as `app.props.ts` and import helpers from
`modality-ts/properties`. Call property builders at module top level — predicates are built
from small combinators, not arbitrary functions.

```ts
import { always, or, not, eq } from "modality-ts/properties";
import { auth, step } from "./App.vars";

always(
  "checkoutOnlySucceedsForUsers",
  or(not(eq(step, "success")), eq(auth, "user")),
);
```

Variable IDs come from the generated model / extraction report. Common prefixes:
`local:<Component>.<state>` (a `useState`), `atom:<name>` (Jotai),
`store:<name>.<field>` (Zustand), `swr:<key>` (SWR cache), and `sys:*`
(system variables such as `sys:route`, `sys:pending`). Extract also writes typed local
handles beside source files as `<source>.vars.ts`; import stable system handles from
`modality-ts/vars`, and use the `var` export for synthesized ids without a generated or
built-in handle (usually via `import { var as stateVar } from "modality-ts/properties"`).
See
[State & domains](../concepts/state-and-domains.md).

## 4. Check the model

```bash
npx modality check
```

The checker explores every reachable state within bounds and prints a verdict per
property. It applies conservative [search limits](../guides/diagnostics-and-search-limits.md)
by default:

```bash
npx modality check --max-states 50000 --max-edges 150000
```

For an intentionally unbounded local run:

```bash
npx modality check --no-search-limits
```

## 5. Replay a counterexample

When a property fails, a counterexample trace is written. Replay it:

```bash
npx modality replay .modality/traces/checkoutOnlySucceedsForUsers.violated.trace.json
```

Replay turns an abstract state-space failure into a concrete, debuggable path — and
classifies whether the real app actually reproduces it. See
[Debugging counterexamples](../guides/debugging-counterexamples.md).

## 6. Wire it into CI

Write model, report, traces, and conformance artifacts into one directory:

```bash
npx modality ci .modality/model.json app.props.ts --artifacts .modality
```

See [CI integration](../guides/ci-integration.md).

## Next

- [How it works](./how-it-works.md) — the full pipeline.
- [Writing properties](../guides/writing-properties.md) — the property DSL in depth.
