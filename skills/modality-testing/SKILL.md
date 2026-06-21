---
name: modality-testing
description: Guide Codex through modality-ts model-checking work for React and TypeScript apps. Use when Codex needs to decide whether modality-ts fits a state-transition bug, initialize or run the modality CLI, create *.props.ts target-registration files, generate typed *.modals.ts handles, write or debug properties with modality-ts/properties, model async effects and finite domains, read model/check/extraction reports and trust ledgers, replay counterexamples, tune search limits, refine models with config or overlays, configure CI/conformance/TLA export, or work with supported sources such as useState, Jotai, SWR, Zustand, TanStack Query, Redux, React Router, TanStack Router, Next.js, timers, effects, WebSockets, Suspense, and static Zod/ArkType numeric refinements.
---

# Modality Testing

Use `modality-ts` as a bounded model-checking layer for React state-transition
bugs: double submits, stale async completions, route/auth bypasses, impossible
state combinations, timer races, and cache/state interleavings. Keep rendering,
layout, CSS, browser quirks, and arbitrary server behavior in unit, component, or
E2E tests.

## Quickstart Shape

Follow the public docs' order. Do not skip the target-registration step.

1. Initialize from the app root:

```bash
npx modality init
```

2. Create empty `*.props.ts` files beside the components to model. They register
   the `*.tsx` targets even before properties exist.
3. Generate typed handles from source analysis:

```bash
npx modality generate
npx modality generate src/App.tsx
```

This writes sibling `<source>.modals.ts` modules. Empty or broken props files do
not block generation.

4. Write properties in the props file with top-level registrations from
   `modality-ts/properties`, importing generated handles from `./App.modals`.
5. Extract the model:

```bash
npx modality extract
npx modality extract src/App.tsx --effect-api api.placeOrder
npx modality extract src/App.tsx --report .modality/extraction-report.json
```

Name side-effect APIs during extraction when async calls should become split
enqueue/resolve operations. Extraction writes `.modality/model.json`; the optional
extraction report is the trust ledger for what was exact, over-approximated, or
unextractable.

6. Check and replay:

```bash
npx modality check
npx modality replay .modality/traces/<property>.violated.trace.json
```

7. For CI, write artifacts together:

```bash
npx modality ci .modality/model.json app.props.ts --artifacts .modality
```

Inside the `modality-ts` repository, follow repo instructions and use `rtk` where
practical, for example `rtk pnpm test`.

## Load References As Needed

- Read [workflow-cli.md](references/workflow-cli.md) for command choice, artifact
  flow, CI/conformance/export, or repository validation.
- Read [property-patterns.md](references/property-patterns.md) before writing or
  repairing `*.props.ts`, choosing a property combinator, or importing handles.
- Read [modeling-and-triage.md](references/modeling-and-triage.md) for async
  effects, supported sources, domains/bounds, overlays, trust ledgers, search
  limits, and counterexample replay.

## Property Rules

- Import property builders and expression helpers from `modality-ts/properties`.
  Properties are serializable data registered at module load time, not callback
  predicates or raw temporal-logic strings.
- Import generated source handles from sibling `*.modals.ts` files. Local state and
  transition handles are grouped by component; atoms are standalone exports; store
  and cache fields group under their source key.
- Import stable system handles such as `route`, `history`, and `pending` from
  `modality-ts/vars`. Use `variable(id)` only for synthesized or bare IDs with no
  generated or built-in handle.
- Choose `always` for state invariants, `alwaysStep` for edge/action rules,
  `reachable` for sanity/vacuity witnesses, `reachableFrom` for conditional
  reachability, and `leadsToWithin` for bounded response after a trigger.
- Prefer `alwaysStep` whenever the English says "cannot trigger", "must not
  clear", or "this action must not leave a bad post-state". State invariants are
  often the wrong shape for action rules.
- Use `property(name, ctlFormula, options?)` with `ctl` only when the named helpers
  do not express the needed temporal shape. Fairness constraints go in the
  registration options.
- Treat `vacuous-warning` as a problem to investigate, not a pass.

## Triage Rules

- Read `.modality/model.json`, extraction reports, check reports, trace JSON, and
  generated replay tests before changing app code.
- A failed property can be a real app bug, an over-broad model, a missing effect
  API, a coarse domain, an unextractable handler, a too-small model bound, a
  search-limit error, or a misformalized property.
- A search-limit hit is an `error` verdict, never verification. Inspect
  `diagnostics.limits`, `diagnostics.dominantVars`, and slicing summaries before
  raising limits.
- A green run is only "verified within the stated bounds, abstractions, and
  environment assumptions." Inspect the trust ledger: active plugins, bounds and
  bound hits, assumptions, abstractions, taints, unextractables, manual or
  over-approx transitions, stale reads, unhandled rejections, ignored vars,
  numeric reductions, and confidence downgrades.
- Replay violated traces whenever possible. `reproduced` means fix the app;
  `not-reproduced` means refine/debug the model; `inconclusive` means fix harness,
  locator, provider, or timeout.

## Surface Notes

- Public property imports are `modality-ts/properties`; stable system vars are
  `modality-ts/vars`; overlay/domain helpers are documented under
  `modality-ts/core`.
- The documented overlay surface covers manual transitions, domain refinements,
  locators, ignored vars, and related environment/payload refinements in guides.
  When implementation details matter, check the local overlay API before using
  guide-only or experimental methods.
- Supported documented sources include `useState`, Jotai, SWR, Zustand, TanStack
  Query, Redux, React Router, TanStack Router, Next.js, and React features such as
  effects, timers, batching, stale closures, concurrent primitives, WebSockets,
  and Suspense. Static Zod and ArkType adapters contribute finite numeric
  refinements where provable.
