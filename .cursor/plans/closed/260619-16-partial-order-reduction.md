# Plan 5: Partial-Order Reduction

## Goal

Avoid exploring equivalent interleavings of independent frontend transitions after per-property slicing has already reduced each check request to its smallest relevant model.

This plan assumes Plans 1, 2, 3, and 4 have already landed:

- Extract can emit per-property slice artifacts and slice manifests.
- Extract/check diagnostics report slice economics and retained contributors.
- `enabled(model, transitionId)` dependencies are guard/mount-only.
- Slicing has been tightened enough that remaining blowups are mostly transition interleavings, not obviously irrelevant state variables.

The first POR implementation must be explicitly opt-in, conservative, deterministic, and trace-safe. It should speed up verification runs for state-invariant properties, especially sliced `always(...)` properties such as the Coffee DX density/printer invariant, without changing verdicts or user-facing counterexample traces.

## Non-goals

- Do not enable POR by default.
- Do not apply POR before slicing. The intended order is: full model -> per-property slice group -> Rust check with optional POR.
- Do not add CTL operators or change property semantics.
- Do not replace BFS with DFS, IDDFS, or a different checker architecture.
- Do not reduce checks for `alwaysStep`, `leadsToWithin`, `reachable`, or `reachableFrom` in the first implementation unless the implementation can prove and test the required visibility and trace obligations. Start with state-only `always` property groups.
- Do not sacrifice canonical shortest counterexamples. If POR finds a violation, rerun the same sliced request without POR and report the exact non-POR trace.
- Do not treat route/history, pending queue, mount reset, token generation, `readPre`, or `readOpArg` interactions as independent until tests prove a conservative rule.
- Do not silently fall back to full exploration. If POR is requested but skipped, report a structured skip reason.
- Do not introduce property-specific or Coffee-DX-specific heuristics.

## Current-State Findings

- `src/check/check-model.ts` is already the TypeScript orchestration point. When slicing is enabled and all properties are sliceable, `checkModelSliced(...)` groups equivalent slices and calls `runRustCheck(...)` once per slice group with:
  - `slicing: false`
  - `slicedModel: true`
  - the grouped properties
- `src/check/types.ts` defines `CheckOptions` and `CheckDiagnostics`. Current diagnostics include `slicing`, `search`, `limits`, `dominantVars`, `storage`, and `hotPath`.
- `src/check/native.ts` serializes `CheckOptions` into the native request. It currently passes `slicing`, `slicedModel`, search limits, elapsed timing, and memory guard bytes.
- `src/cli/features/check/command.ts` always requests slicing when `canSliceAllProperties(model, properties)` is true, then copies `check.diagnostics` into the schema-versioned check report.
- `src/cli/cli.ts` parses check search-limit flags and passes options into `runCheckCommand(...)`. There is no POR flag yet.
- `src/cli/features/check/command.ts` renders compact lines for slicing, search limits, storage, and hot paths in `renderCheckResult(...)`.
- `src/core/report/types.ts` mirrors the report diagnostics shape but currently does not include `storage`, `hotPath`, or any POR-specific fields even though `createCheckReport(...)` copies `check.diagnostics` through.
- `crates/checker/src/model.rs` defines `CheckOptionsIR`, `Transition`, `PropertyIR`, and `CompiledTransition`.
  - `Transition` already carries declared `reads`, `writes`, `cls`, `guard`, `effect`, `triggered_by`, and optional `phase`.
  - `PropertyIR` already carries per-property `reads` and `enabledTransitions`.
  - `CompiledTransition` currently stores `write_indexes`, `triggered_by_indexes`, and `mount_local_var_indexes`; `read_indexes` is resolved during compile but not stored.
- `crates/checker/src/search.rs` owns BFS search.
  - `check_model_compiled(...)` clones `CheckOptionsIR`, builds diagnostics, seeds initial states, loops BFS layers, and calls `explore_depth_parallel(...)`.
  - `expand_chunk(...)` currently iterates `enabled_non_internal(compiled, pre)` for every frontier state, applies each transition, stabilizes, emits `GeneratedEdge`s, and records candidates.
  - Generated edges are sorted before observation, preserving deterministic edge observation and trace behavior.
- `crates/checker/src/transition_index.rs` exposes `enabled_non_internal(compiled, state) -> Vec<TransitionId>` with deterministic order from `CompiledModel::non_internal`.
- `crates/checker/src/stabilize.rs` already contains a conservative commutativity-style optimization for internal transitions: `stabilizing_sequences(...)` avoids permuting internal transitions when their write sets do not conflict.
- `crates/checker/src/step.rs` computes step facts and has local helpers for pending queue effects. POR should not duplicate complex queue semantics if a shared helper is needed.
- `docs/_specs/03-checker.md` currently lists POR as a specified-but-deferred extension, originally restricted to `resolve` transitions with disjoint IR footprints. The implementation plan should update this to the actual conservative first phase.

## Exact File Paths and Relevant Symbols

Primary Rust files to edit:

- `crates/checker/src/por.rs` (new)
  - Add the POR implementation here rather than growing `search.rs`.
  - Suggested symbols:
    - `PorMode`
    - `PorDecision`
    - `PorStateStats`
    - `PorRunStats`
    - `PorSkipReason`
    - `TransitionFootprint`
    - `TransitionPairRelation`
    - `build_por_context(compiled, properties, options)`
    - `reduce_enabled_transitions(context, state_canon, enabled, visited, generate_selected_successors)`
    - `classify_transition_pair(context, left, right)`
    - `transition_visible_to_properties(context, transition_idx)`
- `crates/checker/src/lib.rs`
  - Add `mod por;`.
- `crates/checker/src/model.rs`
  - Extend `CheckOptionsIR`.
  - Extend `CompiledTransition` with stored `read_indexes` and POR-relevant conservative flags or footprint indexes.
  - Keep `CompiledModel::compile(...)` as the single place that validates and compiles transition footprints.
- `crates/checker/src/search.rs`
  - Thread the POR context/stats into `explore_depth_parallel(...)` and `expand_chunk(...)`.
  - Add POR diagnostics to the final `diagnostics` object.
  - Preserve the current non-POR search path when POR is off or skipped.
  - If POR finds a violation, expose enough signal for the TS side or Rust side to rerun without POR for the final trace.
- `crates/checker/src/transition_index.rs`
  - Keep `enabled_non_internal(...)` deterministic.
  - Add a helper only if it makes POR integration clearer, for example `enabled_non_internal_with_por(...)`; otherwise keep POR selection in `por.rs`.
- `crates/checker/src/effect.rs`
  - Add small effect-walker helpers only if needed to classify conservative barriers such as enqueue/dequeue, `readPre`, `readOpArg`, fresh tokens, havoc, or branch-producing effects.
- `crates/checker/src/step.rs`
  - Move or share pending-queue effect collection only if POR needs the same queue identification currently used by step facts.

Primary TypeScript files to edit:

- `src/check/types.ts`
  - Add `partialOrderReduction?: boolean` to `CheckOptions`.
  - Add a `partialOrderReduction` diagnostics section.
- `src/check/native.ts`
  - Serialize `partialOrderReduction` into the native request.
- `src/check/check-model.ts`
  - Pass the option through both unsliced and sliced Rust calls.
  - Merge POR diagnostics across slice groups when `checkModelSliced(...)` runs multiple Rust checks.
  - Preserve existing slicing diagnostics.
- `src/cli/features/check/command.ts`
  - Add `partialOrderReduction?: boolean` to `CheckCommandOptions`.
  - Pass it into `checkModel(...)`.
  - Render compact POR output in `renderCheckResult(...)`.
- `src/cli/cli.ts`
  - Add an explicit CLI flag, preferably `--partial-order-reduction`.
  - Include the flag in check usage text and positional parsing exclusions.
  - Pass it for both single-target and discovered multi-target checks.
- `src/core/report/types.ts`
  - Add typed check-report diagnostics for POR. While here, align existing report diagnostics with emitted `storage` and `hotPath` if tests reveal type drift.

Docs and tests:

- `docs/_specs/03-checker.md`
  - Document POR mode, restrictions, visibility conditions, diagnostics, and the violation rerun rule.
- `test/checker/checker.test.ts`
  - Add Rust-backed POR behavior tests through `checkModel(...)`.
- `src/cli/features/check/command.test.ts`
  - Add check command/report tests for opt-in POR diagnostics and CLI option plumbing.
- `test/check/slicing-parity.test.ts`
  - Add sliced-plus-POR parity tests for state-only `always` properties if the fixture belongs at the slicing boundary.
- `tools/phase7-differential.ts`
  - Add an optional POR-on differential pass for supported properties or add a focused helper used by `pnpm phase7`.

## Existing Patterns to Follow

- Keep Rust search as the source of truth for state exploration. TypeScript should only pass options and display diagnostics.
- Follow existing option plumbing:
  - `CheckOptions` in `src/check/types.ts`
  - request serialization in `src/check/native.ts`
  - `CheckOptionsIR` in `crates/checker/src/model.rs`
- Follow existing deterministic ordering:
  - transitions sorted by id in `CompiledModel::compile(...)`
  - enabled transitions returned in compiled order
  - generated edges sorted before observation
  - diagnostics reason keys sorted before serialization
- Follow current diagnostic style: optional additive fields under `diagnostics`, with compact human lines only for high-value summaries.
- Keep search-limit behavior intact. POR must still respect `maxStates`, `maxEdges`, `maxFrontier`, and `memoryGuardBytes`.
- Keep `sliceModelForCheckProperty(...)` as the slicing source of truth. POR must consume the already-sliced model and must not introduce a second slice path.
- Follow the small hand-authored model style in `test/checker/checker.test.ts`.
- Follow Rust unit-test style already embedded in `search.rs`, `model.rs`, `step.rs`, and `stabilize.rs` for low-level footprint and independence tests.
- Prefer explicit conservative barriers over clever inference. A transition pair should be independent only when every relevant interaction is known safe.

## Atomic Implementation Steps

### Step 1: Add option and diagnostics plumbing with no reduction

Add the public and native option first, but keep behavior identical.

Required behavior:

- `checkModel(model, properties, { partialOrderReduction: true })` serializes the option.
- Rust accepts `partialOrderReduction` in `CheckOptionsIR`.
- Rust diagnostics include a POR section when the option is present.
- With no POR implementation yet, diagnostics should report `enabled: false`, `requested: true`, and `skipReason: "not implemented"` or a temporary equivalent.
- With the option omitted or false, diagnostics should either omit POR or report `requested: false` without changing existing snapshots unless tests require it.

Per-step files to edit:

- `src/check/types.ts`
- `src/check/native.ts`
- `src/check/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/cli.ts`
- `src/core/report/types.ts`
- `crates/checker/src/model.rs`
- `crates/checker/src/search.rs`
- `src/cli/features/check/command.test.ts`
- `test/checker/checker.test.ts`

Stop and report if:

- Adding the option changes existing check diagnostics when the option is omitted.
- The check report type currently rejects existing emitted diagnostics such as `storage` or `hotPath`; fix that type drift deliberately rather than widening everything to `unknown`.

### Step 2: Compile conservative transition footprints

Extend compiled transition metadata so POR can make decisions without rewalking full IR during every state expansion.

Required footprint data:

- `readIndexes`: declared transition reads, guard reads, and mount guard reads required by touched mount-local vars.
- `writeIndexes`: existing compiled writes.
- `triggeredByIndexes`: existing compiled triggered-by vars.
- `mountLocalVarIndexes`: existing compiled mount-local touched vars.
- `pendingQueueIndexesTouched`: queues read or written by enqueue/dequeue/read-op-arg behavior where known.
- `systemRoleIndexesTouched`: at least pending queues, location-current, and location-history role vars.
- Conservative boolean barriers where useful:
  - `touchesPendingQueue`
  - `touchesRouteOrHistory`
  - `touchesMountLocal`
  - `usesReadPre`
  - `usesReadOpArg`
  - `usesFreshToken`
  - `hasHavocOrOpaqueLikeEffect`
  - `mayBranch`

Use existing declared `transition.reads` and `transition.writes` as the primary footprint, but include guard and mount reads so the independence relation is safe even if a future extractor underdeclares a guard read. Validation should still reject unknown declared vars as it does today.

Per-step files to edit:

- `crates/checker/src/model.rs`
- `crates/checker/src/effect.rs`, only for reusable effect walkers
- `crates/checker/src/step.rs`, only if pending queue effect helpers need to be shared

Tests to add:

- Rust unit tests in `model.rs` or `por.rs` proving compiled footprints include declared reads/writes, guard reads, mount guard reads, triggered-by vars, and system-role barriers.

Stop and report if:

- Footprint compilation needs to execute effects or evaluate state-dependent expressions. POR footprints must remain static and derived from validated IR.
- Pending queue or route/history queue identification cannot be represented without duplicating semantics. Move the helper instead of cloning logic.

### Step 3: Implement pairwise independence classification

Create `crates/checker/src/por.rs` and implement conservative pair classification.

A pair must be dependent if any of these hold:

- Same transition id.
- Either transition is visible to the current property group.
- Read/write conflict in either direction.
- Write/write conflict.
- Triggered-by interaction with the other transition's writes.
- Either transition touches a pending queue.
- Either transition touches route/current/history system vars.
- Either transition touches mount-local vars or mount guard vars.
- Either transition uses `readPre`, `readOpArg`, fresh tokens, havoc, branch-producing effects, or another feature not explicitly proven commutative.
- Transition classes or labels imply user-observable ordering that is not captured by footprints.
- The relation is unknown for any reason.

Initial positive independence should be intentionally narrow:

- Both transitions are non-internal macro transitions.
- Both are invisible to all properties in the current Rust request.
- Both have deterministic, non-branching structured effects.
- Both have disjoint read/write/write/read/write footprints.
- Neither touches pending queues, route/history roles, mount-local state, fresh tokens, `readPre`, `readOpArg`, or triggered-by-sensitive internals.

Diagnostics should count dependency reason classes. Use stable strings such as:

- `visible-to-property`
- `read-write-conflict`
- `write-write-conflict`
- `triggered-by-conflict`
- `pending-queue`
- `route-history`
- `mount-local`
- `effect-context`
- `nondeterministic-effect`
- `unsupported-feature`

Per-step files to edit:

- `crates/checker/src/por.rs`
- `crates/checker/src/lib.rs`
- `crates/checker/src/model.rs`

Tests to add:

- Rust unit tests for:
  - two disjoint deterministic invisible transitions are independent
  - write/write conflict is dependent
  - read/write conflict is dependent
  - visible transition is dependent
  - pending queue transition is dependent
  - route/history transition is dependent
  - mount-local transition is dependent
  - fresh token or branch-producing effect is dependent

Stop and report if:

- A desired independence rule depends on dynamic state values. Keep it dependent in this phase.
- Any rule could reorder pending queue resolution, mount reset, or route history effects.

### Step 4: Gate POR to supported property groups

Build a POR context from the compiled model, the current Rust property group, and options.

First supported mode:

- POR may run only when `partialOrderReduction === true`.
- POR may run only when every property in the Rust request is `PropertyIR::Always`.
- POR may run only when the graph recording mode for the property group does not require global edge observation.
- POR may run on full or sliced models, but diagnostics must distinguish `slicedModel: true` from `false`. The expected production path is sliced groups from `checkModelSliced(...)`.

Visibility:

- Treat every var listed in each `Always.reads` as visible.
- Treat every transition named in each `Always.enabledTransitions` as visible.
- Treat writes to visible vars as visible.
- Treat writes to guard/mount vars required by enabled-transition observations as visible if those vars are available from the already compiled property reads. Do not re-infer property reads in Rust unless a missing test proves it is necessary.

Unsupported properties:

- If any property is `AlwaysStep`, `Reachable`, `ReachableFrom`, or `LeadsToWithin`, skip POR with a deterministic reason such as `unsupported-property-kind`.
- If a property has missing `reads` while it contains state predicates, skip POR with `missing-property-reads` rather than guessing.

Per-step files to edit:

- `crates/checker/src/por.rs`
- `crates/checker/src/search.rs`
- `crates/checker/src/property.rs`, only if helper functions for property kind/read extraction belong there

Tests to add:

- POR requested for `always` enables POR diagnostics.
- POR requested for `alwaysStep`, `reachable`, `reachableFrom`, or `leadsToWithin` reports skipped and does not reduce.
- A transition writing a property-read var is visible and blocks reduction.
- A transition named by `enabledTransitions` is visible and blocks reduction.

Stop and report if:

- Existing property builders do not always serialize `reads` for `always` properties. Fix property serialization or skip POR with diagnostics; do not infer incomplete reads ad hoc.

### Step 5: Add state-local reduction with cycle-proviso fallback

Integrate POR into `expand_chunk(...)` without changing the default path.

Recommended implementation shape:

1. For each frontier state, compute `enabled = enabled_non_internal(compiled, pre)` as today.
2. If POR is unavailable or skipped, iterate `enabled` unchanged.
3. If POR is available:
   - If any enabled transition is visible, explore all enabled transitions and record reason `visible-to-property`.
   - Otherwise, choose the first enabled transition that is independent from every other enabled transition.
   - Tentatively explore only that singleton ample set.
   - If every generated successor from the selected set is already in the visited snapshot and there were skipped enabled transitions, fall back to exploring all enabled transitions for that state and record reason `cycle-proviso`.
   - If no singleton candidate is safe, explore all enabled transitions and record the dominant dependency reason.
4. Preserve transition order inside the selected set.
5. Keep generated edge sort keys unchanged so downstream observation remains deterministic.

This is deliberately conservative. It should reduce large interleavings only when the enabled set contains invisible, mutually independent transitions and the cycle fallback does not force full expansion.

Important trace behavior:

- For verified properties, return the POR-reduced result.
- For violated properties, rerun the same Rust request with POR disabled before returning to TypeScript, or return a structured signal that causes `checkModel(...)` to rerun without POR. Prefer doing this inside Rust if it avoids exposing a second native call contract.
- The final reported violation trace must come from the non-POR run and remain the canonical BFS-shortest trace.
- Diagnostics should record that a POR violation rerun occurred.

Per-step files to edit:

- `crates/checker/src/por.rs`
- `crates/checker/src/search.rs`
- `crates/checker/src/transition_index.rs`, only if helper extraction is cleaner
- `src/check/check-model.ts`, only if violation rerun is done on the TypeScript side

Tests to add:

- A hand model with several independent invisible toggles verifies with fewer edges/states when POR is enabled.
- The same model without POR has larger search stats.
- A model with a visible violation returns the same trace steps with POR on and off because the final trace is from the non-POR rerun.
- A model where singleton selected successors all point to already-visited states falls back to full expansion and reports `cycle-proviso`.
- Search limits still stop with error verdicts and structured `limits` diagnostics when POR is enabled.

Stop and report if:

- The cycle-proviso fallback cannot be implemented without making parallel expansion nondeterministic.
- POR changes a reported violation trace.
- POR changes any verdict in existing checker tests.

### Step 6: Merge and render POR diagnostics

Add stable diagnostics on both Rust and TypeScript sides.

Suggested `CheckDiagnostics.partialOrderReduction` shape:

```ts
{
  requested: boolean;
  enabled: boolean;
  skipped?: boolean;
  skipReason?: string;
  supportedPropertyKinds?: readonly string[];
  fullExplorationStates: number;
  reducedStates: number;
  fullEnabledTransitions: number;
  exploredTransitions: number;
  skippedTransitions: number;
  cycleFallbackStates: number;
  violationRerun?: boolean;
  reasonCounts: readonly { reason: string; count: number }[];
}
```

For sliced checks, `checkModelSliced(...)` must merge POR diagnostics across slice groups:

- Sum counts.
- Sort and sum `reasonCounts` by reason.
- `requested` is true if requested for the top-level check.
- `enabled` is true if any slice group enabled POR.
- `skipped` is true only if all groups skipped.
- `skipReason` should be a stable summary such as `all groups skipped: unsupported-property-kind` or omitted if at least one group ran.
- Preserve each existing `SliceSummary` unchanged.

Human output:

- Add a compact line only when POR was requested or enabled:
  - `por=enabled reducedStates:N skippedTransitions:N cycleFallbacks:N`
  - `por=skipped reason:<reason>`
- Do not bury existing `slicing=...`, `storage=...`, or `search-limit=...` lines.

Per-step files to edit:

- `src/check/types.ts`
- `src/check/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/output.ts`, only if the human renderer there also needs a POR summary
- `src/core/report/types.ts`
- `crates/checker/src/search.rs`
- `crates/checker/src/por.rs`
- `src/cli/features/check/command.test.ts`

Stop and report if:

- Merging diagnostics across slice groups would hide a skipped group that matters. Prefer explicit per-group POR summaries over lossy aggregation if needed.

### Step 7: Add differential and parity tests

Add tests that prove POR is behavior-preserving before relying on performance claims.

Required test classes:

- Rust unit tests for footprint and independence classification.
- Rust-backed TypeScript tests for `checkModel(..., { partialOrderReduction: true })`.
- Sliced-vs-sliced+POR status parity for state-only `always` properties.
- POR-on/POR-off differential tests for small hand models with known state counts.
- Counterexample stability tests where POR is requested but the final violation trace matches the non-POR BFS trace.
- Conservative dependency tests proving route/history, pending queue, mount-local, and enabled-transition-observation transitions are not reduced.
- CLI/report tests proving the flag and diagnostics are emitted deterministically.

Per-step files to edit:

- `test/checker/checker.test.ts`
- `test/check/slicing-parity.test.ts`
- `src/cli/features/check/command.test.ts`
- `tools/phase7-differential.ts`
- Rust tests colocated in `crates/checker/src/por.rs`, `model.rs`, or `search.rs`

Stop and report if:

- Any existing checker, slicing parity, or phase7 differential test changes verdict.
- Any violated-property trace changes when POR is requested.
- POR improves counts only by skipping transitions that should be visible to the property.

### Step 8: Add benchmark evidence

Use the existing benchmark tooling and the slice manifests from earlier plans to record whether interleavings still dominate after slicing.

Required behavior:

- Extend `tools/check-performance-benchmark.ts` or a nearby benchmark helper to include:
  - unsliced
  - sliced
  - sliced with POR
- Include stats for states, edges, depth, elapsed time, and POR diagnostics.
- Keep elapsed time as benchmark evidence, not brittle test assertions.
- If the Coffee DX fixture is available locally, record the result in the existing benchmark output path or docs. If not, use a synthetic model with many independent invisible transitions and state why it is synthetic.

Per-step files to edit:

- `tools/check-performance-benchmark.ts`
- `docs/_benchmarks/check-performance.md`
- `docs/_specs/03-checker.md`

Stop and report if:

- The benchmark does not show interleaving-driven improvement after slicing. That may mean remaining cost is domain breadth or effect/stabilization overhead, not POR.

### Step 9: Document POR semantics and limitations

Update the checker spec after implementation and tests pass.

Required docs:

- POR is disabled by default.
- POR runs after slicing.
- First supported mode is conservative state-invariant POR for `always` property groups.
- Visibility is derived from serialized property `reads` and `enabledTransitions`.
- Pending queues, route/history, mount-local state, effect context reads, fresh tokens, nondeterministic effects, and unsupported property kinds force full expansion.
- POR diagnostics explain skipped/reduced transitions and cycle fallback.
- Violations are rerun without POR so reported traces remain canonical BFS-shortest traces.

Per-step files to edit:

- `docs/_specs/03-checker.md`
- `docs/reference/property-api.md`, only if the public `checkModel` option is documented there
- CLI help text in `src/cli/cli.ts`

Stop and report if:

- The implementation behavior cannot be stated as a conservative over-approximation of full BFS for the supported property class.

## Acceptance Criteria

- `partialOrderReduction` can be enabled explicitly through `checkModel(...)` and the CLI.
- POR remains disabled by default.
- POR diagnostics report whether it was requested, enabled, skipped, and why.
- POR runs only after slicing in the normal `checkModel(..., { slicing: true, partialOrderReduction: true })` path.
- Unsupported property groups skip POR with structured diagnostics rather than silently running full search.
- For supported `always` property groups, POR reduces states or edges on at least one hand-authored independent-interleaving fixture.
- POR never changes verdict statuses in the parity suite.
- Violated `always` properties still report the same BFS-shortest trace as non-POR checking.
- Route/history, pending queue, mount-local, effect-context, fresh-token, and nondeterministic transitions are conservatively dependent until proven otherwise.
- Search limits and memory guards still work when POR is enabled.
- Human output and report JSON include deterministic POR summaries.
- `docs/_specs/03-checker.md` describes the implemented POR restrictions and diagnostics.

## Tests to Add or Update

- Add Rust unit tests in `crates/checker/src/por.rs` for transition footprint and pairwise independence reason classes.
- Add Rust search tests or TypeScript Rust-backed tests in `test/checker/checker.test.ts` for:
  - POR enabled on `always`
  - POR skipped on unsupported property kinds
  - reduced stats on independent invisible transitions
  - no reduction for visible writes
  - no reduction for `enabledTransitions`
  - no reduction for pending queue, route/history, and mount-local interactions
  - violation rerun preserving trace steps
- Add sliced parity tests in `test/check/slicing-parity.test.ts` comparing sliced vs sliced+POR verdicts.
- Add CLI tests in `src/cli/features/check/command.test.ts` for `--partial-order-reduction`, report diagnostics, and compact output.
- Extend `tools/phase7-differential.ts` or add a focused POR differential fixture so `pnpm phase7` exercises POR-on/POR-off status parity for supported models.
- Update report type tests if existing check-report diagnostics are currently under-typed.

## Verification Commands

Run focused Rust checks first:

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
```

Run focused TypeScript tests:

```bash
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts
```

Run semantic parity and project checks:

```bash
rtk pnpm phase7
rtk pnpm architecture
rtk pnpm typecheck
rtk pnpm fix
```

Before declaring Plan 5 complete, run the broad suite:

```bash
rtk pnpm test
```

Optional performance evidence:

```bash
rtk pnpm perf:check
```

## Risks, Ambiguities, and Stop Conditions

- POR correctness is more important than speed. Stop if the reduction cannot be explained as a conservative ample-set/persistent-set reduction for the supported property class.
- BFS shortest traces are a product requirement. Stop if a reported violation trace differs from non-POR output; implement or fix the non-POR violation rerun before continuing.
- Standard POR cycle provisos are subtle in parallel BFS. Stop if the cycle fallback cannot be implemented deterministically with the current `expand_chunk(...)` architecture.
- Property visibility depends on serialized `reads` and `enabledTransitions`. Stop if any supported property reaches Rust without reliable reads.
- Pending queues encode async continuation semantics and step facts. Treat them as dependent unless a later plan proves a queue-specific rule.
- Route/history effects are globally observable through navigation state and mount guards. Treat them as dependent in this phase.
- Mount-local transitions can trigger reset/unmount behavior through guards. Treat them as dependent in this phase.
- Fresh tokens and effect nondeterminism can make commuting transitions non-obvious. Treat them as dependent in this phase.
- If POR diagnostics show almost no skipped transitions on the Coffee-shaped benchmark after slicing, report that remaining cost is likely not interleaving-dominated.
- If adding POR option plumbing changes existing report or output snapshots when the option is omitted, stop and restore default-output stability.
- If phase7 or checker parity fails with POR enabled, minimize the model and fix the independence rule before expanding support.
