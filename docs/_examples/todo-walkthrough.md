# Worked Example — Running the Algorithm on a ToDo App

Status: thought experiment, executed against Specs 01–04 as written. Its purpose is twofold: show concretely how the tool processes a real (small) app, and surface places where the specs were insufficient. Gaps found here have been folded back into the specs; §6 lists them.

The subject is a single-route ToDo app: Jotai `authAtom` (guest/user), `useState` for `draft: string` and `saveStatus: 'idle'|'posting'|'failed'`, `useSWR(['todos', userId])` with a conditional key, and `submit()` that POSTs then revalidates. Source: `state.ts`, `api.ts`, `App.tsx` (see `examples/` once scaffolded).

## Verdict summary

| # | Property (English) | Formalization | Verdict |
|---|---|---|---|
| 1 | guest cannot trigger a submit request | `alwaysStep` (not a state invariant — see §4.1) | holds |
| 2 | empty draft cannot trigger a submit request | `alwaysStep` | holds |
| 3 | no double submission while posting | `alwaysStep` | holds (naive invariant variant: violated, instructively — §5.1) |
| 4 | draft not cleared when POST fails | `alwaysStep` postcondition | holds |
| 5 | POST success ⇒ draft empty ∧ saveStatus idle | `alwaysStep` postcondition | holds — but masks a real bug (§5.2) |
| 6 | logout possible even during GET error | `always` + `enabled()` | holds |
| 7 | user ∧ loadedSome ⇒ a todo is displayed | split: model invariant + replay observation | model half trivial; display half is replay/runtime territory (§4.7) |

## 1. Extraction trace (what each phase produces)

**P0/P1 — inventory.** Config declares route `/ → App` and effect APIs `api.fetchTodos`, `api.createTodo`. Discovery finds:

- `atom:auth` — Jotai primitive atom, type `AuthState` (discriminated union).
- `local:App.draft` — `useState<string>`; `local:App.saveStatus` — `useState<SaveStatus>`.
- `swr:todos` — `useSWR` with **conditional tuple key** `userId ? ['todos', userId] : null`: key class `todos(uid)` parameterized by `uid` (Spec 02 §2); the `null` arm guards the template's fetch transitions. The fetcher calls effect API `fetchTodos`.
- Derived consts `userId` and `canSubmit` are M0 expressions over modeled state — inlined at use sites, not state vars (Spec 02 §2). `canSubmit` contains `draft.trim().length > 0`, which forces a decision in P2.

**P2 — domains.**

| Var | TS type | Domain | Provenance |
|---|---|---|---|
| `atom:auth` | tagged union | `tagged(kind, {guest:{}, user:{userId: tokens(1)}})` | type-derived; `userId` kept by field pruning (read by SWR key + POST args) |
| `local:App.draft` | `string` | default `tokens(1)` — **insufficient**: `canSubmit` and property 2 need empty/nonEmpty. Overlay refines to `enum('empty','nonEmpty')` with predicate `s => s.trim().length > 0` and witnesses `'' / 'buy milk'` | overlay (predicate abstraction, Spec 02 §3) |
| `local:App.saveStatus` | literal union | `enum(idle, posting, failed)` | type-derived, exact |
| `swr:todos(u1)` | fetcher returns `Todo[]` | template instance; payload domain `D(Todo[]) = lengthCat` ⇒ `data ∈ {⊥, '0', '1', 'many'}`, `isValidating: bool`, `error: option` | template + D(return type) |
| `sys:pending` | — | ops `GET todos(u1)` (outcomes `success('0'|'1'|'many') | error`), `POST todos` (outcomes `success(token) | error` — `Todo` collapses to token; thrown `ApiError` is invisible to extraction (TS doesn't type throws) so error stays a single value unless overlay-refined) | system |

The user's informal five-valued `todos` state maps onto template-state combinations via the template's hook-view helpers: `notLoaded` = `data:⊥ ∧ ¬validating`, `loading` = `data:⊥ ∧ validating`, `loadedEmpty` = `data:'0'`, `loadedSome` = `data:'1'|'many'`, `error` = `error` present. Properties read these through `swrView(s, 'todos')` rather than raw template vars.

The total overlay for this app: one `refineDomain` (with witnesses) plus input value-class witnesses — about 6 lines. (Design §8's kill criterion is 100.)

**P3/P4 — handlers and transitions.** All four handlers are within M0; `submit` exercises async splitting; `mutate` is recognized by the SWR plugin as a write channel. The conditional rendering (`auth.kind === 'guest' ? Login : Logout`, `auth.kind === 'user' && <section>`) and the **`disabled={!canSubmit}` attribute** become transition guards. Note `login`/`logout` are `async` with no `await` — split produces zero continuations (plain transitions).

| Id | Class | Guard | Effect (IR sketch) |
|---|---|---|---|
| `App.login` | user | `auth.kind = 'guest'` | `auth := user(u1)` |
| `App.logout` | user | `auth.kind = 'user'` | `auth := guest; draft := empty; saveStatus := idle` |
| `App.input[empty\|nonEmpty]` | user | `auth.kind = 'user'` | `draft := ⟨class⟩` (one transition per value class) |
| `App.submit` | user | `auth.kind = 'user' ∧ ¬disabled` where `disabled = ¬(user ∧ draft='nonEmpty' ∧ saveStatus≠'posting')` | `if(¬canSubmit) skip else { saveStatus := posting; enqueue(POST, cont submit#1) }` — the early return survives as an `if` even though the guard already covers it |
| `swr.todos.fetch` | internal (template) | key non-null ∧ trigger (mount/key-change/mutate/focus) | `validating := true; enqueue(GET, cont swr#resolve)` |
| `resolve(GET, success(c))` | env | GET pending | `data := c; validating := false; error := none` |
| `resolve(GET, error)` | env | GET pending | `error := some; validating := false` (data kept — SWR keeps stale data) |
| `resolve(POST, success)` | env | POST pending | cont `submit#1`✓: `draft := empty; saveStatus := idle;` then `mutate` ⇒ template revalidate enqueues GET (cont `submit#2` is empty) |
| `resolve(POST, error)` | env | POST pending | cont `submit#1`✗ (catch): `saveStatus := failed` |
| `swr.todos.focusRevalidate` | library | key non-null | as fetch |

Extraction flags raised: a **stale-read flag** on `submit#1` (the closure-bound `mutate`/key vs. current state — benign here because the only user is `u1`, but reported per Spec 02 §6), and an **unhandled-rejection check** passes (the `await` is inside `try`).

**P5 — escape analysis.** All writes flow through declared channels (`setX` symbols, `useAtom(authAtom)[1]`, `mutate`). No taints. `api.ts` bodies are behind the effect-API boundary and never analyzed.

## 2. The model

State vector: `auth(2 effective) × draft(2) × saveStatus(3) × data(4) × validating(2) × error(2) × pending(GET 0..1, POST 0..2 with continuation tags)`. Syntactic bound ≈ 10³; reachable, stabilized states: a few hundred. Checker wall time: milliseconds; every property below is checked on the full space (slicing is unnecessary at this size but would, e.g., drop the SWR vars entirely for properties 1–5 — their cones don't include the cache).

Bounds in the trust ledger: `pending ≤ 3` (must be ≥ 2 so that the *attempt* at a second POST is representable, plus one slot for a concurrent GET — a `pending ≤ 1` bound would have made property 3 pass vacuously, which the bound-hit report would expose), token budgets never bind, `maxDepth` never binds (state space saturates first).

## 3. How the checker runs (once, for all properties)

Layered BFS from `⟨guest, empty, idle, ⊥, false, none, ∅⟩`. Each macro-step applies one user/env/library transition then stabilizes template-internal transitions (e.g., `login` immediately fires `swr.todos.fetch` during stabilization, so the post-login observable state already has `validating ∧ GET pending` — matching what a user observes after React commits). Invariant and step monitors observe **every edge**, including edges into already-visited states; bounded-response monitors record trigger edges for their sub-searches. One search serves all properties with the same slice.

## 4. Property by property

### 4.1 Guest cannot trigger a submit request — and why it is not a state invariant

The tempting formalization `always(s => !(s.auth.kind === 'guest' && s.pending.has('POST')))` is **wrong**: the checker refutes it in 5 steps — `login → input(nonEmpty) → submit → logout` leaves a guest state with the POST legitimately in flight. That trace is not a bug; the English statement is about *who initiated the request*, not who is logged in while it flies. Correct formalization:

```ts
export const guestCannotSubmit = alwaysStep(M, (pre, step) =>
  !(step.enqueued('POST /api/todos') && pre.auth.kind === 'guest'));
```

Checker reasoning: the only transition that enqueues POST is `App.submit`, whose guard conjoins the section-rendering condition (`auth.kind === 'user'`) — no edge can fire it from a guest state. **Holds**, and would hold even without the `disabled` guard thanks to the extracted early-return `if`. (Scope note: the model treats `disabled` as a hard guard; a user editing the DOM in devtools is outside the modeled event alphabet, stated in the trust ledger.)

### 4.2 Empty draft cannot trigger a submit request

```ts
export const emptyDraftCannotSubmit = alwaysStep(M, (pre, step) =>
  !(step.enqueued('POST /api/todos') && pre.draft === 'empty'));
```

This is where the **predicate-matching rule** earns its keep: `canSubmit`'s `draft.trim().length > 0` is α-matched against the overlay refinement's predicate and rewritten to `draft = 'nonEmpty'`; without the match, the condition would have become a nondeterministic branch and this property would have produced a *spurious* counterexample (submit firing from `empty`), pushing the developer to refine — the over-approximation fails loudly, not silently. **Holds.**

### 4.3 No double submission while posting

```ts
export const noDoubleSubmit = alwaysStep(M, (pre, step) =>
  !(step.enqueued('POST /api/todos') && pre.saveStatus === 'posting'));
```

**Holds** (guard + early return both read `saveStatus ≠ 'posting'`). The naive state-invariant variant is refuted — see §5.1, which is the more interesting story.

### 4.4 Draft survives a failed POST

```ts
export const failedPostKeepsDraft = alwaysStep(M, (pre, step, post) =>
  !step.resolved('POST /api/todos', 'error') ||
  (post.draft === pre.draft && post.saveStatus === 'failed'));
```

Step postcondition on the resolve edge. The catch-continuation's IR is `saveStatus := failed` only — `draft` is in neither its write set nor any stabilization write reachable from it. **Holds**, with `confidence: exact` end to end, so the verdict carries no over-approximation caveat.

### 4.5 Successful POST clears the draft and settles status

```ts
export const successResets = alwaysStep(M, (pre, step, post) =>
  !step.resolved('POST /api/todos', 'success') ||
  (post.draft === 'empty' && post.saveStatus === 'idle'));
```

**Holds** — but for a disquieting reason: the success continuation *unconditionally* assigns `draft := empty`, so the property is satisfied even on a stale completion that wipes a draft the user typed afterwards. A passing property is not evidence of a healthy neighborhood; §5.2 writes the property that catches the actual bug. The walkthrough lesson: pair every "X happens on success" property with a frame property ("nothing else is touched / stale completions touch nothing").

### 4.6 Logout is possible even during a GET error

```ts
export const logoutAlwaysAvailable = always(M, s =>
  !(s.auth.kind === 'user' && swrView(s, 'todos').error) ||
  enabled(M, 'App.logout')(s));
```

Needs the `enabled()` accessor (sound to expose because guards are structured IR — the checker evaluates the guard + mount condition exactly). `App.logout`'s guard reads only `auth.kind`; no error state disables it. **Holds.** This property class ("no dead UI under failure states") generalizes: `enabled()` makes it a one-liner.

### 4.7 user ∧ loadedSome ⇒ a todo is displayed

This property straddles the tool's boundary (design §7), and pretending otherwise would be dishonest:

- **Model half**: `always(s => !(s.auth.kind==='user' && swrView(s,'todos').loadedSome) || swrView(s,'todos').data !== '0')` is near-tautological — it can only catch template/modeling errors. Its real value is the companion sanity check `reachable(s => s.auth.kind==='user' && swrView(s,'todos').loadedSome)`, which guards against vacuity (it is reachable: `login → resolve(GET, success('1'))`).
- **Display half** ("ready to be displayed in the UI" — `(todos ?? []).map(...)` actually renders an `<li>`): this is a *UI-projection* claim about `f(state)`, checked where rendering is checked — in replay (observation map `getAllByRole('listitem').length ≥ 1` asserted in conformance walks whenever the model says `loadedSome`) and in the dev-mode runtime assertion. The model's contribution is enumerating the premise states worth projecting, including unintuitive ones (e.g., `loadedSome ∧ error` after a failed revalidation — SWR keeps stale data; does the UI still render the list when `todosError` is truthy? In this app yes, both render — a golden test per model-found state class would pin that down).

## 5. Two instructive counterexamples

### 5.1 The naive double-submit invariant (what the checker prints)

Formalizing property 3 as `always(s => s.pending.count('POST /api/todos') <= 1)` yields:

```
✗ noDoubleSubmitInv violated (8 steps)
  1. click "Login"                auth: guest → user(u1)        ⤷ stabilize: GET enqueued, validating
  2. resolve GET success('0')     data: ⊥ → '0', validating: → false
  3. input "New todo" (nonEmpty)  draft: empty → nonEmpty
  4. click "Add"                  saveStatus: idle → posting; pending[POST]: 0 → 1
  5. click "Logout"               auth → guest; draft → empty; saveStatus → idle   (POST₁ still in flight)
  6. click "Login"                auth → user(u1)               ⤷ stabilize: GET enqueued
  7. input "New todo" (nonEmpty)  draft: empty → nonEmpty
  8. click "Add"                  pending[POST]: 1 → 2          ← violates noDoubleSubmitInv
  Trust: all transitions exact | Bounds: pending ≤ 3 | replayable: yes
```

The replay test **reproduces** it: the app really does fire two concurrent create requests. Whether it is a bug is a product question (no request cancellation on logout) — but note it is *not* the property the English sentence stated, which is why §4.3 uses the step form. Both facts are useful; the tool's job is to make the difference explicit instead of letting one English sentence silently mean two things.

### 5.2 The stale-completion clobber (the bug property 5 masks)

The frame property "a POST completion that arrives when we are no longer posting must not touch the draft":

```ts
export const staleCompletionIsInert = alwaysStep(M, (pre, step, post) =>
  !(step.resolved('POST /api/todos', 'success') && pre.saveStatus !== 'posting') ||
  post.draft === pre.draft);
```

```
✗ staleCompletionIsInert violated (8 steps)
  1. click "Login" … 4. click "Add"        (as above: POST₁ in flight, posting)
  5. click "Logout"                        draft → empty; saveStatus → idle
  6. click "Login"
  7. input "New todo" (nonEmpty)           draft: empty → nonEmpty
  8. resolve POST₁ success                 draft: nonEmpty → empty   ← user's new draft destroyed
                                           saveStatus: idle → idle; ⤷ stabilize: GET enqueued (mutate)
  Note: step 8 runs continuation submit#1 (stale-read flag from extraction)
```

Replay verdict: **reproduced** — the real continuation runs after logout/login (the component never unmounted) and wipes the fresh draft. This is the canonical async-interleaving bug class the tool exists for, it sits exactly on a transition extraction had *already flagged* (stale-read), and no linear test suite was ever going to enumerate this ordering. It also demonstrates the recommended idiom: properties 4 and 5 (postconditions) plus a frame/staleness property form a complete contract for one async operation — a pattern worth shipping as a property template (`asyncOpContract(op, {...})`, future work).

## 6. Gaps this experiment found in the specs (now folded back)

| # | Gap | Resolution |
|---|---|---|
| 1 | Properties 1–5 are **step properties**; the DSL had only state predicates — and the state-invariant misformalizations are *reachably wrong*, not just stylistically off | `alwaysStep(pre, step, post)` with `step.enqueued/resolved/event` added to design §4 + Spec 03 §5; checker cost ≈ 0 (monitors already observe edges) |
| 2 | "Is possible/enabled" properties (6) inexpressible | `enabled(id)` accessor added to design §4 + Spec 03 §5, with its slicing implication (guard read-set joins the property cone) |
| 3 | `disabled` attribute is the de-facto guard idiom in React and was unhandled | Spec 02 §4: `disabled`/`aria-disabled` → guard conjunct; Spec 04 §3: replay asserts non-disabled before click, mismatch ⇒ divergence |
| 4 | No rule for connecting refined-domain predicates to the code expressions that embody them (`draft.trim().length > 0`) | Spec 02 §3: predicate-matching (normalized-AST α-equivalence) with loud over-approximation on non-match |
| 5 | SWR template fixed `data: ⊥\|token`, can't express `loadedEmpty/loadedSome`; no property-facing view of hook outputs | Spec 01 §9: payload domain = `D(fetcher return type)`; template exports `swrView` helpers |
| 6 | Tuple/array SWR keys unspecified | Spec 02 §2 extended |
| 7 | Error outcome domains: TS doesn't type `throw`, spec only derived success outcomes | Spec 02 §7: default single `error` outcome, overlay `outcomes()` refinement |
| 8 | Input value-class ↔ abstract write binding undefined | Spec 02 §6: per-class transitions for `set(e.target.value)` over refined domains, witnesses from the refinement |

Meta-observation: every gap was found by trying to *formalize an English property* or *push a specific code idiom through M0* — neither pure spec review nor more architecture would have found them. Worked examples should be part of the spec-change process (a new source plugin or DSL feature lands with a walkthrough like this one).
