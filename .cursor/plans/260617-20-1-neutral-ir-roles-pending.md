# Neutral IR Roles, Mount Scopes, and Pending Queues

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-17.

This is plan 1 of 3 split from
`.cursor/plans/260617-20-framework-neutral-ir-checker.md`. It implements the
schema foundation for Plan Family B from
`.cursor/plans/260617-18-versatility-plan-of-plans.md`: remove route-specific
scope names and hard-coded pending queue ids from the trusted IR/checker layer.

## 1. Goal

Make the core IR and Rust checker use neutral schema constructs:

- `mount-local` as the only local state scope, with explicit guard expressions;
- `StateVarDecl.role` metadata for system variables;
- pending queues resolved by role or explicit queue id, not by `sys:pending`;
- no `route-local`, `sys:route`, `sys:history`, or `sys:pending` required by
  validation.

After this plan, framework adapters may still emit route-like variables and a
pending queue named `sys:pending`, but the core and checker must treat those as
ordinary ids plus role metadata.

## 2. Non-goals

- Do not remove `EffectIR.navigate`; that is plan 2.
- Do not replace `navigated`/`navigatedTo`; that is plan 2.
- Do not complete TLA export parity, slicing fixpoint work, or docs migration;
  those are plan 3.
- Do not add React, Next, router, or library-specific checker behavior.
- Do not preserve compatibility for old artifacts that use `route-local` or
  depend on mandatory `sys:*` variables.
- Do not introduce compatibility aliases for old schema names.

## 3. Current-state findings

Verified from the repository before splitting:

- `src/core/ir/types.ts`
  - `StateVarScope` includes `{ kind: "route-local"; route: string }`.
  - `StateVarDecl` has no role metadata.
  - `enqueue` and `dequeue` do not identify the pending queue.
- `src/core/ir/domains.ts`
  - `mountGuardForScope(route-local)` hard-codes `read sys:route`.
  - `isLocalScopedScope` treats `route-local` as a peer of `mount-local`.
- `src/core/ir/validator.ts`
  - `validateSystemVars` requires `sys:route`, `sys:history`, and
    `sys:pending` on unsliced models.
  - `validateSystemVarShapes` knows route/history/pending shapes by id.
  - route-local write-order validation is route-specific.
  - effect read/write helpers hard-code pending writes to `sys:pending`.
- `crates/checker/src/model.rs`
  - Rust `Scope` has `RouteLocal`.
  - `CompiledModel` caches `sys_route_index`, `sys_history_index`, and
    `sys_pending_index`.
  - `mount_guard_for_scope(RouteLocal)` hard-codes `sys:route`.
- `crates/checker/src/domain.rs`
  - validation requires `sys:route`, `sys:history`, and `sys:pending`.
  - effect read/write derivation hard-codes `sys:pending`.
- `crates/checker/src/effect.rs`
  - enqueue/dequeue semantics are generic in concept but hard-code
    `sys:pending`.
- Extraction currently emits `route-local` for route scoped state in:
  - `src/extract/engine/ts/routes.ts`;
  - `src/extract/engine/ts/components.ts`;
  - `src/extract/engine/ts/react-source-transitions.ts`.

## 4. Exact file paths and relevant symbols

Core TypeScript IR and validation:

- `src/core/ir/types.ts`
  - edit `StateVarScope`, `StateVarDecl`, `EffectIR`, `Bounds`,
    `Model.metadata`;
  - add `SystemVarRole`.
- `src/core/ir/domains.ts`
  - edit `isLocalScopedScope`, `mountGuardForScope`.
- `src/core/ir/validator.ts`
  - edit `effectReads`, `effectWrites`, `validateSystemVars`,
    `validatePresentSystemVars`, `validateSystemVarShapes`, `validateScope`,
    `validateTransition`, `validateEffectShape`, `validateEffectTypes`,
    `validateEffectValues`;
  - add a pending queue resolver.

Extraction lowering:

- `src/extract/engine/ts/routes.ts`
  - keep route guard construction, but return/use `mount-local` scopes.
- `src/extract/engine/ts/components.ts`
  - update inline/custom hook local scope construction.
- `src/extract/engine/ts/react-source-transitions.ts`
  - replace `scopeForRoute` output with `mount-local`.

Rust checker:

- `crates/checker/src/model.rs`
  - edit `Scope`, `StateVarDecl`, `EffectIR`, `CompiledModel`,
    `CompiledModel::compile`, `mount_guard_for_scope`,
    `transition_locals_mounted`.
- `crates/checker/src/domain.rs`
  - edit system validation and `effect_reads`/`effect_writes`.
- `crates/checker/src/effect.rs`
  - edit enqueue/dequeue queue lookup.
- `crates/checker/src/step.rs`
  - update pending queue access if it depends on `sys_pending_index`.
- `crates/checker/src/lib.rs`
  - update embedded JSON examples that still use old required vars or
    `route-local`.

Tests:

- `test/core/framework-neutral-ir.test.ts` or nearby core validator tests.
- `test/core/numeric-ir.test.ts`.
- Rust unit tests embedded in `crates/checker/src/model.rs`,
  `crates/checker/src/domain.rs`, and `crates/checker/src/effect.rs`.

## 5. Existing patterns to follow

- Keep `mount-local` as the local scope abstraction. It already carries an
  explicit `ExprIR` guard and is framework neutral.
- Keep `readPre` and `readOpArg` behavior unchanged. They already encode
  pre-state and pending-op argument snapshots.
- Keep `enqueue`/`dequeue` semantics, but make the queue variable configurable
  through `queue?: string` and role metadata.
- Use `origin: "system"` for neutral system vars, with `role` describing why a
  var matters to generic checker mechanics.
- Use structured metadata instead of id-prefix conventions. Ids like
  `sys:pending`, `sys:route`, and `sys:next:*` may remain adapter-owned names,
  but core validation and Rust checker code must not inspect those names for
  semantics.

## 6. Target neutral IR shape

Implement these schema changes:

```ts
export type StateVarScope =
  | { kind: "global" }
  | { kind: "mount-local"; id: string; when: ExprIR };

export interface SystemVarRole {
  kind:
    | "pending-queue"
    | "location-current"
    | "location-history"
    | "tree-slot"
    | "boundary-phase"
    | "cache-entry"
    | "environment";
  group?: string;
}

export interface StateVarDecl {
  id: string;
  domain: AbstractDomain;
  origin: SourceAnchor | "system" | "library-template";
  scope: StateVarScope;
  initial: Value | readonly Value[];
  role?: SystemVarRole;
}

export type EffectIR =
  | { kind: "assign"; var: string; expr: ExprIR }
  | { kind: "havoc"; var: string }
  | { kind: "choose"; var: string; among: readonly ExprIR[] }
  | { kind: "if"; cond: ExprIR; then: EffectIR; else: EffectIR }
  | { kind: "seq"; effects: readonly EffectIR[] }
  | {
      kind: "enqueue";
      queue?: string;
      op: string;
      continuation: string;
      args: Record<string, ExprIR>;
    }
  | { kind: "dequeue"; queue?: string; index: number }
  | { kind: "navigate"; mode: "push" | "replace" | "back"; to?: ExprIR }
  | { kind: "opaque"; ref: OpaqueRef };
```

Notes:

- Keep `navigate` temporarily so plan 1 stays focused. Plan 2 deletes it.
- `queue?: string` exists only to avoid repeating the primary queue in every
  old-style source adapter transition.
- Validation resolves missing `queue` to exactly one
  `role.kind === "pending-queue"` var. If zero or multiple pending queue vars
  exist, `queue` is required.
- If `StateVarDecl.role` is too invasive, `Model.metadata.systemVarRoles` is an
  acceptable fallback, but prefer the field because it keeps role data next to
  the declaration.

## 7. Atomic implementation steps

### Step 1 - Introduce neutral roles and remove `route-local`

Edit `src/core/ir/types.ts`, `src/core/ir/domains.ts`,
`crates/checker/src/model.rs`, and tests that construct scopes.

- Replace `StateVarScope` with only `global` and `mount-local`.
- Add `StateVarDecl.role?: SystemVarRole` in TypeScript and Rust.
- Delete `Scope::RouteLocal`.
- Delete `mountGuardForScope(route-local)` and Rust equivalent.
- Rename `route_local_var_indexes` in Rust `CompiledTransition` to
  `mount_local_var_indexes`.
- Rename `route_local_mounted` to `mount_locals_active`, or delete it if unused.
- Keep mount guard validation strict:
  - guard reads must reference known vars;
  - a mount-local var guard must not read its own var.

Stop and report if any extraction path cannot know the route guard when creating
a local state var. As a temporary implementation choice, use
`{ kind: "mount-local", id: "always", when: { kind: "lit", value: true } }` for
that path and report it; do not restore `route-local`.

### Step 2 - Lower route-local extraction into mount-local guards

Edit only the extraction files required to compile.

- In `src/extract/engine/ts/routes.ts`, keep `routeMountGuard(routePattern)`,
  but make callers use:

```ts
{
  kind: "mount-local",
  id: `route:${routePattern}`,
  when: routeMountGuard(routePattern),
}
```

- In `src/extract/engine/ts/components.ts`, make `inlineCustomHookState` use the
  route mount-local scope where it previously used `route-local`.
- In `src/extract/engine/ts/react-source-transitions.ts`, replace
  `scopeForRoute` returning `route-local` with a `mount-local` guard.
- Update extraction tests and fixtures only where they fail because the scope
  shape changed.

### Step 3 - Add role-based pending queue resolution

Edit `src/core/ir/types.ts`, `src/core/ir/validator.ts`,
`crates/checker/src/model.rs`, `crates/checker/src/domain.rs`,
`crates/checker/src/effect.rs`, `crates/checker/src/step.rs`,
`src/check/slicing/slice-model.ts`, and `src/cli/features/export/command.ts`
only as needed to compile after the schema change.

- Add `queue?: string` to `enqueue` and `dequeue`.
- Add a TypeScript helper in validation:
  - `pendingQueueVar(model, explicitQueue?: string): StateVarDecl | error`.
- Add equivalent Rust helper:
  - `CompiledModel::pending_queue_idx(explicit_queue: Option<&str>)`.
- Remove `CompiledModel.sys_pending_index`.
- Replace hard-coded `sys:pending` writes in `effectWrites` with the resolved
  queue id.
- Keep existing adapter var ids such as `sys:pending` only as emitted names.
  They must not be semantic fallbacks in core/checker code.

Stop and change helper signatures if effect read/write helpers need model
context to resolve queue ids. Do not keep hidden `sys:pending` fallback logic.

### Step 4 - Role-shape validation and required-var removal

Edit TypeScript and Rust validators plus model-building tests.

- Delete mandatory `sys:route` and `sys:history` validation.
- Delete mandatory `sys:pending` validation.
- Require only:
  - every transition reads/writes known vars;
  - every mount-local guard reads known vars and not its own var;
  - role-bearing vars satisfy their role shape.
- Validate pending queue role shape:
  - must be global;
  - must use `boundedList`;
  - item domain must be a record with `opId`, `continuation`, and `args`;
  - primary queue maxLen must match `bounds.maxPending`.
- Validate location/system role shapes without adding checker behavior:
  - `location-current`: enum/string-like finite domain for now;
  - `location-history`: bounded list whose inner domain is compatible with the
    paired `location-current` if `group` matches;
  - `tree-slot`, `boundary-phase`, `cache-entry`, `environment`: finite
    enumerable domain only.
- Update generated/extracted model builders to mark:
  - current route var as `{ kind: "location-current", group: "default" }`;
  - history var as `{ kind: "location-history", group: "default" }`;
  - pending queue as `{ kind: "pending-queue" }`;
  - Next slot/phase/cache vars as tree/boundary/cache roles where already
    emitted.

Stop and update reports/harnesses if any CLI report assumes `sys:route` exists
for display. Discover `role.kind === "location-current"` instead; if no role is
available, show the raw var id.

### Step 5 - Preserve pending-op argument semantics

Edit `crates/checker/src/effect.rs` and matching TypeScript tests only where
needed.

- Keep existing enqueue/dequeue behavior:
  - enqueue snapshots args at enqueue time;
  - `readOpArg` reads those snapshots during continuation effects;
  - dequeue removes from the resolved queue.
- Add or update tests using a queue id such as `system:asyncQueue` to prove the
  behavior does not depend on `sys:pending`.

## 8. Per-step files to edit

| Step | Files |
| --- | --- |
| 1 | `src/core/ir/types.ts`, `src/core/ir/domains.ts`, `crates/checker/src/model.rs`, scope-related tests |
| 2 | `src/extract/engine/ts/routes.ts`, `src/extract/engine/ts/components.ts`, `src/extract/engine/ts/react-source-transitions.ts`, extraction tests |
| 3 | `src/core/ir/types.ts`, `src/core/ir/validator.ts`, `crates/checker/src/model.rs`, `crates/checker/src/domain.rs`, `crates/checker/src/effect.rs`, `crates/checker/src/step.rs`, minimal compile fixes in slicing/export |
| 4 | `src/core/ir/validator.ts`, `crates/checker/src/domain.rs`, extraction model builders, CLI/report code that displays location vars |
| 5 | `crates/checker/src/effect.rs`, `test/core/framework-neutral-ir.test.ts`, Rust effect tests |

## 9. Acceptance criteria

1. `route-local` is gone from core TypeScript IR, Rust checker model types, and
   extraction output.
2. A hand-authored model with only a global `x: bool` state var validates and
   checks without `sys:route`, `sys:history`, or `sys:pending`.
3. A hand-authored model with `app:location`, `app:history`, and
   `system:asyncQueue` role-bearing vars validates and checks.
4. Enqueue/dequeue works with a pending queue var not named `sys:pending`.
5. `readOpArg` continues to read enqueue-time snapshots during continuation
   effects.
6. No TypeScript core file or Rust checker file depends on `sys:pending` as a
   magic id.
7. Existing route-like adapters compile by emitting `mount-local` scopes and
   role-bearing vars.

## 10. Tests to add or update

Core TypeScript:

- Add `test/core/framework-neutral-ir.test.ts` or colocated tests covering:
  - no required route/history/pending vars;
  - mount-local guard validation;
  - pending queue role validation;
  - explicit queue selection;
  - missing queue when multiple queue roles exist;
  - wrong pending item shape.
- Update `test/core/numeric-ir.test.ts` model fixtures to use role metadata
  instead of required `sys:*` names where possible.

Checker/Rust:

- Update embedded tests in:
  - `crates/checker/src/model.rs`;
  - `crates/checker/src/domain.rs`;
  - `crates/checker/src/effect.rs`.
- Add Rust tests for:
  - model without route/history;
  - non-`sys:pending` pending queue;
  - enqueue/dequeue with `readOpArg` snapshots.

Extraction:

- Update tests or fixtures that construct or assert `route-local`.
- Add one regression proving route-local state now lowers to `mount-local` with
  a route guard expression.

## 11. Verification commands

Run targeted checks while developing:

```bash
rtk pnpm vitest run test/core
rtk cargo test -p modality-checker
rtk pnpm typecheck
```

Run broader checks before handoff:

```bash
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
rtk git diff --check
```

`phase7` is not mandatory for this first split unless behavior beyond queue
resolution and validation changed; it becomes mandatory in plans 2 and 3.

## 12. Risks, ambiguities, and stop conditions

- **Some extraction paths may lack route guard context.** Use an always-mounted
  `mount-local` scope only as a reported temporary implementation choice; do not
  restore `route-local`.
- **Effect read/write helpers may lack model context.** Change signatures to
  accept the model or resolver; do not keep `sys:pending` fallback logic.
- **Multiple pending queues need explicit semantics.** Require explicit
  `queue` on enqueue/dequeue when more than one pending queue role exists.
- **Reports and harnesses may assume `sys:route`.** Discover
  `location-current` roles instead of preserving required names.
- **Do not split compatibility aliases into core.** Old models should fail
  validation clearly.
- **Keep plan 1 focused.** If deleting `navigate` or replacing navigation facts
  becomes necessary to make progress, stop and report so plan 2 can be pulled
  forward intentionally.
