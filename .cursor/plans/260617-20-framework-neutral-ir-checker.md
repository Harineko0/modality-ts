# Framework-Neutral IR and Checker Semantics

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-17.

This plan implements Plan Family B from
`.cursor/plans/260617-18-versatility-plan-of-plans.md`: remove framework-specific
assumptions from the trusted IR/checker layer and make React, Next, and router
behavior adapter output rather than checker vocabulary.

The current codebase already has the right direction in places:
`mount-local` scopes are generic, pending operations snapshot arguments through
`readOpArg`, and internal transitions have phase ordinals. The remaining problem
is that the core IR, TypeScript validator, Rust checker, slicing, step facts, and
TLA export still hard-code `sys:route`, `sys:history`, `sys:pending`,
`route-local`, `navigate`, and `navigated*` as privileged concepts.

Because the project is experimental, do not preserve compatibility with the old
IR surface. Delete the old names once the neutral replacements are implemented.

## 1. Goal

Make the trusted core and checker reason over generic transition-system concepts:

- generic mount scopes with explicit guards;
- generic ordered commit/stabilization phases;
- generic bounded pending operation queues with enqueue-time argument snapshots;
- generic effect evaluation contexts for pre-state and resolving-op reads;
- route/tree/cache/environment state represented as ordinary system variables;
- generic step facts based on state-variable changes and pending operations;
- slicing and TLA export that understand the same neutral dependency forms;
- no React, Next, route, history, or navigation vocabulary inside core IR or
  Rust checker semantics.

After this plan, framework adapters may still emit route-like variables and
route-like effects, but they must lower them into neutral IR before validation
and checking.

## 2. Non-goals

- Do not add React, Next, React Router, or library-specific behavior.
- Do not change broad extraction coverage except where it must lower old route
  constructs into the new neutral IR.
- Do not preserve `route-local`, `navigate`, `sys:route`, `sys:history`,
  `StepPredicateFlat.navigated`, or `StepPredicateFlat.navigatedTo`.
- Do not introduce compatibility shims that let old model artifacts validate.
- Do not redesign `AbstractDomain` broadly.
- Do not optimize state-space performance beyond keeping slicing correct for the
  new neutral dependencies.
- Do not edit unrelated source adapters except the minimal lowering changes
  required to produce valid neutral IR.

## 3. Current-state findings

Verified by reading the repository:

- `src/core/ir/types.ts`
  - `StateVarScope` still includes `{ kind: "route-local"; route: string }`.
  - `EffectIR` still includes `{ kind: "navigate"; mode; to }`.
  - `EventLabel` has `{ kind: "navigate"; ... }`.
  - `Transition.phase?: number` is already generic enough, but its name is
    underspecified; the checker treats it as commit ordering.
  - `StepPredicateFlat` includes `navigated?: boolean` and `navigatedTo?: string`.
- `src/core/ir/domains.ts`
  - `mountGuardForScope(route-local)` hard-codes `read sys:route`.
  - `isLocalScopedScope` treats `route-local` as a peer of `mount-local`.
- `src/core/ir/validator.ts`
  - `effectWrites(navigate)` hard-codes writes to `sys:route` and
    `sys:history`.
  - `validateSystemVars` requires `sys:route`, `sys:history`, and
    `sys:pending` on unsliced models.
  - `validateSystemVarShapes` knows route/history shape.
  - route-local write-order validation is route-specific.
  - `validateEffectTypes` type-checks `navigate.to` against `sys:route`.
- `src/core/props/index.ts`
  - `StepFacts` exposes `navigated()` and `navigatedTo(route)`.
  - property read inference for `transitionEnabled*` injects `sys:route`.
- `src/core/artifacts/index.ts`
  - serializable step predicate validation admits `navigated` and
    `navigatedTo`.
- `src/check/slicing/slice-model.ts`
  - step fact vars map pending facts to `sys:pending` and navigation facts to
    `sys:route`.
  - route-local scopes force `sys:route`.
  - `enabledTransitionVars` always adds `sys:route`.
- `src/cli/features/export/command.ts`
  - TLA export implements `EffectIR.navigate` by manipulating `sys:route` and
    `sys:history`, then resetting mount-local state.
  - generic mount-local reset after ordinary assignments is not modeled by a
    generic effect boundary; it is tied to navigate handling.
- `crates/checker/src/model.rs`
  - Rust `Scope` has `RouteLocal`.
  - Rust `EffectIR` has `Navigate`.
  - `StepPredicateIR` has `navigated` and `navigated_to`.
  - `CompiledModel` caches `sys_route_index`, `sys_history_index`,
    `sys_pending_index`.
  - `mount_guard_for_scope(RouteLocal)` hard-codes `sys:route`.
- `crates/checker/src/domain.rs`
  - validation requires `sys:route`, `sys:history`, and `sys:pending`.
  - effect read/write derivation hard-codes `Navigate` and `sys:pending`.
  - initial state normalization calls `navigation::normalize_initial_route_locals`.
- `crates/checker/src/effect.rs`
  - enqueue/dequeue are generic in concept but hard-coded to `sys:pending`.
  - `EffectIR::Navigate` delegates to `navigation::navigate`.
  - top-level effect application resets local scopes after the whole effect,
    which is the right generic boundary to keep.
- `crates/checker/src/navigation.rs`
  - contains both route navigation and generic local-scope reset behavior.
  - `reset_local_scopes` is reusable and should move/rename into a neutral
    module.
- `crates/checker/src/step.rs`
  - step facts compute `navigated` by comparing `sys:route`.
  - pending op facts are otherwise generic except for the queue var id.
- `crates/checker/src/stabilize.rs`
  - commit `phase` ordinals are already framework-neutral in behavior; tests
    should be renamed to commit-order terminology.
- `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`,
  `docs/_specs/03-checker.md`
  - still describe route-local compatibility and `sys:next:*` vocabulary inside
    the core IR spec.

## 4. Exact file paths and relevant symbols

Core TypeScript IR and validation:

- `src/core/ir/types.ts`
  - edit `StateVarScope`, `EffectIR`, `EventLabel`, `Transition`,
    `StepPredicateFlat`, `Bounds`, `Model.metadata`.
  - add neutral `SystemVarRole`, `PendingQueueRole`, `LocationRole`,
    `EffectIR.assignMany` or `EffectIR.batch` only if needed after trying
    `seq`.
- `src/core/ir/domains.ts`
  - edit `isLocalScopedScope`, `mountGuardForScope`.
- `src/core/ir/validator.ts`
  - edit `effectReads`, `effectWrites`, `validateSystemVars`,
    `validatePresentSystemVars`, `validateSystemVarShapes`,
    `validateScope`, `validateTransition`, `validateEffectShape`,
    `validateEffectTypes`, `validateEffectValues`.
- `src/core/props/index.ts`
  - edit `StepFacts`, `inferReads`, `inferEnabledTransitions`.
- `src/core/artifacts/index.ts`
  - edit `STEP_PREDICATE_FLAT_KEYS`,
    `assertSerializableStepPredicateFlat`, `assertSerializableExpr` if new
    expression helpers are added.

Checker TypeScript bridge:

- `src/check/slicing/slice-model.ts`
  - edit `stepFactVars`, `addRouteVarsForNeededRouteLocals`,
    `enabledTransitionVars`.
- `src/check/serialize-properties.ts`
  - likely unchanged; inspect after property type changes.

Rust checker:

- `crates/checker/src/model.rs`
  - edit `Scope`, `Transition`, `EffectIR`, `StepPredicateIR`,
    `CompiledModel`, `CompiledModel::compile`, `mount_guard_for_scope`,
    `transition_locals_mounted`.
- `crates/checker/src/domain.rs`
  - edit `effect_reads`, `effect_writes`, system validation, initial state
    normalization.
- `crates/checker/src/effect.rs`
  - edit enqueue/dequeue queue lookup, remove `EffectIR::Navigate`, keep
    pre-state and resolving-op context semantics.
- `crates/checker/src/navigation.rs`
  - delete route navigation behavior; move/rename local-scope reset behavior
    into `crates/checker/src/mount.rs` or `local_scope.rs`.
- `crates/checker/src/step.rs`
  - replace navigation facts with generic state-change facts.
- `crates/checker/src/expr.rs`
  - edit reads for `transitionEnabled*`, `readPre`, `readOpArg` validation
    context only if property shape changes.
- `crates/checker/src/stabilize.rs`
  - rename phase-tier tests and comments to commit ordinal; behavior likely
    unchanged.
- `crates/checker/src/lib.rs`
  - update embedded JSON examples.

TLA export:

- `src/cli/features/export/command.ts`
  - remove `navigateBranches`.
  - add neutral pending queue role lookup.
  - ensure every top-level effect branch applies generic mount-scope reset when
    dependencies change.

Extraction lowering that must be migrated just enough to emit neutral IR:

- `src/extract/engine/ts/routes.ts`
- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/transition/navigation.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- `src/extract/engine/pipeline/redirects.ts`
- `src/extract/engine/ts/static-navigation.ts`
- `src/extract/sources/next/config.ts`
- `src/extract/sources/next/routes.ts`
- `src/extract/sources/next/harness.ts`

Specs/tests:

- `docs/_specs/01-ir.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/05-architecture.md`
- `src/cli/features/export/command.test.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- `src/cli/features/conform/command.test.ts`
- `test/core/numeric-ir.test.ts`
- Rust unit tests embedded in `crates/checker/src/*.rs`.

## 5. Existing patterns to follow

- Keep `mount-local` as the only local scope shape. It already carries an
  explicit `ExprIR` guard and is the right framework-neutral abstraction.
- Keep `readPre` and `readOpArg` as the effect-context read model. They already
  encode stale closure and pending-op argument snapshots.
- Keep `Transition.phase?: number` behavior but rename the concept in docs and
  tests to "commit ordinal" or "commit phase ordinal". Do not introduce
  framework hook names into core.
- Keep `enqueue`/`dequeue` semantics, but make the queue variable configurable
  through a role instead of the id `sys:pending`.
- Use ordinary `assign`, `choose`, `havoc`, `if`, and `seq` to model navigation,
  route trees, cache lifecycle, server actions, and environment changes.
- Use `origin: "system"` for neutral system vars, with role metadata describing
  why the var is special to generic checker mechanics.
- Use structured metadata instead of id-prefix conventions where the checker
  needs semantics. Id prefixes such as `sys:next:*` may remain adapter-owned
  names, but Rust and core validation must not inspect those prefixes.

## 6. Target neutral IR shape

Implement these shape changes in one coordinated schema break:

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
  | { kind: "opaque"; ref: OpaqueRef };

export interface StepPredicateFlat {
  transitionId?: string;
  transitionClass?: string;
  labelKind?: string;
  enqueued?: string;
  resolved?: readonly [string, string?];
  changed?: string;
  changedTo?: { var: string; value: Value };
  opId?: string;
  continuation?: string;
  opArgs?: Record<string, unknown>;
}
```

Notes:

- `queue?: string` exists only to avoid repeating the primary queue in every
  old-style source adapter transition. Validation resolves missing `queue` to
  exactly one `role.kind === "pending-queue"` var. If zero or multiple queues
  exist, `queue` is required.
- `location-current` and `location-history` roles are metadata for adapters,
  reports, and harnesses. The checker does not treat them specially.
- `changed` and `changedTo` replace `navigated` and `navigatedTo`. Route
  navigation properties become `changed: "<route-var-id>"` or
  `changedTo: { var: "<route-var-id>", value: "/checkout" }`.
- If `StateVarDecl.role` feels too invasive during implementation, put the same
  map under `Model.metadata.systemVarRoles`. Prefer the field if possible because
  it keeps the role next to the declaration and simplifies validation.

## 7. Atomic implementation steps

### Step 1 — Introduce neutral roles and remove `route-local`

Edit `src/core/ir/types.ts`, `src/core/ir/domains.ts`,
`crates/checker/src/model.rs`, and tests that construct scopes.

- Replace `StateVarScope` with only `global` and `mount-local`.
- Add `StateVarDecl.role?: SystemVarRole` in TypeScript and Rust.
- Delete `Scope::RouteLocal`.
- Delete `mountGuardForScope(route-local)` and Rust equivalent.
- Rename `route_local_var_indexes` in Rust `CompiledTransition` to
  `mount_local_var_indexes`.
- Rename `route_local_mounted` to `mount_locals_active` or delete it if unused.
- Update extraction helpers to lower route-local state to mount-local:
  - in `src/extract/engine/ts/routes.ts`, keep `routeMountGuard(routePattern)`
    but make callers use `{ kind: "mount-local", id: "route:<pattern>", when:
    routeMountGuard(routePattern) }`;
  - in `src/extract/engine/ts/components.ts`,
    `inlineCustomHookState` default scope becomes that mount-local scope;
  - in `src/extract/engine/ts/react-source-transitions.ts`, replace
    `scopeForRoute` returning route-local with mount-local.

Tests:

- Add/rename TypeScript validator tests for mount-local guard validation.
- Update Rust tests in `model.rs` and `navigation.rs` to use mount-local guards.

Stop condition:

- If any extraction path cannot know the route guard when creating a local state
  var, use `{ kind: "mount-local", id: "always", when: { kind: "lit", value:
  true } }` and report the path; do not restore `route-local`.

### Step 2 — Neutralize pending queues

Edit `src/core/ir/types.ts`, `src/core/ir/validator.ts`,
`crates/checker/src/model.rs`, `crates/checker/src/domain.rs`,
`crates/checker/src/effect.rs`, `crates/checker/src/step.rs`,
`src/check/slicing/slice-model.ts`, and `src/cli/features/export/command.ts`.

- Add `queue?: string` to `enqueue` and `dequeue`.
- Add helper in TypeScript validator:
  - `pendingQueueVar(model, explicitQueue?: string): StateVarDecl | error`.
- Add equivalent Rust helper:
  - `CompiledModel::pending_queue_idx(explicit_queue: Option<&str>)`.
- Remove `CompiledModel.sys_pending_index`.
- Replace hard-coded `sys:pending` writes in `effectWrites` with the resolved
  queue id.
- Validate every pending queue role:
  - must be global;
  - must use `boundedList`;
  - item domain must be record with `opId`, `continuation`, and `args`;
  - primary queue maxLen must match `bounds.maxPending`.
- Keep `readOpArg` behavior exactly: args are captured at enqueue time and made
  available while applying the dequeue/continuation sequence.
- Update all extraction/source code currently emitting `enqueue`/`dequeue` to
  either set `queue: "<queue-id>"` or rely on the single primary queue role.
- Keep existing adapter var ids such as `sys:pending` only as names emitted by
  adapters; do not special-case that id in core/checker.

Tests:

- Add core validator tests for:
  - one implicit pending queue role;
  - explicit queue selection;
  - missing queue when multiple queues exist;
  - wrong pending item shape.
- Add Rust tests for enqueue/dequeue over a queue named
  `system:asyncQueue`, proving no `sys:pending` id is required.
- Add slicing test proving a property with `opId`/`continuation` includes the
  role queue, not the string `sys:pending`.

Stop condition:

- If `EffectIR` read/write helpers need the model to resolve queue ids and their
  current signatures cannot accept it, change their signatures. Do not keep a
  hidden `sys:pending` fallback.

### Step 3 — Replace `navigate` with ordinary state assignments

Edit `src/core/ir/types.ts`, `src/core/ir/validator.ts`,
`src/cli/features/export/command.ts`, `crates/checker/src/model.rs`,
`crates/checker/src/domain.rs`, `crates/checker/src/effect.rs`, and extraction
navigation files.

- Delete `EffectIR.navigate` in TypeScript and Rust.
- Delete `crates/checker/src/navigation.rs` route behavior. Move
  `reset_local_scopes` and `normalize_initial_route_locals` into a neutral module
  such as `crates/checker/src/mount.rs`, with names:
  - `normalize_initial_mount_locals`;
  - `reset_mount_locals`.
- In TypeScript TLA export, delete `navigateBranches`.
- Add a small extraction-level helper, probably in
  `src/extract/engine/ts/transition/navigation.ts`:

```ts
function locationEffect(args: {
  currentVar: string;
  historyVar?: string;
  mode: "push" | "replace" | "back";
  to?: ExprIR;
  historyCap?: number;
}): EffectIR
```

  This helper emits only `assign`/`if`/`seq`/`cond` over ordinary vars.
- Update `src/extract/engine/ts/static-navigation.ts`,
  `src/extract/engine/pipeline/redirects.ts`,
  `src/extract/sources/next/config.ts`, and
  `src/extract/engine/ts/transition/navigation.ts` to use `locationEffect`
  instead of `navigate`.
- Preserve user-facing labels such as `{ kind: "navigate" }` only if they are
  replay/harness labels. They must not affect checker semantics.
- Ensure mount-local reset remains generic after every top-level transition
  application in Rust and after every TLA branch relation if mount guards change.

Tests:

- Replace Rust navigation tests with assignment-based location tests using a
  variable named `app:location`.
- Add TLA export tests proving push/back-like behavior can be represented with
  ordinary vars and no `navigate` effect.
- Add extraction tests proving router adapters still emit route/current/history
  vars, but effects are `seq`/`assign`, not `navigate`.

Stop condition:

- If push/back cannot be expressed with current `ExprIR` because bounded-list
  append/pop is unavailable, stop and report. Do not reintroduce `navigate`.
  The likely fundamental fix is a neutral bounded-list expression/effect, not a
  route-specific effect.

### Step 4 — Replace navigation step facts with generic changed-var facts

Edit `src/core/ir/types.ts`, `src/core/props/index.ts`,
`src/core/artifacts/index.ts`, `crates/checker/src/model.rs`,
`crates/checker/src/step.rs`, `src/check/slicing/slice-model.ts`, and tests.

- Remove `navigated` and `navigatedTo`.
- Add `changed?: string` and `changedTo?: { var: string; value: Value }`.
- In Rust `StepFacts`, compute changed vars by comparing all pre/post values or
  reusing `changed_var_indexes`.
- Implement predicate matching:
  - `changed: id` matches if `pre[id] != post[id]`;
  - `changedTo: { var, value }` matches if changed and `post[var] === value`
    using existing JSON equality.
- Update `StepFacts` public TypeScript interface:
  - remove `navigated()`/`navigatedTo(route)`;
  - add `changed(varId: string)` and `changedTo(varId: string, value: Value)`.
- Update `inferReads` and slicing:
  - changed facts read the named var;
  - pending facts read the resolved pending queue role;
  - `transitionEnabled*` adds guard/read/write vars of the referenced transition
    but does not inject `sys:route`.

Tests:

- Add alwaysStep tests where a property targets `changedTo` on a var named
  `system:location`.
- Add a regression proving `transitionEnabled` on a transition with no route
  dependency does not force a route/location var into the slice.
- Update or remove old navigated property tests.

Stop condition:

- If user-facing `.props.ts` examples depend heavily on `navigatedTo`, update
  them directly to `changedTo(routeVarId, route)`. Do not add deprecated aliases.

### Step 5 — Make system vars role-based, not required names

Edit TypeScript and Rust validators plus all model-building tests.

- Delete mandatory `sys:route` and `sys:history` validation.
- Delete mandatory `sys:pending` validation and replace with role validation
  from Step 2.
- Require only:
  - every transition reads/writes known vars;
  - mount-local guards read known vars and not their own var;
  - role-bearing vars satisfy their role shape.
- Add role-shape validation:
  - `location-current`: enum/string-like finite domain for now;
  - `location-history`: bounded list whose inner domain is compatible with the
    paired location-current if `group` matches;
  - `tree-slot`, `boundary-phase`, `cache-entry`, `environment`: finite
    enumerable domain only, no checker behavior.
- Update generated/extracted model builders to mark:
  - current route var as `{ kind: "location-current", group: "default" }`;
  - history var as `{ kind: "location-history", group: "default" }`;
  - Next slot/phase/cache vars as tree/boundary/cache roles.

Tests:

- Add model validator tests proving a model with only `x: bool` and no route
  vars is valid if it has no pending effects.
- Add a model with `app:route`/`app:history` roles and no `sys:*` names.
- Add a Next route-tree test proving `sys:next:*` names are not inspected by the
  checker; role metadata carries meaning.

Stop condition:

- If some CLI report assumes `sys:route` exists for display, update the report
  to discover `role.kind === "location-current"`. Do not make the checker keep
  the name.

### Step 6 — Preserve and document neutral commit ordinal semantics

Edit `src/core/ir/types.ts`, `docs/_specs/01-ir.md`,
`docs/_specs/03-checker.md`, and Rust tests in `stabilize.rs`.

- Keep serialized field `phase?: number` only if renaming it would produce churn
  disproportionate to value. Otherwise rename to `commitOrdinal?: number` in the
  schema break.
- Regardless of field name, update comments/docs/tests to define it as:
  "ordering tier for internal stabilization transitions; lower ordinals run
  before higher ordinals when write conflicts exist."
- Update React extraction code in
  `src/extract/engine/ts/transition/effects.ts` and
  `src/extract/engine/ts/transition/concurrent.ts` so any React-specific hook
  names are local to extraction. The emitted IR carries only the ordinal.

Tests:

- Rename `cross_tier_internal_ordering_is_phase_monotonic` to reference commit
  ordinals.
- Add a TypeScript checker/TLA parity test if one exists for internal ordering;
  otherwise add a Rust unit test and a TLA structured-model test.

Stop condition:

- If renaming `phase` touches too many property fixtures for this plan, keep the
  field name but update all comments and docs. The semantic goal is the neutral
  concept, not cosmetic churn.

### Step 7 — TLA parity for neutral effects and mount reset

Edit `src/cli/features/export/command.ts` and
`src/cli/features/export/command.test.ts`.

- Remove route-specific branches.
- Resolve pending queues through role metadata and explicit `queue`.
- Ensure `readPre` and `readOpArg` either export correctly where currently
  supported or fail with a precise error that matches checker limitations.
- Add generic mount reset to branches after any effect whose writes may change a
  mount guard. Use existing `mountGuardForScope` and `exprReads` to decide which
  local vars are affected.
- Structured export must represent the same branches the Rust checker explores
  for:
  - assignment-driven location change;
  - enqueue/dequeue with op args;
  - mount-local activation/deactivation;
  - internal commit ordinal ordering.

Tests:

- Add `generateTlaStructuredModel` tests for a model with no route vars.
- Add a parity-style test where assigning `app:route` activates a mount-local
  state var.
- Add a pending queue test using a non-`sys:pending` queue id.

Stop condition:

- If TLA export cannot express generic mount reset without duplicating a large
  chunk of Rust logic, stop and report. Do not silently let TLA diverge.

### Step 8 — Slicing fixpoint for every neutral dependency form

Edit `src/check/slicing/slice-model.ts` and slicing tests.

- Replace `addRouteVarsForNeededRouteLocals` with
  `addMountGuardVarsForNeededMountLocals`.
- Replace hard-coded step fact vars with:
  - pending queue role vars for op facts;
  - `changed`/`changedTo.var` for changed facts;
  - transition guard/read/write vars for `transitionEnabled*`.
- Include mount guard reads whenever a transition touches a mount-local var.
- Include role-paired vars only where a predicate or transition actually reads
  them. Do not keep implicit route/history coupling except in extraction-emitted
  transition reads.
- Add tests proving unrelated tree/cache/environment system vars disappear from
  unrelated property slices.

Stop condition:

- If a new dependency form cannot be discovered by walking structured IR, add a
  walker. Do not add string-prefix special cases.

### Step 9 — Minimal extraction and docs migration

Edit only the extraction files required to compile and emit valid neutral IR.

- Route/local lowering:
  - use mount-local guards instead of route-local scopes.
- Navigation lowering:
  - use ordinary location/history assignments.
- Next route tree/cache/environment:
  - keep vars, but add roles and remove assumptions that the checker understands
    `sys:next:*`.
- Harnesses:
  - discover location vars by role rather than by `sys:route` and `sys:history`.
- Docs:
  - update `docs/_specs/01-ir.md` to remove route-local compatibility language.
  - update `docs/_specs/03-checker.md` to describe role-based pending queues,
    changed-var step facts, mount-local reset, and commit ordinals.
  - update `docs/_specs/05-architecture.md` to say adapters lower framework
    concepts to neutral system vars and effects.

Stop condition:

- If a source adapter requires a new checker primitive, stop and write a smaller
  adapter SPI plan. Do not hide adapter knowledge in Rust.

## 8. Per-step files to edit

| Step | Files |
| --- | --- |
| 1 | `src/core/ir/types.ts`, `src/core/ir/domains.ts`, `crates/checker/src/model.rs`, `src/extract/engine/ts/routes.ts`, `src/extract/engine/ts/components.ts`, `src/extract/engine/ts/react-source-transitions.ts` |
| 2 | `src/core/ir/types.ts`, `src/core/ir/validator.ts`, `crates/checker/src/model.rs`, `crates/checker/src/domain.rs`, `crates/checker/src/effect.rs`, `crates/checker/src/step.rs`, `src/check/slicing/slice-model.ts`, `src/cli/features/export/command.ts` |
| 3 | `src/core/ir/types.ts`, `src/core/ir/validator.ts`, `src/cli/features/export/command.ts`, `crates/checker/src/model.rs`, `crates/checker/src/domain.rs`, `crates/checker/src/effect.rs`, `crates/checker/src/navigation.rs`, `src/extract/engine/ts/transition/navigation.ts`, `src/extract/engine/ts/static-navigation.ts`, `src/extract/engine/pipeline/redirects.ts`, `src/extract/sources/next/config.ts` |
| 4 | `src/core/ir/types.ts`, `src/core/props/index.ts`, `src/core/artifacts/index.ts`, `crates/checker/src/model.rs`, `crates/checker/src/step.rs`, `src/check/slicing/slice-model.ts` |
| 5 | `src/core/ir/validator.ts`, `crates/checker/src/domain.rs`, extraction model builders, CLI/report code that displays location vars |
| 6 | `src/core/ir/types.ts`, `crates/checker/src/stabilize.rs`, `src/extract/engine/ts/transition/effects.ts`, `src/extract/engine/ts/transition/concurrent.ts`, specs |
| 7 | `src/cli/features/export/command.ts`, `src/cli/features/export/command.test.ts` |
| 8 | `src/check/slicing/slice-model.ts`, slicing tests |
| 9 | `src/extract/**`, `src/extract/sources/next/**`, `docs/_specs/01-ir.md`, `docs/_specs/03-checker.md`, `docs/_specs/05-architecture.md` |

## 9. Acceptance criteria

1. A hand-authored model with no `sys:*` variables validates and checks.
2. A hand-authored model with `app:location` and `app:history` role-bearing vars
   validates, checks, exports to TLA, and supports `changedTo` step properties.
3. No TypeScript core file or Rust checker file contains `route-local`,
   `EffectIR::Navigate`, `kind: "navigate"` effect handling, `navigated`,
   `navigatedTo`, `sys_route_index`, or `sys_history_index`.
4. The only remaining `sys:route`/`sys:history` strings are in source adapters,
   tests intentionally asserting adapter output names, docs that explain adapter
   examples, or migration notes. The checker must not inspect those names.
5. Enqueue/dequeue works with a pending queue var not named `sys:pending`.
6. `readOpArg` continues to read enqueue-time snapshots during continuation
   effects.
7. Mount-local state resets when any ordinary assignment changes its guard from
   false to true or true to false, not only after route navigation.
8. Sliced checking includes mount guards, changed-var predicates, and pending
   queues through structured dependencies and drops unrelated system vars.
9. TLA structured export and Rust checker agree for neutral assignment,
   pending-queue, mount-local, and commit-ordinal fixtures.
10. `rtk pnpm typecheck`, `rtk pnpm test`, `rtk pnpm architecture`,
    `rtk pnpm phase7`, and `rtk pnpm fix` pass.

## 10. Tests to add or update

Core TypeScript:

- Add `test/core/framework-neutral-ir.test.ts` or colocated tests covering:
  - no required route/history vars;
  - mount-local guard validation;
  - pending queue role validation;
  - changed-var step predicate serialization.
- Update `test/core/numeric-ir.test.ts` model fixtures to use role metadata
  instead of required `sys:*` names where possible.

Checker/Rust:

- Update embedded unit tests in:
  - `crates/checker/src/model.rs`;
  - `crates/checker/src/domain.rs`;
  - `crates/checker/src/effect.rs`;
  - `crates/checker/src/step.rs`;
  - `crates/checker/src/stabilize.rs`.
- Add Rust tests for:
  - model without route/history;
  - non-`sys:pending` pending queue;
  - generic changed-var step facts;
  - assignment-driven mount reset.

Slicing:

- Add tests for:
  - mount-local guard vars;
  - changed/changedTo vars;
  - transitionEnabled without implicit route;
  - unrelated system-role vars removed from a property slice.

TLA:

- Update `src/cli/features/export/command.test.ts`.
- Add structured-model parity tests for:
  - ordinary assignment route/location transition;
  - pending queue role;
  - mount-local reset.

Extraction/CLI:

- Update existing extraction/check/ci/conform tests that currently construct
  `route-local`, `navigate`, `navigated`, or mandatory `sys:*` fixtures.
- Add one extraction regression proving a React/Next app still emits route-like
  behavior, but as role-bearing vars and ordinary effects.

Docs:

- Update internal specs in the same branch. Do not leave docs claiming
  route-local is supported.

## 11. Verification commands

Run targeted checks while developing:

```bash
rtk pnpm vitest run test/core
rtk pnpm vitest run src/cli/features/export/command.test.ts
rtk cargo test -p modality-checker
```

Run full verification before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
rtk git diff --check
```

For this plan family, `phase7` is mandatory because checker semantics and TLA
parity are in scope.

## 12. Risks, ambiguities, and stop conditions

- **Bounded-list operations may be insufficient for back navigation.** If
  current `ExprIR` cannot express push/pop/last generically, stop and propose a
  neutral bounded-list expression/effect. Do not keep `navigate`.
- **Mount reset parity is easy to split.** If Rust and TLA mount reset logic
  diverge, stop and factor a shared algorithm description in docs/tests before
  continuing.
- **Multiple pending queues need explicit semantics.** If adapters begin
  emitting more than one pending queue, require explicit `queue` on every
  enqueue/dequeue. Do not guess by id.
- **Reports and harnesses may assume `sys:route`.** Update them to discover
  `location-current` role vars. If a report has no role metadata, show the raw
  var id rather than falling back to `sys:route`.
- **Generated example snapshots may churn.** Update focused expected outputs
  only. Do not blanket-regenerate snapshots without explaining the semantic
  delta in the commit/PR.
- **Do not split compatibility aliases into core.** If old `.props.ts` files use
  `navigatedTo`, update them to `changedTo`. The project explicitly does not
  preserve backward compatibility.
- **Do not let adapters smuggle framework meaning into checker ids.** Any code
  in `src/core`, `src/check`, or `crates/checker` that branches on `sys:next:*`,
  `sys:route`, `React`, `Next`, or route/history names is a blocker.
