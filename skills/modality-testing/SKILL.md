---
name: modality-testing
description: Guide Codex through modality-ts model-checking work for React and TypeScript apps. Use when Codex needs to decide whether modality-ts fits a bug class, initialize or run the modality CLI, generate typed *.modals.ts handles, write or debug *.props.ts property files, model async side effects and bounded state, read extraction trust-ledger/check reports, refine models with overlays/config, replay counterexamples, tune search limits, configure CI artifacts, or work with supported sources such as useState, Jotai, Zustand, SWR, React Router, Next.js, timers, effects, Suspense, and finite numeric/schema domains.
---

# Modality Testing

Use `modality-ts` as a bounded model-checking layer for React state-transition bugs:
double submits, stale async completions, route/auth bypasses, impossible state
combinations, timer races, and cache/state interleavings. Keep DOM layout, CSS, visual
correctness, browser quirks, and arbitrary server behavior in unit/component/E2E tests.

## Start Here

1. Read the local app and current artifacts before guessing. Prefer actual
   `.modality/model.json`, `.modality/*report*.json`, `*.props.ts`, generated
   `*.modals.ts`, and `modality.config.ts` over assumptions from source code alone.
2. Use the current default loop:

```bash
npx modality init
npx modality generate
npx modality extract
npx modality check
```

3. If a component calls network/effect wrappers, name them during extraction:

```bash
npx modality extract src/App.tsx --effect-api api.placeOrder
```

4. Read reports before changing app code. A failed property can be a real bug, an overly
   broad model, a missing effect API, a coarse domain, an unextractable handler, a
   too-small bound, or a mistaken/vacuous property.

Inside the `modality-ts` repository, follow repo instructions and run shell commands via
`rtk` where practical, for example `rtk pnpm test`.

## Load References As Needed

- Read [workflow-cli.md](references/workflow-cli.md) when initializing a project,
  choosing CLI commands, configuring CI, interpreting artifact paths, or running
  validation in this repository.
- Read [property-patterns.md](references/property-patterns.md) before writing or
  repairing `*.props.ts` files, choosing a property combinator, importing state handles,
  or using CTL/numeric/step helpers.
- Read [modeling-and-triage.md](references/modeling-and-triage.md) when modeling async
  effects, reading the trust ledger, dealing with search limits/state explosion,
  deciding whether to add an overlay, replaying counterexamples, or working with
  source adapters.

## Core Rules

- Prefer generated typed handles for local component state and transitions. Run
  `modality generate`; import from sibling modules such as `./App.modals`.
- Write property files as top-level registrations using serializable combinators from
  `modality-ts/properties`. Do not write callback predicates or raw temporal-logic
  strings.
- Import stable system handles from `modality-ts/vars` (`route`, `history`, `pending`).
  Use `variable(id)` from `modality-ts/properties` only for synthesized or bare IDs that
  have no importable handle.
- Use `alwaysStep` for action-shaped rules such as "cannot trigger", "must not clear",
  enqueue/resolve constraints, and stale-response rules. State invariants are often the
  wrong formalization for action rules.
- Treat `vacuous-warning` as a problem to investigate, not a pass.
- Treat CLI search-limit hits as `error` verdicts, never as verification. Configured
  model bounds and actual `trustLedger.boundHits` qualify the claim; search limits stop
  exploration.
- Trust a green run only in light of the trust ledger: active plugins, assumptions,
  abstractions, taints, unextractables, manual/over-approx transitions, ignored vars,
  stale reads, unhandled rejections, and bound hits.
- Replay violated traces whenever possible. `reproduced` means fix the app;
  `not-reproduced` means refine/debug the model; `inconclusive` means fix the harness,
  locator, provider, or timeout.

## Current Surface Notes

- Generated local handles are sibling `*.modals.ts` files, not `.modality/vars/*`
  modules.
- Public property imports are `modality-ts/properties`; stable system vars are
  `modality-ts/vars`; overlay/domain helpers are exposed through `modality-ts/core`.
- The implemented overlay builder currently supports `transition`, `refineDomain`,
  `locator`, and `ignoreVar`. Do not rely on `assume`, `refinePayload`, or `outcomes`
  unless the local implementation has added them.
- Built-in sources currently documented by the project include `useState`, Jotai, SWR,
  Zustand, React Router, Next.js, and React features such as effects, timers, batching,
  stale closures, concurrent primitives, and Suspense. Static Zod and ArkType adapters
  contribute finite type refinements where provable.
