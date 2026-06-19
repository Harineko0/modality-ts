# Plan 3: Enabledness Dependency Fix

## Goal

Make `enabled(model, transitionId)` and `enabledTransitionPrefix(model, prefix)` dependency inference match enabledness semantics:

- `enabled(t)` observes whether `t` is currently executable.
- That requires the transition guard reads and mount/source availability reads.
- It does not require the target transition's effect reads, effect writes, declared `reads`, or declared `writes` unless those variables are also part of the guard or mount condition.

The performance goal is to prevent enabledness-only properties from retaining large unrelated state domains. The Plan 2 benchmark artifacts in `docs/_benchmarks/` show the target shape for the Coffee-shaped fixture:

- `docs/_benchmarks/coffee-shaped.sample.json`
- motivating property: `densityOneRequiresConnectedPrinter`
- full model: `18` vars, `13` transitions, `54.23` full state-space bits
- desired slice: `2` vars, `1` transition, `2.58` retained bits, `51.65` pruned bits
- desired retained contributors: `printerStatus`, `sys:route`
- desired pruned contributors include large payload/effect-write domains such as `orderHistoryPayload`

Do not assert elapsed timings as goldens. Use deterministic slice fields and verdict parity for tests.

## Non-goals

- Do not change the meaning of `enabled(t)` to include effect executability, effect satisfiability, or write-set validity.
- Do not change transition execution semantics.
- Do not introduce a fallback that silently broadens enabledness slices back to full transition effects.
- Do not make `modality check` consume persisted extract-side slice artifacts yet.
- Do not start Plan 4 slicing improvements, POR, or CTL work.
- Do not preserve backward compatibility with the current over-broad inferred `reads`; this tool is experimental.

## Current-State Findings

- `src/core/props/index.ts` currently imports `effectReads`, `effectWrites`, and `exprReads` from `../ir/validator.js`.
- In `inferReads()`, the `transitionEnabled` branch adds:
  - `exprReads(transition.guard)`
  - `effectReads(transition.effect)`
  - `effectWrites(transition.effect)`
  - `transition.reads`
  - `transition.writes`
- The `transitionEnabledPrefix` branch repeats the same broad inference for every matching transition.
- `propertyEnabledTransitions()` already separately infers `enabledTransitions` from `enabled()` and `enabledTransitionPrefix()`. Keep this metadata populated.
- `src/check/slicing/dependency-graph.ts` already has the right conceptual split:
  - `enabledTransitionGuardVars()`
  - `enabledTransitionSeedVars()`
  - `addEnabledObservationGuardVars()`
- `src/check/slicing/slice-model.ts` already treats enabled transitions as observation-only via `observationOnlyTransitions` and `stripObservationOnlyTransition()`.
- `test/check/slicing-parity.test.ts` already has guard-only slicing tests, but the main Coffee-shaped fixture passes explicit `reads`, so it does not catch public DSL read inference regressions.
- `test/kernel/kernel.test.ts` currently has a test named `does not infer route reads for transitionEnabled without route dependency` whose expected value is still over-broad: it expects `["flag"]` when the transition guard is `true` and only the effect writes `flag`. This should change to `[]`.
- `crates/checker/src/expr.rs` has two Rust-side broad-read paths:
  - `eval_expr_checked()` for `TransitionEnabled` / `TransitionEnabledPrefix` checks `transition.reads`, `transition.writes`, and a hard-coded `"sys:route"`.
  - `allowed_reads()` adds `transition.reads` and `transition.writes` for every `enabledTransitions` entry.
- Rust unchecked enabledness evaluation already matches the intended semantics: `transition_is_enabled()` evaluates `transition_locals_mounted(...) && guard_holds(...)`.
- `docs/_specs/03-checker.md` is internally inconsistent with the target: section 4 says `transitionEnabled(t)` contributes guard/transition read-set and route var, while section 5 says enabledness is guard and mount condition.

## Exact File Paths and Relevant Symbols

- `src/core/props/index.ts`
  - `propertyReads()`
  - `inferReads()`
  - `propertyEnabledTransitions()`
  - `inferEnabledTransitions()`
  - `enabled()`
  - `enabledTransitionPrefix()`
- `src/check/slicing/dependency-graph.ts`
  - `enabledTransitionGuardVars()`
  - `enabledTransitionSeedVars()`
  - `computeStateSliceClosure()`
  - `addEnabledObservationGuardVars()`
- `src/check/slicing/slice-model.ts`
  - `sliceModelForCheckProperty()`
  - `sliceModelForProperty()`
  - `collectSupplementalExprStateReads()`
  - `collectExprEnabledTransitions()`
  - `stripObservationOnlyTransition()`
- `crates/checker/src/expr.rs`
  - `eval_expr_checked()`
  - `allowed_reads()`
  - `transition_is_enabled()`
  - `any_transition_enabled_with_prefix()`
  - `transitions_matching_prefix()`
- `test/kernel/kernel.test.ts`
  - `property DSL` tests around `enabled()`
- `test/check/slicing-parity.test.ts`
  - `enabled transition guard-only slicing`
  - `extract-side property slice parity`
- `test/checker/checker.test.ts`
  - tests around `transitionEnabled` and sliced checker parity
- `tools/perf/coffee-shaped-fixture.ts`
  - `coffeeShapedPerformanceModel()`
  - `coffeeShapedPerformanceProperties()`
  - `COFFEE_SHAPED_DENSITY_ONE_PROPERTY`
- `tools/check-performance-benchmark.ts`
  - `runCheckPerformanceBenchmark()`
- `docs/_benchmarks/check-performance.md`
- `docs/_benchmarks/coffee-shaped.sample.json`
- `docs/reference/property-api.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/01-ir.md`

## Existing Patterns To Follow

- Keep property metadata deterministic: sorted arrays, no timing in deterministic artifacts.
- Follow the existing `enabledTransitions` split: `reads` is state dependency metadata; `enabledTransitions` is transition-observation metadata.
- Reuse the guard/mount dependency helpers in `dependency-graph.ts` rather than inventing separate TS check-side semantics.
- Keep observation-only enabled transitions stripped to guard reads, no writes, and an empty `seq` effect.
- Keep benchmark assertions focused on deterministic slice economics and check stats, not elapsed time.
- Use focused Vitest tests in the same files that already cover the behavior.
- If Rust needs helper functions for checked evaluation, keep them local to `crates/checker/src/expr.rs` unless the same helper is clearly needed elsewhere.

## Atomic Implementation Steps

### 1. Narrow public DSL inferred reads for enabledness

Edit `src/core/props/index.ts`.

Change `inferReads()` so:

- `transitionEnabled` adds only `exprReads(transition.guard)` for the referenced transition.
- `transitionEnabledPrefix` adds only guard reads for matching transitions.
- It does not add `effectReads`, `effectWrites`, `transition.reads`, or `transition.writes` for enabledness nodes.
- Keep ordinary `read`, `readPre`, `freshToken`, step facts, and nested expression traversal behavior unchanged.
- Keep `inferEnabledTransitions()` behavior unchanged.
- Remove unused imports of `effectReads` and `effectWrites` if no longer needed in this file.

Do not special-case Coffee-shaped transition ids.

### 2. Align Rust checked evaluation allowlists with enabledness semantics

Edit `crates/checker/src/expr.rs`.

Change checked evaluation so a `TransitionEnabled` node requires only the vars needed to evaluate `transition_is_enabled()`:

- guard reads
- mount/local availability reads if the Rust compiled model exposes them
- no effect reads
- no effect writes
- no transition writes
- no hard-coded `sys:route` unless the transition mount condition actually depends on that var

Recommended implementation shape:

- Add a small helper near `transition_is_enabled()`, for example `enabledness_read_vars(compiled, transition) -> HashSet<String>` or `Vec<String>`.
- Derive guard vars from the structured guard expression, not from `transition.reads`.
- Include mount-condition vars through the compiled transition/local metadata if available.
- If mount vars cannot be derived from the current Rust model shape, stop and report. Do not guess by adding `sys:route`.
- Update the `TransitionEnabled` and `TransitionEnabledPrefix` branches in `eval_expr_checked()` to validate against this helper.
- Update `allowed_reads()` so `enabled_transitions` extends only the same enabledness vars. This keeps checked predicate evaluation exact when `reads` is inferred narrowly.

Keep unchecked `transition_is_enabled()` behavior unchanged unless the helper exposes a real mismatch.

### 3. Add kernel inference regression tests

Edit `test/kernel/kernel.test.ts`.

Update the current over-broad test:

- In `does not infer route reads for transitionEnabled without route dependency`, change the expected `property.reads` from `["flag"]` to `[]` because the guard is `true`.
- Keep the assertion that `enabledTransitions` includes `toggle` either in this test or adjacent coverage.

Add a new focused test:

- Model with vars `guard`, `widePayload`, and `effectRead`.
- Transition `wideEffect` has guard reading `guard`, effect reading `effectRead`, and writes `widePayload`.
- `always(model, enabled(model, "wideEffect"), { name: "wideEnabled" })` should infer:
  - `reads: ["guard"]`
  - `enabledTransitions: ["wideEffect"]`
- Add a prefix variant with two matching transitions and assert the inferred reads are the sorted union of their guard reads only.

### 4. Add slicing and checker parity regressions for inferred reads

Edit `test/check/slicing-parity.test.ts` and `test/checker/checker.test.ts`.

Add or adjust tests so they do not pass explicit `reads` for the enabledness property:

- A transition with a narrow guard and a wide effect should produce a slice that retains the guard var and forced observation transition only.
- The wide effect var must be pruned from `sliceModelForCheckProperty()`.
- The retained transition must be observation-only:
  - `writes: []`
  - `effect: { kind: "seq", effects: [] }`
- `checkModel(model, [property], { slicing: true })` and `checkModel(model, [property], { slicing: false })` must return the same verdict status for the property.

Include a case where the guard includes route/mount reads so mount dependencies are retained when genuinely required.

### 5. Add a benchmark regression that catches explicit-read masking

Edit `tools/perf/coffee-shaped-fixture.ts` and `tools/check-performance-benchmark.test.ts`.

Preferred minimal approach:

- Add an exported helper or test-local property construction that builds the `densityOneRequiresConnectedPrinter` property without explicit `reads`.
- Assert that its inferred `reads` are exactly `["printerStatus", "sys:route"]` for the current Coffee-shaped fixture.
- Assert its slice economics match the Plan 2 deterministic shape:
  - `vars === 2`
  - `transitions === 1`
  - retained vars are `printerStatus` and `sys:route`
  - pruned contributors include at least one wide payload var, such as `orderHistoryPayload` or `printerStatusData`

Do not require the sample elapsed timings or exact speedup from `coffee-shaped.sample.json`.

### 6. Update docs/specs

Edit:

- `docs/reference/property-api.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/01-ir.md` only if its enabledness summary still implies effect dependencies after the code change.

State clearly:

- `enabled(t)` is guard plus mount/source availability.
- Inferred `reads` for `enabled(t)` include only guard and mount availability reads.
- `enabledTransitions` records the observed transition id so slicing/checking can retain the transition as observation-only.
- Effect reads/writes are not included solely because the property asks whether a transition is enabled.

Remove or rewrite any language saying `transitionEnabled(t)` contributes the transition read-set or write-set.

## Acceptance Criteria

- `always(model, enabled(model, "t"))` inferred `reads` contain only enabledness inputs, not effect inputs or writes.
- `enabledTransitionPrefix(model, prefix)` inferred `reads` are the sorted union of guard/mount reads for matching transitions only.
- `enabledTransitions` remains populated for exact and prefix enabledness predicates.
- Sliced checker execution keeps enabled transitions as observation-only transitions.
- A transition with a wide effect and narrow guard does not retain the wide effect var solely due to `enabled()`.
- Rust checked predicate evaluation accepts narrow enabledness read sets and does not demand transition effect/write vars.
- Rust checked predicate evaluation does not demand a hard-coded `sys:route` when no mount/source condition requires it.
- The Coffee-shaped inferred-read regression reaches the Plan 2 deterministic target shape: the motivating property slice retains `printerStatus` and `sys:route`, keeps one transition, and prunes wide payload domains.
- Full-model and sliced-model verdicts match for the new enabledness tests.
- Docs no longer describe enabledness dependencies as transition read/write/effect dependencies.

## Tests To Add Or Update

- `test/kernel/kernel.test.ts`
  - Update the existing `transitionEnabled` inferred-read expectation from effect/write vars to guard-only vars.
  - Add exact-id enabledness inference with wide effect and narrow guard.
  - Add prefix enabledness inference with multiple matching transitions.
- `test/check/slicing-parity.test.ts`
  - Add or modify a guard-only slicing test to rely on inferred reads, not explicit `reads`.
  - Add prefix variant if not already covered by inferred-read tests.
- `test/checker/checker.test.ts`
  - Add sliced-vs-unsliced verdict parity for enabledness with a wide effect var pruned from the slice.
  - Add no-hard-coded-route checked-evaluation coverage if existing tests do not fail before the Rust fix.
- `tools/check-performance-benchmark.test.ts`
  - Add deterministic assertions based on `docs/_benchmarks/coffee-shaped.sample.json` fields, not timings.
- Optional Rust unit tests in `crates/checker/src/expr.rs`
  - `allowed_reads` for enabled transitions includes guard vars and excludes writes.
  - `TransitionEnabled` checked evaluation succeeds when only guard vars are allowed.

## Verification Commands

Run focused checks first:

```bash
rtk pnpm test -- test/kernel/kernel.test.ts
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- tools/check-performance-benchmark.test.ts
rtk cargo test --manifest-path crates/checker/Cargo.toml
```

Run benchmark trend check:

```bash
rtk pnpm perf:check
```

Compare deterministic fields against `docs/_benchmarks/coffee-shaped.sample.json`. Do not fail the implementation on elapsed-time differences alone.

Run repo-level checks before handoff:

```bash
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
rtk pnpm test
```

## Risks, Ambiguities, And Stop Conditions

- Stop and report if Rust cannot derive mount/source dependency vars from `CompiledModel` without hard-coding names like `sys:route`.
- Stop and report if any current checker semantic test proves that `enabled(t)` intentionally depends on effect reads/writes. Do not keep broad dependencies merely because old metadata did.
- Stop and report if guard reads cannot be extracted from Rust `ExprIR` without duplicating a large or inconsistent expression walker. A small local walker is acceptable; a second divergent dependency system is not.
- Stop and report if fixing `allowed_reads()` makes unrelated property kinds fail because they relied on enabled transitions to smuggle effect vars into the allowlist.
- Stop and report if the Coffee-shaped deterministic slice grows beyond the Plan 2 sample shape without a clear semantic reason.
- Do not update `docs/_benchmarks/coffee-shaped.sample.json` just to match a worse result. Only update benchmark artifacts if deterministic improvements or intentional fixture changes are understood.
- Do not broaden all mount dependencies globally as a shortcut for mount correctness. Include only mount/source vars actually needed by the observed transition.
