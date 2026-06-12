# modality-ts: A Model-Checking-Based Testing Tool for React — Design

## Context

Frontend bugs increasingly live in the *state-transition structure* of an app — invalid state combinations, async races, route/auth/cache inconsistency — rather than in rendering or local logic. Unit tests cover local functions; E2E tests cover a handful of linear paths. Neither explores the combinatorial space of event interleavings. The premise `UI = f(state)` suggests splitting verification: test `f` with existing tools (golden/visual/component tests), and verify the state-transition side with model checking.

**modality-ts** is a testing tool that extracts a finite state-transition model from a React + TypeScript application (state sources: `useState`, Jotai, SWR), checks developer-defined properties against it with a model checker, and turns counterexamples into replayable component tests.

Detailed specifications for the difficult subsystems live in `docs/specs/`:

- [`specs/01-ir.md`](specs/01-ir.md) — the transition-system IR (the contract between extractor, checker, exporter, and replay)
- [`specs/02-extraction.md`](specs/02-extraction.md) — the algorithm for converting TypeScript code into the IR
- [`specs/03-checker.md`](specs/03-checker.md) — the custom TypeScript explicit-state model checker
- [`specs/04-conformance.md`](specs/04-conformance.md) — counterexample concretization, replay tests, and model–code conformance
- [`specs/05-architecture.md`](specs/05-architecture.md) — software architecture: package layout, vertical slicing, and the state-source plugin contract
- [`implement.md`](implement.md) — implementation flow and per-phase verification gates

Two worked examples apply the specs end-to-end and drive their refinement: [`examples/todo-walkthrough.md`](examples/todo-walkthrough.md) (a small ToDo app; introduced step invariants and `enabled`) and [`examples/checkout-walkthrough.md`](examples/checkout-walkthrough.md) (a multi-step checkout with 52 properties; introduced relational list data, multi-parameter cache keys, op-argument snapshots, and conditional reachability). Several spec sections below were extended as a result of these exercises.

## 0. Summary of design decisions

| Question | Decision |
|---|---|
| Is the idea sound? | Yes, with one architectural correction: **fully automatic model extraction is infeasible**. Design for *extraction-assisted modeling* plus *conformance testing* of the model against the real app. |
| Backend | **Custom explicit-state checker in TypeScript**, over a transition-system IR that can later export to TLA+/TLC or nuXmv. Alloy is viable (Alloy 6 has LTL) but not the best fit. |
| Formal model | Finite labeled transition system: abstracted state vector (route, atoms, useState, SWR cache, pending requests) + atomic event-level transitions; async modeled as split request/response transitions with environment nondeterminism. |
| Property language | TypeScript-embedded DSL: plain TS predicates over the typed state vector + a small temporal combinator set (`always`, `never`, `leadsToWithin`, `reachable`). Not raw LTL/CTL, not Alloy assertions. |
| State-space control | Sound: type-driven + predicate abstraction, per-property cone-of-influence slicing, explicit bounds reported honestly. Heuristic: guided/random exploration, clearly labeled "testing, not verification." AI: allowed to *suggest and explain*, never to *prune or vouch*. |
| Counterexamples | User-meaningful event traces with state diffs and source locations; auto-generated React Testing Library + MSW replay test (which doubles as the conformance check). |
| Positioning | A third layer between unit and E2E tests: exhaustive (within bounds) exploration of event interleavings. It does not verify rendering, value computation, or anything outside the model. |
| MVP | One seeded-bug demo app, invariants + bounded response properties, extraction of state inventory + simple transitions, manual overlay for the rest, BFS checker, replayable counterexamples. |

---

## 1. Is the idea technically sound?

### Where it is strong

- **The restricted scope makes state inventory extraction genuinely tractable.** `useState` calls, module-level Jotai `atom()` declarations, and `useSWR(key)` call sites are syntactically identifiable with the TypeScript compiler API. Jotai is the best case: atoms are global, declared statically, and derived atoms (`atom(get => ...)`) hand you a dependency graph and pure derivations for free.
- **TypeScript types do half the abstraction work.** A state variable typed `'idle' | 'loading' | 'success' | 'error'` or a discriminated union *is* a finite domain — no abstraction needed. Idiomatic typed React code already encodes much of its state machine in its types.
- **SWR doesn't need extraction at all.** It has a well-understood per-key state machine (no-data / validating / data / error, plus revalidation triggers, deduplication, cache persistence across mounts). Model the library *once*, by hand, carefully — a parameterized template instantiated per extracted key. This is the standard model-checking move for trusted runtimes, and it is far sounder than analyzing SWR's source.
- **The bug class targeted is real and badly served today.** Out-of-order response races, double-submit, back-button auth bypass, stale-cache-after-logout — these are interleaving bugs. Example-based tests (unit or Playwright) check one interleaving each; the interesting failures live in interleavings nobody wrote a test for. Exhaustive exploration is exactly the right tool shape here.

### Where it will fail, and the architectural consequence

- **Transition-effect extraction from arbitrary handler bodies is undecidable and, in practice, brittle.** `onClick={() => setX(f(y, z))}` with nontrivial `f`, callbacks passed through props, dynamic dispatch, custom hooks wrapping hooks — static analysis will extract a *subset* of transitions correctly, over-approximate some (model the write as "could become anything in its domain" — a havoc), and *miss* others entirely. Over-approximation is acceptable (sound for safety properties; costs false positives). Missed transitions are fatal: they produce false "verified" results, which is the one failure mode a verification tool must not have.
- **Unbounded data domains.** Strings, arrays, and server payloads have no finite domain. Verification requires abstraction (e.g., `user` → `null | present`; `items` → length 0/1/many), and choosing good abstractions requires human judgment about which distinctions matter.
- **React render-level semantics.** Batching, stale closures, effect ordering, concurrent features. Modeling at render granularity explodes the state space and the extraction burden. The design choice: model at **event granularity** — each user event or async completion is one atomic transition from settled state to settled state (with `useEffect`-driven reactions folded in via run-to-completion stabilization; see `specs/01-ir.md`). This deliberately gives up on stale-closure and batching-artifact bugs (a documented limitation) in exchange for a tractable model that still captures the async-race bug class.
- **The model–code conformance gap is the central risk of the whole idea.** A verified model proves nothing about an app that diverges from it. Every model-based testing effort in history has died or thrived on this gap.

### Consequence: two design commitments

1. **Extraction-assisted modeling, not automatic extraction.** The tool extracts the state inventory and a transition skeleton, classifies each extracted transition as *exact* / *over-approximated* / *unextractable*, and requires the developer to resolve the last category in a small overlay file (`*.model.ts`). The tool must never silently guess; "I couldn't model this handler" is a first-class output.
2. **Conformance testing closes the gap.** Because the model's transitions are labeled with concrete app events (click target, route change, mocked network outcome), any model trace can be compiled into an executable component test. Counterexample traces are replayed against the real app; if the real app does *not* exhibit the violation, that is a model bug, reported as such. Periodically replaying random model traces (model-based testing) keeps the model honest beyond counterexamples. Verification of the model + testing of conformance is the honest contract; "verification of the app" is not on offer.

**Verdict: sound as a bounded-verification + model-based-testing tool. Not sound as an "automatically verify my React app" tool, and the design must never market itself as the latter.**

## 2. Choice of model checking backend

### Candidates evaluated

| Backend | Fit | Key problem |
|---|---|---|
| **Alloy 6** | Viable. `var` fields + LTL (since 2021) cover temporal properties; Analyzer gives instant feedback; bounded scopes match our bounded philosophy. | Its distinguishing power — relational logic over rich object graphs — goes unused: abstracted frontend state is mostly enums and small records. Costs remain: JVM dependency, a second language for generated specs, trace counterexamples extracted via XML/Java API, weak integer/sequence handling, confusing scope semantics for users. Paying Alloy's costs without using Alloy's strengths. |
| **TLA+ / TLC** | Strong. Action-based semantics map 1:1 onto our transitions; mature explicit-state checker; fairness and liveness; battle-tested. The best *industrial* choice if generating specs for an external checker. | Java toolchain; generated-TLA+ counterexamples must be parsed and mapped back; developer-supplied predicates would need TS→TLA+ translation, which is a fragile, semantics-laden compiler of its own. |
| **nuXmv / NuSMV** | Good semantic match (finite Kripke structures, LTL/CTL, clean machine-readable traces; symbolic engines scale past explicit state). | Same foreign-toolchain and predicate-translation problem; awkward for even bounded collections; licensing friction (nuXmv is no-cost but not open source). |
| **SPIN / Promela** | Process model is nice for concurrent async ops. | Everything else is a poor fit: C-ish data modeling, embedded-C escape hatches, weakest mapping to typed app state. |
| **SMT-based BMC (Z3)** | Maximum flexibility; good for unbounded data later. | You build the entire checking methodology yourself; bounded only; liveness requires extra machinery. Wrong place to spend MVP effort. |
| **Custom explicit-state checker in TypeScript** | See below. | Forgoes 25 years of checker engineering (partial-order reduction, symmetry, symbolic states); risk of checker bugs. |

### Recommendation: custom explicit-state checker in TypeScript, with an IR escape hatch

The decisive observation: **the binding constraint for this tool is not checker throughput — it is model fidelity and developer experience.** After abstraction, realistic frontend models have 10³–10⁷ states, comfortably within a naive BFS in a JS runtime. Meanwhile, every external backend imposes a *translation layer in both directions*: developer-written TS predicates must be compiled into the spec language, and counterexamples must be parsed back and mapped to app concepts. That layer is a permanent source of bugs and friction, and it forbids the single best DX feature available: **letting transition effects and property predicates be ordinary TypeScript functions over the app's own types** — executed directly by the checker, type-checked by `tsc`, autocompleted in the editor, and reusable as runtime dev-mode assertions.

Concretely:

- Model = a transition-system IR: typed state vector, initial states, guarded transitions whose effects may return multiple successors (nondeterminism). See `specs/01-ir.md`.
- Checker = BFS over canonicalized states for invariants — BFS guarantees *shortest* counterexamples, which matters more for DX than speed. Bounded-response properties check on the same search via a budgeted universal sub-search. Full liveness/fairness (nested DFS / SCC fair-cycle detection) is deferred; bounded response covers the MVP's needs without fairness subtleties. See `specs/03-checker.md`.
- **Escape hatches that keep this honest:** the IR is serializable, and an `export --tla` / `export --smv` path (i) provides differential testing of our checker against TLC/nuXmv on the same models — the mitigation for "custom checker bugs" — and (ii) provides a scale path if a real model ever exceeds explicit-state reach. Exported specs use only the structured IR (enums, bounded ints), not arbitrary TS predicates, so the export is mechanical.

Trade-offs accepted: no partial-order reduction or symbolic engine on day one (acceptable at target scale; POR can be added for commuting async completions later); we own correctness of the checker core (small, heavily tested, differentially validated); liveness arrives late (bounded response is arguably the more useful property form for frontend anyway: "submit reaches success or error within 3 environment steps" beats "eventually").

Alloy remains genuinely useful as a *design sketchpad* — hand-writing a small Alloy 6 model of, say, the SWR cache + auth flow is a cheap way to validate the modeling approach before any code exists. Recommended as a spike, not as the backend.

## 3. The state and transition model

### Formal object

A finite labeled transition system `M = (S, S₀, A, →)` with states as abstracted snapshots and labels as app-meaningful events. Components of the state vector:

| Component | Source | Representation |
|---|---|---|
| Route | router (modeled abstractly; history bounded for back-button) | finite enum of route patterns + abstracted params; bounded history stack |
| Global state | Jotai atoms | abstracted value per atom; derived atoms as extracted pure expressions, else declared in overlay |
| Local state | `useState` per component instance, keyed by mounted route | abstracted values; **reset on unmount/remount** per React semantics |
| Server cache | SWR per modeled key | library-template instance: `{ data: ⊥ \| token, isValidating, error }` + revalidation/dedup behavior from options |
| In-flight ops | pending fetches/mutations | bounded multiset of pending requests (the concurrency bound) |

### Transition classes

- **User events**: clicks, submits, input changes — abstracted to their state effect (e.g., input abstracted to `setFieldValidity(valid|invalid)`, not character strings). These run the extracted/annotated handler effect atomically.
- **Navigation**: push/replace/back; triggers unmount (local-state reset) and mount (initial states, SWR revalidation per template).
- **Async split-transitions**: an initiating event *enqueues* a pending request; a separate **environment transition** later resolves it with a nondeterministic outcome (`success(abstractData) | error`) and nondeterministic *ordering* relative to other pending requests and user events. This is where the race bugs live, and the model gets them for free from interleaving.
- **Internal (reactive) transitions**: `useEffect` bodies that write modeled state, fired eagerly under run-to-completion stabilization after each event (see `specs/01-ir.md §5`). Auth-guard redirects (`useEffect(() => { if (!user) navigate('/login') })`) live here.
- **Revalidation events**: SWR focus/interval revalidation modeled as nondeterministically enabled environment events (a major source of real-world surprise behavior).

### Environment assumptions

The server is pure nondeterminism by default, optionally constrained by developer-declared assumptions (`assume('POST /login', r => r.ok implies r.token !== null)`). Assumptions are part of the trust base and listed in the verification report.

### Known, documented exclusions

Render-level effects (stale closures, batching artifacts, effect ordering relative to paint), refs/imperative DOM, third-party component internal state, `useReducer`/Redux/Zustand/TanStack Query (later), value computation inside handlers (abstracted or havoc'd), components rendered multiple times under one route (lists of stateful children) in v1.

## 4. Property specification

**Decision: a TypeScript-embedded DSL.** Predicates are plain TS functions over the typed, named state vector that extraction produces; the temporal layer is a deliberately small combinator vocabulary:

```ts
// app.props.ts — type-checked against the extracted state type
import { always, alwaysStep, leadsToWithin, onEvent, reachable, enabled } from 'modality';
import { M } from './app.model'; // generated state type

export const authGuard = always(M, s =>
  s.route === '/admin' ? s.session.kind === 'authenticated' : true);

export const noDoubleSubmit = always(M, s =>
  s.pending.count('POST /orders') <= 1);

export const submitResolves = leadsToWithin(M,
  onEvent('CheckoutPage.submitOrder'),
  s => s.order.kind === 'success' || s.order.kind === 'error',
  { budget: { environment: 3 } });

export const checkoutReachable = reachable(M, s => s.route === '/checkout');

// step invariant: constrains actions/edges, not states — "an unauthenticated
// session can never *trigger* an order request" (the state-invariant version is
// reachably wrong: logout while a request is in flight legally yields
// guest ∧ pending — see examples/todo-walkthrough.md §4.1)
export const guestCannotOrder = alwaysStep(M, (pre, step) =>
  !(step.enqueued('POST /orders') && pre.session.kind !== 'authenticated'));

// enabledness: "logout must remain possible in every error state"
export const logoutAvailable = always(M, s =>
  s.session.kind !== 'authenticated' || enabled(M, 'Header.logout')(s));
```

Why this and not the alternatives:

- **Raw LTL/CTL**: the audience is frontend developers; `G (admin -> auth)` vs `AG` vs `U`-operator precedence is a wall. Worse, LTL formulas can't be type-checked against app state. The combinators *compile to* the small LTL fragment the checker supports — the logic is there, the notation isn't.
- **Alloy-style assertions**: a second language, no editor support against app types, and relational quantification power that the abstracted state doesn't need.
- The embedded form has a bonus: the same predicates can run as **dev-mode runtime assertions** in the real app, giving a second, cheap conformance signal in ordinary E2E runs.

### Design principle: usability at the surface, standard semantics underneath

When the two pull apart, **practical usability wins at the surface; standard modal logic governs underneath** — and the boundary between the layers is strict.

Usability wins the surface for a reason beyond audience: notation standardity does not prevent misformalization. `G(guest → ¬pendingPOST)` is perfectly standard LTL and is exactly the *wrong* formalization of "a guest cannot trigger a submit" (the walkthrough's logout-while-in-flight trace falsifies it legally); what prevents the mistake is a combinator shaped like the developer's intent (`alwaysStep` + `step.enqueued`). Worse, LTL is state-based, so action properties need history-variable encodings that non-specialists get wrong *silently*. Precedents point the same way: TLA+ spread among engineers on the `□`/leads-to idioms rather than full LTL nesting, while Quickstrom's own reports name its full-LTL surface as the adoption bottleneck.

Standardity still governs underneath because the failure mode of pure pragmatism is **semantic drift** — combinators meaning "whatever the checker happens to do," which makes verdicts unfalsifiable and destroys both the TLA+/SMV export and differential testing (Spec 03 §9), since cross-checking two checkers requires an independent definition of what the property means. Hence two standing rules:

1. **The combinator set is closed.** No user-defined temporal operators, no free nesting of temporal combinators (predicates inside them are arbitrary TS; the temporal shell is fixed). Missing expressiveness is met by adding *one* well-defined combinator — as the walkthrough did with `alwaysStep` and `enabled` — never by opening the surface to raw LTL/CTL.
2. **Every combinator has normative formal semantics over the LTS**, recorded in the table below; the exporter translation and the differential tests are checked against these definitions, not against the implementation.

| Combinator | Normative semantics over `M = (S, S₀, A, →)` (stabilized states/edges) |
|---|---|
| `always(p)` | `G p` — `p` holds in every reachable state |
| `alwaysStep(q)` | action invariant: `q(s, t, s′)` holds for every reachable edge `s →t→ s′` (the TLA `□[A]` tradition) |
| `reachable(p)` | existential witness `EF p`; exhaustion without witness = "unreachable within bounds" (vacuity warning, not a pass) |
| `enabled(t)` | state predicate: `guard_t(s) ∧ mounted_t(s)` — exact, since guards are structured IR |
| `leadsToWithin(trig, goal, k)` | for every reachable edge satisfying `trig`: all continuations admitted by the scheduler constraint reach `goal` within budget `k` — deliberately *not* textbook LTL, so its full definition (budget accounting, scheduler constraint, deadlock case) is normative in Spec 03 §6 |
| `reachableFrom(when, goal)` | `AG(when → EF goal)` (CTL): from every reachable `when`-state, some path — user steps plus a *cooperative environment* — reaches `goal`; checked by backward reachability over the explored graph (Spec 03 §5). Counterexamples are non-replayable by nature (they assert path absence): a witness `when`-state plus an exhausted-search certificate |

**Expressible in v1:** state invariants (incl. route guards, mutual exclusion, cross-source consistency like "cache cleared when logged out"); **step invariants** (`alwaysStep` over `(pre, step, post)` edges) — required whenever the English property constrains *actions* ("cannot trigger", "must not clear") rather than states, which turned out to cover most action-flavored properties in practice; **enabledness** (`enabled(transitionId)` inside predicates — "X must remain possible"; sound because guards are structured IR); bounded response (`leadsToWithin`); *conditional reachability* (`reachableFrom` — "from any state with a valid payment method, review remains reachable"; the checkout walkthrough's P46–P52); and *reachability sanity checks* — vacuity detection matters, because an over-constrained model "verifies" everything. **Deferred:** unbounded liveness with fairness, past-time operators, scoped until/weak-until (the checkout walkthrough's P44 "thereafter" — covered in v1 by the stale-resolve frame idiom over op-argument snapshots), hyperproperties.

## 5. State-space control

Explosion sources, in order of severity: data domains ≫ pending-request interleavings > number of state variables > route history depth.

### Sound reductions (result still reads "verified within stated bounds")

1. **Type-driven abstraction** — finite union/literal types used exactly; this is free and lossless.
2. **Declared predicate abstraction** — for non-finite domains, developer (or extraction default) declares the distinctions that matter (`user: null | present`; `items.length: 0 | 1 | many`). Writes the abstraction can't track precisely become havoc (any abstract value) — over-approximation, sound for safety, may yield spurious counterexamples that the conformance replay will expose as model artifacts.
3. **Per-property cone-of-influence slicing** — check each property against only the state variables that transitively influence its predicates (read/write sets from the IR). Sound given a conservative dependency graph; typically the single biggest win.
4. **Explicit bounds, honestly reported** — ≤K pending requests, ≤H history depth, ≤N trace length. This is bounded verification in the Alloy small-scope tradition; the report must say "verified for up to 2 concurrent requests," never "verified."
5. (Later) **Partial-order reduction** over provably commuting async completions; **symmetry** over interchangeable keys.

### Heuristic reductions (result reads "tested, not verified")

Randomized/guided exploration beyond bounds, interleaving prioritization (e.g., explore response-reordering first), swarm-style restarts. Useful as a fallback mode; the report must visibly downgrade its claim.

### AI assistance: a bright line

- **Safe (additive or human/checker-validated):** suggesting abstraction predicates, suggesting candidate properties from code ("this looks like an auth guard"), drafting overlay annotations *that the developer reviews*, explaining counterexamples in prose, mapping traces to likely root causes. In every case, either a human reviews the artifact or the checker/conformance-replay validates it; an LLM error degrades into a false alarm or a rejected suggestion.
- **Unsafe (subtractive or trust-bearing):** AI-pruned state spaces, AI-asserted transition semantics that enter the model unreviewed, AI-judged "this counterexample is spurious, suppress it." Any of these silently converts "verified" into "unsoundly verified," which destroys the tool's only differentiated promise.

Rule of thumb: **AI may add behaviors, candidates, and explanations; it may never remove behaviors from the model or vouch for conformance.**

## 6. Counterexamples and developer experience

### What a useful counterexample is

A shortest (BFS) trace of *user-meaningful* events with per-step state diffs and source anchors:

```
✗ noDoubleSubmit violated (4 steps)
  1. navigate /checkout            route: /home → /checkout
  2. click "Place order"           pending[POST /orders]: 0 → 1   (CheckoutPage.tsx:41)
  3. click "Place order"           pending[POST /orders]: 1 → 2   ← violates noDoubleSubmit
     hint: submit handler has no guard on order.kind === 'submitting'
  Property: app.props.ts:9   |   Bounds: ≤2 pending, trace ≤12   |   Abstractions: 3 (listed)
```

### Replay tiers

1. **Abstract trace** (always): pretty-printed + JSON.
2. **Generated component test** (MVP): React Testing Library + MSW, with network outcomes and orderings forced to match the trace (all model nondeterminism is environment events, so it is controllable by construction: MSW for network, fake timers for time). **This is also the conformance check** — if the replayed test passes (no violation in the real app), the tool reports a *model-only counterexample*: a model bug to fix, not an app bug. Both outcomes are valuable; neither is silent. See `specs/04-conformance.md`.
3. **Playwright script** (later): for traces whose events all map to real DOM interactions.

### Workflow integration

`modality.config.ts` (entry points, routes, bounds) + generated `app.model.ts` (state types + extracted skeleton, regenerated; annotations live in a separate overlay so regeneration doesn't clobber them) + `*.props.ts`. CLI: `modality extract`, `modality check [--watch]`, `modality replay <trace>`. CI: bounded checks are deterministic and fast (seconds–minutes at MVP scale) → a normal CI gate; the report artifact states bounds, abstractions, assumptions, and unmodeled handlers — the honesty ledger. A stale-model detector (extraction diff vs. last verified model) fails CI when code changed under an unregenerated model.

## 7. Relationship to existing testing

| Layer | Verifies | This tool's relationship |
|---|---|---|
| Unit tests | value computation inside `f` and handlers | complementary — exactly what the model abstracts away |
| Component/golden/visual | rendering: `UI = f(state)` for sampled states | complementary — the tool can *supply* reachable states worth golden-testing |
| Playwright E2E | a few real end-to-end paths, full integration | complementary — the tool explores *all* interleavings of an abstracted model; E2E checks *one* path of the real system |
| **modality-ts** | **all event interleavings of the modeled state layer, within bounds** | the layer nothing else covers |

**Can guarantee:** within the stated bounds, abstractions, and environment assumptions, no reachable model state violates the properties — exhaustively, including every async interleaving, which no test suite samples.

**Cannot guarantee:** rendering correctness; handler value-computation correctness; anything beyond the bounds; behaviors of unmodeled code; and — fundamentally — that the model matches the app (conformance is *tested* via replay and runtime assertions, never proven). Honest one-line positioning: *an exhaustive, replayable test generator for state-transition bugs, with verification-grade reasoning inside the model.*

## 8. MVP proposal

**Slice: "verify the auth/checkout flow of one demo app and find three seeded interleaving bugs that its Playwright suite misses."**

In scope:
- Extraction: Jotai atoms + `useState` with finite/discriminated-union types; `useSWR` keys → library template; route list from config (not router introspection); transition effects extracted only for the M0 syntactic class (`specs/02-extraction.md §6`); everything else emitted as a typed TODO in the overlay file.
- Checker: explicit-state BFS, invariants + `leadsToWithin` + `reachable`, canonical hashing, bounds from config.
- Output: trace format above + generated RTL+MSW replay test.
- Demo app with three seeded bugs: (a) double-submit race creating two orders, (b) back-button reaches an authed route after logout, (c) SWR cache shows stale user data after account switch.

Out of scope for MVP: liveness/fairness, POR/symmetry, Playwright replay, TLA+/SMV export (stub the IR serialization only), AI assistance, any state library beyond the three.

**PoC success criteria (and failure criteria — equally important):**
1. All three seeded bugs found, each with a shortest trace, total check time under ~1 minute.
2. ≥2 of 3 replay tests reproduce the violation in the real app (conformance machinery works end-to-end).
3. A developer without formal-methods background writes the three properties in under an hour using only the README.
4. **Kill signal:** if modeling the ~5-screen demo app requires more than ~100 lines of manual overlay annotations, the extraction value proposition has failed and the project should pivot (e.g., toward "model-check your explicitly-written XState machines" instead of extraction).

## 9. Research and product potential

**Honest classification: research prototype first, plausible internal tool second, general-purpose product a long shot.** The history of this space — model-based GUI testing, ESC/Java-style annotation tools, QuickCheck-family adoption outside niches, Quickstrom — shows the recurring killers: annotation burden, the conformance gap, and developers not knowing what properties to write. The design addresses each (extraction assist, replay-based conformance, property templates/AI suggestions) but none is fully solved.

**Strongest use cases:** auth/authorization route guards; multi-step wizards and checkout flows; optimistic updates + cache consistency; double-submit and response-reordering races. Common thread: high cost of failure, state-shaped logic, async nondeterminism — i.e., where exhaustive interleaving exploration beats more example tests.

**Adjacent prior art to track:** Quickstrom (LTL over real browser runs — testing-side sibling), XState + `@xstate/test` (developer writes the machine explicitly — the pivot target if extraction fails), TLA+-in-industry practice (modeling culture this tool tries to automate the entry into).

**Biggest adoption risks:** (1) extraction fidelity treadmill against React ecosystem churn; (2) a single false "verified" destroying trust — hence the obsessive honesty-ledger framing; (3) the cheaper-alternative squeeze: "just add Playwright tests + an LLM to write them" satisfies most teams even where it's strictly weaker; (4) property-writing remains a skill most frontend teams haven't built. The research contribution is real regardless of product outcome: a worked answer to *how much formal model can be extracted from typed idiomatic React, and how to keep it honest*.
