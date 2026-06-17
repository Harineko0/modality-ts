# Neutral Effects, Mount Reset, and Step Facts

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-17.

This is plan 2 of 3 split from
`.cursor/plans/260617-20-framework-neutral-ir-checker.md`. It assumes plan 1 has
removed `route-local`, added system variable roles, and made pending queues
role-based. This plan removes navigation as a checker primitive and replaces
navigation-specific step facts with generic state-change facts.

## 1. Goal

Make checker semantics operate over ordinary state transitions:

- delete `EffectIR.navigate` in TypeScript and Rust;
- model location/history changes as ordinary `assign`/`if`/`seq` effects;
- move route-navigation reset behavior into generic mount-local reset behavior;
- replace `navigated` and `navigatedTo` predicates with `changed` and
  `changedTo`;
- keep commit ordering framework-neutral by documenting and testing it as a
  commit ordinal rather than a React-specific phase.

After this plan, React, Next, and router adapters can still produce navigation
labels for replay/reporting, but the checker must not understand navigation as
special vocabulary.

## 2. Non-goals

- Do not redo plan 1 role and pending-queue work.
- Do not complete slicing fixpoint or TLA parity; plan 3 owns that, except for
  compile-oriented updates required by deleted schema fields.
- Do not migrate all docs; plan 3 owns full docs/spec cleanup.
- Do not add framework-specific behavior to the checker.
- Do not add deprecated aliases for `navigate`, `navigated`, or `navigatedTo`.
- Do not optimize state-space performance.

## 3. Current-state findings

Verified before splitting:

- `src/core/ir/types.ts`
  - `EffectIR` includes `{ kind: "navigate"; mode; to }`.
  - `EventLabel` has `{ kind: "navigate"; ... }`; this may remain as a
    user-facing label if it does not affect semantics.
  - `StepPredicateFlat` includes `navigated?: boolean` and
    `navigatedTo?: string`.
  - `Transition.phase?: number` already behaves like a generic ordering tier,
    but docs/tests call it phase.
- `src/core/ir/validator.ts`
  - `effectWrites(navigate)` hard-codes writes to route/history vars.
  - `validateEffectTypes` type-checks `navigate.to` against route vars.
- `src/core/props/index.ts`
  - `StepFacts` exposes `navigated()` and `navigatedTo(route)`.
  - property read inference for `transitionEnabled*` injects route reads.
- `src/core/artifacts/index.ts`
  - serializable step predicate validation admits `navigated` and
    `navigatedTo`.
- `crates/checker/src/model.rs`
  - Rust `EffectIR` has `Navigate`.
  - `StepPredicateIR` has `navigated` and `navigated_to`.
- `crates/checker/src/effect.rs`
  - `EffectIR::Navigate` delegates to `navigation::navigate`.
  - top-level effect application already resets local scopes after whole
    effects; keep that generic boundary.
- `crates/checker/src/navigation.rs`
  - mixes route navigation behavior with reusable local-scope reset behavior.
- `crates/checker/src/step.rs`
  - computes `navigated` by comparing route vars.
- `crates/checker/src/stabilize.rs`
  - commit phase ordinals are already framework-neutral in behavior; tests and
    comments need neutral naming.

## 4. Exact file paths and relevant symbols

Core TypeScript IR and validation:

- `src/core/ir/types.ts`
  - edit `EffectIR`, `EventLabel`, `Transition`, `StepPredicateFlat`.
- `src/core/ir/validator.ts`
  - edit `effectReads`, `effectWrites`, `validateEffectShape`,
    `validateEffectTypes`, `validateEffectValues`.
- `src/core/props/index.ts`
  - edit `StepFacts`, `inferReads`, `inferEnabledTransitions`.
- `src/core/artifacts/index.ts`
  - edit `STEP_PREDICATE_FLAT_KEYS`,
    `assertSerializableStepPredicateFlat`.

Extraction lowering:

- `src/extract/engine/ts/transition/navigation.ts`
  - add `locationEffect`.
- `src/extract/engine/ts/static-navigation.ts`
- `src/extract/engine/pipeline/redirects.ts`
- `src/extract/sources/next/config.ts`
- `src/extract/sources/next/routes.ts`
- `src/extract/sources/next/harness.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`

Rust checker:

- `crates/checker/src/model.rs`
  - edit `EffectIR`, `StepPredicateIR`, `Transition` comments if present.
- `crates/checker/src/domain.rs`
  - edit `effect_reads`, `effect_writes`, validation.
- `crates/checker/src/effect.rs`
  - remove `EffectIR::Navigate`, preserve generic mount reset after top-level
    effects.
- `crates/checker/src/navigation.rs`
  - delete route navigation behavior; move local reset to a neutral module.
- `crates/checker/src/mount.rs` or `crates/checker/src/local_scope.rs`
  - create if needed for `normalize_initial_mount_locals` and
    `reset_mount_locals`.
- `crates/checker/src/step.rs`
  - replace navigation facts with generic changed-var facts.
- `crates/checker/src/stabilize.rs`
  - rename phase-tier tests/comments to commit ordinal terminology.
- `crates/checker/src/lib.rs`
  - update embedded JSON examples.

Tests:

- `src/cli/features/check/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- `src/cli/features/conform/command.test.ts`
- `test/core/framework-neutral-ir.test.ts` or nearby core tests.
- Rust unit tests embedded in `crates/checker/src/*.rs`.

## 5. Existing patterns to follow

- Use ordinary `assign`, `choose`, `havoc`, `if`, and `seq` to model navigation,
  route trees, cache lifecycle, server actions, and environment changes.
- Preserve user-facing labels such as `{ kind: "navigate" }` only if they are
  replay/harness labels. They must not affect checker semantics.
- Keep mount-local reset as the generic boundary after a top-level transition
  effect, not as route-specific behavior.
- Use role metadata to discover location/current/history vars in adapters and
  reports.
- Keep serialized `phase?: number` unless renaming to `commitOrdinal?: number`
  is low-churn. The semantic goal is neutral ordering, not cosmetic churn.

## 6. Target neutral IR shape

After this plan, `EffectIR` must not include `navigate`:

```ts
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
```

Replace step predicates with generic changed-var facts:

```ts
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

- `changed: id` matches when `pre[id] !== post[id]`.
- `changedTo: { var, value }` matches when the var changed and the post value
  equals `value` using existing value equality semantics.
- Route navigation properties become `changedTo(routeVarId, route)` in
  `.props.ts`.

## 7. Atomic implementation steps

### Step 1 - Delete `navigate` from core and checker schema

Edit `src/core/ir/types.ts`, `src/core/ir/validator.ts`,
`crates/checker/src/model.rs`, `crates/checker/src/domain.rs`, and
`crates/checker/src/effect.rs`.

- Delete `EffectIR.navigate` in TypeScript and Rust.
- Delete validation branches for `navigate`.
- Delete read/write derivation branches for `navigate`.
- Delete Rust `EffectIR::Navigate` application.
- Keep event labels separate: if `EventLabel.navigate` exists only for replay
  and reports, leave it; if it is interpreted by checker semantics, make it a
  generic label.

Stop if route push/back cannot be expressed without a checker primitive because
bounded-list expressions are missing. The fundamental fix should be a neutral
bounded-list expression/effect, not restoring `navigate`.

### Step 2 - Move mount reset into a neutral module

Edit `crates/checker/src/navigation.rs`, `crates/checker/src/effect.rs`, and
`crates/checker/src/model.rs`.

- Delete route navigation behavior from `navigation.rs`.
- Move reusable local-scope reset behavior into `crates/checker/src/mount.rs` or
  `crates/checker/src/local_scope.rs`.
- Rename functions:
  - `normalize_initial_route_locals` to `normalize_initial_mount_locals`;
  - `reset_local_scopes` to `reset_mount_locals`.
- Ensure top-level effect application still calls generic mount reset after the
  whole effect.
- Reset mount-local state when ordinary assignments change a guard from false to
  true or true to false, not only after navigation.

Stop if reset semantics differ between mount-local activation and deactivation;
write an explicit test for the intended behavior before continuing.

### Step 3 - Lower adapter navigation into ordinary effects

Edit extraction navigation files.

- Add a helper in `src/extract/engine/ts/transition/navigation.ts`:

```ts
function locationEffect(args: {
  currentVar: string;
  historyVar?: string;
  mode: "push" | "replace" | "back";
  to?: ExprIR;
  historyCap?: number;
}): EffectIR
```

- The helper must emit only `assign`/`if`/`seq` and existing neutral expression
  forms.
- Update `src/extract/engine/ts/static-navigation.ts`,
  `src/extract/engine/pipeline/redirects.ts`,
  `src/extract/sources/next/config.ts`,
  `src/extract/sources/next/routes.ts`, and
  `src/extract/engine/ts/transition/statement-summary.ts` to use
  `locationEffect` instead of `navigate`.
- Discover current/history vars through `role.kind === "location-current"` and
  `role.kind === "location-history"` where practical.

Stop and report if push/back requires missing neutral bounded-list operations.
Do not reintroduce `navigate`.

### Step 4 - Replace navigation step facts

Edit `src/core/ir/types.ts`, `src/core/props/index.ts`,
`src/core/artifacts/index.ts`, `crates/checker/src/model.rs`,
`crates/checker/src/step.rs`, and tests.

- Remove `navigated` and `navigatedTo`.
- Add `changed?: string` and `changedTo?: { var: string; value: Value }`.
- In Rust step facts, compute changed vars by comparing all pre/post values or
  reusing existing changed-var indexes.
- Implement predicate matching:
  - `changed: id` matches if `pre[id] != post[id]`;
  - `changedTo` matches if changed and post value equals expected value.
- Update the TypeScript `StepFacts` public interface:
  - remove `navigated()` and `navigatedTo(route)`;
  - add `changed(varId: string)` and `changedTo(varId: string, value: Value)`.
- Update `assertSerializableStepPredicateFlat` key allowlist.
- Update user-facing `.props.ts` examples directly from `navigatedTo(route)` to
  `changedTo(routeVarId, route)`.

Stop if examples depend on implicit route var discovery. Make the route var id
explicit or discover it by role in example setup; do not add deprecated aliases.

### Step 5 - Neutralize `transitionEnabled*` read inference

Edit `src/core/props/index.ts` and matching Rust expression handling only if
needed.

- Remove unconditional route read injection from `transitionEnabled*`.
- Infer guard/read/write vars of the referenced transition instead.
- Include mount guard reads when the referenced transition touches mount-local
  vars.
- Keep pending fact reads role-based from plan 1.

Plan 3 will complete slicing coverage, but this step should prevent new
property inference from depending on route vars.

### Step 6 - Preserve neutral commit ordinal semantics

Edit `src/core/ir/types.ts`, `docs/_specs/01-ir.md` only for inline comments if
needed, `docs/_specs/03-checker.md` only for minimal references if needed, and
`crates/checker/src/stabilize.rs`.

- Keep serialized field `phase?: number` if renaming it would create broad
  fixture churn.
- If low-churn, rename it to `commitOrdinal?: number`; otherwise update comments
  and tests to define `phase` as a commit ordinal.
- Define the concept as: ordering tier for internal stabilization transitions;
  lower ordinals run before higher ordinals when write conflicts exist.
- Update React extraction in
  `src/extract/engine/ts/transition/effects.ts` and
  `src/extract/engine/ts/transition/concurrent.ts` so React-specific hook names
  stay local to extraction. Emitted IR carries only the ordinal.
- Rename Rust tests such as `cross_tier_internal_ordering_is_phase_monotonic`
  to reference commit ordinals.

Stop if renaming `phase` touches too many fixtures. Keep the field name and
neutralize the semantics in comments/tests instead.

## 8. Per-step files to edit

| Step | Files |
| --- | --- |
| 1 | `src/core/ir/types.ts`, `src/core/ir/validator.ts`, `crates/checker/src/model.rs`, `crates/checker/src/domain.rs`, `crates/checker/src/effect.rs` |
| 2 | `crates/checker/src/navigation.rs`, `crates/checker/src/mount.rs` or `crates/checker/src/local_scope.rs`, `crates/checker/src/effect.rs`, `crates/checker/src/model.rs` |
| 3 | `src/extract/engine/ts/transition/navigation.ts`, `src/extract/engine/ts/static-navigation.ts`, `src/extract/engine/pipeline/redirects.ts`, `src/extract/sources/next/config.ts`, `src/extract/sources/next/routes.ts`, `src/extract/engine/ts/transition/statement-summary.ts` |
| 4 | `src/core/ir/types.ts`, `src/core/props/index.ts`, `src/core/artifacts/index.ts`, `crates/checker/src/model.rs`, `crates/checker/src/step.rs`, property/example tests |
| 5 | `src/core/props/index.ts`, `src/check/slicing/slice-model.ts` only for compile fixes, property inference tests |
| 6 | `src/core/ir/types.ts`, `crates/checker/src/stabilize.rs`, `src/extract/engine/ts/transition/effects.ts`, `src/extract/engine/ts/transition/concurrent.ts`, minimal spec comments if needed |

## 9. Acceptance criteria

1. No TypeScript core file or Rust checker file contains `EffectIR.navigate`,
   `EffectIR::Navigate`, or semantic handling for `kind: "navigate"` effects.
2. Route/current/history changes are represented as ordinary state assignments.
3. Rust mount-local reset runs for ordinary assignments that affect mount guards.
4. `navigated` and `navigatedTo` are gone from core predicate types,
   serialization validation, and Rust predicate matching.
5. `changed` and `changedTo` work for a var named `system:location` or
   `app:location` without `sys:route`.
6. `transitionEnabled*` no longer injects a route/location var when the
   transition has no route/location dependency.
7. Commit ordering tests/comments use neutral commit ordinal terminology.
8. Any remaining `navigate` strings are labels, adapter-facing names, or docs
   awaiting plan 3 cleanup; they must not affect checker semantics.

## 10. Tests to add or update

Core TypeScript:

- Add always-step/property tests for:
  - `changed("system:location")`;
  - `changedTo("system:location", "/checkout")`;
  - `transitionEnabled` without implicit route reads.
- Update property serialization tests to reject `navigated` and `navigatedTo`.

Checker/Rust:

- Replace navigation tests with assignment-based location tests using a variable
  named `app:location`.
- Add Rust tests for:
  - generic changed-var step facts;
  - mount-local reset after ordinary assignment;
  - commit ordinal ordering terminology.

Extraction/CLI:

- Add extraction tests proving router adapters still emit route-like behavior
  but effects are `seq`/`assign`, not `navigate`.
- Update check/ci/conform tests that construct `navigate`, `navigated`, or
  `navigatedTo`.

Examples:

- Update `.props.ts` examples from `navigatedTo(route)` to
  `changedTo(routeVarId, route)`.
- Do not add deprecated helper aliases.

## 11. Verification commands

Run targeted checks while developing:

```bash
rtk pnpm vitest run test/core
rtk cargo test -p modality-checker
rtk pnpm vitest run src/cli/features/check/command.test.ts
```

Run full semantic verification before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
rtk git diff --check
```

`phase7` is mandatory because checker semantics and model generation are in
scope.

## 12. Risks, ambiguities, and stop conditions

- **Bounded-list operations may be insufficient for back navigation.** If
  current `ExprIR` cannot express push/pop/last generically, stop and propose a
  neutral bounded-list expression/effect. Do not keep `navigate`.
- **Mount reset is easy to overfit to routes.** Any reset logic must inspect
  mount guards and ordinary state changes, not location variable names.
- **Event labels may be confused with effect semantics.** Keep labels only if no
  checker code branches on them as semantic effects.
- **Example properties may rely on implicit route ids.** Update them to explicit
  `changedTo(varId, value)` or role discovery in example code; do not add
  aliases.
- **Do not let adapters smuggle framework meaning into checker ids.** Code in
  `src/core`, `src/check`, or `crates/checker` must not branch on `sys:next:*`,
  `sys:route`, `React`, `Next`, or route/history names.
