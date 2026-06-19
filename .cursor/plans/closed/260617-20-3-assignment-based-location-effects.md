# Assignment-Based Location Effects

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-3.
Depends on: `260617-20-1-neutral-scopes-and-system-var-roles.md`.

## 1. Goal

Delete route/navigation effects from the trusted IR and checker. Navigation-like
adapter behavior should lower into ordinary assignments, conditionals, and
sequences over role-bearing state variables.

The intended end state of this plan is:

- `EffectIR.navigate` is removed from TypeScript and Rust;
- Rust route navigation behavior is deleted;
- generic mount reset behavior is moved out of `navigation.rs` into a neutral
  mount/local-scope module;
- source adapters lower push/replace/back into ordinary effects over location
  and history vars;
- labels may still use `{ kind: "navigate" }` for replay/reporting, but labels
  must not affect checker semantics.

## 2. Non-goals

- Do not replace `navigated`/`navigatedTo` step facts here. That belongs in
  plan 4.
- Do not delete mandatory `sys:route`/`sys:history` validation here unless it
  is a tiny local cleanup already enabled by this plan. Full role validation
  belongs in plan 5.
- Do not add framework-specific effects for Next or React Router.
- Do not implement a broad bounded-list algebra unless push/back cannot be
  expressed. If that happens, stop and report.
- Do not change event label shape unless necessary for type errors.

## 3. Current-State Findings

- `src/core/ir/types.ts` includes
  `{ kind: "navigate"; mode: "push" | "replace" | "back"; to?: ExprIR }`.
- `src/core/ir/validator.ts` treats navigate as writes to `sys:route` and
  `sys:history`, and type-checks `to` against `sys:route`.
- `src/cli/features/export/command.ts` has `navigateBranches()` that manipulates
  `sys:route` and `sys:history`.
- `crates/checker/src/model.rs` has `EffectIR::Navigate`.
- `crates/checker/src/domain.rs` derives navigate reads/writes from
  `sys:route` and `sys:history`.
- `crates/checker/src/effect.rs` delegates `EffectIR::Navigate` to
  `navigation::navigate`.
- `crates/checker/src/navigation.rs` mixes route navigation with reusable
  `reset_local_scopes` and initial local normalization.
- Extraction navigation code emits `navigate` in:
  - `src/extract/engine/ts/transition/navigation.ts`;
  - `src/extract/engine/ts/static-navigation.ts`;
  - `src/extract/engine/pipeline/redirects.ts`;
  - `src/extract/sources/next/routes.ts`;
  - `src/extract/sources/next/config.ts`;
  - related tests.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/core/ir/types.ts`
  - `EffectIR`
- `src/core/ir/validator.ts`
  - `effectReads`
  - `effectWrites`
  - `validateEffectShape`
  - `validateEffectTypes`
  - `effectExpressions`
- `crates/checker/src/model.rs`
  - `EffectIR`
  - tests constructing navigate effects
- `crates/checker/src/domain.rs`
  - `effect_reads`
  - `effect_writes`
- `crates/checker/src/effect.rs`
  - `EffectIR::Navigate` arm
  - reset-after-effect logic
- `crates/checker/src/navigation.rs`
  - route navigation deletion
  - generic local reset extraction
- `crates/checker/src/lib.rs`
  - embedded examples
- `src/extract/engine/ts/transition/navigation.ts`
  - `navigationEffect`
  - `applyLowerNavigation`
  - `appendEffect`
  - new `locationEffect`
- `src/extract/engine/ts/static-navigation.ts`
- `src/extract/engine/pipeline/redirects.ts`
- `src/extract/sources/next/routes.ts`
- `src/extract/sources/next/config.ts`
- `src/extract/sources/next/navigation.test.ts`
- `src/extract/engine/ts/react-source-navigation.test.ts`
- `src/cli/features/export/command.test.ts`

## 5. Existing Patterns to Follow

- Use ordinary IR primitives first: `assign`, `if`, `seq`, `cond`, and existing
  expression forms.
- Keep route/location var ids adapter-owned. The helper may default to
  `sys:route`/`sys:history` for existing adapters, but it must accept explicit
  var ids.
- Keep user-facing labels as labels only. A transition label
  `{ kind: "navigate" }` is acceptable if no trusted logic branches on it.
- Keep generic reset after top-level effect application in Rust. It is already
  close to the right abstraction in `effect.rs`, but the implementation should
  live in a neutral module and refer to mount guards, not navigation.

## 6. Atomic Implementation Steps

### Step 1 - Add adapter-level `locationEffect`

Files to edit:

- `src/extract/engine/ts/transition/navigation.ts`
- tests for extraction navigation helpers

Implementation:

1. Add a helper with this intent:

```ts
function locationEffect(args: {
  currentVar: string;
  historyVar?: string;
  mode: "push" | "replace" | "back";
  to?: ExprIR;
  historyCap?: number;
}): {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
}
```

2. For `push`:
   - assign history to an expression representing history plus current location
     if supported;
   - assign current location to `to`.
3. For `replace`:
   - assign current location to `to`;
   - history may be unchanged.
4. For `back`:
   - assign current location from the last history item and remove that item if
     current bounded-list expression support can express it.
5. If existing `ExprIR` cannot express append/last/pop over bounded lists,
   stop and report before deleting `navigate`. The fundamental next step is a
   neutral bounded-list expression/effect, not a route-specific effect.

Acceptance criteria:

- Navigation extraction tests can assert generated effects are `seq`/`assign`
  or a clearly documented stop condition is reported.

### Step 2 - Migrate extraction emitters away from `navigate`

Files to edit:

- `src/extract/engine/ts/transition/navigation.ts`
- `src/extract/engine/ts/static-navigation.ts`
- `src/extract/engine/pipeline/redirects.ts`
- `src/extract/sources/next/routes.ts`
- `src/extract/sources/next/config.ts`
- `src/extract/sources/next/navigation.test.ts`
- `src/extract/engine/ts/react-source-navigation.test.ts`

Implementation:

1. Replace `navigationEffect()` output with `locationEffect()` output.
2. Update `applyLowerNavigation()` so adapter overrides also return ordinary
   effects. If adapter SPI currently permits `navigate`, tighten the expected
   shape through tests and types.
3. Update `appendEffect()` so it derives reads through structured effect read
   walkers or explicit helper output, not `effect.kind === "navigate"`.
4. Preserve transition labels and classes for reports/replay.
5. Update Next route tree lowering to assign route/tree/slot vars through
   ordinary effects.

Acceptance criteria:

- `rtk rg -n "kind: \"navigate\"" src/extract test` shows only event labels,
  expected label assertions, or historical plan text. No effect object remains.

### Step 3 - Remove `EffectIR.navigate` from TypeScript core

Files to edit:

- `src/core/ir/types.ts`
- `src/core/ir/validator.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- tests constructing core effects

Implementation:

1. Delete the navigate variant from `EffectIR`.
2. Delete navigate handling from `effectReads`, `effectWrites`,
   `validateEffectShape`, `validateEffectTypes`, and `effectExpressions`.
3. Delete route-specific navigate target type checking.
4. Update statement summary effect footprint logic to walk ordinary effects.

Acceptance criteria:

- TypeScript compilation has no unreachable switch cases for navigate.
- Core validator tests no longer construct navigate effects.

### Step 4 - Remove `EffectIR::Navigate` from Rust checker

Files to edit:

- `crates/checker/src/model.rs`
- `crates/checker/src/domain.rs`
- `crates/checker/src/effect.rs`
- `crates/checker/src/lib.rs`
- Rust tests

Implementation:

1. Delete the Rust enum variant.
2. Delete navigate read/write derivation in `domain.rs`.
3. Delete the navigate application arm in `effect.rs`.
4. Update embedded JSON examples and tests to use ordinary assignments.

Acceptance criteria:

- `rtk rg -n "EffectIR::Navigate|Navigate \\{|navigate\\(" crates/checker/src`
  has no route navigation implementation hits.

### Step 5 - Extract neutral mount reset module

Files to edit:

- `crates/checker/src/navigation.rs`
- new `crates/checker/src/mount.rs` or `crates/checker/src/local_scope.rs`
- `crates/checker/src/effect.rs`
- `crates/checker/src/domain.rs`
- `crates/checker/src/lib.rs`

Implementation:

1. Move generic local-scope reset functions out of `navigation.rs`:
   - `normalize_initial_route_locals` becomes
     `normalize_initial_mount_locals`;
   - `reset_local_scopes` becomes `reset_mount_locals`.
2. Delete route navigation behavior from `navigation.rs`. If the file becomes
   empty, delete it and update `mod` declarations.
3. Ensure top-level effect application still performs mount reset after the
   whole effect, using the pre-state and post-state to detect guard changes.
4. Keep reset criteria based on `mount_guard` comparisons, not route ids.

Acceptance criteria:

- Assignment to an ordinary var that changes a mount guard resets affected
  mount-local state in Rust tests.
- No Rust checker module named `navigation` is required for semantics after
  this plan.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/ts/transition/navigation.ts`,
  navigation helper tests.
- Step 2: `src/extract/engine/ts/transition/navigation.ts`,
  `src/extract/engine/ts/static-navigation.ts`,
  `src/extract/engine/pipeline/redirects.ts`,
  `src/extract/sources/next/routes.ts`,
  `src/extract/sources/next/config.ts`, extraction navigation tests.
- Step 3: `src/core/ir/types.ts`, `src/core/ir/validator.ts`,
  `src/extract/engine/ts/transition/statement-summary.ts`, core tests.
- Step 4: `crates/checker/src/model.rs`, `crates/checker/src/domain.rs`,
  `crates/checker/src/effect.rs`, `crates/checker/src/lib.rs`, Rust tests.
- Step 5: `crates/checker/src/navigation.rs`,
  `crates/checker/src/mount.rs` or `crates/checker/src/local_scope.rs`,
  `crates/checker/src/effect.rs`, `crates/checker/src/domain.rs`.

## 8. Acceptance Criteria

- `EffectIR.navigate` is absent from TypeScript and Rust IR.
- Source adapters lower navigation-like behavior into ordinary effects.
- Rust route navigation behavior is deleted.
- Mount reset is implemented as generic mount-local reset.
- Existing replay/report labels can still say `navigate`, but no trusted
  semantic code branches on navigate labels.

## 9. Tests to Add or Update

- Update extraction navigation tests to expect ordinary effects.
- Add Rust tests for:
  - assignment-driven location change;
  - assignment-driven mount-local reset;
  - no dependency on `sys:route` for mount reset.
- Update TLA export tests enough to remove navigate fixtures if they fail to
  compile; full TLA parity is plan 6.
- Update core validator tests that used navigate effects.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/extract/engine/ts/react-source-navigation.test.ts
rtk pnpm vitest run src/extract/sources/next/navigation.test.ts
rtk pnpm vitest run test/kernel/kernel.test.ts
rtk cargo test -p modality-checker effect
rtk cargo test -p modality-checker mount
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if push/back cannot be expressed with current neutral
  bounded-list operations. Do not keep or recreate `navigate`.
- Stop and report if adapter override APIs still require returning navigate
  effects and changing them would collide with plan 21. The fix should be an
  adapter SPI adjustment, not trusted route semantics.
- Stop and report if mount reset behavior diverges from existing tests. Add a
  focused fixture showing the intended neutral behavior before proceeding.
- Do not use id prefixes such as `sys:route` to decide reset semantics.

## 12. Must Not Change

- Do not replace `navigated` step facts here.
- Do not rewrite all docs here; plan 7 owns docs cleanup.
- Do not change pending queue semantics.
