---
id: config-and-overlay-api
title: Config & overlay API
sidebar_label: Config & overlay
---

Two configuration surfaces: the **config** (entry points, routes, bounds, plugins) and
the **overlay** (manual model refinements, applied additively so regeneration never
clobbers them). The overlay builder is exported from `modality-ts/core`.

## Config

The config declares what to extract and the bounds to check under:

| Concern | Examples |
| --- | --- |
| Entry points / route table | route `pattern → RootComponent`, include globs |
| Effect APIs | functions whose calls are network operations (also via `--effect-api`) |
| Environment streams | `environment.webSockets[]` with optional `id` / `url` and `messages[]` variants (`type`, `bind`) for WebSocket `onmessage` handlers |
| Plugins | `plugins: [jotai(), swr(), zustand(), reactRouterAdapter()]` (built-ins auto-register on dependency match; disable via `--disable-plugin`) |
| Bounds | `maxDepth`, `maxPending` (the concurrency bound `K`), `maxInternalSteps`, `maxHistory` |
| Locator conventions | `data-testid` / role+name conventions for replay |

The active plugins (id + version) are stamped into the
[trust ledger](../soundness/trust-ledger.md).

## Overlay builder

The overlay is a TS module exporting a builder, typed against the generated state vector
so it autocompletes against real variable IDs.

```ts
import { overlay, enumOf, byTestId } from "modality-ts/core";

export default overlay(M)
  // fill an unextractable handler with a structured/opaque effect
  .transition("CheckoutPage.onRetry", {
    reads: ["local:CheckoutPage.order"],
    writes: ["local:CheckoutPage.order"],
    effect: (s) => ({ ...s, "local:CheckoutPage.order": { kind: "submitting" } }),
  })
  // replace a `tokens` domain with a predicate abstraction (+ required witnesses)
  .refineDomain("atom:cartTotal", enumOf("zero", "positive"), {
    witness: { zero: () => 0, positive: () => 42 },
  })
  // refine an async outcome payload field
  // (refinePayload / assume / outcomes are not implemented in the overlay builder yet)
  // supply a missing replay locator
  .locator("CheckoutPage.onRetry", byTestId("retry-btn"))
  // explicit, reported exclusion
  .ignoreVar("local:DebugPanel.open");
```

## Method summary

| Method | Purpose |
| --- | --- |
| `transition(id, { reads, writes, effect })` | fill an `unextractable` handler (an [opaque effect](../architecture/ir.md#the-opaque-escape-hatch)) |
| `refineDomain(varId, domain, { witness })` | predicate abstraction with a required concretization witness |
| `locator(transitionId, locator)` | declare a replay locator |
| `ignoreVar(varId)` | exclude a variable (reported) |

## Merge rules

Overlay entries override extracted entries of the same ID. An overlay entry whose ID
matches **nothing** is an error (drift detection). Overriding an `exact` extraction is
allowed but flagged. IDs embed a hash of the handler's normalized AST, so a rename breaks
the ID by design — use `modality extract --explain-drift` to re-map. See
[Refining domains & overlays](../guides/refining-domains-and-overlays.md).
