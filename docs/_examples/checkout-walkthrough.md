# Worked Example 2 — Checkout/Purchasing App

Status: thought experiment, executed against Specs 01–04 *after* the ToDo walkthrough's refinements. The subject is a multi-step subscription checkout (plan → billing → review → success) with three Jotai atoms (`auth`, `cart`, `checkoutStep`), two `useState`s (`selectedPaymentMethodId`, `submitStatus`), two SWR hooks (quote with a five-parameter key; payment methods), and 52 developer-stated properties. Source: `state.ts`, `api.ts`, `App.tsx`.

This walkthrough deliberately skips what the ToDo walkthrough already established (step vs. state properties, `disabled` guards, predicate matching, basic async splitting) and focuses on what is *new* at this scale: relational list data, multi-parameter cache keys, payload refinement, op-argument snapshots, conditional reachability — and the first genuinely multi-step counterexamples. §6 lists the spec gaps found and where they were folded back.

## 0. Verdict summary (52 properties)

| Group | Holds | Violated | Other |
|---|---|---|---|
| Auth / screen transitions (P01–P08) | P02–P07 | **P01, P08** (stale submit continuation, §4 V1) | |
| Plan / quote (P09–P17) | P09–P13, P16, P17 | **P14, P15** (billing gate skips quote validity, §4 V4) | |
| Billing / payment method (P18–P24) | P18–P24 | | |
| Review / submit (P25–P37) | P25, P26, P28–P33, P35–P37 | **P27** under the strict reading of "stale" (§5.3) | P34 holds as a frame property (§5.4) |
| Async / stale responses (P38–P45) | P38, P39, P41 | **P40, P43** (V1), **P44** (V2), **P45** (V3) | P42 **vacuous** (§5.2) |
| Reachability / liveness (P46–P52) | P46, P47, P49–P52 | | P48 violated *as stated*, holds after premise refinement (§5.1) |

Seven genuine app bugs from one root cause (the unguarded `submitOrder` continuation) plus one gate omission (`canGoBilling` ignores quote validity). All violating traces replay-reproducible; the reachability verdicts are non-replayable by nature.

## 1. Extraction: the five new problems and their resolutions

### 1.1 The five-parameter quote key (key-window cache modeling)

`quoteKey = ['quote', userId, plan, seats, billingCycle, couponCode]`. Naively instantiating the SWR template per abstract parameter combination yields `1 × 3 × 3 × 2 × 2 = 36` cache entries — each with `data × isValidating × error` — which multiplies the state space by several orders of magnitude for no property-relevant reason. Resolution (now Spec 01 §9): the template tracks **full entries only for a bounded window of recently-current keys** (default W=2: current + previous); evicted entries collapse to a summary, and a key re-entering after eviction gets a **havoc'd entry** (sound over-approximation) while key-change revalidation still fires. Two semantics are load-bearing and now explicit in the template spec:

- **per-key isolation** — a resolve writes only to its op's key entry, never to "the current view";
- **the view reads the current key only**, exposing `active: false` when the key expression is `null`.

P38/P39/P41 hold or fail *through these two rules* — they are template invariants, which is exactly where they should live (differentially tested against real SWR, not re-derived per app). W=2 makes plan-toggling (A→B→A) precise; three-way toggles hit the window bound and surface in the trust ledger.

### 1.2 Relational list data (`find` over payment methods)

`paymentMethods?.find(m => m.id === selectedPaymentMethodId) ?? null` is a *relational* read: local state holds an identity into server data. `lengthCat` cannot express it — P20/P22/P30/P42 need per-item `expired` and id equality. Resolution: payload refinement to `boundedList({id: tokens, expired: bool}, maxLen: 2)` (brand/last4 pruned — only rendered), `selectedPaymentMethodId: option(tokens)` sharing the same token family (cross-variable token equality is already preserved by whole-state canonical renaming, Spec 03 §2). The `find` itself: **bounded-list comprehensions** (`find`/`some`/`every` with M0 lambdas) are now M0 expressions, unrolled at extraction into cond-chains over indexed reads — a finite disjunction, so the IR stays closed (no new node kinds, per the architecture rule).

### 1.3 List-rendered event handlers (indexed event families)

The payment-method radios live inside `paymentMethods.map(...)` — previously specs only said "stateful list items ⇒ unextractable." These items have no hooks, only event props closing over the item, which is tractable: extraction now generates an **indexed family** — one transition per index `i < maxLen`, guarded by "element `i` exists" ∧ item-level attributes (`disabled={method.expired}` ⇒ `¬xs[i].expired` — which *is* P20), with the loop variable bound to `xs[i]`. Replay uses positional locators (the *i*-th radio), deterministic because the witness factory fixes list order.

### 1.4 Payload refinement (`quote.total > 0`)

`Quote.total: number` defaults to `tokens(1)`, which cannot express P14's `total > 0`. `refine` previously targeted only state vars. Resolution: `overlay.refinePayload('POST /api/billing/quote', 'total', { nonpositive, positive })` — refinement of an effect-API outcome field, with D-recursion, pruning (subtotal/discount collapse — only rendered), and predicate matching (`quote.total > 0` → `total = 'positive'`) applying to payloads exactly as to state vars. The quote success outcome becomes `success(total ∈ {nonpositive, positive}, couponValid ∈ bool)` — 4 outcomes the environment chooses among, which is precisely the nondeterminism P14/P15 need.

### 1.5 Inputs with transforms and selects

`setSeats(Number(e.target.value))` previously fell to havoc (not replay-splittable); now value-coercing transforms from an allow-list (`Number`, `String`, `.trim()`, `.toLowerCase()`) compose with the per-class split, with witnesses declared as pre-transform input strings (`'0' / '5' / '500'` for `{tooFew, valid, tooMany}`, validated against their predicates at extract time). The `<select>` for billing cycle derives its two value classes from the JSX `<option>` literals. `couponCode` needs only `tokens(2)` — its *value* never matters locally, but its *change* must be observable (it is a key component; P16, P41).

**Overlay budget for this app**: seats refinement + quote payload refinement + payment-methods list refinement + coupon token count + input witnesses ≈ **30–40 lines**. Under the 100-line kill criterion (design §8), but no longer trivial — an honest data point: relational payloads are where overlay cost concentrates.

## 2. The model

State vector: `auth(2) × cart{plan(4) × seats(3) × cycle(2) × coupon(2)} × step(4) × selectedPM(option·tokens) × submitStatus(3) × quote-window(2 entries: data ∈ {⊥} ∪ 2×2, validating, error, + key ids) × pm-cache(data ∈ {⊥} ∪ lists≤2, validating, error) × pending(quote GETs ≤2, PM GET ≤1, order POSTs ≤2 — POST args carry the enqueue-time snapshot: plan × seats × cycle × coupon × total × userId)`.

Unsliced reachable estimate: ~10⁵–10⁶ stabilized states — the first model where **slicing is necessary rather than cosmetic**. Per-property cones: the billing/payment group (P18–P24) drops the entire quote window (~30× reduction); the plan/quote group drops payment methods and `submitStatus`; only the async group (P38–P45) needs most of the vector. Checker time: seconds per slice group at Spec 03's throughput target. Bounds in the trust ledger: key window W=2, POST pending ≤2, list ≤2, token budgets.

## 3. Formalization patterns (representative; the rest are isomorphic)

Gate properties (P09–P15, P17, P21–P24) are one reusable step-predicate per gate — composition is plain TS, which is the payoff of the embedded DSL at 52-property scale:

```ts
const proceedsToBilling = (step: Step) => step.navigatedTo('billing'); // goBilling edge
const gate = (name: string, bad: (pre: ModelState) => boolean) =>
  alwaysStep(M, (pre, step) => !(proceedsToBilling(step) && bad(pre)), { name });

export const p09 = gate('P09', pre => pre.cart.plan === null);
export const p14 = gate('P14', pre => swrView(pre, 'quote').data?.total !== 'positive');
```

The new patterns:

- **Op-argument snapshots** (P43, P45): the pending op's args *are* the epoch — no ghost state needed because the code happens to pass the identifying data:

```ts
export const p43 = alwaysStep(M, (pre, step, post) =>
  !(step.resolved('POST /api/orders', 'success') && post.step === 'success') ||
  (post.auth.kind === 'user' && step.op.args.userId === post.auth.userId));

export const p45 = alwaysStep(M, (pre, step, post) =>
  !(step.resolved('POST /api/orders', 'success') && post.step === 'success') ||
  cartMatchesArgs(post.cart, step.op.args));
```

- **Stale-resolve frame** (P44's "thereafter" without temporal operators — see §5.4):

```ts
export const p44 = alwaysStep(M, (pre, step, post) =>
  !(step.resolved('POST /api/orders') && pre.auth.kind === 'guest') ||
  post.submitStatus === pre.submitStatus);
```

- **Conditional reachability** (P46–P52) — new combinator `reachableFrom(when, goal)` = `AG(when → EF goal)`, checked by backward reachability over the explored graph:

```ts
export const p52 = reachableFrom(M,
  s => s.submitStatus === 'failed',
  s => enabled(M, 'CheckoutApp.submitOrder')(s));
```

Its `EF` deliberately assumes a *cooperative environment* (the server may answer success on some path) — the right reading of "remains possible," stated in the report. Its counterexamples are **non-replayable by nature** (they assert path absence): a trace to the witness state plus an exhausted-search certificate.

- **SWR-disabled** (P02/P03): `always(s => s.auth.kind !== 'guest' || !swrView(s, 'quote').active)` — via the template view's new `active` flag.

## 4. The violations

**V1 — stale success continuation (P01, P08, P40, P43).** Shortest trace, 10 macro-steps:

```
✗ P08 violated (10 steps)                                    [slice: full]
  1. click "Login"                 auth: guest → user(u1)   ⤷ PM fetch enqueued
  2. resolve GET paymentMethods    success([{id:m1, expired:false}])
  3. click "Pro"                   cart.plan: null → pro    ⤷ quote fetch enqueued
  4. resolve POST quote            success(total:positive, couponValid:true)
  5. click "Continue to billing"
  6. select payment method [0]     selectedPM: null → m1
  7. click "Review order"          step: billing → review
  8. click "Submit order"          submitStatus → submitting; POST orders pending
                                   (args: u1, pro, valid, monthly, c0, positive)
  9. click "Logout"                auth → guest; step → plan; cart reset; PM → null;
                                   submitStatus → idle      (POST still in flight)
 10. resolve POST orders success   step: plan → success     ← guest ∧ step='success'
     continuation CheckoutApp.submitOrder#1 (stale-read flag from extraction)
```

Replay: **reproduced** — the continuation runs unconditionally. The same edge violates P01 (guest ⇒ step='plan'), P40 (success after logout), and P43 (`args.userId = u1` but `post.auth.kind = 'guest'`). One root cause, four property hits — the report deduplicates by violating transition and says so.

**V2 — stale failure continuation (P44).** Same prefix; step 10 resolves `error` instead: `submitStatus: idle → failed` while guest. The "Order failed" alert would greet the next user of the shared machine. Reproduced.

**V3 — cart edited during in-flight submit (P45).** Steps 1–8 as above, then: `9. Back (review→billing)`, `10. Back (billing→plan)`, `11. click "Starter"` (cart.plan now `starter`, quote key changes, new fetch enqueued), `12. resolve POST orders success` → `step='success'` with `cart.plan='starter'` ≠ `args.plan='pro'`. The success page announces a subscription the UI no longer describes. Reproduced. (Note steps 9–10 are possible because nothing disables the Back buttons while `submitting` — the trace itself is the design-review artifact.)

**V4 — billing gate skips quote validity (P14, P15).** 5 steps: login → selectPlan → quote resolves `success(total: nonpositive, couponValid: true)` → "Continue to billing" fires — `canGoBilling` checks `!quoteLoading && !quoteError` but not `hasValidQuote`. The deeper invariant (cannot *submit* with an invalid quote) holds via `canSubmit`, so this is a gate-consistency bug, not a money-loss bug — the report's two verdicts together say exactly that.

**V5 — submit during revalidation (P27, strict reading).** Reach review validly, trigger `focus-revalidate` (env event), then "Submit order" is still enabled: `canSubmit` requires `!quoteLoading` but not `!quoteValidating`, and the POST carries the pre-revalidation `quote.total`. Whether this is a bug depends on what "stale" means — see §5.3.

## 5. Property-engineering lessons

**5.1 P48 was false as stated — and the counterexample is the fix.** "Valid quote + valid payment method on review ⇒ submit can be triggered" has a one-state counterexample: `submitStatus='submitting'` satisfies the premise while the button is disabled. The premise needed `submitStatus='idle'`. This is the checker as a *property debugger*: the English was underspecified, the witness state said exactly how.

**5.2 P42 is vacuous, and that's a verdict.** "A payment-methods response for an old userId must not validate the current selection" — but `login()` hardcodes `u1`; no reachable trace has two distinct users, so the premise never fires. The vacuity suite reports *premise unreachable* rather than a hollow "verified". (To make P42 meaningful the model needs `userId: tokens(2)` and a login that can choose — an overlay decision the report can suggest, but not make.)

**5.3 P27's "stale" is two different properties.** Under "stale = `isLoading`" it holds; under "stale = `isValidating`" it fails (V5). The tool cannot resolve English ambiguity — it can only make the choice explicit by demanding a predicate. Both formalizations ship in the walkthrough props file with the verdict difference annotated; the developer deletes the one they don't mean. This is a feature of forcing formalization, not a weakness of the property language.

**5.4 "Thereafter" wants Until — the closed combinator set held, with a caveat.** P44's natural form is `G(logout∧pending → (status='idle' W nextSubmit))` — weak-until, which v1 deliberately lacks. The stale-resolve frame idiom (§3) expresses the *enforceable core* via op args: stale completions must not touch the var. It is not literally equivalent (it wouldn't catch some *other* transition setting `failed` while guest — though P01/P08-style invariants would), and that gap is now recorded in design §4's deferred list as the concrete motivating case for a future scoped-until combinator. The closed-set policy worked as designed: pressure produced a documented idiom plus a deferral note, not an ad-hoc operator.

**5.5 P32 holds inside the bug.** "On success, step becomes success" is satisfied by the very continuation that causes V1 — it fires even for a guest. Same lesson as the ToDo walkthrough's §4.5, now with money involved: postcondition properties need their frame/staleness duals (`asyncOpContract` template, future work — this is the second walkthrough to independently want it, which promotes it from "nice" to "roadmap").

## 6. Gaps this experiment found in the specs (now folded back)

| # | Gap | Resolution |
|---|---|---|
| 1 | Multi-parameter SWR keys explode the template (36 quote entries) | Spec 01 §9: bounded key window (W=2), per-key isolation + current-key view as explicit template invariants, `active` flag; Spec 02 §2 pointer |
| 2 | Relational reads into list data (`find` by id) inexpressible — no list comprehensions in M0, `lengthCat` too coarse | Spec 02 §6: bounded-list comprehensions unrolled to cond-chains (IR stays closed); Spec 01 §3.1 indexed-path note |
| 3 | List-rendered event handlers (radios in `.map()`) unhandled — only the stateful-item case was specified | Spec 02 §4: indexed event families with element-existence + item-attribute guards; Spec 01 §6 + Spec 04 §3: positional locators |
| 4 | Refinement couldn't target response payload fields (`quote.total > 0`) | Spec 02 §3: `refinePayload(op, path, classes)` |
| 5 | Step predicates couldn't see enqueue-time snapshots — P43/P45 unformalizable | Spec 03 §5: `step.op.args`; ghost variables noted as the future mechanism when code passes no identifying args |
| 6 | Conditional reachability (P46–P52) is CTL — `reachable` only quantifies from initial states | design §4 + Spec 03 §5: `reachableFrom(when, goal)` = `AG(when → EF goal)`, backward reachability, non-replayable counterexample semantics |
| 7 | Input transforms (`Number(...)`) and `<select>`/radio class derivation fell to havoc — not replay-splittable | Spec 02 §6: coercion allow-list with pre-transform witnesses; option-literal classes |
| 8 | "Thereafter"-shaped properties (P44) pressure the closed combinator set | design §4: deferred scoped-until with the frame idiom as the documented v1 answer |

Meta-observations, second iteration: (a) every *new* gap came from a code idiom (relational data, multi-param keys, list rendering) or a property *shape* (conditional reachability, snapshots) — the per-library extraction machinery from walkthrough 1 needed no changes, which is weak but real evidence the M0/template factoring is at the right altitude; (b) property count stresses organization more than expressiveness — 52 properties compress to ~5 reusable TS predicates and four shapes (gate, frame, snapshot, reachability), so the docs should teach *shapes*, not formulas; (c) this is the second independent demand for `asyncOpContract` — postcondition + frame + staleness as one named bundle around an effect API.
