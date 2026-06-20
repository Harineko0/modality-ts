

<p align="center">
  <br>
  <br>
  <a href="https://modality-ts.yuni.cat" target="_blank" rel="noopener noreferrer">
    <img width="261" height="261" alt="icon-removebg-preview" src="https://github.com/user-attachments/assets/e698e5fd-3d41-4edf-9d32-ab72760cc4c9" />
  </a>
</p>

<h1 align="center">
modality-ts
</h1>
<p align="center">
Model-checking-based testing tool for React state-transition bugs.
<p>
<p align="center">
  <a href="https://www.npmjs.com/package/modality-ts">
  <img src="https://img.shields.io/npm/v/modality-ts.svg" alt="npm version">
</a>
<a href="https://github.com/Harineko0/modality-ts/actions/workflows/ci.yml">
  <img src="https://github.com/Harineko0/modality-ts/actions/workflows/ci.yml/badge.svg" alt="CI">
</a>
<a href="LICENSE">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT">
</a>
<a href="https://www.typescriptlang.org/">
  <img src="https://img.shields.io/badge/TypeScript-5.9-blue.svg" alt="TypeScript">
</a>
<p>

`modality-ts` extracts a finite transition model from React + TypeScript code, checks developer-defined properties against every reachable state within stated bounds, and turns counterexamples into replayable tests.

It is for the bugs that hide between example-based tests: double submits, stale async completions, impossible checkout states, auth/router bypasses, and "this can never happen" state combinations that only appear after an awkward event interleaving.

### [Read the docs »](https://modality-ts.yuni.cat)

## Installation

```bash
npm install -D modality-ts
# or
pnpm add -D modality-ts
# or
yarn add -D modality-ts
```

## Usage

### 1. Register a target

Create an empty `*.props.ts` file beside the components you want to model:

```text
src/App.tsx
src/App.props.ts
```

### 2. Generate typed handles

Run generation before writing properties:

```bash
npx modality init
npx modality generate
```

This writes sibling modules such as `src/App.modals.ts`, which contain typed handles for the component's state and transitions.

### 3. Write properties

Write properties in the props file, importing component handles from sibling modules such as `./App.modals`.

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
import { App } from "./App.modals";

// always for state invariants
always(
  "guestCannotReachSuccess",
  not(and(eq(App.auth, "guest"), eq(App.step, "success"))),
);

// alwaysStep for action rules
alwaysStep("emptyDraftCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(App.draft, "empty"),
});

// reachable for sanity checks
reachable(
  "guestCannotReachSuccess",
  not(and(eq(App.auth, "guest"), eq(App.step, "success"))),
);

// reachableFrom for conditional reachability
reachableFrom(
  "reviewStaysReachable",
  eq(App.payment, "valid"),
  eq(App.step, "review"),
);

// leadsToWithin for bounded response
leadsToWithin(
  "submitResolves",
  stepEnqueued("api.placeOrder"),
  or(eq(App.order, "success"), eq(App.order, "error")),
  { budget: { environment: 3 } },
);
```

### 4. Extract and check
Run extraction and check:

```bash
# extract the model from the source code
npx modality extract

# check the model for properties
npx modality check
```

This will produce a report like this:

```text
 ✓ src/App.props.ts 0.13s
  (2 tests, 2 passed, 0 failed, 0 errors, states 1, edges 0, depth 1, slices 2, vars 2, transitions 0, skipped 0)
  ✓ guestCannotReachSuccess reachable
    trace: (initial)
  ✓ emptyDraftCannotSubmit verified-within-bounds
    trace: (initial)
  ✓ guestCannotReachSuccess verified-within-bounds
    trace: (initial)
  ✓ reviewStaysReachable verified-within-bounds
    trace: (initial)
  ✓ submitResolves verified-within-bounds
    trace: (initial)

 Test Files  0 failed | 1 passed (5)
      Tests  5 passed, 0 failed, 0 warnings, (5)
   Start at  <timestamp>
   Duration  <duration>
```

## Limitation

`modality-ts` verifies the model it can extract, not arbitrary browser behavior. It works best for React apps where important behavior is represented as bounded, deterministic state transitions in TypeScript.

Good fits include:

- Components with local `useState` transitions.
- Apps that use supported state/data sources such as Jotai, SWR, and router state.
- Flows with finite domains, bounded collections, and named side effects.
- Business rules that can be expressed as safety properties over reachable states.

Current weak fits include:

- Apps whose correctness depends mainly on DOM layout, CSS, animation timing, canvas rendering, or browser quirks.
- Unbounded or highly numeric behavior without explicit finite bounds.
- External services that are not modeled as effects or bounded data.
- Concurrency, timers, and network races that are not represented in the extracted model.
- Code patterns outside the supported React + TypeScript extraction subset.

For those cases, use `modality-ts` alongside regular unit, integration, and end-to-end tests.

## License

MIT
