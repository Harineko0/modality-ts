# Framework-Neutral IR and Checker Semantics - Split Index

Status: split index.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.

This original monolithic plan has been split into smaller Composer 2 handoff
plans. Do not implement from this index directly. Implement the split plans in
order unless a later plan explicitly says it can be done independently.

The family goal is to remove framework-specific assumptions from the trusted
core IR, TypeScript validation, Rust checker, slicing, step facts, and TLA
export. React, Next, router, route, history, and navigation vocabulary may remain
in source adapters and examples, but only as adapter-owned names that lower into
neutral IR.

## Split Plans

1. `.cursor/plans/260617-20-1-neutral-scopes-and-system-var-roles.md`
   - Introduce `StateVarDecl.role`.
   - Remove `route-local` from TypeScript and Rust IR.
   - Lower route-scoped local state to `mount-local` guards.

2. `.cursor/plans/260617-20-2-role-based-pending-queues.md`
   - Add explicit or role-resolved queues to `enqueue` and `dequeue`.
   - Remove checker reliance on the hard-coded `sys:pending` id.
   - Preserve `readOpArg` enqueue-time snapshot semantics.

3. `.cursor/plans/260617-20-3-assignment-based-location-effects.md`
   - Delete `EffectIR.navigate` from TypeScript and Rust.
   - Lower navigation into ordinary location/history assignments.
   - Move route-specific Rust navigation reset code into neutral mount reset.

4. `.cursor/plans/260617-20-4-generic-step-facts.md`
   - Replace `navigated` and `navigatedTo` with `changed` and `changedTo`.
   - Update property helpers, serializable artifacts, Rust step matching, and
     step-fact slicing dependencies.

5. `.cursor/plans/260617-20-5-role-based-system-validation-and-commit-ordinals.md`
   - Delete mandatory `sys:route` and `sys:history` validation.
   - Validate role-bearing vars by shape.
   - Document commit ordinal semantics for stabilization phases.

6. `.cursor/plans/260617-20-6-neutral-tla-and-slicing-parity.md`
   - Make TLA export and property slicing use the same neutral dependencies as
     the Rust checker.
   - Add parity fixtures for assignment-driven location, pending queues,
     mount-local reset, and commit ordinals.

7. `.cursor/plans/260617-20-7-adapter-migration-docs-and-cleanup.md`
   - Finish source adapter, CLI harness/report, example, and docs migration.
   - Remove obsolete compatibility paths and ensure no trusted layer branches on
     framework-owned ids.

## Family-Level Must Not Change

- Do not add React, Next, React Router, or library-specific checker behavior.
- Do not preserve `route-local`, `EffectIR.navigate`, `sys:route`,
  `sys:history`, `sys:pending`, `navigated`, or `navigatedTo` as trusted
  checker vocabulary.
- Do not introduce compatibility shims for old model artifacts.
- Do not move adapter semantics into `src/core`, `src/check`, or
  `crates/checker`.
- Do not edit generated artifacts or `dist/`.
- Do not silently keep TLA export or slicing on old route-specific semantics.

## Family-Level Acceptance Criteria

- A model with no `sys:*` variables validates and checks when it does not use
  pending effects.
- A model with `app:location`, `app:history`, and `app:asyncQueue` role-bearing
  vars validates, checks, exports to TLA, and supports changed-var step
  properties.
- No TypeScript core file or Rust checker file contains `route-local`,
  `EffectIR::Navigate`, route-specific navigate handling, `navigated`,
  `navigatedTo`, `sys_route_index`, or `sys_history_index`.
- Enqueue/dequeue works with a pending queue var not named `sys:pending`.
- `readOpArg` continues to read enqueue-time snapshots during continuation
  effects.
- Mount-local state resets when ordinary assignments change mount guards, not
  only after route navigation.
- Sliced checking includes mount guards, changed-var predicates, and pending
  queues through structured dependencies and drops unrelated system vars.
- `rtk pnpm typecheck`, `rtk pnpm test`, `rtk pnpm architecture`,
  `rtk pnpm phase7`, `rtk pnpm ci:examples`, `rtk pnpm fix`, and
  `rtk git diff --check` pass before final handoff.
