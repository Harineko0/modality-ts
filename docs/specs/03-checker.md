# Spec 03 — The Custom Explicit-State Model Checker

Status: draft for review. Companion to `docs/design.md §2` and Spec 01.

Design goals, in priority order: (1) **correctness** — a wrong checker is worse than no tool; (2) **shortest counterexamples** — DX depends on minimal traces; (3) **determinism/reproducibility**; (4) throughput sufficient for ~10⁶–10⁷ stabilized states on a laptop. Notably *not* a goal: competing with TLC/SPIN on raw scale — the IR export exists for that.

## 1. Architecture

```
model.json + overlay module ─► loader (well-formedness, Spec 01 §7)
properties (*.props.ts)      ─► property compiler (slicing per property)
                                ├─► core search (BFS, §3)
                                ├─► invariant monitor (§5)
                                ├─► bounded-response monitor (§6)
                                └─► trace reconstructor + reporter (§7, §8)
```

One process, single-threaded core in v1 (worker-parallel frontier expansion is a specified extension, §10). Runs under Node ≥20; no native deps.

## 2. State representation and canonicalization

A state is a JS object `{ [varId]: Value }`. The visited set requires a canonical, hashable form.

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
- `stabilize` enforces the internal-transition semantics including the order-exploration rule for write-intersecting internal transitions and the `maxInternalSteps` divergence error.
- **Determinism**: with sorted iteration orders and no wall-clock dependence, two runs on the same model produce identical results and identical counterexamples. This is a hard requirement (CI reproducibility, differential testing).

BFS (not DFS/IDDFS) because shortest counterexamples are the product's core DX promise and memory at target scale (10⁷ × ~100B canon strings ≈ 1–2 GB) is acceptable; IDDFS is the specified fallback if memory, not time, becomes the binding constraint.

## 4. Per-property slicing (cone of influence)

Before searching, each property's read set is computed: predicate reads are declared via the typed accessor pattern (`s => s.order.kind` — collected by running the predicate once against a recording proxy) **union** any vars the developer lists explicitly (`{ alsoReads: [...] }` for predicates whose reads are data-dependent; the recording proxy under-approximating reads is the one soundness hazard of this trick, so: proxy-recorded reads are validated on every monitor evaluation during search — touching an unrecorded var aborts with a modeling error rather than continuing unsoundly).

The slice = least fixpoint of: property reads ∪ reads of transitions writing anything in the slice (via IR `reads/writes`). Vars outside the slice are **frozen at ⊥/initial and their transitions dropped** for that property's run; properties with identical slices share one search. Expected effect: an auth-guard property doesn't pay for checkout-state interleavings, and vice versa — this is the main scaling lever, and it is sound exactly because IR footprints are validated over-approximations (Spec 01 §7).

## 5. Invariants, `never`, `reachable`

- `always(p)`: evaluate `p` on every newly visited stabilized state; first violation (BFS ⇒ minimal depth) reconstructs the trace and, per config, halts or continues collecting distinct violations (deduplicated by violated-predicate × final-transition id).
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

Per run: verdict per property (`verified-within-bounds` / `violated (n traces)` / `vacuous-warning` / `error`), the **trust ledger** (bounds, abstractions, assumptions, over-approx/manual/taint lists from the extraction report), state-space stats (states, depth reached, time, peak memory, bound-hit events — e.g., token exhaustion, pending-cap saturation: each bound that *bit* is listed, since a bound that never binds adds no caveat). Output: human terminal rendering + `report.json` (CI artifact, schema-versioned).

## 9. Correctness assurance for the checker itself

The checker is part of the trusted base; it gets the heaviest internal testing in the project:

1. **Differential testing against TLC** (primary): a corpus of structured-only models (hand-written + extraction outputs + randomly generated IR within domain bounds) exported via IR→TLA+; assert identical reachable-state counts, identical invariant verdicts, and cross-validated counterexample traces (our trace must be admissible in TLC's model and vice versa). Random IR generation is cheap and high-yield here (the IR is small); run in the tool's own CI.
2. **Metamorphic tests**: adding an always-false-guard transition changes nothing; splitting an enum value into two that are never distinguished changes no verdicts; slicing on vs off produces identical verdicts per property.
3. **Oracle micro-models**: dining-philosophers-grade classics with known state counts and known counterexamples, encoded in the IR.
4. Property-based tests on canonicalization (encode∘decode = id; token-renaming idempotent and equality-preserving).

## 10. Performance envelope and specified extensions

Targets (v1, laptop, Node): ≥30k macro-steps/sec expansion on structured effects; 10⁶ states ≈ under a minute; 10⁷ states ≈ tens of minutes / ~2 GB — beyond that, the answer is slicing, tighter bounds, or export, not heroics. Specified-but-deferred extensions, in order of expected value: (a) worker-thread frontier partitioning by canon-hash (BFS layers are embarrassingly parallel; visited-set sharding by hash prefix); (b) partial-order reduction restricted to `resolve` transitions with disjoint IR footprints (the common commuting pair; correctness obligation is small because independence is checkable from validated footprints); (c) binary visited-set encoding; (d) on-disk frontier for memory-bound runs.

## 11. Failure modes and their handling

| Failure | Handling |
|---|---|
| Opaque effect throws / returns invalid state | abort run with modeling error + the offending input state (never skip the state — that would be silent under-approximation) |
| Property predicate throws | same — a throwing predicate is a property bug, not `false` |
| Stabilization divergence | modeling error + micro-step trace (Spec 01 §5) |
| Visited-set memory exhaustion | checkpoint stats + "increase bounds confidence not available" partial report; suggest slicing/bounds; never sample silently |
| Nondeterministic opaque effect returns different results across identical calls | detected in debug mode by double-execution; modeling error (breaks determinism guarantee) |
