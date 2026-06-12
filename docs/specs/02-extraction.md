# Spec 02 — Extraction: TypeScript → IR

Status: draft for review. Companion to `docs/design.md §1, §3` and Spec 01.

This is the highest-risk subsystem. The governing rule, stated once and enforced everywhere:

> **Soundness invariant (E1).** For every concrete execution of an app event handler, either the extracted transition's successor set covers the abstracted result of that execution, or the handler is classified `unextractable` and surfaced as an overlay TODO. The extractor may over-approximate freely; it may never silently under-approximate.

The corollary that drives the whole algorithm: the dangerous direction is **missed writes** to modeled state. Most of the machinery below exists to detect "this code *might* write modeled state in a way I can't summarize" and bail out loudly rather than guess.

## 1. Pipeline overview

```
modality.config.ts ──► P0 project load (ts-morph / TS compiler API, full type checker)
                       P1 state inventory        (atoms, useState, useSWR, routes)
                       P2 domain inference       (TS types → AbstractDomain)
                       P3 handler discovery      (JSX events, effects, atom writers)
                       P4 effect summarization   (M0 abstract interpretation, async splitting)
                       P5 escape analysis        (missed-write detection → E1)
                       P6 overlay merge          (manual annotations, stable IDs)
                       P7 emit: model.json + app.model.ts (types) + extraction report
```

P0 input from config: route table (`pattern → RootComponent`), include globs, the list of **effect APIs** (functions whose calls are network operations, e.g. `api.*`, `fetch` wrappers — needed by P4), and test-locator conventions.

## 2. P1 — State inventory

**Jotai atoms.** Find module-level (exported or not) calls to `atom`/`atomWithStorage`/etc. from `jotai`'s module graph, resolved via the type checker (not by identifier name — aliasing and re-export are common).

- *Primitive atoms*: record initial-value expression and declared/inferred type.
- *Derived read-only atoms*: the read function's `get(x)` calls give the dependency set. Attempt to extract the body as an `ExprIR` over those dependencies (same expression subset as §6). Success ⇒ the atom is **not** a state variable at all — it is compiled away by inlining the expression at use sites (smaller state vector, free consistency). Failure ⇒ the atom becomes a real var with an `internal` recompute transition declared `over-approx` (havoc on dependency change) or overlay-defined.
- *Writable derived atoms*: the write function is a transition-effect fragment, summarized by P4 like any handler.

**`useState`.** For every component reachable from a route root (call-graph walk over JSX element types, depth-limited with bail-and-report): record `useState` calls; bind the destructured `[x, setX]` names; the *setter symbol* (not name) is what P4/P5 track. Component instances are keyed by route (Spec 01 §2). v1 restriction, detected and enforced: a modeled stateful component must render at most once per route (no stateful list items); violations downgrade that component's vars to `unextractable`.

**`useSWR`.** Record call sites; classify keys:
- string literal ⇒ exact key class;
- template/derived keys ⇒ key class parameterized by the abstract values of the variables in the key (e.g. ``` `/api/user/${id}` ``` with `id: tokens(2)` ⇒ 2 cache entries) — this is what makes stale-cache-across-identity bugs expressible;
- conditional keys (`cond ? key : null`) ⇒ guard on the template's fetch transitions;
- dynamically computed keys beyond the expression subset ⇒ `unextractable` (a havoc'd cache is useless).
Options objects are evaluated if literal; non-literal options force conservative template settings (all revalidation events enabled — over-approximation).

**Custom hooks.** Inlined transparently: a custom hook is just a function whose body is analyzed in the calling component's context, recursively, with a depth cap (default 3). Hook state identity follows the *call site path*, matching React's rules-of-hooks semantics. Hooks that escape analysis (conditional hook calls are illegal in React anyway; dynamic hook selection) ⇒ `unextractable`.

## 3. P2 — Domain inference (TS types → AbstractDomain)

Algorithm `D(τ)` on the checker-resolved type, structural and recursive:

| TS type τ | D(τ) |
|---|---|
| `boolean` | `bool` |
| union of literals (string/number/boolean) | `enum` of the literals |
| `T \| null \| undefined` | `option(D(T))` (null and undefined collapse — documented) |
| discriminated union of object types (common literal-typed field) | `tagged`, recursing into non-discriminant fields |
| object type | `record` of `D(field)` — but see *field pruning* below |
| `string`, non-literal `number`, unrecognized | `tokens(1)` ("some value"), refinable in overlay |
| `Array<T>`, `ReadonlyArray<T>` | `lengthCat` by default; `boundedList` only via overlay |
| function-typed, `unknown`, `any` | `tokens(1)` + warning (`any` hides structure) |

**Field pruning (cone-of-relevance for data).** Recursing `D` into a server-payload record would bloat the state with fields nothing reads. Rule: record fields are kept only if (transitively) *read* by some extracted guard/effect/derived atom or by a property predicate; all other fields collapse into the record's token identity. This runs as a fixpoint with P4 (which discovers reads) and re-runs when properties change. Pruning is sound: unread fields cannot influence modeled transitions; it is recomputed, never cached across property edits.

**Predicate abstraction (overlay-declared, v1; auto-suggested, later).** `overlay.refine('cart.total', { zero: t => t === 0, positive: t => t > 0 })` replaces `tokens` with an `enum` plus a *concretization obligation* (Spec 04 §2). Extraction then maps writes to the refined var through the predicates when the written expression is decidable (literals, copies), else havocs over the refined enum — still sound. Automatic predicate harvesting from guard comparisons (`x > 0` appearing in code) is specified as future work because it changes E1's review story: auto-predicates must be shown in the report.

## 4. P3 — Handler discovery

Transition entry points, in decreasing order of extraction confidence:

1. **JSX event props** on intrinsic elements (`onClick`, `onSubmit`, `onChange`, …) within modeled components. Resolve the handler expression: inline arrow ⇒ direct; identifier ⇒ its declaration; `props.onX` ⇒ resolve through the *call sites of the component* (one level: find JSX usages, take the passed expression; multiple distinct passes ⇒ one transition per pass site). Deeper prop-drilling ⇒ `unextractable`.
2. **`useEffect` bodies** whose statements write modeled state ⇒ `internal` transitions with `triggeredBy` = the effect's dependency array vars (missing dep array ⇒ `triggeredBy: all reads`, over-approximate). Cleanup functions that write modeled state ⇒ folded into unmount.
3. **Atom write functions** (writable derived atoms) and **`useSetAtom`/`useAtom` setter usages** inside handlers — these are not separate transitions; they are writes encountered during P4 of some handler.
4. **Event props on non-intrinsic (component) elements** (`<Button onPress={...}>`): followed one level into the component to find which intrinsic event triggers the prop (pattern: prop called in an intrinsic handler). Beyond one level ⇒ `unextractable` with the component named in the report.

Locator extraction for `EventLabel` (Spec 01 §6): `data-testid` attr if present, else accessible role + name from JSX literals, else `replayable: false`.

## 5. P5 — Escape analysis (the E1 enforcer)

Modeled state can be written only through known channels: `useState` setters (tracked as symbols), atom setters (`useSetAtom`/`useAtom`[1]/`store.set`), SWR `mutate`. The analysis computes, per handler, whether any write channel **escapes** summarization:

- A setter symbol passed as an argument to a function whose body is not analyzable (external module, dynamic) ⇒ that var is **tainted** in this handler ⇒ havoc on it at handler end (over-approx) — unless the setter escapes *beyond the handler* (stored in a ref, registered as a global callback), in which case the var is tainted **globally**: an `env` transition `external-write(var) = havoc(var)` is added, always enabled. Globally tainted vars make most properties about them unverifiable and are loudly reported — this is correct behavior, not a bug: the code genuinely admits arbitrary writes.
- A call to a function in the project whose body is available ⇒ inline and summarize (depth cap 3, cycle ⇒ bail).
- A call to an *external* function that does not receive any write channel and is not an effect API ⇒ assumed pure w.r.t. modeled state. This assumption is sound for the three supported channels (an external module cannot call your `setX` without being handed it; Jotai's default store is a loophole — `getDefaultStore().set` in external code — handled by flagging any project import of `getDefaultStore` as a global taint source).

This section is the soundness core; it is deliberately conservative and is where extraction quality is won or lost.

## 6. P4 — Effect summarization: the M0 subset

Handlers are summarized by a small abstract interpreter over a defined statement subset. Outside the subset ⇒ per-statement havoc of written vars when writes are still identifiable, else handler-level `unextractable` (per E1 via §5).

**M0 statements:** `setX(e)`; `setX(prev => e)`; atom set / `mutate` calls; `const y = e` (environment binding, substitution); `if/else` with M0 condition; ternary statements; early `return`; `await effectApi(...)` (→ §7); `try/catch` around awaits (→ §7); sequential composition.

**M0 expressions** (compiled to `ExprIR`): literals; reads of modeled vars/bound consts (with property paths); `?:`, `&&`, `||`, `!`; `===`/`!==` against literals or other modeled reads; object spread-update `{...x, f: e}`; discriminant checks (`x.kind === 'a'`); `arr.length === 0`-style checks (→ `lenCat`). Everything else ⇒ the *expression* is unrepresentable; if it flows into a write, that write becomes `havoc`/`choose` over the target domain (`confidence: 'over-approx'`); if it flows only into a condition, the condition becomes nondeterministic `choose` over both branches (over-approx, sound).

**Abstraction of written values.** A representable expression writes its `ExprIR` translation. A non-representable expression of a finite-domain type writes `havoc`. A non-representable expression of `tokens` type writes `freshToken` if the expression involves new data (call results), else `havoc` over existing tokens — heuristic with a sound fallback (`havoc` ∪ fresh), recorded in the report.

**Loops:** loops without awaits and without modeled-state writes are skipped (pure computation, abstracted away). Loops *with* modeled writes ⇒ havoc the written vars (over-approx). Loops with awaits ⇒ `unextractable` (the pending-op structure would be unbounded).

**State-read semantics inside handlers (stale closure decision).** In React, a handler reads the values captured at render. The model reads the *current* model state at transition time — which matches React for the synchronous prefix (the captured values are the values at event time) but diverges *after an await*: real code sees stale captures; the model's continuation sees current state. Decision: continuations read **current state**, and reads of vars that may have changed since enqueue are flagged in the report (`stale-read risk`). Modeling captured-vs-current faithfully is specified as the v2 "closure snapshot" extension (store a snapshot record in the PendingOp args for flagged vars). Rationale: full fidelity here doubles PendingOp state cost for a bug class we partially disclaim (design §3); the flag keeps us honest meanwhile. Note the divergence is two-sided (neither over- nor under-approximation), so properties touching flagged continuations report `confidence: over-approx` *and* the replay conformance check becomes the arbiter.

## 7. Async splitting (CPS at await boundaries)

The signature React-race machinery. A handler containing `await effectApi(...)` is split:

```
async function onSubmit() {            Transition T_submit (user):
  setOrder({kind:'submitting'});         assign order := {kind:'submitting'}
  try {                                  enqueue op='POST /orders', cont='onSubmit#1'
    const r = await api.placeOrder(x);
    setOrder({kind:'success'});        Continuation onSubmit#1 (env resolve):
  } catch {                              outcome=success: assign order := {kind:'success'}
    setOrder({kind:'error'});            outcome=error:   assign order := {kind:'error'}
  }
}
```

Algorithm: walk the body splitting at each `await` of an effect API into segments `seg₀ … segₙ`. `seg₀` becomes the user transition's effect plus `enqueue(op, cont₁)`. Each `segᵢ` becomes continuation `contᵢ`: an effect family indexed by the op's outcome domain — the success branch is the code path where `await` returned (awaited value bound as an abstract token/typed abstraction of the API's return type), the error branch is the enclosing `catch` segment (no enclosing try ⇒ error outcome runs no continuation — unhandled rejection — and is *reported*, since it is usually itself a bug). Sequential awaits chain (`contᵢ` ends with `enqueue(opᵢ₊₁, contᵢ₊₁)`); `Promise.all` of effect APIs ⇒ enqueue all, continuation guarded on all resolved (join modeled as a counter in the cont args); racing patterns beyond that ⇒ `unextractable`.

The checker's interleaving of `resolve` transitions then explores all orderings of outstanding continuations against user events and each other — double-submit and reordering races emerge without any further extraction cleverness. Outcome domains for ops come from `D(return type)` of the effect API, overridable by `assume()`.

## 8. P6 — Overlay merge

The overlay is a normal TS module with a typed builder API (types generated from P1–P2 output, so overlay code autocompletes against the real state vector):

```ts
export default overlay(M)
  .transition('CheckoutPage.onRetry', {            // fills an unextractable TODO
    reads: ['order'], writes: ['order'],
    effect: s => ({ ...s, order: { kind: 'submitting' } }),
  })
  .refineDomain('atom:cartTotal', enumOf('zero', 'positive'), { witness: {...} })
  .assume('POST /login', o => o.kind !== 'success' || o.token !== null)
  .locator('CheckoutPage.onRetry', byTestId('retry-btn'))
  .ignoreVar('local:DebugPanel.open');             // explicit, reported exclusion
```

Merge rules: overlay entries override extracted entries of the same id; an overlay entry whose id matches nothing is an **error** (catches drift); every `unextractable` without an overlay entry or `ignore` is a check-time warning and the affected transitions are listed in the report's trust ledger. Overrides of `exact` extractions are allowed but flagged (the developer is contradicting the extractor — one of them is wrong).

## 9. Stable IDs and regeneration

Transition/var ids must survive `modality extract` re-runs or overlays rot. Id = `«componentOrModule».«handlerName|attrName»[«disambiguator»]` where the disambiguator is a short hash of the *normalized* AST of the handler (whitespace/comment-insensitive). Renames break ids by design (the overlay author must re-confirm); the CLI offers `modality extract --explain-drift` showing orphaned overlay entries against new candidates by AST similarity. Never auto-rebind — E1 again.

## 10. Extraction report (the trust ledger)

Emitted on every extract; embedded in check reports:

- per-handler classification: `exact` / `over-approx (reasons)` / `unextractable (reason)` / `overlay`;
- global taints and their sources; stale-read flags; unhandled-rejection flags;
- domain table with abstraction provenance (type-derived / default-token / overlay-refined);
- coverage: % of discovered handlers exact+overlay, count of ignored vars;
- everything the verification claim is conditional on, in one place.

## 11. Known hard cases and their verdicts (v1)

| Case | Verdict |
|---|---|
| Context-passed state/setters | out of scope (treated as escape ⇒ taint) |
| `useReducer` | unsupported (suggest in report; natural v2 — reducers are *good* for extraction) |
| Stateful list items (`items.map(<Row/>)` with `useState` in Row) | detected, vars `unextractable` |
| Refs (`useRef`) | not state-vector members; a ref holding a setter ⇒ global taint (§5) |
| Setter called inside `setTimeout`/`setInterval` | timer modeled as an env event if the callback is M0; else taint |
| Conditional rendering changing available events | guard on transitions: extracted from the JSX condition when M0, else transition always enabled (over-approx, may produce model-only counterexamples caught by replay) |
| StrictMode double-invoke, concurrent rendering | invisible at event granularity; documented exclusion |
| Suspense/ErrorBoundary | v1: not modeled; SWR template assumes non-suspense mode (config-checked) |
