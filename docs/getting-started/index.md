---
id: getting-started
slug: /
title: Getting Started
sidebar_label: Getting Started
---

`modality-ts` finds React state-transition bugs by extracting a finite model from TypeScript source, checking properties against every reachable state within configured bounds, and turning counterexamples into replayable traces.

It is a companion to your normal tests. Unit and end-to-end tests sample important paths; `modality-ts` explores the state graph those paths imply.

## Install

Install `modality-ts` as a development dependency in the app you want to check:

```bash
npm install -D modality-ts
```

The same workflow works with pnpm or yarn:

```bash
pnpm add -D modality-ts
yarn add -D modality-ts
```

## Create the default files

Initialize the local `.modality` workspace:

```bash
npx modality init
```

Then extract a model from your React source:

```bash
npx modality extract
```

If extraction cannot infer the source file from a property file yet, pass the component explicitly:

```bash
npx modality extract src/App.tsx
```

## Write properties

Properties live in files such as `app.props.mjs` and import helpers from `modality-ts/core`.

```js
import { eq, lit, notExpr, orExpr, readVar } from "modality-ts/core";

export function properties() {
  return [
    {
      kind: "always",
      name: "checkoutOnlySucceedsForUsers",
      reads: ["local:App.step", "local:App.auth"],
      predicate: orExpr(
        notExpr(eq(readVar("local:App.step"), lit("success"))),
        eq(readVar("local:App.auth"), lit("user")),
      ),
    },
  ];
}
```

Use variable names from the generated model or extraction report. Local `useState` variables are commonly named `local:<Component>.<stateName>`; Jotai atoms use `atom:<atomName>`; system variables use the `sys:` prefix.

## Check the model

Run the checker:

```bash
npx modality check
```

The checker applies conservative search limits by default:

```bash
npx modality check --max-states 50000 --max-edges 150000
```

For intentionally unbounded local runs, disable those limits:

```bash
npx modality check --no-search-limits
```

## Replay counterexamples

When a property fails, `modality-ts` writes a trace artifact. Replay it against the app model:

```bash
npx modality replay .modality/traces/checkoutOnlySucceedsForUsers.violated.trace.json
```

Replay is how an abstract state-space failure turns into a concrete debugging path.

## Run in CI

Use the CI command to write model, report, trace, and conformance artifacts under one directory:

```bash
npx modality ci .modality/model.json app.props.mjs --artifacts .modality
```

You can also let CI derive the matching model path from a discovered property file:

```bash
npx modality ci app.props.mjs --artifacts .modality
```
