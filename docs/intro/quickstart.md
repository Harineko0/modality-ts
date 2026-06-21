---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
---

This walks the full loop end to end: **create props → generate handles → write properties → extract → check**.

## 1. Initialize

```bash
npx modality init
```

## 2. Register targets and generate handles

Create empty `*.props.ts` files beside the components you want to model. They register
which `*.tsx` files belong in the pipeline even before properties are written.

Generate typed state and transition handles from source analysis alone — no properties
required:

```bash
npx modality generate
```

Or target a single component:

```bash
npx modality generate src/App.tsx
```

This writes `<source>.modals.ts` next to each source file. Empty or broken props files
do not block generation.

## 3. Extract a model

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

Broken or missing props files no longer abort extract: model artifacts are still
written, slices for failed props are skipped, and a per-file warning is printed.

## 4. Write a property

Properties live in files such as `app.props.ts` and import helpers from
`modality-ts/properties`. Call property builders at module top level — predicates are built
from small combinators, not arbitrary functions.

```ts
import { always, or, not, eq } from "modality-ts/properties";
import { App } from "./App.modals";

always(
  "checkoutOnlySucceedsForUsers",
  or(not(eq(App.step, "success")), eq(App.auth, "user")),
);
```

Variable IDs come from the generated model / extraction report. Common prefixes:
`local:<Component>.<state>` (a `useState`), `atom:<name>` (Jotai),
`zustand:<name>.<field>` (Zustand), `swr:<key>:<field>` (SWR cache), and `sys:*`
(system variables such as `sys:route`, `sys:pending`). Run `modality generate` to write
typed handles beside source files as `<source>.modals.ts`; import stable system handles from
`modality-ts/vars`, and use `variable()` only for synthesized ids without a generated or
built-in handle. Local state and transition handles from the same module are nested by
component, atoms are standalone exports, and store/cache fields group under their source key
— for example `eq(App.step, "success")`, `eq(sessionAtom.at("role"), "admin")`,
`eq(useManagementStore.summaryStatus, "success")`, and `enabled(App.onClick.save)`. See
[State & domains](../concepts/state-and-domains.md).

## 5. Check the model

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

## 6. Replay a counterexample

When a property fails, a counterexample trace is written. Replay it:

```bash
npx modality replay .modality/traces/checkoutOnlySucceedsForUsers.violated.trace.json
```

Replay turns an abstract state-space failure into a concrete, debuggable path — and
classifies whether the real app actually reproduces it. See
[Debugging counterexamples](../guides/debugging-counterexamples.md).

## 7. Wire it into CI

Write model, report, traces, and conformance artifacts into one directory:

```bash
npx modality ci .modality/model.json app.props.ts --artifacts .modality
```

See [CI integration](../guides/ci-integration.md).

## Next

- [How it works](./how-it-works.md) — the full pipeline.
- [Writing properties](../guides/writing-properties.md) — the property DSL in depth.
