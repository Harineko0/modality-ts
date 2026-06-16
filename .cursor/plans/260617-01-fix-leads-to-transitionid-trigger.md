# Fix `leadsToWithin` `transitionId` Trigger Vacuity

## Goal

Fix `docs/_issues/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md` so a reachable `leadsToWithin` trigger written as `stepTransitionId("<id>")` is observed as fired by the checker, including for route-local customer-click style transitions. A zero-step response property whose goal is already true in the trigger successor should verify within bounds, not report `vacuous-warning`.

## Non-goals

- Do not redesign the property DSL or change the public shape of `stepTransitionId`, `leadsToWithin`, `enabledTransitions`, traces, or verdict statuses.
- Do not add a broad fallback that treats every reachable transition with a matching id as a trigger without also preserving the existing full step predicate semantics.
- Do not change `alwaysStep`, `reachable`, `reachableFrom`, scheduler budgets, replay generation, or extraction behavior except where a focused regression proves they are involved.
- Do not edit generated `dist/`, `native/`, or `docs/build/` artifacts.
- Do not rely on the external Coffee DX repo for the regression; reproduce the bug with an in-repo minimal model.

## Current-State Findings

- The issue is documented in `docs/_issues/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md`. The reported property uses `leadsToWithin(model, stepTransitionId("CustomerHome.onClick.isPrinterSettingsOpen"), goal, { budget: { steps: 0, environment: 0 }, enabledTransitions: ["CustomerHome.onClick.isPrinterSettingsOpen"] })`.
- The TypeScript DSL emits a flat trigger object from `stepTransitionId` in `src/core/props/index.ts:82`; `leadsToWithin` stores it under `property.trigger` in `src/core/props/index.ts:135`.
- Properties are passed through unchanged by `src/check/serialize-properties.ts`, so the checker sees the same `trigger` object.
- The Rust checker records `leadsToWithin` triggers via compact edge recording:
  - `crates/checker/src/graph.rs:41` `GraphRecording::record_with_ids`
  - `crates/checker/src/graph.rs:55` computes `triggered_properties`
  - `crates/checker/src/graph.rs:59` calls `step::matches_step_predicate(step, pre, post, trigger)`
- `finalize_leads_to` only sees triggers that were recorded in `triggered_properties`:
  - `crates/checker/src/property.rs:237` `finalize_leads_to`
  - `crates/checker/src/property.rs:249` resolves trigger edges
  - `crates/checker/src/property.rs:250` reports `Trigger never fired within bounds` when none were recorded
  - `crates/checker/src/property.rs:287` `resolve_trigger_edges`
- Main BFS constructs the `StepFacts` used by compact recording at `crates/checker/src/search.rs:368` after generating `GeneratedEdge` values.
- `matches_step_predicate` in `crates/checker/src/step.rs:156` already checks `pred.transition_id` against `step.transition.id`, so a simple global-state `stepTransitionId` trigger is expected to work.
- Existing coverage proves the simple case, not the Coffee DX route-local immediate-success case:
  - `test/checker/checker.test.ts:635` verifies a `stepTransitionId("fire")` `leadsToWithin` trigger is not sliced away when the goal is false and the verdict is violated.
  - `test/checker/checker.test.ts:1150` verifies compact edge recording is selected for `leadsToWithin`.
- Because the simple case should already work, start with a focused regression matching the issue shape. If that regression passes before implementation, stop and report that this issue is stale or requires a more faithful Coffee DX fixture.

## Exact File Paths and Relevant Symbols

- `docs/_issues/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md`
  - Source issue and expected behavior.
- `src/core/props/index.ts`
  - `stepTransitionId`
  - `leadsToWithin`
  - `propertyEnabledTransitions`
- `src/check/serialize-properties.ts`
  - `serializeProperties`
- `crates/checker/src/graph.rs`
  - `GraphRecording`
  - `GraphRecording::record_with_ids`
  - `CompactEdge.triggered_properties`
  - `resolve_edge_mode`
- `crates/checker/src/search.rs`
  - `GeneratedEdge`
  - `explore_depth_parallel`
  - `expand_chunk`
  - `facts(compiled, pre, &edge.post_state, transition)`
- `crates/checker/src/step.rs`
  - `StepFacts`
  - `facts`
  - `matches_step_predicate`
- `crates/checker/src/property.rs`
  - `finalize_leads_to`
  - `resolve_trigger_edges`
  - `materialize_edge`
  - `failing_suffix_within`
- `test/checker/checker.test.ts`
  - Add the primary TypeScript regression near the existing `leadsToWithin` tests around line 615-710.
- Optional Rust unit-test files if the red test narrows the bug below the JS boundary:
  - `crates/checker/src/graph.rs` test module if trigger recording is wrong.
  - `crates/checker/src/step.rs` test module if predicate matching is wrong.
  - `crates/checker/src/search.rs` test module if edge/facts construction is wrong.

## Existing Patterns to Follow

- Use focused in-repo hand-built `Model` fixtures in `test/checker/checker.test.ts`; reuse the local helpers `lit`, `read`, `readVar`, `eq`, `reachable`, `leadsToWithin`, and `stepTransitionId`.
- Keep regression assertions on observable checker behavior: verdict status, trace transition ids, and absence of `vacuous-warning`.
- For Rust-side fixes, keep the compact recording shape: compact edges should remain small and property-specific, not full edge storage.
- Preserve deterministic ordering patterns: sorted transitions and sorted edge output are relied on by trace and stats assertions.
- Follow the checker’s current architecture: TypeScript builds/serializes the property, Rust performs model checking, compact graph recording supplies `leadsToWithin` trigger edges to finalization.

## Atomic Implementation Steps

1. Add a red regression test for the reported shape.
   - In `test/checker/checker.test.ts`, add a model named something like `route-local-transitionid-leads-to`.
   - Include `sys:route`, `sys:history`, `sys:pending`, and a route-local boolean `local:CustomerHome.isPrinterSettingsOpen` scoped to `/customer`.
   - Initial route should be `/customer`; local boolean should start `false`.
   - Add a user click transition with id `CustomerHome.onClick.isPrinterSettingsOpen`, guard `not(local...)`, and effect assigning the local boolean to `true`.
   - Check both:
     - `reachable(m, eq(readVar("local:CustomerHome.isPrinterSettingsOpen"), lit(true)), { name: "printerSettingsOpenReachable" })`
     - `leadsToWithin(m, stepTransitionId("CustomerHome.onClick.isPrinterSettingsOpen"), eq(readVar("local:CustomerHome.isPrinterSettingsOpen"), lit(true)), { name: "printerSettingsOpenClickImmediatelyOpensDialog", budget: { steps: 0, environment: 0 }, enabledTransitions: ["CustomerHome.onClick.isPrinterSettingsOpen"] })`
   - Assert reachable is `reachable`.
   - Assert the `leadsToWithin` verdict is `verified-within-bounds`, not `vacuous-warning`.
   - Assert the reachable trace includes exactly `CustomerHome.onClick.isPrinterSettingsOpen`.
   - Run this test before changing implementation.

2. If the new test already passes, stop and report.
   - Do not make speculative implementation changes.
   - Update the plan or issue with the observed passing command and ask for a more faithful Coffee DX model artifact, because current HEAD no longer reproduces the documented behavior.

3. If the new test fails with `vacuous-warning`, localize where the trigger is lost.
   - Prefer a small Rust unit test or temporary local debugging around `GraphRecording::record_with_ids` and `step::matches_step_predicate`.
   - Confirm whether the generated `StepFacts.transition.id` equals `CustomerHome.onClick.isPrinterSettingsOpen`.
   - Confirm whether `matches_step_predicate` returns false, whether `record_with_ids` records an empty `triggered_properties`, or whether `materialize_edge` drops the compact edge because the post state is missing from `TraceContext`.

4. Fix the concrete loss point with minimal scope.
   - If `matches_step_predicate` returns false despite matching transition id, adjust `crates/checker/src/step.rs` so `transition_id` matching is independent of route-local post-state details and still composes with all other predicate fields.
   - If `record_with_ids` loses the trigger because it only has a stabilized post state, preserve the existing behavior for all step predicates but ensure bare `transition_id` triggers match on the transition itself.
   - If `materialize_edge` drops trigger edges whose post state was observed as an edge but not inserted as a visited state, fix compact recording/finalization so all recorded trigger edges can materialize from stored edge states or ensure trigger post states are retained. Keep this targeted to compact `leadsToWithin` edge recording.
   - If the bug comes from route-local mount gating, make the trigger-edge decision based on the explored transition and state pair, not on the goal’s route-local read mounting rules. Keep goal evaluation in `finalize_leads_to` unchanged.

5. Add the narrow Rust test that matches the chosen fix.
   - For a predicate-match fix, add tests in `crates/checker/src/step.rs`.
   - For compact recording/finalization, add tests in `crates/checker/src/graph.rs` or `crates/checker/src/property.rs` if visibility allows without making private implementation unnecessarily public.
   - Avoid brittle timing/performance assertions.

6. Re-run the targeted TypeScript regression and relevant existing checker tests.
   - Ensure existing `leadsToWithin` tests still pass, especially `test/checker/checker.test.ts:635` and `test/checker/checker.test.ts:1150`.

7. Update or close the issue doc after the fix.
   - If this repo uses issue docs as active notes, append a short resolution section to `docs/_issues/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md` with the root cause, fix summary, and verification command.
   - If issue docs are meant to move when resolved, move it under `docs/_issues/closed/` only if that is the established current practice in the repo.

## Per-Step Files to Edit

- Step 1:
  - `test/checker/checker.test.ts`
- Step 2:
  - No implementation edits.
  - Optionally `docs/_issues/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md` if recording stale status is desired.
- Step 3:
  - No committed edits unless adding a focused diagnostic test.
- Step 4:
  - One or more of:
    - `crates/checker/src/step.rs`
    - `crates/checker/src/graph.rs`
    - `crates/checker/src/property.rs`
    - `crates/checker/src/search.rs`
  - Choose the smallest set after the red test identifies the loss point.
- Step 5:
  - One of:
    - `crates/checker/src/step.rs`
    - `crates/checker/src/graph.rs`
    - `crates/checker/src/property.rs`
    - `crates/checker/src/search.rs`
- Step 7:
  - `docs/_issues/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md`
  - Or `docs/_issues/closed/leads-to-transitionid-trigger-vacuous-for-reachable-customer-click.md`

## Acceptance Criteria

- A route-local user-click transition whose id is used by `stepTransitionId(...)` is treated as a fired `leadsToWithin` trigger when the transition is reachable.
- With `budget: { steps: 0, environment: 0 }`, if the goal is true in the trigger successor, the property returns `verified-within-bounds`.
- The same fixture’s `reachable(...)` property still reports `reachable` with trace `["CustomerHome.onClick.isPrinterSettingsOpen"]`.
- The checker does not report `Trigger never fired within bounds` for the regression fixture.
- Existing `leadsToWithin` behaviors remain intact:
  - false immediate goal still yields a violation with the trigger edge in the trace.
  - scheduler suffix search and `allowUserEvents` semantics do not change.
  - compact edge recording remains compact and deterministic.
- No generated artifacts are committed.

## Tests to Add or Update

- Add a new Vitest case in `test/checker/checker.test.ts` near the existing bounded-response tests:
  - Suggested test name: `treats route-local transitionId leadsToWithin triggers as fired`.
  - Assert both the reachable witness and the non-vacuous `leadsToWithin` verdict.
- Add a Rust unit test only after localizing the failure:
  - `step.rs`: direct test for `matches_step_predicate` if the predicate matcher is wrong.
  - `graph.rs`: direct test for `record_with_ids` populating `triggered_properties` if compact recording is wrong.
  - `property.rs`/`search.rs`: direct test only if trigger materialization or post-state retention is the bug.

## Verification Commands

Run commands with `rtk` from `/Users/hari/proj/modality-ts`.

1. Targeted regression:
   ```bash
   rtk pnpm build:rust
   rtk pnpm vitest run test/checker/checker.test.ts -t "route-local transitionId"
   ```

2. Checker suite:
   ```bash
   rtk pnpm vitest run test/checker/checker.test.ts
   ```

3. Rust checker tests:
   ```bash
   rtk cargo test --manifest-path crates/checker/Cargo.toml
   ```

4. Full validation for this change:
   ```bash
   rtk pnpm typecheck
   rtk pnpm test
   rtk pnpm fix
   ```

Use `rtk pnpm test` as the final confidence command because it rebuilds the native checker before running Vitest.

## Risks, Ambiguities, and Stop Conditions

- Stop if the new route-local regression passes before implementation. That means current HEAD may already differ from the Coffee DX failure, and guessing at a fix would be risky.
- Stop if the issue requires Coffee DX-specific extracted model details that the minimal in-repo fixture cannot reproduce. Request the generated `.modality/probe-customer.model.json` or an anonymized minimized model.
- Stop if the failing trigger edge is reachable but its post state is not available in `TraceContext`; that implies a storage/trace design choice, and the implementation agent should report the exact edge/state lifecycle before changing graph storage.
- Stop if a proposed fix changes `matches_step_predicate` semantics for composite predicates, `enqueued`, `resolved`, navigation, or op args. Those are separate behaviors and must remain covered.
- Be careful with `budget.steps.or(budget.environment)` in `failing_suffix_within`; do not change budget precedence unless a separate test demonstrates it is part of this bug.
- Be careful with route-local mount checks. Goal evaluation should still respect local reads and mounted state; only trigger detection should avoid becoming vacuous for an actually explored transition id.
- Do not use elapsed time or edge-count performance assertions for this bug.
