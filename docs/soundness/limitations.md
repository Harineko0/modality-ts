---
id: limitations
title: Limitations
sidebar_label: Limitations
---

Knowing the edges is part of using the tool soundly. This page is the honest map of what
`modality-ts` models, what it deliberately excludes, and what is still future work.

> A documented exclusion is **safe**: excluded behaviour either becomes a loud
> [taint/over-approximation](./e1-invariant.md) or is simply outside the model's claim.
> The dangerous thing would be an *undocumented* gap — which the
> [E1 invariant](./e1-invariant.md) and [trust ledger](./trust-ledger.md) exist to
> prevent.

## What is modeled

Several behaviours that earlier specs listed as "v1 exclusions" are now **observably
modeled** end to end (extraction → IR → checker):

| Feature | How it is modeled |
| --- | --- |
| Timers (`setTimeout`/`setInterval`/`clear*`) | a `sys:timer:*` state machine; firing is a guarded `env` transition; cleanup cancels |
| Layout effects (`useLayoutEffect`/`useInsertionEffect`) | `internal` transitions like `useEffect`, with commit-`phase` ordering |
| Effect ordering | both-orders exploration for write-conflicting effects; phase tiers for layout-before-passive |
| React-18 batching | direct reads see the render snapshot via `readPre`; functional updaters chain |
| Stale closures across `await` | the read-set is snapshotted into `op.args` and read via `readOpArg` in continuations |
| Concurrent rendering | `useTransition` `isPending`, `useDeferredValue` lag, `flushSync` opt-out |
| Suspense / `React.lazy` / `use()` | a `sys:suspense:*` `ready`/`suspended` gate + resolve transitions |
| Finite numeric state | `boundedInt`/`intSet` with overflow policy ([details](../concepts/state-and-domains.md#finite-numeric-domains)) |

See [React features](../sources/react-features.md) for the details.

## What is excluded by design

These are **not** modeled, and that is intentional — modeling them would explode the
state space or the extraction burden for little benefit:

- **Rendering correctness** — `UI = f(state)`; `f` is another layer's job (golden/visual
  tests). The model verifies the *state* side.
- **Handler value computation** — arithmetic and string logic inside handlers is
  abstracted or `havoc`'d, not verified.
- **Render internals** — reconciliation, fiber bailouts, StrictMode double-invoke. These
  are invisible at [event/macro-step granularity](../concepts/transition-system.md#granularity-event-level-not-render-level).
- **DOM/layout/CSS/animation/canvas** — outside the state model entirely.
- **Unbounded liveness with fairness** — only **bounded response**
  ([`leadsToWithin`](../concepts/properties.md)) is offered; unbounded `leadsTo` with
  weak fairness is future work.
- **`forward` / `go` navigation** — only `push`/`replace`/`back` lower to the IR today.

## What becomes a taint or downgrade (not silently dropped)

These patterns are recognized and handled *loudly* — they degrade precision but never
soundness:

| Pattern | Handling |
| --- | --- |
| Context-passed state/setters | treated as an escape ⇒ taint |
| A ref holding a setter (`useRef`) | global taint (always-enabled external write) |
| Stateful list items (`items.map(<Row/>)` with `useState` in `Row`) | detected; those vars `unextractable` |
| Conditional rendering changing available events | guard from the JSX condition when M0, else transition left enabled (over-approx, caught by replay) |
| Unbounded data without a declared abstraction | `tokens(1)` ("some value") + caveat |
| Unprovable numeric constraint | abstain → `tokens(1)` + caveat (a wrong bound would be unsound) |

## Not yet supported

- **`useReducer`** — warned, not modeled (a natural future addition; reducers are *good*
  extraction material — pure, switch-shaped).
- **Redux / TanStack Query** — not built-in sources yet (the
  [plugin SPI](../architecture/state-sources.md) is designed to accommodate them).
- **ErrorBoundary** — not modeled; unhandled error paths are reported.
- **Server / full-route execution** — loaders, actions, and initial data loading are
  [future work](../architecture/navigation.md#default-scope-client-ui-transitions);
  default extraction models client UI transitions only.

## The fundamental limitation

The deepest one cannot be engineered away: **a verified model proves nothing about an app
that diverges from it.** Conformance is *tested* (via replay and runtime assertions),
never *proven*. That is why a green check is necessary but not sufficient, and why the
[conformance machinery](../architecture/conformance-and-replay.md) and
[trust ledger](./trust-ledger.md) are not optional extras but the core of the honest
contract.
