# 260615 — Model React effect semantics in the extractor (and where needed, the checker)

Plan for Cursor Composer 2. Adds **real modeling** for seven React features the extract
module ignores today: **batching, stale closure, effect ordering, concurrent rendering,
suspense, timers, layout effects**.

> The user has stated `docs/specs/**` are **out of date**; their "documented v1
> exclusion" verdicts (Spec 02 §11) for concurrent rendering / Suspense / stale closure are
> **not binding**. Prioritize actually supporting the features. Specs are used here only as
> background on existing mechanisms, not as a reason to defer.

The architecture is favorable: the **Rust checker (`crates/checker`) interprets the IR
generically** — domains, guards, structured effects, `enqueue`/`dequeue`, stabilization.
Crucially, **`resolve`/`env` transitions are emitted by the extractor**, not synthesized by
the checker (see `src/extract/engine/ts/transition/async.ts`). That means most new
semantics can be added by **introducing new `sys:` state variables and ordinary transitions
expressed in the existing closed IR** — no Rust change. Three features need a small,
named checker change; they are isolated and called out per step.

Soundness invariant (still load-bearing regardless of spec age): **never silently
under-approximate a write to modeled state.** Over-approximate loudly with a warning that
reaches the trust ledger.

---

## 1. Goal

Make each feature *observably modeled* end-to-end (extraction → IR → checker), not merely
warned about:

1. **Timers** — model `setTimeout`/`setInterval` as a cancellable scheduled-timer state
   machine (`scheduled`/`idle`), with `clearTimeout`/`clearInterval` and effect-cleanup
   cancellation. Firing is an `env` transition guarded on `scheduled`. **Extract-only.**
2. **Layout effects** — `useLayoutEffect`/`useInsertionEffect` that write modeled state
   produce internal transitions exactly like `useEffect` (today: silently dropped — a
   missed write). **Extract-only.**
3. **Effect ordering** — keep the checker's existing both-orders exploration for
   write-conflicting internal effects (`crates/checker/src/stabilize.rs`), and add a
   **commit-phase ordering** so layout effects stabilize before passive effects (a
   `phase` discriminator on internal transitions). **Extract + small checker.**
4. **Batching** — model React-18 auto-batching faithfully: within one handler, **direct
   closure reads see the render snapshot** (frozen entry state) while **functional updaters
   `setX(p => …)` chain through the accumulator.** Today both accumulate → over-counts.
   Implemented via the already-present `readPre` IR node, evaluated against a macro-step
   pre-state. **Extract + small checker.**
5. **Stale closure** — extend the same snapshot mechanism across `await`: capture the
   closure's read-set into the `PendingOp.args` at enqueue and have continuations read it
   via the already-present `readOpArg` IR node, instead of reading current state.
   **Extract + small checker.** (This is the spec's "v2 closure snapshot," now in scope.)
6. **Concurrent rendering** — model `useTransition`/`startTransition` as a deferred commit
   with an `isPending` bool (reusing the pending-op queue), `useDeferredValue` as a lagging
   mirror var synced by an internal transition, and `flushSync` as a batching-opt-out
   (reads compile to current, not snapshot). **Extract-only** (reuses enqueue/resolve).
7. **Suspense** — model a `<Suspense>` boundary as a `ready`/`suspended` state var: a
   suspending `use(promise)` / `React.lazy` / data read enqueues a resolve op, gates the
   subtree's transitions (`guard: boundary == ready`), and shows the fallback while
   suspended. **Extract-only** (reuses enqueue/resolve + guards).

## 2. Non-goals

- **No new `AbstractDomain` / `EffectIR` / `ExprIR` node kinds.** Everything is expressed
  with existing nodes — including `readPre` and `readOpArg`, which already exist in
  `src/core/ir/types.ts` and `crates/checker/src/model.rs` but are currently inert in
  effect context (`crates/checker/src/expr.rs:144`, `:415`). We *activate* them, not add
  new kinds.
- **No probabilistic/priority scheduling.** Concurrent rendering is modeled as
  *interruptible deferral* (interleaving), not as React's lane priorities. `isPending` and
  tearing windows are captured; exact lane order is not.
- **No render-internals modeling** (reconciliation, double-invoke/StrictMode, fiber
  bailouts). These are invisible at event/macro-step granularity and stay out.
- **No `useReducer`** (separate, already-warned at `react-source-transitions.ts:214`).
- No overlay-API, codegen, or replay-contract changes beyond labels for the new `env`
  transitions (timer fire, suspense resolve) which already have `EventLabel` kinds
  (`timer`, `resolve`).

## 3. Current-state findings (grounded in code)

- **Effect detection is `useEffect`-only.** `ast.ts:35` `isUseEffectCall` matches the
  identifier `useEffect`; dispatch at `react-source-transitions.ts:474`. `useLayoutEffect`
  / `useInsertionEffect` are never inspected and `useEffectWritesModeledState`
  (`transition/effects.ts:206`) is `useEffect`-keyed → a layout effect that writes modeled
  state yields **no transition and no warning** (missed write).
- **Timers** (`transition/timers.ts`): `setTimeout`/`setInterval` with an M0 callback →
  one always-enabled `env` timer transition. **No `clearTimeout`/`clearInterval`**, no
  scheduled/idle state → a cancelled timer still fires freely (unsound-leaning
  over-approx, and silent).
- **Concurrent wrappers** fall to `fallbackSummaries` (`statement-summary.ts:676`) →
  `settersWrittenIn` **havocs** every inner setter; `isPending`, deferral, interruption are
  absent. `flushSync` likewise havocs.
- **Suspense / `use()` / `lazy`**: no detection anywhere.
- **Batching**: `EffectIR::Seq` applies effects **left-to-right against the accumulating
  state** (`crates/checker/src/effect.rs:82-92`). Direct reads `setX(x+1)` and functional
  updaters `setX(p=>p+1)` both compile to `assign x = read(x)+1`
  (`transition/expressions.ts:36-50`), so a batch of two direct increments yields **+2**
  where React yields **+1** (stale snapshot). Functional updaters are correctly chained;
  direct reads are not snapshot-pinned.
- **Stale closure (async)**: continuations read **current** state and emit
  `Stale-read risk …` warnings (`transition/async.ts:152-157`) → `staleReads` caveats. The
  snapshot is never captured; `readOpArg` exists but evaluates to `Null`
  (`crates/checker/src/expr.rs:144`).
- **Effect ordering**: `stabilize.rs` already (a) respects `triggeredBy` via
  `internal_triggered` (`:78`), and (b) explores **both orders** when internal write-sets
  intersect (`stabilizing_sequences`/`has_write_conflict`, `:93,:166`). What's missing is a
  **layout-before-passive phase** guarantee — today all internal effects are one
  undifferentiated pool. Also note `apply_internal_sequence` calls `apply_effect` with
  `EvalOptions::default()` (`:130`) — no pre-state, so `readPre` is inert inside effects.
- **System-var assembly**: `sys:pending` decl is built in
  `src/cli/features/extract/command.ts` (~`:1593`, the function returning the
  `boundedList<PendingOp>` decl), aggregating ops/continuations/arg-domains from emitted
  `enqueue` effects. `sys:route`/`sys:history` come from the router source
  (`src/extract/sources/router/routes.ts:36`). **New `sys:` vars are added the same way**:
  emit transitions that reference them, then synthesize their decls in this assembly step.
- **`EvalOptions`** (`crates/checker/src/expr.rs`) is the single struct threaded through
  `eval_expr`/`apply_effect` — the natural place to carry a `pre_state` and a
  `resolving_op_args` so `readPre`/`readOpArg` resolve in effect context.
- **Warning → caveat plumbing** (`command.ts:1270-1320`): caveats are currently
  reconstructed by **regex-parsing warning strings** (`^Global taint `, `^Stale-read risk `,
  `^Unhandled rejection `, `^Unextractable `). This string round-trip is the design smell
  replaced by structured caveats (§6.1), not extended.

## 4. Exact files & relevant symbols

**Extraction (TS):**

| Path | Symbols |
|---|---|
| `src/extract/engine/ts/ast.ts` | `isUseEffectCall` → add `reactEffectHookName(node)`; neighbors `isUseReducerCall`/`isUseRefCall` |
| `src/extract/engine/ts/transition/effects.ts` | `transitionsFromUseEffect` (+`hookName`, +`phase`), `useEffectWritesModeledState` |
| `src/extract/engine/ts/transition/timers.ts` | `transitionsFromTimerCall`, `timerSetterTaints`, `handlerSchedulesModeledTimer`; add clear-call + scheduled/idle var |
| `src/extract/engine/ts/transition/statement-summary.ts` | `summarizeStatement` (unwrap `startTransition`/`flushSync`), snapshot read tagging |
| `src/extract/engine/ts/transition/expressions.ts` | `setterArgumentExpr`/`valueExpr` — emit `readPre` for direct closure reads vs `read` for functional-updater param |
| `src/extract/engine/ts/transition/async.ts` | enqueue arg-capture of closure read-set; continuation reads → `readOpArg` |
| `src/extract/engine/ts/react-source-transitions.ts` | dispatch: effect hooks, timers/clears, `useTransition`/`useDeferredValue`, `<Suspense>`/`use`/`lazy`; new `sys:` transition emission |
| `src/cli/features/extract/command.ts` | system-var assembly (~`:1593`) — synthesize `sys:timer:*`, `sys:suspense:*`, `isPending`/deferred decls; **delete** the warning-string caveat matchers (`:1270-1320`) and replace with structured-caveat aggregation (§6.1) |
| `src/core/ir/types.ts` | no effect/expr node-kind change; **replace** `ExtractionCaveats` with the structured `ExtractionCaveat[]` (§6.1); add `Transition.phase?: number` (§6.2) |
| `src/core/report/types.ts` | renderer consumes typed `ExtractionCaveat` (no string parsing) |

**Checker (Rust) — only steps 3/4/5:**

| Path | Symbols |
|---|---|
| `crates/checker/src/expr.rs` | `EvalOptions` (+`pre_state`, +`resolving_op_args`); `ReadPre`/`ReadOpArg` arms (`:144,:415`) |
| `crates/checker/src/effect.rs` | `apply_effect`/`apply_effect_inner` — set pre_state at transition entry; bind dequeued op args during `resolve` continuation eval |
| `crates/checker/src/stabilize.rs` | `apply_internal_sequence` (pass pre-state), `stabilizing_sequences` (phase-aware ordering for step 3) |
| `crates/checker/src/model.rs` | `Transition` — additive `phase: Option<u32>` commit ordinal (framework-neutral, §6.2) for step 3 |

## 5. Existing patterns to follow

- **New `sys:` state machine** = copy the SWR template idiom
  (`src/extract/sources/swr/template.ts`): declare a var with an `enum`/`bool` domain,
  emit transitions that `assign`/guard it, and let `command.ts` assembly pick up its decl.
  The pending-queue reuse (enqueue + guarded resolve) is exactly `transition/async.ts`.
- **Transition shape**: mirror `transitionsFromUseEffect` (`effects.ts:50-149`) and the
  async `enqueue`/`success`/`error` triples (`async.ts:161-231`).
- **Env transition with replay label**: timer fire → `label:{kind:"timer",key}` (already
  used, `timers.ts:89`); suspense resolve → `label:{kind:"resolve",op,outcome}` (already
  used, `async.ts:189`).
- **Stable ids / determinism**: component + hook/var-derived ids, sorted, AST-hash
  disambiguator (Spec 02 §9); byte-identical re-extraction is a hard requirement.
- **Checker `EvalOptions` threading**: follow how `options` is already passed through
  `eval_expr`/`apply_effect`/`apply_effect_inner` — add fields, default them, set them at
  the one call site that knows the pre-state.

## 6. Resolved design decisions (no stopgaps, framework-agnostic)

Per project policy (fundamental over stopgap; abstract over framework-specific; no backward
compatibility), the two former open questions are decided as follows. **Both go one level
deeper than a minimal patch** to remove the underlying design smell rather than extend it.

### 6.1 Reporting: structured caveats emitted at the call site (replaces string-prefix parsing)

The current mechanism reconstructs caveats by **regex-parsing warning message strings**
(`globalTaintFromWarning`/`staleReadFromWarning`/`unhandledRejectionFromWarning`,
`command.ts:1290-1320`). That string round-trip is the stopgap. **Replace it** with
structured caveats emitted where the data already exists, and derive the human message
*from* the struct. Migrate the existing buckets onto it (no compat shim — the warning-string
matchers are deleted).

```ts
// src/core/ir/types.ts — replaces the four parallel arrays in ExtractionCaveats
type CaveatKind =
  | "global-taint" | "stale-read" | "unhandled-rejection"
  | "unextractable" | "model-slack";              // open union; new features extend it
interface ExtractionCaveat {
  kind: CaveatKind;
  id: string;                                       // e.g. "Comp.startTransition"
  reason: string;
  source?: SourceAnchor;
  severity: "info" | "over-approx" | "unsound-risk";
}
interface ExtractionCaveats { entries: readonly ExtractionCaveat[]; }
```

`ExtractionWarning` carries the structured caveat (or *is* one) so the renderer and the
trust ledger consume typed data. The residual imprecision from steps 1/5/6/7 (cancellable-
but-non-M0 timers, partially-snapshotted closures, non-analyzable concurrent callbacks,
unmodeled suspense outcomes) is emitted as `kind:"model-slack"` — framework-neutral, no new
prefixes invented. The string-parsing layer is retired entirely, not extended.

### 6.2 Effect ordering: a framework-neutral commit ordinal (step 3 ships now)

Deferring step 3 is a backward-compat-shaped stopgap → rejected; it ships. But
`phase: "layout" | "passive"` is **React vocabulary in the IR**, which breaks the
"accommodate different frameworks" rule (Vue `pre`/`sync`/`post`, Solid, Svelte `tick` do
not map to those words). Model it as a **comparable commit ordinal**, lower runs first,
single-tier default:

```ts
// Transition (src/core/ir/types.ts + crates/checker/src/model.rs): additive, neutral
phase?: number;   // commit tier; stabilization runs lower tiers before higher
```

- The **checker** (`stabilize.rs`) knows only "lower `phase` before higher when write-sets
  conflict" — zero framework knowledge.
- Each **source adapter** maps its framework's flush semantics onto ordinals. The React
  adapter: `useInsertionEffect → 0`, `useLayoutEffect → 0`, `useEffect → 1` (collapse to the
  two tiers that are observable at macro-step granularity; widen later without IR change). A
  future Vue/Solid adapter picks its own ordinals against the same field.

This keeps the IR and trusted Rust core framework-neutral and pushes all React specifics
into the extraction adapter layer — the abstraction boundary the policy requires.

## 7. Atomic implementation steps

Ordered by dependency and value. Steps 1, 2, 6, 7 are extract-only and independently
shippable. Steps 4 and 5 share one checker change (pre-state/op-args in `EvalOptions`) and
should land together. Step 3 is optional/last.

### Step 1 — Cancellable timers (extract-only)

1a. `timers.ts`: add `isTimerClearCall` for `clearTimeout`/`clearInterval`. Track the timer
**handle identity** from `const h = setTimeout(cb, d)` so a `clearTimeout(h)` /
effect-cleanup clear maps to the same timer.

1b. For each modeled timer, emit a `sys:timer:<Comp>.<handlerOrEffect>#<n>` var,
domain `enum("idle","scheduled")`, initial `"idle"` (synthesize the decl in `command.ts`
assembly, §3). Transitions:
- **schedule** (inside the handler/effect that calls `setTimeout`): `assign timer :=
  "scheduled"` spliced into that transition's effect.
- **fire**: `cls:"env"`, `label:{kind:"timer",key}`, `guard: timer == "scheduled"`,
  effect = `seq[ assign timer := "idle" (setTimeout) | identity (setInterval), …callback
  summary ]`.
- **cancel**: `clearTimeout(h)` / cleanup-return clear → `assign timer := "idle"`.

1c. `setInterval` stays `"scheduled"` after firing (repeats) until cleared; cap repeats via
the existing macro-step/depth bounds (no new bound). If the callback is non-M0 → keep the
current taint/havoc path and emit `Unextractable …[timer-callback]`.

1d. Remove the always-enabled-forever imprecision: the fire transition is now guarded, so a
cleared timer cannot fire — this is the precision win and the soundness fix together.

### Step 2 — Layout / insertion effects (extract-only, soundness)

2a. `ast.ts`: `reactEffectHookName(node): "useEffect"|"useLayoutEffect"|
"useInsertionEffect"|undefined`; keep `isUseEffectCall` as a wrapper.

2b. `effects.ts`: `transitionsFromUseEffect(..., hookName = "useEffect", phase?)` — use
`hookName` in ids/labels (`:103,:108,:130,:135`); set the **commit ordinal** (§6.2) on the
internal transition: `phase: 0` for `useLayoutEffect`/`useInsertionEffect`, `phase: 1` for
`useEffect`. The mapping lives in the React adapter only; the field is a framework-neutral
number. Generalize `useEffectWritesModeledState` to all three.

2c. `react-source-transitions.ts:474`: dispatch on `reactEffectHookName`; substitute the
hook name into the existing `Unextractable effect …` warning path.

### Step 3 — Commit-tier effect ordering (extract + small checker)

Ships now (not deferred, per §6.2). The IR field is a framework-neutral ordinal.

3a. Extract already tags the ordinal (step 2b). `model.rs`: add
`phase: Option<u32>` to `Transition` (additive, defaults `None` = single tier).

3b. `stabilize.rs` `stabilizing_sequences`: when a conflicting internal set spans multiple
`phase` tiers, restrict explored permutations to those that are **non-decreasing in
`phase`** (all lower tiers before higher; still explore every intra-tier ordering, and a
`None` phase sorts as its own default tier). Non-conflicting sets unchanged. Add a Rust unit
test beside `conflicting_internal_transitions_explore_both_orders` (`stabilize.rs:345`)
asserting cross-tier orderings are pruned while same-tier both-orders survive.

3c. The checker contains **no** framework vocabulary — it compares integers. All meaning
("layout before passive") lives in the React adapter's ordinal assignment (§6.2).

### Step 4 — Batching with render-snapshot semantics (extract + small checker)

4a. **Checker**: add `pre_state: Option<&ModelState>` to `EvalOptions`. In
`effect.rs::apply_effect`, set it to the transition's **entry state** once, before applying
the (possibly `Seq`) effect, and thread it unchanged through `Seq`/`If` recursion (so every
nested effect sees the *same* macro-step entry snapshot, not the accumulator). Implement the
`ExprIR::ReadPre` arm in `expr.rs:144`/`:415` to read from `pre_state` (fallback to current
+ debug assert if absent). `apply_internal_sequence` in `stabilize.rs:130` passes the
sequence's entry state likewise.

4b. **Extract**: in `expressions.ts`, compile a **direct closure read** of a modeled state
var (e.g. the `x` in `setX(x + 1)`) to `{kind:"readPre", var}`, while the **functional
updater parameter** (`p` in `setX(p => …)`, bound at `setterArgumentExpr:36-50`) stays
`{kind:"read", var}` (accumulator). Net effect: `setX(x+1); setX(x+1)` → `+1` (both read the
frozen snapshot); `setX(p=>p+1); setX(p=>p+1)` → `+2` (chained) — matching React.

4c. Add IR well-formedness coverage: `readPre` now legal in effect expressions (update the
TS validator `src/core/ir/validator.ts` and Rust `domain.rs` walk if they reject it).

### Step 5 — Stale closure across await (extract + same checker change)

5a. **Extract** (`async.ts`): at the `enqueue`, capture the continuation's **closure
read-set** (the vars it reads that may change before resolve) into `op.args` as snapshot
entries (`args["snap:<var>"] = {kind:"read", var}`). In the continuation effects, compile
reads of those vars to `{kind:"readOpArg", key:"snap:<var>"}` instead of `read`. Keep the
existing `Stale-read risk` warning as informational (now *resolved* by the snapshot, so
downgrade its wording, or drop it when fully snapshotted).

5b. **Checker** (`effect.rs`): when applying a `resolve` continuation, bind the **dequeued
op's `args`** into `EvalOptions.resolving_op_args`, and implement `ExprIR::ReadOpArg`
(`expr.rs:144,:415`) to read from it. The success-payload binding already flows through
op args; this generalizes it to snapshot fields.

5c. The `sys:pending` arg-domain inference in `command.ts` (~`:1585` `pendingArgDomain`)
already derives arg field domains from enqueue exprs — the new `snap:<var>` args are picked
up automatically; verify the domain matches the source var's domain.

### Step 6 — Concurrent rendering (extract-only)

6a. **`useTransition`** (`const [isPending, startTransition] = useTransition()`): declare a
component-local `isPending: bool`. `startTransition(fn)` →
`seq[ assign isPending := true, enqueue(op="transition:<Comp>#n", cont="<…>.commit") ]`; the
resolve continuation applies `fn`'s effect summary and `assign isPending := false`. Reusing
the pending queue gives free interleavings (user events during the pending window → tearing
properties become expressible). `isPending` reads in JSX guards are honored.

6b. **`useDeferredValue(src)`**: declare `deferred:<domain of src>` mirroring `src`, synced
by an `internal` transition `triggeredBy:[src]`, `assign deferred := read(src)`. The lag
(one macro-step) models the deferred update; properties can observe `deferred != src`
transiently.

6c. **`flushSync(fn)`**: opt **out** of step-4 snapshotting for `fn`'s body — compile its
direct reads to `read` (current/accumulator), not `readPre` — modeling the forced
synchronous, unbatched commit.

6d. Non-analyzable callbacks → keep havoc fallback + `Unextractable …[concurrent]` caveat.

### Step 7 — Suspense (extract-only)

7a. Detect on the render/interaction surface: a `<Suspense>` element (record its boundary
id + the subtree it wraps), `React.lazy(...)` component instantiation, and `use(promise)` /
suspending data reads inside the boundary.

7b. Declare `sys:suspense:<Boundary>: enum("ready","suspended")`, initial `"suspended"` if
it wraps a lazy/await-on-mount child else `"ready"`. The suspending read →
`enqueue(op="suspense:<Boundary>", cont="…ready")` + `assign boundary := "suspended"`;
resolve → `assign boundary := "ready"` (+ `dequeue`). Outcome domain may include `error`
(ErrorBoundary) — emit the `error` resolve when an error boundary is present, else leave it
to the unhandled path with a warning.

7c. **Gate the subtree**: transitions discovered inside the boundary get a guard conjunct
`boundary == "ready"` (use the existing guard-conjunction helper `andGuard`,
`transition/guards.ts`). Fallback-only interactions (e.g. a spinner's cancel) are enabled
while `suspended`.

7d. SWR/data under Suspense: align with the SWR template's non-suspense assumption
(Spec 01 §9) — when a suspending SWR key is detected, route it through 7b instead of the
focus-revalidate env model, and note it in the report.

### Step 8 — Spec & report sync

8a. Rewrite the `docs/specs/02-extraction.md` §11 verdict rows for all seven features to
reflect that they are now modeled (the user flagged these specs as stale — correct them as
part of the change so they stop misleading the next reader). Cross-reference the new
`sys:timer:*` / `sys:suspense:*` / `isPending` vars in `docs/specs/01-ir.md` §2 system-var
list.

8b. Update `docs/specs/03-checker.md` §5 to document `readPre`/`readOpArg` effect-context
evaluation and the `phase` ordering rule (if step 3 shipped).

## 8. Per-step files to edit

- **1**: `transition/timers.ts`, `react-source-transitions.ts`, `command.ts` (timer var
  decls).
- **2**: `ast.ts`, `transition/effects.ts`, `react-source-transitions.ts`.
- **3**: `crates/checker/src/model.rs`, `crates/checker/src/stabilize.rs` (+ Rust test).
- **4**: `crates/checker/src/{expr.rs,effect.rs,stabilize.rs}`,
  `transition/expressions.ts`, `src/core/ir/validator.ts`,
  `crates/checker/src/domain.rs`.
- **5**: `transition/async.ts`, `crates/checker/src/{expr.rs,effect.rs}`, `command.ts`
  (arg-domain verify).
- **6**: `transition/statement-summary.ts`, `react-source-transitions.ts`,
  `transition/expressions.ts`, `command.ts` (isPending/deferred decls).
- **7**: `react-source-transitions.ts`, `transition/guards.ts` (reuse), `command.ts`
  (suspense var decls), SWR source touch-point.
- **8**: `docs/specs/01-ir.md`, `02-extraction.md`, `03-checker.md`.

## 9. Acceptance criteria

1. `setTimeout(cb,…)` + `clearTimeout(h)` in a component: the fire `env` transition is
   guarded `sys:timer == scheduled`; after the clear transition it is disabled — a model
   trace cannot fire a cancelled timer. `setInterval` fires repeatedly until cleared.
2. `useLayoutEffect(() => setOpen(true), [x])` produces an internal transition with
   `triggeredBy:["…x"]`, `writes:["…open"]`, `phase: 0` (layout tier). A pre-change test asserting
   this **fails on `main`** (proves the missed-write gap) and passes after step 2.
   `useInsertionEffect` likewise.
3. `setCount(c+1); setCount(c+1)` (direct) yields net **+1** in the model;
   `setCount(p=>p+1); setCount(p=>p+1)` yields **+2** — verified by a checker state-count /
   reachable-value test. (On `main` both yield +2.)
4. An async handler whose continuation reads a var the user can change mid-flight: the
   continuation reads the **enqueue-time snapshot** (a property like "success applies to the
   user who initiated it" holds), demonstrated by a `leadsToWithin`/`alwaysStep` test using
   `readOpArg`-backed args.
5. `startTransition(() => setStep(2))` yields `isPending` true→false around a deferred
   commit (not a havoc); a property can observe an interleaved user event during the pending
   window. `useDeferredValue` shows a one-step lag. `flushSync` commits without snapshot
   batching.
6. A `<Suspense>` boundary with a lazy child: subtree transitions are disabled while
   `suspended`, enabled after the `resolve`; fallback interactions enabled while suspended.
7. **Determinism**: re-extraction is byte-identical (`model.json`); new ids stable/sorted.
8. `pnpm typecheck`, `pnpm test`, `pnpm architecture`, `pnpm phase7`, `pnpm ci:examples`,
   and `cargo test -p checker` all green. **`phase7` (differential vs TLA+) is the hard
   gate** — the `readPre`/`readOpArg`/`phase` changes alter checker semantics, so the TLA+
   exporter (`src/cli/features/export`) and the differential corpus must be updated in
   lockstep; a parity failure that is *not* explained by an intended semantic change ⇒ stop.

## 10. Tests to add or update

Confirm existing filenames first (`rtk find test -path '*extract*' -name '*.test.ts'`,
`rtk grep -rln useEffect test/extract`). Add under `test/extract/` mirroring modules:

- `timers-cancellation.test.ts` — schedule/fire/clear guard machine; interval repeat.
- `layout-effects.test.ts` — layout/insertion transition shape + `phase`; the pre-fix
  failing assertion (§9.2).
- `batching-snapshot.test.ts` — direct +1 vs functional +2 (extraction emits `readPre` for
  direct reads; checker net effect).
- `stale-closure-snapshot.test.ts` — continuation reads `readOpArg` snapshot; identity
  property.
- `concurrent.test.ts` — `useTransition` isPending window, `useDeferredValue` lag,
  `flushSync` opt-out.
- `suspense.test.ts` — boundary gating + resolve.
- `effect-ordering.test.ts` — `triggeredBy` populated; cross-tier ordering (lower `phase`
  commits first) enforced, same-tier both-orders preserved.

**Rust**: `crates/checker/src/expr.rs` unit tests for `ReadPre`/`ReadOpArg` eval;
`stabilize.rs` phase-ordering test; `effect.rs` Seq-with-snapshot test (direct vs
functional).

**Goldens**: review (do not blanket-regenerate) any `examples/`-derived `model.json`
snapshots that change because layout effects / timers / suspense now emit vars+transitions —
each diff is the behavioral review artifact (Spec 01 §8).

## 11. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm test
rtk cargo test -p checker          # or the repo's wrapper; see crates/checker
rtk pnpm architecture
rtk pnpm phase7                    # HARD GATE: IR↔checker↔TLA+ parity
rtk pnpm ci:examples
rtk pnpm fix                       # biome lint + format
```

Run `pnpm phase7` and `cargo test -p checker` after **every** step that emits a new
transition/var (1,2,6,7) or changes effect eval (3,4,5).

## 12. Risks, ambiguities, and stop conditions

- **STOP — checker semantics move under-explained.** Steps 3/4/5 change `crates/checker`
  effect evaluation. Any `phase7` parity delta that is **not** a deliberate, documented
  semantic change (snapshot batching, op-arg snapshot, phase ordering) means a bug — pause
  and reconcile the TLA+ exporter, don't paper over goldens.
- **STOP — `readPre`/`readOpArg` reach `eval_expr` without context.** They are currently
  inert (`Null`). When activated, every code path that evaluates an effect expression must
  supply the pre-state / op-args; a missing context must hard-error in debug mode (it did
  before, `expr.rs:418`), never silently read `Null`. If wiring the pre-state through
  proves to touch many call sites, stop and report — it may warrant a focused checker PR
  ahead of the extraction work.
- **Caveat migration is a clean replacement, not an addition (§6.1).** Deleting the
  warning-string matchers (`command.ts:1290-1320`) will break any test asserting the old
  array shape (`globalTaints`/`staleReads`/…). Update those tests to the structured
  `ExtractionCaveat[]` — do **not** keep both shapes (no backward compatibility). If a
  consumer outside `src/` reads the old shape, that is in-scope to migrate, not to shim.
- **`phase` is a neutral ordinal, never a string (§6.2).** Reject any patch that puts
  `"layout"`/`"passive"` (or other framework words) into `model.rs`/`types.ts`. Framework
  meaning lives only in the adapter's number assignment. The checker compares integers.
- **Ambiguity — `useTransition` start-fn / timer-handle binding.** Both come from
  destructured/`const`-bound locals. Use the existing local-binding resolution
  (`transition/locals.ts`); where a binding can't be resolved statically, fall back to the
  literal name and emit the `Unextractable …` caveat rather than adding whole-program alias
  analysis.
- **Risk — double counting.** Steps 1/6 emit transitions near existing fallback-havoc
  paths; ensure a write is summarized **or** havoc'd, never both. Assert write-set dedupe in
  tests (`uniqueStrings`/`uniqueSummariesByEffect` already exist).
- **Risk — state-space growth.** New `sys:timer:*` / `sys:suspense:*` / `isPending` vars and
  pending entries multiply states. Confirm slicing (`src/check/slicing`) drops them from
  unrelated properties and that example checks stay within bounds; if a feature blows up an
  example, gate it behind the existing bound (`maxPending`, depth) and report the bound-hit.
- **Risk — stale-closure snapshot bloat.** Capturing many vars into `op.args` enlarges the
  `PendingOp` domain. Snapshot **only** vars actually read by the continuation *and* mutable
  before resolve (the existing stale-read analysis already identifies these); do not snapshot
  the whole state.
- **Assumption check.** This plan assumes the checker generically interprets IR and that
  `resolve`/`env` transitions are extractor-emitted (verified: `async.ts`, `stabilize.rs`,
  `effect.rs`). If a later refactor moved any of these into the Rust core, re-scope the
  affected step and report before proceeding.
