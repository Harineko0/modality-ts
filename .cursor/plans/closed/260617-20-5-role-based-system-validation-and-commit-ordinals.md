# Role-Based System Validation and Commit Ordinals

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-5.
Depends on:
`260617-20-1-neutral-scopes-and-system-var-roles.md`,
`260617-20-2-role-based-pending-queues.md`,
`260617-20-3-assignment-based-location-effects.md`.

## 1. Goal

Replace mandatory system var names with role-based validation, and document the
existing stabilization `phase` field as a framework-neutral commit ordinal.

The intended end state of this plan is:

- unsliced models no longer require `sys:route`, `sys:history`, or
  `sys:pending`;
- validators inspect `StateVarDecl.role` for system semantics;
- location-current/history, tree-slot, boundary-phase, cache-entry,
  environment, and pending-queue roles have shape validation;
- CLI reports/harness code that needs a location var discovers it by role;
- stabilization docs/tests refer to commit ordinals rather than framework hook
  phases.

## 2. Non-goals

- Do not add new checker behavior for location, tree, cache, boundary, or
  environment roles. These roles are metadata and validation hooks only.
- Do not reintroduce route/history coupling by id.
- Do not rename serialized `phase` if doing so causes broad fixture churn.
- Do not change stabilization ordering behavior.
- Do not complete every docs migration in this plan. Plan 7 owns final docs
  cleanup.

## 3. Current-State Findings

- `src/core/ir/validator.ts` currently requires `sys:route`, `sys:history`, and
  `sys:pending` for unsliced models.
- `validateSystemVarShapes()` knows route enum/history bounded list and pending
  bounded list shapes by id.
- `crates/checker/src/domain.rs` has equivalent required-name validation.
- CLI tests and reports commonly assume `sys:route`, `sys:history`, and
  `sys:pending`.
- `src/core/ir/types.ts` already comments `Transition.phase` as a commit tier
  ordinal, but specs/tests still use phase terminology in places.
- `crates/checker/src/stabilize.rs` behavior is already generic ordered
  stabilization, but test names/comments use phase-tier language.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/core/ir/validator.ts`
  - `validateSystemVars`
  - `validatePresentSystemVars`
  - `validateSystemVarShapes`
  - `validateSystemDecl`
  - `validatePendingOpDomain`
  - role validation helpers
- `crates/checker/src/domain.rs`
  - required system var validation
  - system var shape validation
  - pending queue validation if not completed in plan 2
- `src/core/ir/types.ts`
  - `Transition.phase` comment
  - `SystemVarRole` comments if useful
- `crates/checker/src/stabilize.rs`
  - test names/comments
- CLI/report/harness files that display or discover location vars:
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/ci/command.test.ts`
  - `src/cli/features/extract/command.ts`
  - `src/cli/codegen/replay-test.ts`
  - `src/cli/features/replay/command.ts`
- extraction model builders that create route/history vars:
  - `src/extract/sources/next/routes.ts`
  - `src/extract/engine/ts/routes.ts`
  - `src/extract/engine/ts/transition/router-submit.ts`
  - `src/extract/sources/next/cache.ts`

## 5. Existing Patterns to Follow

- Use structured role metadata instead of id prefixes. Ids such as `sys:route`
  and `sys:next:*` may remain adapter-owned names, but trusted code should not
  branch on those strings.
- Keep role validation finite and conservative:
  - `location-current`: enum/string-like finite domain for now;
  - `location-history`: bounded list with inner domain compatible with the
    grouped location-current var when a matching group exists;
  - `tree-slot`, `boundary-phase`, `cache-entry`, `environment`: finite
    enumerable domains with no checker behavior;
  - `pending-queue`: as defined in plan 2.
- Keep serialized `phase?: number` if renaming would distract from semantics.
  The important change is conceptual naming in docs/tests.

## 6. Atomic Implementation Steps

### Step 1 - Replace required-name validation in TypeScript

Files to edit:

- `src/core/ir/validator.ts`
- `test/kernel/kernel.test.ts`
- `test/core/numeric-ir.test.ts`

Implementation:

1. Delete mandatory `validateSystemDecl(errors, "sys:route", ...)`,
   `"sys:history"`, and `"sys:pending"` calls.
2. Replace `validateSystemVars()` and `validatePresentSystemVars()` with role
   validation over `model.vars`.
3. Keep sliced validation behavior aligned with unsliced behavior. Sliced models
   should validate any role-bearing vars they contain but should not require
   missing roles.
4. Preserve general validation that every transition reads/writes known vars.

Acceptance criteria:

- A model with only `x: bool` and no `sys:*` vars validates if it has no pending
  effects.
- A model with `sys:*` names but no roles receives no special treatment beyond
  ordinary var validation.

### Step 2 - Add TypeScript role shape validation

Files to edit:

- `src/core/ir/validator.ts`

Implementation:

1. Validate `pending-queue` exactly as plan 2 specifies.
2. Validate `location-current`:
   - must be global;
   - must have system or library-template origin;
   - domain must be finite and currently should be `enum` unless local domain
     helpers already define a better string-like finite category.
3. Validate `location-history`:
   - must be global;
   - must be `boundedList`;
   - if a same-group `location-current` exists, inner domain must be compatible
     with the current location domain.
4. Validate `tree-slot`, `boundary-phase`, `cache-entry`, and `environment`:
   - must be enumerable by existing `enumerateDomain`;
   - no checker behavior is implied.
5. Validate role group conflicts:
   - multiple location-current vars in the same group should either be rejected
     or produce a precise error unless a later adapter plan requires multiple
     active locations per group.

Acceptance criteria:

- Tests cover `app:route`/`app:history` roles with no `sys:*` names.
- Tests prove `sys:next:*` ids without role metadata are not interpreted by
  validation.

### Step 3 - Mirror role validation in Rust

Files to edit:

- `crates/checker/src/model.rs`
- `crates/checker/src/domain.rs`
- Rust tests in `domain.rs`, `model.rs`, and fixtures in other modules

Implementation:

1. Add role enum/struct to Rust if plan 1 only added a permissive JSON value.
2. Delete required `sys:route`, `sys:history`, and `sys:pending` checks.
3. Implement role validation with the same constraints as TypeScript.
4. Ensure errors are specific and stable enough for tests.
5. Update Rust test fixtures to stop adding route/history/pending unless a test
   actually needs those vars.

Acceptance criteria:

- Rust checker compiles and validates a model with only `x: bool`.
- Rust checker validates a model with `app:location` and `app:history` roles.

### Step 4 - Update extraction model builders to stamp roles

Files to edit:

- `src/extract/sources/next/routes.ts`
- `src/extract/engine/ts/routes.ts`
- `src/extract/engine/ts/transition/router-submit.ts`
- `src/extract/sources/next/cache.ts`
- related extraction tests

Implementation:

1. Mark current route/location var as
   `{ kind: "location-current", group: "default" }`.
2. Mark history var as
   `{ kind: "location-history", group: "default" }`.
3. Mark pending queue var as `{ kind: "pending-queue" }` if not already done in
   plan 2.
4. Mark Next route tree/cache/environment vars:
   - slot vars: `tree-slot`;
   - phase vars: `boundary-phase`;
   - cache vars: `cache-entry`;
   - environment vars: `environment`.
5. Do not add trusted code that branches on `sys:next:*`.

Acceptance criteria:

- Extracted models have role metadata for system vars that need semantic
  validation or reporting.

### Step 5 - Discover location vars by role in CLI/report/harness code

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/codegen/replay-test.ts`
- `src/cli/features/replay/command.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/ci/command.test.ts`

Implementation:

1. Replace report/harness assumptions that look for `sys:route` with a helper
   that finds `role.kind === "location-current"`, preferring group
   `"default"` when multiple exist.
2. Replace history lookup with `role.kind === "location-history"` and matching
   group.
3. If no role metadata exists, display raw var ids already present in the model
   rather than falling back to `sys:route`.
4. Keep adapter-owned output names unchanged unless a test specifically benefits
   from neutral names.

Acceptance criteria:

- CLI tests can use `app:location`/`app:history` role names.
- Reports do not require `sys:route` to exist.

### Step 6 - Clarify commit ordinal semantics

Files to edit:

- `src/core/ir/types.ts`
- `crates/checker/src/stabilize.rs`
- `docs/_specs/01-ir.md`
- `docs/_specs/03-checker.md`

Implementation:

1. Keep `phase?: number` unless renaming to `commitOrdinal?: number` is small.
2. Define the field as: "ordering tier for internal stabilization transitions;
   lower ordinals run before higher ordinals when write conflicts exist."
3. Rename Rust test names/comments from phase-tier language to commit ordinal
   language where practical.
4. Ensure React-specific hook names remain in extraction code only; emitted IR
   carries only the ordinal.

Acceptance criteria:

- Stabilization behavior is unchanged.
- Docs/tests no longer present commit ordering as React-specific phase
  semantics.

## 7. Per-Step Files to Edit

- Step 1: `src/core/ir/validator.ts`, `test/kernel/kernel.test.ts`,
  `test/core/numeric-ir.test.ts`.
- Step 2: `src/core/ir/validator.ts`.
- Step 3: `crates/checker/src/model.rs`, `crates/checker/src/domain.rs`, Rust
  tests.
- Step 4: `src/extract/sources/next/routes.ts`,
  `src/extract/engine/ts/routes.ts`,
  `src/extract/engine/ts/transition/router-submit.ts`,
  `src/extract/sources/next/cache.ts`.
- Step 5: `src/cli/features/extract/command.ts`,
  `src/cli/codegen/replay-test.ts`,
  `src/cli/features/replay/command.ts`, CLI report tests.
- Step 6: `src/core/ir/types.ts`, `crates/checker/src/stabilize.rs`,
  `docs/_specs/01-ir.md`, `docs/_specs/03-checker.md`.

## 8. Acceptance Criteria

- Models no longer require `sys:route`, `sys:history`, or `sys:pending` by
  name.
- Role-bearing vars are shape-validated consistently in TypeScript and Rust.
- CLI/report/harness code discovers location and history vars by role.
- Next tree/cache/environment ids have no trusted id-prefix semantics.
- Commit ordinal semantics are documented without framework vocabulary.

## 9. Tests to Add or Update

- Add validator tests for:
  - model with only `x: bool`;
  - `app:location`/`app:history` role pair;
  - invalid location-current domain;
  - invalid location-history inner domain;
  - `sys:next:*` names without roles are ordinary vars.
- Add Rust domain validation equivalents.
- Update CLI check/CI tests to avoid assuming `sys:*` names where not needed.
- Rename/update stabilization tests to commit ordinal terminology.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run test/kernel/kernel.test.ts test/core/numeric-ir.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/ci/command.test.ts
rtk cargo test -p modality-checker domain
rtk cargo test -p modality-checker stabilize
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if multiple same-group location-current vars are required by
  existing adapters. Do not guess a primary var without an explicit role/group
  rule.
- Stop and report if reports need a location var but no role-bearing var exists.
  Update reports to degrade gracefully instead of requiring `sys:route`.
- Stop and report if renaming `phase` causes broad snapshot churn. Keep the
  serialized name and update comments/docs.
- Do not add id-prefix validation for `sys:next:*`.

## 12. Must Not Change

- Do not change stabilization execution order.
- Do not add checker behavior for tree/cache/environment roles.
- Do not preserve old required-name validation.
