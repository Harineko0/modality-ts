# Check Performance Overhaul Plan of Plans

## Goal

Reduce massive-state property check time, with the immediate priority of making per-property slicing materialized and measurable at extract time.

The motivating benchmark is the Coffee DX property in `/Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts`:

```ts
always(
  model,
  orExpr(
    neq(readVar("local:CustomerHome.printerStatus"), lit("connected")),
    enabled(model, "PrinterSettingsDialog.onClick.optimisticDensity.seq.1"),
  ),
  { name: "densityOneRequiresConnectedPrinter" },
)
```

Current observed behavior: extraction takes about 6.8 seconds and checking takes about 600 seconds. The target is to bring checks for properties of this shape under 10 seconds by making irrelevant state space visible, removable, and testable.

This is a plan of plans. Each phase below should become its own implementation plan before code changes begin.

## Context

`modality-ts` currently extracts one model per TSX/source target and performs per-property slicing during `check`. This makes slices transient in-memory artifacts. They are difficult to inspect directly, compare across runs, benchmark independently, or use as golden artifacts.

The project direction is to move per-property slicing into extract output first. After that, proceed in this order:

1. Diagnostics.
2. Fixes.
3. Slicing improvements.
4. Partial-order reduction.
5. CTL expansion.

Important current architecture:

- Public property builders live in `src/core/props/index.ts`.
- Property and model artifact validation lives in `src/core/artifacts/index.ts`.
- Check-side slicing lives in `src/check/slicing/slice-model.ts` and `src/check/slicing/dependency-graph.ts`.
- Check orchestration lives in `src/check/check-model.ts`.
- The CLI check command lives in `src/cli/features/check/command.ts`.
- Extract orchestration lives in `src/cli/features/extract/command.ts`.
- Generated model discovery and default artifact paths live in `src/cli/defaults.ts`.
- The Rust checker lives under `crates/checker/src/`, especially `search.rs`, `property.rs`, `graph.rs`, and `model.rs`.
- Checker specification notes are in `docs/_specs/03-checker.md`.

Key current behavior:

- `checkModel()` computes check-side per-property slices only when all loaded properties are sliceable.
- `checkModelSliced()` groups properties with equivalent slice vars/transitions and runs Rust once per slice group.
- Slice diagnostics are emitted in check reports, but the actual sliced models are not persisted.
- `always(p)` is already equivalent to `AG p`; the expensive work is usually reachability/state generation, not predicate evaluation.
- `enabled(t)` should depend on enabledness: guard, mount condition, and any required route/mount system vars. It should not require the target transition's whole effect unless a later formal decision says otherwise.
- CTL/SCC work is valuable later, but it is not the first lever for invariant performance.

## Non-goals

- Do not start by adding CTL operators.
- Do not replace the Rust checker.
- Do not remove current check-side slicing until extract-side slices are stable and parity-tested.
- Do not optimize only for the Coffee DX property shape; use it as the primary benchmark and regression case.
- Do not introduce backward-compatibility layers. This tool is experimental.
- Do not hide uncertainty by silently falling back to full-model behavior without diagnostics.

## Current-state findings

- `src/core/props/index.ts` infers `reads` for `transitionEnabled` by including guard reads, effect reads, effect writes, transition reads, and transition writes. This can over-expand slices for properties that only ask whether a transition is enabled.
- `src/check/slicing/slice-model.ts` already computes property dependency requests and can produce per-property sliced `Model` values.
- `src/check/slicing/dependency-graph.ts` already separates enabled-transition guard vars from broader transition semantic vars through `enabledTransitionGuardVars()` and `enabledTransitionSeedVars()`.
- `src/check/check-model.ts` already groups equivalent slices and records slice summaries, which is a good model for extract-side slice grouping diagnostics.
- `src/cli/features/extract/command.ts` currently writes one model artifact and one generated app model artifact per extraction target.
- `src/cli/defaults.ts` already supports per-props generated model paths under `.modality/models/**/*.model.json`.
- There is no current extract-side property loading path. Extraction can infer source files from props files, but it does not appear to evaluate `.props.ts` to emit per-property artifacts.

## Existing patterns to follow

- Use canonical JSON via `canonicalJson()` when writing artifacts.
- Keep artifact schemas versioned with `schemaVersion: 1` and explicit `kind` fields where appropriate.
- Follow `runCheckCommand()` and `runExtractCommand()` option-object style for CLI integration.
- Follow `checkModelSliced()` grouping logic for equivalent slices.
- Follow `ExtractionReport` diagnostics style: phase timings plus structured diagnostics.
- Preserve deterministic ordering by sorting property names, slice keys, vars, transitions, and artifact paths.
- Use focused Vitest coverage under `test/check/`, `test/extraction/`, and `src/cli/features/*/*.test.ts`.

## Plan 1: Extract-side per-property slice artifacts

Goal: materialize per-property slices during extraction so they can be measured and checked independently.

Primary design:

- Add a new extract option that accepts property paths, probably `propsPaths?: readonly string[]`, without making extraction require properties.
- Reuse the existing property loading semantics from `src/cli/features/check/command.ts` instead of inventing a second incompatible `.props.ts` loader.
- Build a small shared property-loading module if needed, for example `src/cli/features/properties/load-properties.ts`.
- After the final postprocessed model is assembled in extract, load properties and compute slices with `sliceModelForCheckProperty()`.
- Persist slice models under deterministic paths, for example:
  - `.modality/models/<source>.slices/<property-safe-name>.model.json`, or
  - `.modality/models/<source>.<property-safe-name>.model.json`.
- Prefer a manifest artifact over path guessing, for example `.modality/models/<source>.slices.json`, containing property name, slice model path, mode, vars, transitions, retained bits, pruned bits, and source model hash.
- Preserve the current full model artifact as the canonical extraction output.
- Do not make `check` depend on extract-side slices in this phase.

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/cli.ts`
- `src/cli/defaults.ts`
- `src/check/slicing/slice-model.ts` only if public helper shape needs minor adjustment
- `src/cli/features/check/command.ts` if property loading is extracted into a shared module
- `src/core/artifacts/index.ts` if a slice manifest parser is added
- `src/core/report/types.ts` or related report type files for extraction diagnostics
- Docs under `docs/` and/or `docs/_specs/03-checker.md`

Acceptance criteria:

- Running `modality extract` with discovered props emits the full model plus per-property slice artifacts and a manifest.
- Slice manifests include enough economics to compare full vs sliced model size without running check.
- Running extract without props still behaves like today.
- Slice artifact output is deterministic.
- A property that cannot be sliced is represented explicitly in the manifest with a reason and no fake slice.

Tests:

- Add CLI extract tests showing slice artifacts are emitted for a small props file.
- Add tests for deterministic safe property filenames.
- Add tests for unsliceable property manifest entries.
- Add tests that slice artifact models parse with `parseModelArtifact()`.
- Add tests that check-side slicing and extract-side slicing produce identical model vars/transitions for the same property.

Verification commands:

```bash
rtk pnpm test -- src/cli/features/extract
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm typecheck
rtk pnpm fix
```

Stop and ask/report if:

- Property loading during extract creates import cycles between check and extract features.
- The intended slice artifact path conflicts with existing `.modality/models` discovery.
- A property factory requires runtime state not available during extract.

## Plan 2: Diagnostics and benchmarking

Goal: make performance and state-space causes observable before applying semantic fixes.

Primary design:

- Add extract report diagnostics for every emitted property slice:
  - property name
  - slice mode
  - full vars/transitions vs slice vars/transitions
  - retained/pruned state-space contributor bits
  - top retained contributors
  - top pruned contributors
  - slicing skip reason
  - elapsed time to compute the slice
- Add a benchmark fixture or canary around the Coffee DX property when a local fixture is acceptable, or create an equivalent synthetic fixture in this repo if cross-repo tests are undesirable.
- Add a CLI-visible summary line for slice economics.
- Keep raw elapsed timings separate from deterministic golden assertions.

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/output.ts`
- `src/cli/features/extract/report.ts`
- `src/check/slicing/contributors.ts`
- `src/check/types.ts`
- `src/core/report/types.ts`
- `tools/` if a benchmark runner is added

Acceptance criteria:

- Extract output can answer: "Which variables/transitions made this property slice large?"
- Reports can be compared across runs without needing heap inspection.
- The motivating property has a recorded baseline of full model size, slice size, and check time.

Tests:

- Snapshot-light tests for extraction report slice diagnostics.
- Tests for retained/pruned contributors in manifest/report.
- Tests that elapsed timing exists when requested but is not used in brittle snapshots.

Verification commands:

```bash
rtk pnpm test -- src/cli/features/extract
rtk pnpm test -- src/cli/features/check
rtk pnpm typecheck
rtk pnpm fix
```

Stop and ask/report if:

- Diagnostics require persisting sensitive source text or full state values.
- The benchmark cannot be represented inside this repo without importing Coffee DX.

## Plan 3: Enabledness dependency fix

Goal: make `enabled(model, transitionId)` slice dependencies match enabledness semantics.

Primary design:

- Treat `transitionEnabled` and `transitionEnabledPrefix` as guard/mount observation dependencies for state properties.
- Do not include transition effects or writes in inferred `reads` solely because a property uses `enabled()`.
- Keep `enabledTransitions` populated so slicing can force the relevant transition into the slice as observation-only.
- Validate that Rust predicate evaluation for `transitionEnabled` still has the vars it needs after slicing.

Files to edit:

- `src/core/props/index.ts`
- `src/check/slicing/slice-model.ts`
- `src/check/slicing/dependency-graph.ts`
- `crates/checker/src/expr.rs` only if Rust enabledness evaluation reveals missing assumptions
- `docs/reference/property-api.md`
- `docs/_specs/03-checker.md`

Acceptance criteria:

- The Coffee DX property's slice no longer retains variables solely because `setDensity1` writes them.
- Existing enabledness tests still pass.
- New tests cover an enabled transition with a wide effect and a narrow guard.

Tests:

- Unit test for `always(model, enabled(model, "t"))` inferred reads.
- Slicing parity test where `t` writes an unrelated huge domain.
- Checker test proving `enabled(t)` remains exact in a sliced model.

Verification commands:

```bash
rtk pnpm test -- test/kernel/kernel.test.ts
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm typecheck
rtk pnpm fix
```

Stop and ask/report if:

- Current Rust enabledness semantics require effect data for reasons other than guard/mount checks.
- Existing docs intentionally promise effect-sensitive enabledness.

## Plan 4: Slicing improvements

Goal: reduce remaining unnecessary state space after the enabledness fix.

Primary design:

- Use extract-side slice artifacts and diagnostics to identify the next largest retained contributors.
- Improve dependency closure only where diagnostics show concrete over-retention.
- Prefer principled dependency analysis over property-specific hacks.
- Consider field/path-sensitive slicing for record-like domains if whole-variable retention dominates.
- Consider route/mount-scope refinements where unrelated route-local state is retained.

Files likely to edit:

- `src/check/slicing/dependency-graph.ts`
- `src/check/slicing/slice-model.ts`
- `src/check/slicing/predicate-relevance.ts`
- `src/core/ir/validator.ts`
- `src/extract/engine/ts/field-pruning.ts`
- `src/cli/features/extract/model-postprocess.ts`

Acceptance criteria:

- Each slicing improvement includes a before/after diagnostic from an extract-side slice artifact.
- Slicing parity with full-model checking is preserved for affected property kinds.
- No broad full-model fallback is introduced for sliceable state properties.

Tests:

- Add narrow fixtures for each improved dependency rule.
- Add metamorphic tests: slicing on vs off produces the same verdict for the affected property.
- Add regression tests for mount-local and pending-queue interactions if touched.

Verification commands:

```bash
rtk pnpm test -- test/check/slicing-parity.test.ts
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm architecture
rtk pnpm typecheck
rtk pnpm fix
```

Stop and ask/report if:

- A proposed slicing rule cannot be stated as a sound over-approximation.
- A rule requires changing model semantics rather than dependency analysis.

## Plan 5: Partial-order reduction

Goal: avoid exploring equivalent interleavings of independent frontend transitions.

Primary design:

- Start with a formal independence relation over transitions based on reads, writes, classes, pending queues, mount effects, and route/history effects.
- Apply POR only after slicing, so the independence relation is smaller and easier to validate.
- Implement behind a disabled-by-default checker option until parity and differential tests are strong.
- Preserve counterexample replayability and deterministic trace ordering.

Files likely to edit:

- `crates/checker/src/search.rs`
- `crates/checker/src/step.rs`
- `crates/checker/src/model.rs`
- `crates/checker/src/transition_index.rs`
- `src/check/types.ts`
- `src/check/native.ts`
- `src/cli/features/check/command.ts`
- `docs/_specs/03-checker.md`

Acceptance criteria:

- POR can be enabled explicitly and reports that it was enabled.
- POR never changes verdicts in the parity suite.
- POR records reduction diagnostics: considered transitions, skipped transitions, and reason classes.
- The Coffee DX benchmark improves after slicing if independent interleavings still dominate.

Tests:

- Rust unit tests for independence classification.
- Differential tests with POR on/off.
- Counterexample stability tests for violated `always` properties.
- Tests that route/history/pending queue transitions are conservatively dependent.

Verification commands:

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm phase7
rtk pnpm typecheck
rtk pnpm fix
```

Stop and ask/report if:

- Independence cannot be made conservative for pending queues, mount reset, or route history.
- POR makes minimal counterexample traces unstable in user-facing reports.

## Plan 6: CTL expansion

Goal: add modal/temporal property forms after state-space reduction is measurable and stable.

Primary design:

- Introduce structured temporal property IR rather than ad hoc property kinds.
- Map existing helpers onto the new vocabulary where useful:
  - `always` as `AG p`
  - `reachable` as `EF p`
  - `reachableFrom` as `AG(when -> EF goal)`
- Add `X`, `F`, and `U` in a CTL-compatible shape.
- Add `AG`, `EG`, and related operators using standard fixpoint algorithms.
- Use SCC algorithms such as Tarjan or Kosaraju where they actually help, especially `EG`, liveness/cycle detection, and future fairness work.
- Keep bounded semantics explicit in reports.

Files likely to edit:

- `src/core/ir/types.ts`
- `src/core/props/index.ts`
- `src/core/artifacts/index.ts`
- `crates/checker/src/model.rs`
- `crates/checker/src/property.rs`
- `crates/checker/src/graph.rs`
- `crates/checker/src/search.rs`
- `docs/reference/property-api.md`
- `docs/_specs/03-checker.md`
- `tools/phase7-differential.ts`

Acceptance criteria:

- CTL operators are serializable and validated on both TS and Rust sides.
- Existing properties continue to have equivalent semantics through the new representation or a clear migration.
- `EG`/`U` algorithms are tested against small hand models and TLA/TLC differential cases where available.
- Reports clearly state bounded vs exact semantics.

Tests:

- TS artifact validation tests for the new property IR.
- Rust evaluator/model tests for each CTL operator.
- Differential tests for CTL formulas on hand-authored models.
- Docs examples for common frontend properties.

Verification commands:

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
rtk pnpm test
rtk pnpm phase7
rtk pnpm architecture
rtk pnpm typecheck
rtk pnpm fix
```

Stop and ask/report if:

- CTL semantics conflict with existing property report statuses.
- A proposed operator cannot produce actionable traces or certificates.
- The implementation would require broad rewrites before Plans 1-5 have landed.

## Cross-phase acceptance criteria

- Extract emits measurable per-property slice artifacts before any semantic optimization is applied.
- The motivating Coffee DX property has a documented baseline and after-change measurement.
- Full-model and sliced-model verdicts match for all sliceable properties in tests.
- User-facing reports explain when slicing is skipped or conservative.
- No phase relies on transient in-memory-only evidence for performance claims.

## Cross-phase verification

Run these before declaring a major phase complete:

```bash
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm typecheck
rtk pnpm fix
```

For Rust-heavy phases, also run:

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
```

## Risks and ambiguities

- Extract-side property loading may blur the current separation between extraction and checking. Prefer a shared property loader module to avoid coupling extract to check command internals.
- Persisted slice artifact paths must not confuse existing model discovery. A manifest is safer than relying on filename conventions alone.
- Fixing `enabled()` dependency inference may expose hidden assumptions in current tests. Treat that as useful signal, not as a reason to keep over-broad dependencies.
- Some model blowups may come from broad domains rather than interleavings. Diagnostics must distinguish retained variable domain size from transition count.
- POR is correctness-sensitive and should wait until slice artifacts and parity tests are strong.
- CTL expansion is valuable but should not distract from the immediate invariant performance path.

## Stop conditions for the overhaul

- Stop if a phase cannot prove parity between full-model and sliced-model checking for the affected property class.
- Stop if performance improvement depends on deleting user-observable behavior from the model.
- Stop if a fallback silently returns to full-model checking without reporting the reason.
- Stop if a benchmark result cannot be reproduced from persisted artifacts.
