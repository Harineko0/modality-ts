# State Space Narrowing and Diagnostics Plan

## Goal

Fix the real-app state explosion path described in `docs/issues/state-explosion-on-real-app-check.md` by making `modality check` reduce irrelevant state space before search and fail gracefully when a model is still too large.

This plan covers directions 1, 2, and 3 from the discussion:

- Structured checker diagnostics, progress reporting, and graceful limits.
- Correct and default per-property slicing.
- Framework-neutral extraction/model metadata that helps narrow future state spaces without overfitting to React Router, SWR, Jotai, or any specific library.

The implementation should preserve the existing TypeScript checker and IR semantics.

## Non-goals

- Do not rewrite the checker in Rust.
- Do not change the public model artifact schema unless a schema-versioned migration is included.
- Do not add library-specific special cases for TinyURL, React Router routes, SWR keys, Jotai atoms, or particular app-shell file names.
- Do not silently under-approximate behavior. If a slice cannot be proven sound from declared footprints, fail closed or report a diagnostic.
- Do not remove BFS shortest-counterexample behavior.
- Do not commit generated `dist/` output.

## Current-State Findings

- The issue reproduction in `docs/issues/state-explosion-on-real-app-check.md` reports extraction succeeding with `vars=45 transitions=46`, followed by Node heap exhaustion during `modality check`.
- `src/cli/features/check/command.ts` calls `checkModel(model, properties)` without `{ slicing: true }`, so the CLI does not use the existing slicing path.
- `src/check/engine/check-model.ts` only uses slicing when `options.slicing` is truthy and every property has `reads`.
- `src/check/slicing/slice-model.ts` currently pulls every `sys:*` variable into every slice. This likely keeps route/history/pending dimensions even when a property does not read them.
- `src/check/slicing/slice-model.ts` retains transitions that merely read a needed variable. The checker spec says the cone of influence should grow from transitions that write needed variables, then include their reads.
- `docs/specs/03-checker.md` says vars outside a property slice are frozen at bottom/initial and their transitions are dropped. Current slicing drops vars but still tends to keep too many system vars and transitions.
- `src/check/properties/checked-state.ts` already validates undeclared property reads at runtime, which is the right safety pattern to preserve.
- `src/core/report/types.ts` only reports `states`, `edges`, and `depth` in `CheckReport.stats`; there is no structured frontier, heap, slice, or cutoff diagnostic today.
- `src/check/engine/check-model.ts` currently throws normal errors for validation/stabilization problems but has no explicit max-state, max-frontier, or memory guard.

## Exact File Paths and Relevant Symbols

- `docs/issues/state-explosion-on-real-app-check.md`
  - The real-app failure report and expected diagnostic behavior.
- `docs/specs/03-checker.md`
  - Section 4, per-property slicing.
  - Section 8, reporting.
  - Section 11, visited-set memory exhaustion.
- `src/cli/features/check/command.ts`
  - `runCheckCommand`
  - `createCheckReport`
  - `renderCheckResult`
  - `CheckCommandOptions`
- `src/check/engine/check-model.ts`
  - `checkModel`
  - `checkModelCore`
  - `checkModelSliced`
  - `combineSlicedResults`
  - `exploreDepth`
  - `seedFrontier`
- `src/check/types.ts`
  - `CheckOptions`
  - `CheckResult`
  - `PropertyVerdict`
- `src/check/slicing/slice-model.ts`
  - `sliceModel`
  - `sliceModelForProperty`
  - `enabledTransitionVars`
- `src/check/properties/checked-state.ts`
  - `checkedState`
  - `allowedPropertyReads`
- `src/check/engine/mounts.ts`
  - `routeLocalMounted`
- `src/check/engine/initial-states.ts`
  - `initialStates`
- `src/check/runtime/navigation.ts`
  - `normalizeInitialRouteLocals`
  - `navigate`
- `src/core/ir/types.ts`
  - `Model`
  - `StateVarDecl`
  - `Transition`
  - `Bounds`
- `src/core/report/types.ts`
  - `CheckReport`
  - `ReportTrustLedger`
- `test/checker/checker.test.ts`
  - Existing slicing tests around `keeps verdicts stable with slicing enabled`
  - Existing enabled-transition slicing test around `preserves enabled() verdicts and witnesses when slicing is enabled`
- `src/cli/features/check/command.test.ts`
  - CLI report/rendering tests.

## Existing Patterns to Follow

- Follow `checkModel(model, properties, { slicing: true })` tests in `test/checker/checker.test.ts` for semantic parity between sliced and unsliced checks.
- Follow `checkedState(...)` in `src/check/properties/checked-state.ts`: runtime validation of declared reads should catch unsound property metadata rather than continuing silently.
- Follow `boundHits` in `src/check/diagnostics/bounds.ts` and `src/check/engine/check-model.ts` for surfacing bounded-search caveats without changing verdict semantics unnecessarily.
- Follow `createCheckReport(...)` in `src/cli/features/check/command.ts` for adding report fields in one place after `CheckResult` is extended.
- Follow the IR-level `reads`/`writes` contract in `Transition`; do not inspect framework-specific source paths inside the checker.

## Atomic Implementation Steps

### 1. Add checker execution diagnostics types

Extend the checker result with a structured diagnostics object that can describe large searches without changing successful verdict behavior.

Recommended shape in `src/check/types.ts`:

- Add `CheckDiagnostics`.
- Add optional `diagnostics?: CheckDiagnostics` to `CheckResult`.
- Include fields such as:
  - `slicing`: enabled/disabled, number of slices, per-slice var/transition/property counts.
  - `search`: max frontier size, final frontier size, expanded depths, maybe elapsed milliseconds.
  - `limits`: optional reason when a search was stopped gracefully.
  - `dominantVars`: optional top variables by distinct observed values, capped to a small number.

Keep this additive. Existing callers should continue compiling after small report/rendering updates.

Files to edit:

- `src/check/types.ts`
- `src/core/report/types.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`

Stop and ask/report if:

- Adding fields to `CheckReport` would require changing `schemaVersion`; if so, either bump intentionally or keep diagnostics under an optional backwards-compatible field.

### 2. Track per-depth progress and slice summaries inside `checkModelCore`

Add internal stats collection to `src/check/engine/check-model.ts`.

Implementation details:

- Track per-depth `frontier.length`, `next.length`, states, and edges.
- Track maximum frontier size.
- Track explored states through `parents.size`.
- Keep diagnostics deterministic. Do not include wall-clock fields in tests that assert full report equality unless tests inject a stable clock or ignore the field.
- In sliced mode, record one summary per slice:
  - slice key or stable index
  - properties in the slice
  - vars count
  - transitions count
  - result states/edges/depth

Files to edit:

- `src/check/engine/check-model.ts`
- `src/check/types.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- Existing deterministic report tests compare canonical JSON and would become unstable due to elapsed time or memory fields. Prefer omitting volatile fields from default reports or making them opt-in.

### 3. Add graceful search limits

Add optional `CheckOptions` limits so the checker can stop with a structured error verdict instead of exhausting the Node heap.

Recommended options in `src/check/types.ts`:

- `maxStates?: number`
- `maxEdges?: number`
- `maxFrontier?: number`
- `memoryGuard?: { maxHeapUsedBytes?: number }`
- `onProgress?: (snapshot: CheckProgress) => void`

Behavior:

- Limits should default to undefined initially, except CLI can set a conservative memory guard if desired.
- When a limit is hit, return error verdicts for unfinished properties with a message such as `search limit exceeded: maxStates=...`.
- Preserve already-found violations/reachable witnesses.
- Include limit details in `CheckResult.diagnostics` and `boundHits` or a new diagnostics field. Prefer diagnostics over overloading `boundHits`.

Files to edit:

- `src/check/types.ts`
- `src/check/engine/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- A memory guard cannot be implemented deterministically enough for tests. In that case, implement state/frontier/edge limits first and leave heap sampling as CLI-only or opt-in.

### 4. Enable slicing by default in CLI when property reads are available

Update `runCheckCommand(...)` in `src/cli/features/check/command.ts` to call:

```ts
checkModel(model, properties, { slicing: true })
```

or use an explicit option if a CLI flag already exists by the time Composer runs.

Behavior:

- If every property has `reads`, use slicing.
- If any property lacks `reads`, preserve the current full-model behavior and report that slicing was skipped.
- Do not make users add a new flag to get the intended default optimization.

Files to edit:

- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`
- `src/check/engine/check-model.ts` only if diagnostics need to mark slicing skipped.

Stop and ask/report if:

- There is a product decision to keep full-model check as the default. In that case, add `--slicing` and `--no-slicing` flags and update docs, but report that this differs from the recommended fix.

### 5. Fix the slicing seed so system vars are included only when needed

Change `sliceModelForProperty(...)` in `src/check/slicing/slice-model.ts`.

Desired behavior:

- Seed with `property.reads`.
- Add vars required by `property.enabledTransitions` through `enabledTransitionVars(...)`.
- Add system vars only when they are explicitly read, written, or required by a kept transition's mount/navigation semantics.
- Do not blindly include all `sys:*` vars.

Important cases:

- `enabled(t)` should still include `sys:route` if `routeLocalMounted(...)` needs it.
- Navigation effects that write `sys:route` or `sys:history` should remain only when route/history is in the cone.
- `enqueue`/`dequeue` transitions that use `sys:pending` should remain only when pending semantics are relevant to the property cone.

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/check/properties/checked-state.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- A transition effect implicitly depends on a system var that is not declared in `reads` or `writes`. That is a model footprint bug; fix the footprint or report it rather than baking in a checker special case.

### 6. Fix the transition retention rule for slices

Update `sliceModelForProperty(...)` so kept transitions match the spec's cone-of-influence rule.

Recommended algorithm:

1. Start `neededVars` with property reads and enabled-transition vars.
2. Repeatedly find transitions whose `writes` intersect `neededVars`.
3. Add those transitions to `neededTransitions`.
4. Add their `reads` and `writes` to `neededVars`.
5. Repeat until fixed point.
6. Add forced enabled transitions even if they do not write the cone.
7. Return only `neededVars` and `neededTransitions`.

Do not keep a transition solely because it reads a needed var. A reader that does not write back into the property cone cannot affect a state property, except for `alwaysStep` cases that observe the transition itself. If step properties need broader behavior, add a dedicated rule based on property kind rather than retaining all readers for every property.

Files to edit:

- `src/check/slicing/slice-model.ts`
- `test/checker/checker.test.ts`

Stop and ask/report if:

- `alwaysStep` properties with broad transition observations lack enough metadata to slice soundly. Prefer falling back to full-model search for those properties over unsafe slicing.

### 7. Add focused slicing regressions for route/system noise

Add tests that model the TinyURL shape without needing the sibling repo.

Recommended tests in `test/checker/checker.test.ts`:

- A property reading a local var should not retain unrelated `sys:history` if no kept transition reads/writes history.
- A property reading a route-local var should keep only transitions that can affect that var and the minimum system route var needed for mount semantics.
- A property using `enabled("transitionId")` should keep that transition's reads/writes and `sys:route`.
- A transition that only reads a needed var but writes an unrelated var should be dropped for `always`/`reachable` properties.
- Sliced and unsliced verdict statuses should remain identical on small models where full exploration is tractable.

Files to edit:

- `test/checker/checker.test.ts`

Stop and ask/report if:

- The existing property DSL cannot distinguish state predicates from step predicates at the point slicing is selected. Add the minimum metadata needed rather than broadening every slice.

### 8. Add framework-neutral extraction narrowing metadata

Use generic metadata, not library-specific checker rules.

Recommended additions should be additive and optional:

- In `src/core/ir/types.ts`, consider optional transition metadata for:
  - `scope` or `lifetime` if current `StateVarDecl.scope` is insufficient.
  - `independenceKey` or `resourceKey` only if it can be derived generically from reads/writes/template keys.
  - `extractionGroup` for diagnostics only, not semantics.
- Prefer using existing fields first:
  - `StateVarDecl.scope`
  - `Transition.reads`
  - `Transition.writes`
  - `Transition.cls`
  - `Transition.source`
  - `Transition.confidence`

For built-in plugins, verify they emit accurate reads/writes and route-local scopes:

- `src/extract/engine/pipeline/index.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/sources/router/*`
- `src/extract/sources/swr/*`
- `src/extract/sources/jotai/*`
- `src/extract/sources/use-state/*`

Files to edit:

- Start with tests and footprint fixes only.
- Edit `src/core/ir/types.ts` only if existing fields cannot express the needed generic relationship.

Stop and ask/report if:

- A proposed extraction fix references concrete library names in checker logic. That is overfitting; move the library knowledge into plugin-emitted generic IR facts.

### 9. Expose useful CLI diagnostics

Update `renderCheckResult(...)` so large-search diagnostics are visible.

Recommended output:

- Existing verdict lines unchanged.
- Existing `states=... edges=... depth=...` line unchanged.
- Add one compact line when slicing is active:
  - `slicing=slices:3 vars:... transitions:... skipped:0`
- Add one compact line when a limit is hit:
  - `search-limit=maxStates states=... frontier=... depth=...`
- Keep output stable and concise.

Files to edit:

- `src/cli/features/check/command.ts`
- `src/cli/features/check/command.test.ts`

Stop and ask/report if:

- Human output becomes too noisy for normal successful runs. Prefer report JSON for detailed per-depth diagnostics and terminal output for summaries.

### 10. Document the new default and troubleshooting path

Update docs after behavior lands.

Recommended docs:

- `docs/issues/state-explosion-on-real-app-check.md`: append a "Resolution Plan" or "Implemented Notes" section.
- `docs/specs/03-checker.md`: align current implementation details if slicing semantics changed.
- README or CLI docs only if there is an existing check-command section.

Files to edit:

- `docs/issues/state-explosion-on-real-app-check.md`
- `docs/specs/03-checker.md`
- Possibly `README.md`

Stop and ask/report if:

- The spec and implementation disagree about slicing step-property semantics; resolve the semantic decision before documenting.

## Per-Step Files to Edit

- Step 1:
  - `src/check/types.ts`
  - `src/core/report/types.ts`
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/command.test.ts`
- Step 2:
  - `src/check/engine/check-model.ts`
  - `src/check/types.ts`
  - `src/cli/features/check/command.ts`
  - `test/checker/checker.test.ts`
- Step 3:
  - `src/check/types.ts`
  - `src/check/engine/check-model.ts`
  - `src/cli/features/check/command.ts`
  - `test/checker/checker.test.ts`
- Step 4:
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/command.test.ts`
- Step 5:
  - `src/check/slicing/slice-model.ts`
  - `src/check/properties/checked-state.ts`
  - `test/checker/checker.test.ts`
- Step 6:
  - `src/check/slicing/slice-model.ts`
  - `test/checker/checker.test.ts`
- Step 7:
  - `test/checker/checker.test.ts`
- Step 8:
  - `src/core/ir/types.ts` only if necessary
  - `src/extract/**` only for footprint/scope correctness fixes
  - `test/extraction/**` and `src/cli/features/extract/command.test.ts`
- Step 9:
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/command.test.ts`
- Step 10:
  - `docs/issues/state-explosion-on-real-app-check.md`
  - `docs/specs/03-checker.md`
  - Possibly `README.md`

## Acceptance Criteria

- `modality check` uses slicing by default when all loaded properties have declared or inferred `reads`.
- Slicing no longer includes every `sys:*` var automatically.
- Slicing no longer keeps transitions solely because they read a needed var for normal state properties.
- Properties using `enabled(...)` still check correctly with slicing enabled.
- If slicing is skipped, the report explains why.
- A large search can stop with a structured diagnostic instead of a raw V8 heap crash when configured limits are hit.
- Reports include enough data to understand scale: states, edges, depth, max frontier, slicing summary, and limit reason when relevant.
- No checker logic special-cases a specific framework, library, app route, file path, or plugin package.
- Existing sliced-vs-full verdict parity tests continue to pass.
- No generated `dist/` files are committed.

## Tests to Add or Update

- `test/checker/checker.test.ts`
  - Add route/system-var slicing regressions.
  - Add reader-only transition drop regression.
  - Add max-state or max-frontier graceful-limit regression.
  - Update existing slicing tests if diagnostics are now included.
- `src/cli/features/check/command.test.ts`
  - Assert CLI invokes slicing by default when property reads are present.
  - Assert CLI output/report includes slicing summary.
  - Assert CLI output/report includes search-limit diagnostics.
  - Preserve deterministic report tests.
- `test/extraction/extraction.test.ts` or `src/cli/features/extract/command.test.ts`
  - Add footprint/scope regression only if extraction reads/writes are corrected.
- Avoid tests that require `/Users/hari/proj/gdgjp/tinyurl`; use a synthetic model in this repository.

## Verification Commands

Run commands with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/checker/checker.test.ts
rtk pnpm test -- src/cli/features/check/command.test.ts
rtk pnpm test -- test/extraction/extraction.test.ts src/cli/features/extract/command.test.ts
rtk pnpm architecture
```

If slicing semantics or checker reachability behavior changes in a way that may affect TLA parity, also run:

```bash
rtk pnpm phase7
```

For manual validation against the original issue after the synthetic tests pass:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk pnpm exec modality check
rtk pnpm exec modality check .modality/model.json app/routes/analytics.props.mjs
```

## Risks, Ambiguities, and Stop Conditions

- Risk: Dropping reader-only transitions is sound for state predicates but may be wrong for broad `alwaysStep` properties. If property kind cannot be handled precisely, fall back to full-model search for affected properties.
- Risk: System variables may be implicit dependencies of route mount or navigation. Prefer making those dependencies explicit in transition `reads`/`writes` or `enabledTransitionVars(...)` rather than reintroducing all `sys:*` vars.
- Risk: Adding volatile timing or memory data can break deterministic report tests. Keep volatile metrics opt-in or test them structurally.
- Risk: Too-low default CLI limits could turn real bugs into search-limit errors. Make limits configurable and report them clearly.
- Ambiguity: The best default for memory guard is product-sensitive. Implement state/frontier/edge limits first if heap sampling is controversial.
- Stop and report if a model's transition footprints are missing required system reads/writes; that must be corrected at extraction/IR validation level.
- Stop and report if fixing extraction narrowing requires changing public IR schema. Propose the smallest schema addition before implementing.
