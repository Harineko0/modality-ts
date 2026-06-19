# Spec 03 — The Explicit-State Model Checker

Status: updated. Companion to `docs/design.md §2` and Spec 01.

Design goals, in priority order: (1) **correctness** — a wrong checker is worse than no tool; (2) **shortest counterexamples** — DX depends on minimal traces; (3) **determinism/reproducibility**; (4) throughput sufficient for ~10⁶–10⁷ stabilized states on a laptop. Notably *not* a goal: competing with TLC/SPIN on raw scale — the IR export exists for that.

**Implementation note (current).** The checker is implemented in **Rust** (`crates/checker`) and compiled to a Node-API native addon (`native/modality-checker.<platform>.node`). The TypeScript side (`src/check/`) is reduced to artifact loading, native-binding invocation (`src/check/native.ts`, in-process — no sidecar, no subprocess, no engine selector or TS fallback), and report plumbing. Two consequences differ from the original TypeScript-checker sketch below: **(a)** properties are a **serializable structured property IR** (the combinators in `modality-ts/core` build predicate trees the Rust evaluator interprets) — *not* arbitrary executed TypeScript closures; and **(b)** the IR is mirrored on both sides (`src/core/ir/types.ts` ↔ `crates/checker/src/model.rs`) and must move in lockstep. The algorithm, semantics, and correctness obligations in the rest of this spec are unchanged — they describe the Rust implementation.

## 1. Architecture

```
model.json + overlay module ─► loader (well-formedness, Spec 01 §7)
property IR (*.props.ts)    ─► property compiler (slicing per property)
                                ├─► core search (BFS, §3)
                                ├─► invariant monitor (§5)
                                ├─► bounded-response monitor (§6)
                                └─► trace reconstructor + reporter (§7, §8)
```

One in-process native addon. The Rust core supports parallel frontier expansion (§10); the TypeScript host runs under Node ≥20 and loads the platform-specific native artifact shipped in the package.

## 2. State representation and canonicalization

A state is a record `{ [varId]: Value }` (a `ModelState` on the TS side; the corresponding Rust value in `crates/checker/src/state.rs`). The visited set requires a canonical, hashable form.

- **Canonical encoding**: a deterministic byte/string encoding — vars in declaration order, values encoded per-domain (enums as indices, records field-ordered, `⊥` as a reserved tag, lists length-prefixed). Domain-aware encoding (vs `JSON.stringify`) is both smaller and immune to key-order accidents. Implementation: a per-model compiled encoder (generated closures, one per domain — avoids interpreting the domain tree per state).
- **Token canonicalization**: `tokens` values are renamed to first-use order along the path *per variable family* (standard symmetry reduction on opaque identities: a state where `data=t₂` everywhere and one where `data=t₁` everywhere are the same state). This is sound because tokens have no semantics besides (in)equality, and it typically shrinks the space by the factorial of the token count. Cross-variable equality of tokens (cache holds the *same* token the session holds) is preserved by renaming over the whole state, not per-var.
- **Visited set**: v1 = `Set<string>` of canonical strings. Specified optimization (only if profiling demands): 64-bit hash → bucket file, with full-encoding collision check — never hash-only membership (a hash collision would silently drop states = unsoundness).
- **Parent map** for trace reconstruction: `Map<canon, {parentCanon, transitionId, choiceIdx}>`. Memory note: parent map dominates memory; the specified fallback for big runs is *lossy parents* (store every state but parents only every k-th BFS layer, re-search the gap on demand) — trace reconstruction cost is bounded by k layers.

## 3. Core search

Layered BFS over **macro-steps** (Spec 01 §5):

```
frontier := stabilize*(initialStates); visited := frontier
while frontier ≠ ∅ and depth < maxDepth:
  next := ∅
  for s in frontier (deterministic order):
    for t in enabled(s) (deterministic order):
      for s' in apply(t, s):                 # effect nondeterminism
        for s'' in stabilize(s'):            # run-to-completion, may branch (Spec 01 §5)
          monitors.observe(s, t, s'')        # §5, §6
          if canon(s'') ∉ visited: add to visited, parents, next
  frontier := next
```

- `enabled(s)`: user/nav transitions whose guard holds and whose component's route is mounted; `resolve(p, outcome)` for each pending op × assumed-allowed outcome; library/env events per template. Guard evaluation is compiled (ExprIR → JS closure at load time), not interpreted.
- `apply` executes compiled structured effects or imported opaque effects against a **frozen** input (deep-freeze in debug mode; structural-sharing copies on write). Opaque-effect outputs are domain-validated and write-set-validated in debug mode (Spec 01 §3.2).
- `stabilize` enforces the internal-transition semantics including the order-exploration rule for write-intersecting internal transitions and the `maxInternalSteps` divergence error. When write-sets conflict, internal transitions with lower commit ordinals (`phase`) run before higher ordinals; same-ordinal conflicts preserve both orders (Spec 01 §3).
- **Effect-context reads**: `readPre` evaluates against the pre-step state snapshot (React batching of direct reads in a handler); `readOpArg` reads enqueue-time snapshots from the resolving pending op's `args`. Both are only valid inside effect/step evaluation — missing context is a hard error in debug mode.
- **Determinism**: with sorted iteration orders and no wall-clock dependence, two runs on the same model produce identical results and identical counterexamples. This is a hard requirement (CI reproducibility, differential testing).

BFS (not DFS/IDDFS) because shortest counterexamples are the product's core DX promise and memory at target scale (10⁷ × ~100B canon strings ≈ 1–2 GB) is acceptable; IDDFS is the specified fallback if memory, not time, becomes the binding constraint.

## 4. Per-property slicing (cone of influence)

Before searching, each property's read set is computed by **walking the structured property IR** (`inferReads` over the `ExprIR`/step-predicate tree in `src/core/props`), **union** any vars the developer lists explicitly via the property's `reads` field. Because predicates are serializable IR (not executed closures), reads are read off the tree directly — there is no recording-proxy step and no proxy-under-approximation hazard. A `transitionEnabled(t)` node contributes only the guard and mount-availability reads needed to evaluate whether `t` is enabled; effect reads, effect writes, and the transition's declared `reads`/`writes` are not included unless they also appear in the guard or mount condition. The observed transition id is recorded separately in `enabledTransitions` so slicing can retain `t` as an observation-only transition.

The slice = least fixpoint of: property reads ∪ vars required by `enabled(transitionId)` guard/mount dependencies ∪ reads of transitions writing anything in the slice (via IR `reads/writes`). Role-bearing system vars enter a slice only when explicitly read, written, or required by a kept transition's mount semantics — they are not included wholesale. Transitions are kept when they write into the cone or are forced by `enabled(...)`; transitions that only read cone vars but write elsewhere are dropped for state properties (`always`, `reachable`, `reachableFrom`). Untargeted `alwaysStep`, positive targeted `alwaysStep`, and all `leadsToWithin` properties use full-model search when slicing is enabled: broad or positive `alwaysStep` predicates observe edges globally, and `leadsToWithin` uses a step trigger whose transition dependencies are not yet represented in the slice. Negated bad-step `alwaysStep` properties whose step predicate **syntactically** includes `stepTransitionId(...)` / `transitionId` may instead use a **targeted edge slice**: dependency vars are grown with the usual backwards writer closure from property reads and target guard reads, while target-transition execution writes (for example enqueueing into a pending-queue role var) are kept for the target edge but do not recursively pull unrelated transitions that merely share those infrastructure writes. `leadsToWithin` may become sliceable only after trigger transition dependencies are represented precisely and included in the slice. Vars outside the slice are **frozen at ⊥/initial and their transitions dropped** for that property's run; properties with identical slices share one search. Expected effect: an auth-guard property doesn't pay for checkout-state interleavings, and vice versa — this is the main scaling lever, and it is sound exactly because IR footprints are validated over-approximations (Spec 01 §7).

**Record field projection (current phase).** After var/transition cone-of-influence selection, retained `record` domains may be projected to the field paths required by the property predicate, retained transition guards/effects, and mount guards. A whole-var read, havoc, or full-record literal assignment keeps the entire record domain. Projected slice models validate under `validateModel(..., { sliced: true })` and emit slice economics from the projected domains (smaller `retainedBits`, `prunedFieldPaths` on retained contributors). Unsupported directional predicate shapes still set `closureFallback: "directional predicate shape unsupported"` and use broad backward closure; supported shapes include simple `eq`/`neq` on whole vars and literals, nested `and` of supported clauses, `or` only when every branch is independently simple, and `not(eq(...))` / `not(neq(...))` normalized to the corresponding negated clause.

**Extract-side slice artifacts (current phase).** `modality extract` can optionally persist per-property slice models and a manifest (`*.slices.json`) when properties are supplied. These artifacts use the same `sliceModelForCheckProperty` path as check and record slice economics for inspection before search. Manifest emitted entries include `fullVars`, `fullTransitions`, `topRetainedContributors`, and `topPrunedContributors`. Extraction reports add `diagnostics.propertySlices` with per-property planning timings and contributor arrays; elapsed fields are report-only and not written to the manifest. **`modality check` still computes transient slices independently** and does not load persisted extract-side slices yet. Parity tests must keep both paths aligned on var/transition IDs and skip reasons. Reproducible Coffee-shaped baselines: `pnpm perf:check` (see `docs/_benchmarks/check-performance.md`).

## 5. Invariants, step invariants, `reachable`, `enabled`

- `always(p)`: evaluate `p` on every newly visited stabilized state; first violation (BFS ⇒ minimal depth) reconstructs the trace and, per config, halts or continues collecting distinct violations (deduplicated by violated-predicate × final-transition id).
- `alwaysStep(q)`: evaluate `q(pre, step, post)` on **every edge** the search generates — including edges into already-visited states (the §3 pseudocode runs `monitors.observe(s, t, s'')` *before* the visited check for exactly this reason; evaluating only on newly visited states would miss violating edges between two known states). `step` exposes the transition id, the `EventLabel`, IR-level facts derived from the executed effect — `enqueued(op)`, `resolved(op, outcome)`, `changed(var)`, `changedTo(var, value)` — and, on enqueue/resolve edges, the pending op's **argument record** (`step.op.args`): the abstract snapshot captured at enqueue time (Spec 01 §2). Op args are how snapshot-staleness properties are written without temporal operators ("an order success whose `args.userId` differs from the current user must not advance the flow" — checkout walkthrough P43/P45). Where the code passes no identifying args, overlay-declared write-only **ghost variables** are the specified future mechanism (sound because ghosts never feed transitions). Violation trace = parent-map path to `pre` plus the violating edge; minimal by BFS. Step invariants are the correct form for action-shaped English ("cannot trigger", "must not clear") — the ToDo walkthrough §4.1 shows a state-invariant misformalization that is reachably wrong, which is why the DSL ships both forms.
- `enabled(transitionId)`: a predicate-level accessor evaluating the named transition's guard ∧ mount condition against the given state — sound and exact because guards are always structured IR (Spec 01 §3.1). Inferred `reads` for `enabled(t)` include only guard and mount-availability variables; `enabledTransitions` records `t` so slicing retains the transition as observation-only without pulling effect reads or writes. Slicing interaction: a property using `enabled(t)` adds `t`'s guard read-set and any mount-availability reads required by `t`'s mount condition to its cone.
- `reachableFrom(when, goal)`: `AG(when → EF goal)`. Algorithm: when any such property is registered, the forward search records reverse edges; afterwards, compute the backward-reachable set `B = {s | s →* goal}` by reverse BFS from all visited goal states; violation = any visited `when`-state ∉ `B`. Sound within bounds for both halves, since the graph is exhaustive within them. The counterexample is necessarily **non-replayable** (it asserts path *absence*): the report renders the forward trace *to* the witness `when`-state plus an exhausted-search certificate, with a nearest-miss hint (visited states in `B` minimally distant from the witness) as a repair aid; replay (Spec 04) is skipped for these. Semantics note, stated in every report: `EF` quantifies over *all* transition classes — it assumes a cooperative environment (a "reachable" verdict may rely on the server eventually answering success), which is the intuitive reading of "remains possible."
- `reachable(p)`: same search, success = witness trace; failure after exhaustion = "unreachable within bounds" — reported as a **vacuity warning**, not a pass, when used as a sanity premise of other properties.
- Built-in vacuity suite per run: transitions never enabled, enum values never inhabited, `leadsToWithin` triggers that never fire. An over-constrained model is the quiet failure mode of all formal tools; these checks are always-on.

## 6. `leadsToWithin` (bounded response)

Semantics: for every reachable state `s` and enabled trigger transition `t` at `s` with `s →t→ s₀`: **all** paths from `s₀` consistent with the *scheduler constraint* reach a goal state within the budget. Budget counts macro-steps, split by class: `{ environment: 3 }` = at most 3 env/library steps, with user steps excluded by the default scheduler constraint (see below).

- **Scheduler constraint** (the crucial semantic choice): by default, after the trigger fires, only `env`/`library`/`internal` steps are considered — the property asks "does the app *by itself* settle?" Including adversarial user interference (`{ allowUserEvents: true }`) is opt-in, because "user clicks 5 other things" trivially falsifies most response properties without being interesting. Both modes are sound checks of their respective formal statements; the report states which was checked.
- **Algorithm**: during the main BFS, record trigger occurrences `(s₀, propId)`. After (or interleaved with) the main search, for each distinct `s₀`: bounded universal search — depth-limited AND-search over constrained successors; a path that exhausts the budget without reaching the goal ⇒ counterexample (trace = main-BFS path to `s` + the failing suffix). Memoize on `(canon(state), remainingBudget)` globally per property — the same sub-states recur across triggers, making the total cost near-linear in distinct (state × budget) pairs rather than per-trigger exponential.
- Deadlock interaction: a constrained state with no enabled steps and goal unmet before budget exhaustion ⇒ violation ("the app stalls"), which catches forgotten-continuation bugs (e.g., unhandled rejection paths from Spec 02 §7).

This replaces unbounded liveness + fairness for v1 deliberately: it is strictly easier to implement correctly, needs no fairness annotations, and produces *finite, replayable* counterexamples — an unbounded-liveness lasso counterexample cannot be replayed as a test anyway. The cost: a true-but-slow convergence (4 env steps when budget is 3) reports as a violation; the trace makes the repair (raise the budget) obvious. Unbounded `leadsTo` with weak fairness via SCC fair-cycle detection is specified as v2.

## 7. Counterexample construction

From the violation point, walk the parent map to an initial state; emit `Trace = Step[]` where each step carries: transition id + `EventLabel`, source anchors, pre/post state (full, abstract), computed diff, and for stabilized steps the internal micro-step list (verbose mode). Post-processing passes, each pure over the trace:

1. **Diff focusing**: mark the vars in the violated predicate's read set; the renderer foregrounds those diffs.
2. **Hint pass** (heuristic, clearly labeled): pattern rules over the trace, e.g. "same user transition fired twice while `pending` non-empty and no guard reads a submitting-like var" → double-submit hint. Hints never affect verdicts.
3. **Replayability check**: all labels replayable ⇒ hand off to Spec 04 codegen; else abstract-only with the blocking labels named.

No trace minimization pass is needed for `always` (BFS minimality); `leadsToWithin` suffixes are minimal within their budget by construction.

## 8. Reporting

Per run: verdict per property (`verified-within-bounds` / `violated (n traces)` / `vacuous-warning` / `error`), optional **property confidence** (`ReportPropertyConfidence`: `level` ∈ `exact` | `property-preserving` | `over-approx` | `manual` | `bounded` | `heuristic`, plus `reasons`, `caveatIds`, `affectedTransitions`, `affectedVars`), the **trust ledger** (bounds, abstractions, assumptions, typed caveat partitions including `modelSlack`, over-approx/manual/taint lists from the extraction report), state-space stats (states, edges, depth reached, bound-hit events — e.g., token exhaustion, pending-cap saturation: each bound that *bit* is listed, since a bound that never binds adds no caveat), and optional **diagnostics**:

- **slicing summary** — slice count, per-slice var/transition/state/edge/depth counts, `mode` (`state` / `targetedStep` / `full`), skip reason when slicing is unavailable; **slice economics** (`retainedBits`, `prunedBits`, `topContributors`, `prunedTopContributors`, `retainedSystemVars`, `prunedSystemVars`); **pending-queue retention** (`pendingQueueDependencies` with `reasons`, `opIds`, `continuations` when a `pending-queue` role var is kept); **mount-scope retention** (`mountScopeDependencies` with `guardReads`, `retainedBecause`).
- **search summary** — max/final frontier, expanded depths, elapsed time.
- **limits** — reason when configured `maxStates` / `maxFrontier` / `maxEdges` / `memoryGuard` stops search early (error verdict, may set confidence `bounded`).
- **dominantVars** — top vars by distinct observed values during search.
- **partialOrderReduction** — when requested via `checkModel(..., { partialOrderReduction: true })` or CLI `--partial-order-reduction`: `requested`, `enabled`, optional `skipped`/`skipReason`, reduction counters (`reducedStates`, `skippedTransitions`, `cycleFallbackStates`, …), `reasonCounts`, and `violationRerun` when a violated `always` property was rechecked without POR so the reported trace stays the canonical BFS-shortest trace.

Output: human terminal rendering (compact `slicing=...` / `search-limit=...` / `por=enabled ...` or `por=skipped reason:...` / `confidence=<level> reasons:<n>` lines when relevant) + `report.json` (CI artifact, schema-versioned; `diagnostics` and per-verdict `confidence` are optional additive fields on schema version 1).

## 9. Correctness assurance for the checker itself

The checker is part of the trusted base; it gets the heaviest internal testing in the project:

1. **Differential testing against TLC** (primary): a corpus of structured-only models (hand-written + extraction outputs + randomly generated IR within domain bounds) exported via IR→TLA+; assert identical reachable-state counts, identical invariant verdicts, and cross-validated counterexample traces (our trace must be admissible in TLC's model and vice versa). Random IR generation is cheap and high-yield here (the IR is small); run in the tool's own CI.
2. **Metamorphic tests**: adding an always-false-guard transition changes nothing; splitting an enum value into two that are never distinguished changes no verdicts; slicing on vs off produces identical verdicts per property.
3. **Oracle micro-models**: dining-philosophers-grade classics with known state counts and known counterexamples, encoded in the IR.
4. Property-based tests on canonicalization (encode∘decode = id; token-renaming idempotent and equality-preserving).

## 10. Performance envelope and specified extensions

Targets (laptop): ≥30k macro-steps/sec expansion on structured effects; 10⁶ states ≈ under a minute; 10⁷ states ≈ tens of minutes / ~2 GB — beyond that, the answer is slicing, tighter bounds, or export, not heroics. **Parallel frontier expansion is implemented** in the Rust crate (`crates/checker/src/frontier.rs`, `search.rs`): BFS layers are embarrassingly parallel, with the visited set sharded by canon-hash.

**Partial-order reduction (POR)** is implemented as an opt-in conservative ample-set reduction in `crates/checker/src/por.rs`, integrated into BFS expansion in `search.rs`. It is **disabled by default**. Intended production order: full model → per-property slice group (`checkModelSliced`) → Rust check with optional POR. First supported mode: state-invariant **`always`** property groups with `EdgeRecordingMode::None` (no `reachableFrom` / `leadsToWithin` edge recording). Visibility is derived from serialized property `reads` and `enabledTransitions`; transitions writing visible vars or named in `enabledTransitions` force full expansion. Conservative dependency barriers (always dependent in this phase): pending queues, route/current/history system vars, mount-local scope, `readPre` / `readOpArg`, fresh tokens, havoc/choose/branching effects, triggered-by interactions, and read/write/write-write conflicts. When every enabled transition at a state is mutually independent and invisible, POR explores a singleton ample set; if all successors are already visited and other enabled transitions were skipped, a **cycle-proviso** fallback expands the full enabled set. Violations found under POR trigger an automatic non-POR rerun so reported traces remain BFS-shortest. Unsupported property kinds (`alwaysStep`, `reachable`, `reachableFrom`, `leadsToWithin`) skip POR with structured diagnostics rather than silently running full search.

Specified-but-deferred extensions: (a) binary visited-set encoding; (b) on-disk frontier for memory-bound runs.

## 11. Failure modes and their handling

| Failure | Handling |
|---|---|
| Opaque effect throws / returns invalid state | abort run with modeling error + the offending input state (never skip the state — that would be silent under-approximation) |
| Property predicate throws | same — a throwing predicate is a property bug, not `false` |
| Stabilization divergence | modeling error + micro-step trace (Spec 01 §5) |
| Visited-set memory exhaustion | checkpoint stats + structured diagnostics (frontier/states/dominant vars) + optional configured search limits (`maxStates`, `maxFrontier`, `maxEdges`, `memoryGuard`) that stop with error verdicts instead of crashing; suggest slicing/bounds; never sample silently |
| Nondeterministic opaque effect returns different results across identical calls | detected in debug mode by double-execution; modeling error (breaks determinism guarantee) |
