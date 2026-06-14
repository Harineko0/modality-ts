---
name: modality-testing
description: Guide use of modality-ts for model-checking React and TypeScript state-transition behavior. Use when Codex needs to extract a finite model from React code, write or refine property files, run the modality CLI, inspect reports and counterexample traces, replay failures, configure CI artifacts, or decide whether a stateful UI workflow is a good fit for bounded model checking.
---

# Modality Testing

## Overview

Use modality-ts to verify bounded, deterministic React state transitions. Focus on app behavior represented in TypeScript state, router state, cache/source state, and named side effects; keep DOM layout, CSS, animation timing, browser quirks, and unbounded external systems covered by ordinary unit, integration, or end-to-end tests.

The built-in extraction pipeline can model React local state plus supported source plugins such as Jotai, SWR, and router state. When the target imports local modules, extraction follows relative TypeScript imports so atom definitions, SWR payload aliases, and helper handlers can contribute domains and transitions. Treat the generated model as the source of truth for exact variable IDs before writing properties.

## Workflow

1. Pick target components whose important behavior is finite enough to model.
2. Initialize the project when no Modality config exists:

```bash
modality init
```

3. Create `*.props.mjs` files next to target components when you want default source inference. `src/App.props.mjs` maps to `src/App.tsx`; multiple props files map to multiple sources.
4. Extract a model. With colocated props files, let the CLI infer sources and write `.modality/model.json` plus `.modality/app.model.ts`:

```bash
modality extract
```

Use explicit sources when inference is not desired:

```bash
modality extract src/App.tsx src/HomePage.tsx
```

5. Name modeled side-effect APIs when user flows depend on them:

```bash
modality extract --effect-api api.placeOrder
```

6. Inspect the extraction summary and report. Confirm that expected plugins are present, important handlers are not listed as unextractable, and key variables such as auth atoms, SWR data, route state, and `sys:pending` appear in the model.
7. Write property files that export `properties()` and return checks over model state. Avoid putting conditionals or branching logic in props.mjs files.
8. Check the model. With default paths, `modality check` reads `.modality/model.json`, loads all discovered `*.props.mjs`, and writes `.modality/report.json`, `.modality/traces`, `.modality/replay-tests`, and `.modality/action-replay-tests`:

```bash
modality check
```

9. Replay a failing counterexample when a property is violated. The trace path remains mandatory:

```bash
modality replay .modality/traces/noDoubleSubmit.violated.trace.json
```

10. Prefer CI artifacts when automating verification:

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
      reads: ["atom:authAtom", "sys:pending"],
      predicate: (pre, step) =>
        !(step.enqueued("api.placeOrder") && pre["atom:authAtom"]?.kind === "guest")
    },
    {
      kind: "reachableFrom",
      name: "reviewCanReachSuccess",
      reads: ["atom:authAtom", "local:App.step"],
      when: (state) => state["atom:authAtom"]?.kind === "user" && state["local:App.step"] === "review",
      goal: (state) => state["local:App.step"] === "success"
    }
  ];
}
```

Declare `reads` explicitly when a property touches model variables. Use state keys as they appear in the extracted model, commonly `local:<Component>.<stateName>`, `sys:pending`, `sys:route`, `atom:<atomName>`, and SWR cache entries such as `swr:<key>:data`, `swr:<key>:error`, or `swr:<key>:isValidating`.

For Jotai, prefer properties over the atom variable, for example `atom:authAtom`, and use the extracted tagged-union shape when the atom type is a discriminated union. For SWR, read the extracted data variable and nested payload fields directly when the payload type is finite, for example `state["swr:event_snapshot_userId:data"]?.application?.applied`. If the exact SWR key ID is not obvious, inspect `.modality/model.json` or the generated app model before writing the property.

## Failure Triage

When a check fails, inspect the report first, then open the trace for the shortest counterexample. Decide whether the result reveals a real bug, an overly broad model, a missing side-effect API, an incorrect property, or behavior that should be bounded differently.

Use replay to confirm the failure sequence. If the model diverges from the intended app behavior, update the extraction target, side-effect declarations, finite domains, or property file before treating the result as a product bug.

Extraction caveats matter. An `Unextractable handler` means the flow is not represented directly and may need a simpler handler shape, a supported helper pattern, or an overlay. An `over-approx` transition is useful for bug finding but is not a precise proof; inspect havoc writes and refine code, domains, or overlays when a property needs proof-level confidence. If a modeled side effect has lifecycle behavior that is not in the model, such as aborting or clearing pending requests, encode that behavior with an overlay or keep the property scoped to the modeled semantics.

## Command Reference

```bash
npm install -g modality-ts
modality init
modality extract [source.tsx ...]
modality check [model.json] [props.mjs ...]
modality replay <trace.json>
modality conform --count 8 --depth 4
modality export
modality ci <model.json> [props.mjs] --artifacts .modality
```
