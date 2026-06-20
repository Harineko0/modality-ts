# Modeling And Triage

Use this reference for effect modeling, source support, trust-ledger interpretation,
overlays, replay, and search-limit/state-explosion work.

## Fit And Scope

Good fits:

- local `useState` and supported state/data source transitions;
- route/history/auth/cache flows;
- bounded async effects and timers;
- finite domains, bounded collections, schema-derived finite numerics;
- business rules expressible over reachable state and edges.

Weak fits:

- DOM layout, CSS, animation timing, canvas rendering, browser quirks;
- arbitrary unbounded server/database behavior;
- correctness depending mainly on rendering rather than state transitions;
- unbounded strings/numbers without a property-relevant abstraction.

## Supported Sources

The documented source surface includes:

- `useState`: local component state, route-scoped where applicable; React 18 batching is
  modeled with pre-state snapshots and functional updater accumulation.
- Jotai: primitive/derived/writable atoms, utility atoms, store scoping, hydration.
- Zustand: stores, fields, actions, selectors, `set`/`get`, common middleware, many
  immer draft mutations.
- SWR: per-key cache lifecycle, data/error/validating state, revalidation, dedup,
  stale-data retention on failed revalidate.
- Router/Next.js: `sys:route`, bounded history, App/Pages routes, route-tree slots, and
  server APIs as nondeterministic async effects.
- React features: effects as internal stabilization transitions; timers as environment
  transitions; Suspense as gating state; transitions/deferred values at macro-step
  granularity.
- Type-library adapters: static Zod and ArkType refinements where finite constraints are
  provable.

Unsupported or unanalyzable writes should surface as taints/caveats rather than silent
misses. If a result depends on unsupported state, do not present it as a clean proof.

## Domains And Bounds

Every variable needs a finite abstract domain. Exact domains come from boolean/literal
unions, discriminated unions, records, options, static finite numeric types, and supported
schema refinements. Coarse domains include `tokens`, `lengthCat`, and bounded lists.

Use overlays or type refinements when a property needs distinctions hidden by a coarse
domain, for example non-empty draft, positive cart total, or two different user payloads.
Token exhaustion, pending-cap saturation, key-window eviction, and other actual bound
hits must appear in the trust ledger.

Distinguish:

- model bounds (`maxDepth`, `maxPending`, `maxInternalSteps`, `maxHistory`): part of the
  verification claim;
- actual `trustLedger.boundHits`: bounds that bit in the explored run;
- CLI search limits (`--max-states`, `--max-edges`, `--max-frontier`,
  `--memory-guard-mb`): resource guards that produce `error` verdicts when hit.

## Async Effects

Name network/effect wrappers with repeatable `--effect-api` flags or config:

```bash
npx modality extract src/App.tsx \
  --effect-api api.placeOrder \
  --effect-api api.fetchQuote
```

Async handlers split into:

- a user transition for the synchronous prefix plus enqueue;
- environment resolve transitions for success/error outcomes;
- continuations guarded by operation identity and outcome.

Raise `maxPending` when a property needs multiple simultaneous requests, such as
double-submit checks. Use `readOpArg(key)` for enqueue-time snapshots in stale-response
properties. Unhandled rejection paths and stale-read risks are trust-ledger caveats.

## Trust Ledger Checklist

Before trusting a green run, inspect:

- active plugins and versions;
- configured bounds and actual bound hits;
- assumptions and ignored vars;
- per-var domain provenance and abstractions;
- global taints and unsound-risk caveats;
- unextractable handlers and over-approx/manual transitions;
- stale reads and unhandled rejections;
- model slack, numeric reductions, and confidence downgrades;
- extraction coverage and effect-operation provenance.

Warning strings are for humans. Machine decisions should use structured caveats and
ledger fields.

## Overlays

Use overlays for additive, reviewable model refinements:

- fill an `unextractable` handler with a manual transition;
- refine a coarse variable domain;
- add a replay locator;
- explicitly ignore irrelevant noise.

Current implemented builder methods:

```ts
import { overlay } from "modality-ts/core";

export default overlay(M)
  .transition("CheckoutPage.onRetry", {
    cls: "user",
    label: { kind: "click", text: "Retry" },
    source: [],
    guard: { kind: "lit", value: true },
    reads: ["local:CheckoutPage.order"],
    writes: ["local:CheckoutPage.order"],
    confidence: "manual",
    effect: {
      kind: "assign",
      var: "local:CheckoutPage.order",
      expr: { kind: "lit", value: { kind: "submitting" } },
    },
  })
  .refineDomain(
    "atom:cartTotal",
    { kind: "enum", values: ["zero", "positive"] },
    { initial: "zero" },
  )
  .locator("CheckoutPage.onRetry", { kind: "testId", value: "retry-btn" })
  .ignoreVar("local:DebugPanel.open");
```

Overlay entries must match extracted IDs. Orphans are drift and should fail. Overriding
an exact transition is allowed but warned. Run `modality extract --explain-drift` after
refactors.

Do not assume `assume`, `refinePayload`, or `outcomes` exist in the builder unless local
source confirms they have been implemented.

## Failure Triage

For a `violated` property:

1. Open the shortest trace and inspect focused diffs over the property read set.
2. Replay when possible.
3. Classify:
   - `reproduced`: real app bug; fix the app and keep the replay as regression evidence.
   - `not-reproduced`: model divergence; inspect the diverging step's provenance and
     refine extraction/overlay/modeling.
   - `inconclusive`: harness, locator, provider, or timeout issue.
4. For `leadsToWithin`, decide whether the app truly fails to converge or the budget is
   too small.
5. For `reachableFrom`, use the witness state and nearest-miss/certificate; do not
   expect action replay for path-absence claims.

For `error` from search limits:

1. Read `diagnostics.limits`, `diagnostics.dominantVars`, and slicing diagnostics.
2. Tighten domains, add property-relevant overlays, reduce bounds, or focus properties.
3. Prefer negated targeted `alwaysStep` with syntactic `stepTransitionId(...)` for
   handler-specific bad-step checks; this can enable targeted slicing.
4. Re-run with larger limits only after understanding what exploded.

For `vacuous-warning`:

1. Confirm the trigger/witness should be reachable.
2. Check route/mount scope, effect APIs, guards, generated handles, and bounds.
3. Add `reachable(...)` sanity checks when authoring a new model.

## Config Surface

Use config for extraction shape and bounds: entry points, route table, include globs,
effect APIs, environment streams such as WebSocket message variants, plugins/adapters,
`maxDepth`, `maxPending`, `maxInternalSteps`, `maxHistory`, and replay locator
conventions. Built-ins auto-register when matching packages appear in dependencies and
can be disabled with `--disable-plugin <id>`.
