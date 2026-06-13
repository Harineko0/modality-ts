---
name: modality-testing
description: Guide use of modality-ts for model-checking React and TypeScript state-transition behavior. Use when Codex needs to extract a finite model from React code, write or refine property files, run the modality CLI, inspect reports and counterexample traces, replay failures, configure CI artifacts, or decide whether a stateful UI workflow is a good fit for bounded model checking.
---

# Modality Testing

## Overview

Use modality-ts to verify bounded, deterministic React state transitions. Focus on app behavior represented in TypeScript state, router state, cache/source state, and named side effects; keep DOM layout, CSS, animation timing, browser quirks, and unbounded external systems covered by ordinary unit, integration, or end-to-end tests.

## Workflow

1. Pick a target component or entry file whose important behavior is finite enough to model.
2. Extract a model:

```bash
modality extract src/App.tsx --out .modality/model.json
```

3. Name modeled side-effect APIs when user flows depend on them:

```bash
modality extract src/App.tsx --out .modality/model.json --effect-api api.placeOrder
```

4. Write a property file that exports `properties()` and returns checks over model state.
5. Check the model and write reports/traces:

```bash
modality check .modality/model.json src/app.props.mjs --report .modality/report.json --traces .modality/traces
```

6. Replay a failing counterexample when a property is violated:

```bash
modality replay .modality/traces/noDoubleSubmit.violated.trace.json
```

7. Prefer CI artifacts when automating verification:

```bash
modality ci .modality/model.json src/app.props.mjs --artifacts .modality
```

## Property Patterns

Use `always`-style properties for invariants over every reachable state. Use `alwaysStep` for transition-sensitive rules, especially side-effect enqueue/resolve behavior. Use `reachable` or `reachableFrom` when the expected behavior is that a useful state can be reached.

```js
export function properties() {
  return [
    {
      kind: "always",
      name: "noDoubleSubmit",
      reads: ["sys:pending"],
      predicate: (state) =>
        state["sys:pending"].filter((op) => op.opId === "api.placeOrder").length <= 1
    },
    {
      kind: "alwaysStep",
      name: "guestCannotSubmit",
      reads: ["local:App.auth", "sys:pending"],
      predicate: (pre, step) =>
        !(step.enqueued("api.placeOrder") && pre["local:App.auth"] === "guest")
    },
    {
      kind: "reachableFrom",
      name: "reviewCanReachSuccess",
      reads: ["local:App.auth", "local:App.step"],
      when: (state) => state["local:App.auth"] === "user" && state["local:App.step"] === "review",
      goal: (state) => state["local:App.step"] === "success"
    }
  ];
}
```

Declare `reads` explicitly when a property touches model variables. Use state keys as they appear in the extracted model, commonly `local:<Component>.<stateName>`, `sys:pending`, `sys:route`, and adapter-specific state such as atom or cache entries.

## Failure Triage

When a check fails, inspect the report first, then open the trace for the shortest counterexample. Decide whether the result reveals a real bug, an overly broad model, a missing side-effect API, an incorrect property, or behavior that should be bounded differently.

Use replay to confirm the failure sequence. If the model diverges from the intended app behavior, update the extraction target, side-effect declarations, finite domains, or property file before treating the result as a product bug.

## Command Reference

```bash
npm install -g modality-ts
modality extract <source.tsx> --out model.json
modality check <model.json> [props.mjs] --report report.json --traces traces
modality replay <trace.json>
modality conform --model model.json --count 8 --depth 4
modality export <model.json> --format tla --out model.tla
modality ci <model.json> [props.mjs] --artifacts .modality
```
