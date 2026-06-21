# Modeling And Triage

Use this reference for fit checks, async effects, supported sources, domains,
overlays, trust ledgers, replay, and search-limit work.

## Fit And Scope

Good fits:

- local `useState` and supported state/data-source transitions;
- route/history/auth/cache flows;
- bounded async effects, timers, WebSocket streams, and environment events;
- finite domains, bounded collections, and schema-derived finite numerics;
- business rules expressible over reachable state or edges.

Weak fits:

- DOM layout, CSS, animation timing, canvas rendering, and browser quirks;
- arbitrary unbounded server/database behavior;
- correctness depending mainly on rendering rather than state transitions;
- unbounded strings/numbers without a property-relevant abstraction.

## Supported Sources

Documented support includes `useState`, Jotai, SWR, Zustand, TanStack Query,
Redux, React Router, TanStack Router, Next.js, `fetch` / named effect APIs,
timers, WebSockets, Suspense, concurrent React primitives, and static Zod/ArkType
finite numeric refinements. Unsupported or unanalyzable writes should surface as
taints/caveats, not silent verification.

## Async Effects

Async-race bugs only appear when relevant network/effect calls are modeled as
effect operations. Name wrappers during extraction:

```bash
npx modality extract src/App.tsx \
  --effect-api api.placeOrder \
  --effect-api api.fetchQuote
```

Extraction splits an async handler into:

- a user transition for the synchronous prefix plus enqueue;
- environment resolve transitions for success/error outcomes;
- continuations guarded by operation identity and outcome.

Raise `maxPending` when a property needs multiple simultaneous requests, such as
double-submit checks. Use `readOpArg(key)` for enqueue-time snapshots in stale
response properties. Unhandled rejections and stale-read risks are trust-ledger
caveats.

Timers, SWR revalidation, and WebSocket lifecycle/message events are environment
transitions. Declare WebSocket message variants in config when properties depend on
parsed payload classes.

## Domains And Bounds

Every state variable has a finite abstract domain. Exact domains come from
boolean/literal unions, discriminated unions, records, options, finite numeric
types, and supported schema refinements. Coarse domains include `tokens`,
`lengthCat`, and bounded lists.

Use static TypeScript types or schema initializer chains first when they express the
finite structure. Use overlays when a property needs distinctions hidden by coarse
domains, runtime-only schema predicates, bounded lists, manual transitions, missing
locators, or environment refinements.

Distinguish:

- model bounds (`maxDepth`, `maxPending`, `maxInternalSteps`, `maxHistory`): part of
  the verification claim;
- `trustLedger.boundHits`: bounds that actually bit in the run;
- CLI search limits (`--max-states`, `--max-edges`, `--max-frontier`,
  `--memory-guard-mb`): resource guards that yield `error` verdicts when hit.

## Overlays

Use overlays for additive, reviewable refinements:

- fill an `unextractable` handler with a manual transition;
- refine a `tokens`/coarse domain with a predicate abstraction and witnesses;
- refine async outcome payload distinctions when documented and supported locally;
- constrain over-permissive environments when documented and supported locally;
- add a replay locator;
- explicitly ignore irrelevant noise.

Docs show the common shape:

```ts
import { overlay, enumOf, byTestId } from "modality-ts/core";

export default overlay(M)
  .transition("CheckoutPage.onRetry", {
    reads: ["local:CheckoutPage.order"],
    writes: ["local:CheckoutPage.order"],
    effect: (s) => ({ ...s, "local:CheckoutPage.order": { kind: "submitting" } }),
  })
  .refineDomain("atom:cartTotal", enumOf("zero", "positive"), {
    witness: { zero: () => 0, positive: () => 42 },
  })
  .locator("CheckoutPage.onRetry", byTestId("retry-btn"))
  .ignoreVar("local:DebugPanel.open");
```

Overlay entries must match extracted IDs. Orphans are drift and should fail.
Overriding an exact transition is allowed but flagged. Use
`modality extract --explain-drift` after refactors.

## Trust Ledger Checklist

Before trusting a green run, inspect:

- active plugins and versions;
- configured bounds and actual bound hits;
- assumptions, abstractions, ignored vars, and manual transitions;
- per-variable domain provenance and numeric reductions;
- global taints and unsound-risk caveats;
- unextractable handlers and over-approx transitions;
- stale reads, unhandled rejections, model slack, and confidence downgrades;
- extraction coverage and effect-operation provenance.

Warning strings are for humans. Machine decisions should use structured caveats and
ledger fields.

## Failure Triage

For `violated`:

1. Open the shortest trace and inspect focused diffs over the property read set.
2. Replay when possible.
3. Classify `reproduced` as a real app bug, `not-reproduced` as model divergence,
   and `inconclusive` as harness/locator/provider/timeout debt.
4. For `leadsToWithin`, decide whether the app truly fails to converge or the
   budget is too small.
5. For `reachableFrom`, expect a path-absence witness, not action replay.

For search-limit `error`:

1. Read `diagnostics.limits`, `diagnostics.dominantVars`, and slicing summaries.
2. Tighten domains, add property-relevant overlays, reduce bounds, or focus the
   property.
3. Prefer negated targeted `alwaysStep` with `stepTransitionId(...)` for
   handler-specific bad-step checks.
4. Raise limits only after understanding what exploded.

For `vacuous-warning`:

1. Confirm the trigger/witness should be reachable.
2. Check props target registration, route/mount scope, effect APIs, guards,
   generated handles, and bounds.
3. Add `reachable(...)` sanity checks while authoring a new model.
