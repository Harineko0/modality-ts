# Neutral Scopes and System Var Roles

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-1.

## 1. Goal

Make local state scope and system-variable meaning framework-neutral at the IR
schema boundary.

The intended end state of this plan is:

- `StateVarScope` has only `global` and `mount-local`;
- route-scoped local state is represented as `mount-local` with an explicit
  guard expression;
- `StateVarDecl.role?: SystemVarRole` exists in TypeScript and Rust so later
  plans can discover pending, location, tree, cache, boundary, and environment
  vars without id-prefix conventions;
- core scope validation and Rust compilation no longer synthesize mount guards
  from `sys:route`;
- extraction helpers that currently emit `route-local` are migrated to emit
  `mount-local` guards.

## 2. Non-goals

- Do not remove `EffectIR.navigate` in this plan. That belongs in
  `260617-20-3-assignment-based-location-effects.md`.
- Do not remove mandatory `sys:route`/`sys:history` validation here. That
  belongs in plan 5 after adapters and location effects have neutral roles.
- Do not change pending queue semantics beyond adding the shared role type.
- Do not change property step facts.
- Do not redesign `AbstractDomain`.
- Do not preserve `route-local` as a compatibility alias.

## 3. Current-State Findings

- `src/core/ir/types.ts` defines `StateVarScope` as `global`,
  `route-local`, and `mount-local`.
- `src/core/ir/domains.ts` has `mountGuardForScope(route-local)` hard-coded to
  read `sys:route`.
- `src/core/ir/validator.ts` already validates `mount-local.when`, but also has
  route-local write-order validation tied to navigation.
- `crates/checker/src/model.rs` defines `Scope::RouteLocal`, derives mount
  guards from `sys:route`, and names compiled local collections
  `route_local_var_indexes`.
- `crates/checker/src/navigation.rs` contains generic local-scope reset behavior
  mixed with route navigation behavior.
- Extraction files that currently create or reason about route-local scopes
  include `src/extract/engine/ts/routes.ts`,
  `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/transition/router-submit.ts`,
  `src/extract/sources/next/routes.ts`, and tests under `test/sources` and
  `src/cli/features/extract/command.test.ts`.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/core/ir/types.ts`
  - `StateVarScope`
  - `StateVarDecl`
  - new `SystemVarRole`
  - `Model.metadata` only if field-level roles prove impossible
- `src/core/ir/domains.ts`
  - `isLocalScopedScope`
  - `mountGuardForScope`
- `src/core/ir/validator.ts`
  - `validateScope`
  - `validateRouteLocalWrites`
  - `validateRouteLocalWriteOrder`
- `crates/checker/src/model.rs`
  - `Scope`
  - `StateVarDecl`
  - `CompiledVar`
  - `CompiledTransition`
  - `CompiledModel::compile`
  - `mount_guard_for_scope`
  - `transition_locals_mounted`
  - `route_local_mounted`
- `src/extract/engine/ts/routes.ts`
  - `routeMountGuard`
  - `routeMountReads`
- `src/extract/engine/ts/components.ts`
  - `inlineCustomHookState`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `scopeForRoute`
- `src/extract/engine/ts/transition/router-submit.ts`
  - route action data local scope creation
- `src/extract/sources/next/routes.ts`
  - route mount scope helpers

Tests to update:

- `test/kernel/mounted-scope.test.ts`
- `test/kernel/kernel.test.ts`
- `test/sources/use-state/use-state-source.test.ts`
- `src/cli/features/extract/command.test.ts`
- Rust unit tests in `crates/checker/src/model.rs` and
  `crates/checker/src/navigation.rs`

## 5. Existing Patterns to Follow

- Keep `mount-local` as the single local-scope abstraction. It already carries a
  concrete `ExprIR` guard and is suitable for routes, layout slots, templates,
  tabs, dialogs, or any future mounted subtree.
- Keep route guard construction in extraction helpers. Adapter-owned helpers may
  still read `sys:route` or another location var by id, but core/checker code
  must only see the resulting expression.
- Keep role metadata near the state var declaration if possible:

```ts
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
```

- If field-level `role?: SystemVarRole` creates too much churn in Rust
  serialization, stop and report. The fallback is
  `Model.metadata.systemVarRoles`, but prefer the field because it keeps schema
  intent local to declarations.

## 6. Atomic Implementation Steps

### Step 1 - Add `SystemVarRole`

Files to edit:

- `src/core/ir/types.ts`
- `crates/checker/src/model.rs`

Implementation:

1. Add `SystemVarRole` to TypeScript with the role kinds listed above.
2. Add `role?: SystemVarRole` to `StateVarDecl`.
3. Add equivalent Rust structs/enums with serde camelCase/kebab-case behavior
   matching the TypeScript JSON shape.
4. Do not validate role shapes yet except for JSON shape/unknown role kind
   through serde/TypeScript typing. Plan 5 owns semantic role validation.

Acceptance criteria:

- Existing models without `role` still deserialize in Rust and typecheck in
  TypeScript during this plan.
- A hand-authored TypeScript fixture can include
  `{ role: { kind: "location-current", group: "default" } }`.

### Step 2 - Remove `route-local` from IR types

Files to edit:

- `src/core/ir/types.ts`
- `src/core/ir/domains.ts`
- `crates/checker/src/model.rs`

Implementation:

1. Delete `{ kind: "route-local"; route: string }` from `StateVarScope`.
2. Delete `Scope::RouteLocal`.
3. Update `isLocalScopedScope()` so only `mount-local` is local-scoped.
4. Update `mountGuardForScope()` and Rust `mount_guard_for_scope()` so:
   - `global` returns `undefined`/`None`;
   - `mount-local` returns/clones `when`;
   - no route-specific guard is synthesized.
5. Rename Rust `route_local_var_indexes` to `mount_local_var_indexes`.
6. Rename `route_local_mounted` to `mount_locals_active`, or delete it if all
   callers can use `transition_locals_mounted`.

Acceptance criteria:

- `rtk rg -n "route-local|RouteLocal|route_local" src/core crates/checker/src`
  returns no trusted-layer hits except historical comments in plans.
- Rust compile errors from removed enum variants are fixed within this scope.

### Step 3 - Remove route-local write-order validation

Files to edit:

- `src/core/ir/validator.ts`

Implementation:

1. Delete `validateRouteLocalWrites()` and `validateRouteLocalWriteOrder()`.
2. Remove the call from `validateTransition()`.
3. Do not add a new generic write-order rule in this plan. Generic mount reset
   after transition application belongs in plan 3 and plan 6.
4. Keep existing validation for `mount-local.when`:
   - expression shape;
   - references known vars;
   - boolean type;
   - must not read the scoped var itself.

Acceptance criteria:

- Validator tests no longer assert route-local multi-route or
  navigate-then-write errors.
- New or renamed tests assert mount-local guard validation only.

### Step 4 - Lower route-local extraction output to mount-local

Files to edit:

- `src/extract/engine/ts/routes.ts`
- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/transition/router-submit.ts`
- `src/extract/sources/next/routes.ts`
- focused extraction tests that assert scope shape

Implementation:

1. Keep `routeMountGuard(routePattern)` as an extraction helper that returns an
   `ExprIR`.
2. Add or reuse a helper that produces:

```ts
{
  kind: "mount-local",
  id: `route:${routePattern ?? "<unknown>"}`,
  when: routeMountGuard(routePattern),
}
```

3. Replace `scopeForRoute()` and inline route-local object construction with
   that helper.
4. For route action data or other route-scoped adapter variables, use the same
   mount-local scope form.
5. If an extraction path cannot know the route guard, use a mount-local guard
   with `{ kind: "lit", value: true }` and add a focused TODO/caveat at the
   extraction site. Do not reintroduce `route-local`.

Acceptance criteria:

- Tests that used to expect `{ kind: "route-local", route: "/x" }` now expect
  `{ kind: "mount-local", id: "route:/x", when: ... }`.
- Adapter-owned route guard expressions may still read `sys:route`; core and
  Rust checker code do not synthesize that read.

## 7. Per-Step Files to Edit

- Step 1: `src/core/ir/types.ts`, `crates/checker/src/model.rs`.
- Step 2: `src/core/ir/types.ts`, `src/core/ir/domains.ts`,
  `crates/checker/src/model.rs`.
- Step 3: `src/core/ir/validator.ts`, `test/kernel/kernel.test.ts`,
  `test/kernel/mounted-scope.test.ts`.
- Step 4: `src/extract/engine/ts/routes.ts`,
  `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/transition/router-submit.ts`,
  `src/extract/sources/next/routes.ts`, focused extraction tests.

## 8. Acceptance Criteria

- `route-local` is not part of TypeScript or Rust IR.
- Core/checker mount guards come only from `mount-local.when`.
- `StateVarDecl.role` exists in TypeScript and Rust and can carry the planned
  neutral role kinds.
- Route-scoped adapter output uses `mount-local` scopes with explicit guards.
- No compatibility alias accepts old `route-local` model artifacts.
- Existing tests affected by route-local scope shape are updated intentionally.

## 9. Tests to Add or Update

- Add or update `test/kernel/mounted-scope.test.ts` for:
  - valid `mount-local` guard;
  - guard reads known vars;
  - guard must be boolean;
  - guard must not read the scoped var itself.
- Update `test/sources/use-state/use-state-source.test.ts` to assert
  mount-local route guards.
- Update `src/cli/features/extract/command.test.ts` route-local assertions.
- Update Rust tests in `crates/checker/src/model.rs` to construct mount-local
  guards directly.
- Remove or rewrite tests whose only purpose was route-local compatibility.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run test/kernel/mounted-scope.test.ts test/kernel/kernel.test.ts
rtk pnpm vitest run test/sources/use-state/use-state-source.test.ts
rtk cargo test -p modality-checker model
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if any extraction path cannot construct a meaningful
  mount-local guard and would need checker help to infer one.
- Stop and report if field-level `StateVarDecl.role` conflicts with existing
  schema tooling. Prefer fixing schema tooling; use metadata mapping only if the
  field-level approach is structurally blocked.
- Do not keep `route-local` in serde as an accepted variant.
- Do not move route guard generation into Rust or core validation.

## 12. Must Not Change

- Do not remove `EffectIR.navigate` here.
- Do not change `enqueue`/`dequeue`.
- Do not change step predicates.
- Do not change TLA export.
- Do not change source adapter route ids except where needed for scope shape.
