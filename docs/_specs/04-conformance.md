# Spec 04 — Conformance: Trace Concretization, Replay, and Model–Code Agreement

Status: draft for review. Companion to `docs/design.md §1, §6`, Specs 01–03.

The model checker verifies the *model*. This subsystem is what ties the model to the *app*: it compiles abstract traces into executable component tests, runs them, and classifies the outcome. It is also the safety net for every over-approximation and heuristic admitted by Specs 01–03 — spurious counterexamples die here instead of in front of the developer's debugger, and model divergence is detected here instead of silently corroding trust.

## 1. The three replay verdicts

Given a counterexample trace `T` for property `P`:

| Verdict | Meaning | Action surfaced |
|---|---|---|
| **reproduced** | the generated test drives the app along `T` and observes `¬P` | app bug; test file is the regression test, committed as-is |
| **not-reproduced** | the app, driven along `T`, never violates `P` (or a step's precondition fails — e.g., the button to click is not in the DOM) | model divergence; report which step diverged and the extraction provenance of the transitions involved |
| **inconclusive** | harness failure (locator missing, provider setup error, timeout) | infrastructure TODO; never counted as either of the above |

A `not-reproduced` is *not* automatically a model bug to silence: it may be an over-approximation doing its job (havoc'd transition took a branch the code can't). The report distinguishes (a) divergence at a transition marked `exact` — extraction defect, high priority — from (b) divergence at `over-approx`/`manual` transitions — expected slack; suggest refining the overlay if such spurious traces recur for the same transition.

## 2. Concretization: abstract values → concrete witnesses

Every abstract domain must produce concrete values to drive the app and concrete payloads for mocked responses.

- `enum`, `bool`, `option`-shape, `tagged` tags: trivial (literals).
- `tokens`: a **witness factory** per token-bearing variable: distinct concrete payloads per token, structurally valid for the app's types. Default: auto-generated from the TS type (faker-style structural generation, deterministic seed), with token distinctness enforced on the *pruned-relevant fields* (Spec 02 §3) — distinctness elsewhere is irrelevant by construction. Overlay override: `witness('swr:GET /api/user', t => fixtures.user(t))` for apps whose code validates payload shapes beyond the type.
- Refined-predicate enums (Spec 02 §3): the refinement declaration carries a witness obligation per predicate class (`{ zero: () => 0, positive: () => 42 }`) — the overlay API makes it a required field, so unconcretizable refinements are rejected at extract time, not replay time.
- `lengthCat`: witnesses `[]`, `[w]`, `[w₁, w₂, w₃]` over the element witness.
- Abstract input classes (`valueClass: 'valid' | 'invalid'` on input events): witness strings supplied by overlay per field, with defaults derived from common validators when recognizable (zod/yup schema literal at the validation site) — else required overlay field.

Soundness note: concretization is *not* required to be faithful to the abstraction (many concrete values map to one abstract value — we pick one). A `reproduced` verdict is therefore always genuine; a `not-reproduced` may be witness-specific, which is one more reason `not-reproduced` is advisory, not authoritative.

## 3. Generated test anatomy (RTL + MSW)

One self-contained `*.replay.test.tsx` per trace, deterministic, committed-friendly:

```
render(<AppUnderTest initialRoute={trace.initialRoute} />)   // harness wrapper from config:
                                                             // fresh Jotai store, SWRConfig
                                                             // {provider: () => new Map(), dedupingInterval: 0…per template settings},
                                                             // MemoryRouter, fake timers
for each step:
  click/submit/input  → userEvent.* on the step's Locator
  navigate            → router test API (push/back)
  resolve(op,outcome) → release the op's deferred MSW handler with the
                        witness payload for `outcome`, then await stabilization
  focus-revalidate    → dispatch window focus event
  after each step: await stabilization barrier; run step assertions (§4)
final: assert observable projection of ¬P  (or P, for leadsToWithin suffixes: assert goal not yet
       reached at budget exhaustion per the observation map)
```

**Ordering control** is the heart of replay fidelity: every effect-API route is mocked by a *gated* handler — the request is captured and parked on a deferred promise; only the trace's `resolve` step releases it, with the chosen outcome. This makes response *reordering* and *interleaving with user events* exactly reproducible — the model's whole nondeterminism budget (scheduling, outcomes) is controllable by construction, because Spec 01 §4 confined nondeterminism to environment events. Requests the app makes that the trace doesn't expect (extra fetch = divergence signal) are parked and reported at teardown.

**Stabilization barrier**: after each step, flush microtasks + advance fake timers by the template-known delays + `await waitFor(idle)` where idle = no parked-handler releases pending and React act queue empty. This is the replay-side mirror of macro-step semantics (Spec 01 §5).

**Indexed-family steps**: a step belonging to an indexed event family (Spec 02 §4) resolves its positional locator (Spec 01 §6) against the concrete list rendered from the trace's own environment steps — the witness factory fixes list order, so "the *i*-th payment-method radio" is deterministic. A list shorter than the index at replay time is a divergence at that step.

**Enabledness assertion**: before each click/submit step, the test asserts the target element exists and is not disabled — the model claimed the transition was enabled there, so an absent or disabled control is a *divergence at that step* (verdict `not-reproduced`, with the guard's extraction provenance in the report), not a test failure to debug. This closes the loop with guard extraction from `disabled` attributes and conditional rendering (Spec 02 §4, §11).

## 4. The observation problem (how the test reads app state)

The violated predicate is over *model* state; the test must evaluate its concrete counterpart. Observability differs by state source — this is a genuine hard point and the design is explicit about it:

| Source | Observation mechanism | Fidelity |
|---|---|---|
| Jotai atoms | the harness creates the `Provider` store, so the test holds the store handle: `store.get(sessionAtom)` | direct, full |
| SWR cache | harness-provided cache `Map` is directly inspectable per key | direct, full |
| route | router test API / `MemoryRouter` state | direct, full |
| `sys:pending` | parked-MSW bookkeeping (count of captured unreleased requests per op) | direct, full |
| `useState` | **not externally observable.** Two supported mechanisms below. | indirect |

`useState` observation mechanisms, in preference order:

1. **DOM projection** (default): the property author (or overlay) declares an observation map for each `useState`-derived var used in properties: `observe('local:CheckoutPage.step', { dom: q => q.getByTestId('wizard-step').textContent, parse: ... })`. Honest but partial: it observes `f(state)`, so it assumes the rendering of that var is correct — acceptable, since rendering correctness is explicitly another layer's job (design §7), and a wrong rendering would surface as a different test failure anyway.
2. **Probe transform** (opt-in): a small SWC/Babel transform, active only under test, that wraps modeled `useState` calls to mirror values into a test-visible registry keyed by the extractor's var ids. Full fidelity, zero production cost, but it is build-machinery — hence opt-in, not default.

Properties whose predicates read only directly-observable vars (the majority: route guards, cache consistency, pending counts) need no observation declarations at all. The extract-time check computes, per property, whether its read set is fully observable and lists the missing observation declarations — replay for that property is blocked (clearly, early) until provided.

## 5. Beyond counterexamples: proactive conformance (model-based testing mode)

Counterexample replay only exercises traces the checker found violating. `modality conform` additionally:

1. samples N random walks (seeded, depth-bounded) from the state graph — biased toward transitions with `confidence: exact` (those *claim* fidelity) and toward rarely-covered transitions (coverage-guided);
2. compiles each into a replay test asserting **stepwise agreement**: after every step, all observable vars match the model state (not just a final predicate);
3. classifies mismatches exactly as §1, aggregated per transition id — a transition that diverges across many walks is mis-extracted, and the report ranks these.

This is the standing answer to "how do you know the model still matches the app": it runs in CI on a budget (N×depth configurable), and its pass-rate per transition is the quantitative conformance metric in the trust ledger. The same machinery doubles as the **SWR template validator** (Spec 01 §9): walks that exercise template transitions check the hand-written template against the real library — run against pinned SWR versions in the tool's own CI, and the template carries a tested-versions range that `modality extract` checks against the app's lockfile.

## 6. Runtime assertion mode (cheap, continuous)

The property predicates are the same **structured property IR** used by the checker, evaluable over `ModelState` by the shared evaluator (`evalStatePredicate`, exported from `modality-ts/core`); a thin dev-build hook (`useModalityAssertions(store)`) subscribes to the observable sources (atoms, stores, SWR cache, route) and evaluates the observable-only invariants on every change, logging/throwing on violation. (The same evaluator runs in the checker host and the dev bundle, so an invariant means the same thing in both.) This catches divergence and bugs during *ordinary* development and E2E runs at near-zero cost, and is the gentlest adoption on-ramp (teams can run assertions for months before ever running the checker). Limitations stated: observes only directly-observable vars, only invariants (no `leadsToWithin`), only states the session happens to visit.

## 7. Workflow summary

```
modality extract        → app.model.ts, model.json, extraction report (trust ledger)
modality check          → verdicts + traces (+ auto-generated *.replay.test.tsx per violation)
modality replay <trace> → runs one generated test, prints §1 verdict with divergence step
modality conform        → MBT mode (§5), conformance metrics per transition
CI gate                 → check (fail on violation reproduced or on trust-ledger regression,
                          e.g. new global taint, conformance pass-rate drop, stale model hash)
```

Failure policy in CI deserves one explicit rule: a **violated property whose replay is `not-reproduced`** fails CI *softly* (annotation, not red) by default — it is a model maintenance task, and making it red trains teams to delete properties. A reproduced violation is red. Teams can harden this once their model stabilizes.

## 8. Repository conformance matrix and real-app canaries

The `modality-ts` repository maintains two manifest-driven validation layers beyond
per-app `modality ci`:

### Conformance matrix

`test/conformance/matrix.json` is the semantic conformance matrix:

- **Rows** are behavioral capabilities (`features`), not library marketing names.
- **Columns** are framework/library/source targets (`targets`) such as `react-use-state`
  or `react-router`.
- A **supported** cell requires at least one canonical fixture under
  `test/conformance/fixtures/<fixture-id>/`.

Fixture workflow:

1. add or extend a feature row in `matrix.json`;
2. add a canonical fixture with `fixture.json` and a minimal app under
   `test/conformance/fixtures/<fixture-id>/`;
3. wire the fixture id into the supported cell for the relevant target column;
4. run `rtk pnpm ci:conformance`.

The runner (`tools/conformance/runner.ts`) calls the public CLI command wrappers
(`runExtractCommand`, `runCheckCommand`, `runConformCommand`) and writes a
`ConformanceMatrixReport` to a temp directory — never under fixture roots.

### Real-app canaries

`test/canaries/canaries.json` lists local example apps and planned canary slots.
Canaries find **missing abstraction boundaries** — they are not the design oracle.
A canary failure should point back to a fixture gap, a matrix row, or a plan family
via structured `classifications` in the `CanaryRunReport`.

Run `rtk pnpm ci:canaries` for all active canaries. `rtk pnpm ci:examples` is a
compatibility alias for the demo-app seeded-bug acceptance canary.

### Thresholds, budgets, and classifications

Thresholds, state-space budgets, accepted caveats, and failure classifications live
in manifests — not in CLI flags or runner hard-coding. Shared gate helpers under
`tools/shared-gates/` implement one threshold and budget comparison path for both
runners.

Failure categories and suggested follow-up plan families:

| Category | Typical follow-up |
| --- | --- |
| `missing-semantic-abstraction` | semantic TypeScript foundation |
| `missing-adapter-capability` | adapter SPI |
| `syntax-recognition-gap` | framework-neutral IR/checker |
| `incorrect-ir-or-checker` | conformance matrix |
| `state-space-budget` | state-space economics |
| `environment-or-project-integration` | effects/async environment |
| `explicit-unsupported-behavior` | trust-ledger docs |
| `fixture-or-canary-invalid` | real-app canary |

Budget failures classify as `state-space-budget`. Manifest-owned budget fields
include states, edges, depth, frontier, dominant var values, state-space bits, top
contributor bits, and pending queue length (via bound hits).

Canaries and conformance fixtures compare **contributor budgets** (`stateContributors`
from extraction reports, per-slice economics from check reports) and **accepted caveats**
(manifest `acceptedCaveats` vs report caveat ids) — not only pass/fail verdicts. A
fixture may pass all properties yet fail a budget cap or introduce an unaccepted
`model-slack` caveat; runners surface these through `thresholdResults`, `budgetResults`,
`acceptedCaveats`, and `unacceptedCaveats` in matrix and canary reports.

### Public CLI surface

`modality matrix` and `modality canary` are deliberately **not** exposed. Matrix and
canary manifests are repo-maintainer configuration; package users run
`modality extract`, `modality check`, `modality ci`, `modality conform`, and
`modality replay` on their own projects.
