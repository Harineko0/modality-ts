# Role-Based Pending Queues

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-2.
Depends on: `260617-20-1-neutral-scopes-and-system-var-roles.md`.

## 1. Goal

Make pending operation queues generic state variables selected by explicit
effect fields or by `role.kind === "pending-queue"`, rather than by the
hard-coded id `sys:pending`.

The intended end state of this plan is:

- `EffectIR.enqueue` and `EffectIR.dequeue` accept `queue?: string` in
  TypeScript and Rust;
- validators and the Rust checker resolve omitted `queue` only when exactly one
  pending queue role exists;
- `CompiledModel.sys_pending_index` is removed;
- enqueue/dequeue reads and writes target the resolved queue var id;
- `readOpArg` still reads the argument snapshot captured at enqueue time;
- adapter code may continue naming its primary queue `sys:pending`, but trusted
  code never special-cases that id.

## 2. Non-goals

- Do not remove `sys:route` or `sys:history` validation in this plan.
- Do not remove `EffectIR.navigate`.
- Do not introduce multiple-queue scheduling policy beyond explicit queue
  selection.
- Do not change pending op record semantics.
- Do not change step fact names except where pending fact dependencies need role
  lookup for slicing.

## 3. Current-State Findings

- `src/core/ir/types.ts` has `enqueue` and `dequeue` without a queue field.
- `src/core/ir/validator.ts` hard-codes `effectWrites(enqueue/dequeue)` to
  `sys:pending` and validates pending shape only on `sys:pending`.
- `crates/checker/src/model.rs` stores `CompiledModel.sys_pending_index`.
- `crates/checker/src/effect.rs` reads/writes the pending queue through
  `compiled.sys_pending_index`.
- `crates/checker/src/domain.rs` derives effect writes and validates required
  system vars with `sys:pending`.
- `crates/checker/src/step.rs` derives pending step facts from
  `sys_pending_index`.
- `src/check/slicing/slice-model.ts` maps pending step facts to `sys:pending`.
- TLA export in `src/cli/features/export/command.ts` interprets
  enqueue/dequeue through `sys:pending`.
- Extraction files such as `src/extract/engine/ts/transition/async.ts`,
  `src/extract/engine/ts/transition/router-submit.ts`, and
  `src/extract/sources/next/cache.ts` emit transitions whose reads/writes
  mention `sys:pending`.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/core/ir/types.ts`
  - `EffectIR.enqueue`
  - `EffectIR.dequeue`
- `src/core/ir/validator.ts`
  - `effectReads`
  - `effectWrites`
  - `validateSystemVars`
  - `validatePresentSystemVars`
  - `validateSystemVarShapes`
  - `validatePendingOpDomain`
  - `validateTransition`
  - `validateEffectShape`
- `crates/checker/src/model.rs`
  - `EffectIR::Enqueue`
  - `EffectIR::Dequeue`
  - `CompiledModel`
  - new queue resolution helper
- `crates/checker/src/domain.rs`
  - `effect_reads`
  - `effect_writes`
  - system validation
- `crates/checker/src/effect.rs`
  - enqueue/dequeue application
  - `effect_contains_enqueue`
  - pending-op context setup
- `crates/checker/src/step.rs`
  - pending fact construction
- `src/check/slicing/slice-model.ts`
  - `stepFactVars`
- `src/cli/features/export/command.ts`
  - enqueue/dequeue branch generation
- extraction emitters:
  - `src/extract/engine/ts/transition/async.ts`
  - `src/extract/engine/ts/transition/router-submit.ts`
  - `src/extract/sources/next/cache.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`

## 5. Existing Patterns to Follow

- Keep pending operation records shaped as:

```ts
{
  opId: string;
  continuation: string;
  args: Record<string, Value>;
}
```

- Keep `readOpArg` evaluation scoped to dequeue/continuation effects. It should
  continue to read the enqueue-time snapshot, not current state.
- Keep adapter-owned ids stable where possible. `sys:pending` may remain in
  adapter output as a name, but not as a trusted fallback.
- Prefer model-aware helpers over hidden globals. Existing pure
  `effectWrites(effect)` signatures may need a model-aware replacement for
  validation. Change signatures rather than preserving an id fallback.

## 6. Atomic Implementation Steps

### Step 1 - Add queue fields to pending effects

Files to edit:

- `src/core/ir/types.ts`
- `crates/checker/src/model.rs`

Implementation:

1. Change TypeScript `EffectIR`:

```ts
| {
    kind: "enqueue";
    queue?: string;
    op: string;
    continuation: string;
    args: Record<string, ExprIR>;
  }
| { kind: "dequeue"; queue?: string; index: number }
```

2. Change Rust `EffectIR::Enqueue` and `EffectIR::Dequeue` to include
   `queue: Option<String>` with serde default/skip behavior.
3. Update effect walkers and test fixture constructors for the new shape.

Acceptance criteria:

- Existing JSON without `queue` still parses, but validation/checking resolves
  it by role and does not fallback to `sys:pending`.

### Step 2 - Add queue resolution helpers

Files to edit:

- `src/core/ir/validator.ts`
- `crates/checker/src/model.rs`

Implementation:

1. Add a TypeScript helper equivalent to:

```ts
function pendingQueueVar(
  model: Model,
  explicitQueue: string | undefined,
): StateVarDecl | undefined
```

2. Behavior:
   - if `explicitQueue` is present, it must reference a known var whose role is
     `pending-queue`;
   - if omitted and exactly one pending-queue role exists, use it;
   - if omitted and zero or multiple pending-queue roles exist, report a
     validation error;
   - error messages must include the transition id when resolving inside a
     transition.
3. Add Rust equivalent on `CompiledModel`, for example:

```rust
pub fn pending_queue_idx(&self, explicit_queue: Option<&str>) -> Result<usize, String>
```

4. Remove `CompiledModel.sys_pending_index`.

Acceptance criteria:

- No Rust checker runtime path reads `sys_pending_index`.
- Missing explicit queues are accepted only for exactly one pending queue role.

### Step 3 - Validate pending queue roles and effect footprints

Files to edit:

- `src/core/ir/validator.ts`
- `crates/checker/src/domain.rs`

Implementation:

1. Replace `validatePendingOpDomain(errors, pending.domain)` with validation for
   every var whose `role.kind === "pending-queue"`.
2. Pending queue role validation:
   - var must have `origin === "system"`;
   - var must have global scope;
   - domain must be `boundedList`;
   - `maxLen` must equal `model.bounds.maxPending`;
   - inner domain must be a record with `opId`, `continuation`, and `args`;
   - `opId` and `continuation` must be enum domains;
   - `args` must be a record domain.
3. Replace hard-coded `effectWrites()` handling for pending effects with
   model-aware resolution:
   - `enqueue` writes the resolved queue;
   - `dequeue` writes the resolved queue.
4. If public `effectWrites(effect)` must stay pure for other callers, add
   `effectWritesForModel(model, transition)` and migrate validation/checker
   callers that need queue resolution.

Acceptance criteria:

- A model with `app:asyncQueue` role validates and no `sys:pending` var.
- A model with no pending effects and no pending queue role still validates.
- A model with pending effects and no queue role fails with a precise error.

### Step 4 - Update Rust enqueue/dequeue execution

Files to edit:

- `crates/checker/src/effect.rs`
- `crates/checker/src/step.rs`
- `crates/checker/src/domain.rs`

Implementation:

1. Resolve the queue index from the effect field and role metadata before
   enqueue/dequeue.
2. Preserve token budget and max-pending behavior using the resolved queue var.
3. Preserve `readOpArg` behavior:
   - enqueue evaluates `args` against the current/pre-state as today;
   - dequeue/continuation exposes the selected pending op args while applying
     continuation effects.
4. Update pending step facts to inspect the resolved queue changed by the
   executed effect instead of `sys_pending_index`.
5. If a transition contains multiple queue effects, compute enqueued/resolved
   facts from the actual queue operations applied in that edge.

Acceptance criteria:

- Rust tests prove enqueue/dequeue work for a queue named `system:asyncQueue`.
- Existing pending continuation tests still pass after fixture updates.

### Step 5 - Update slicing and TLA export for pending queues

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/cli/features/export/command.ts`
- `src/cli/features/export/command.test.ts`

Implementation:

1. Update slicing pending step fact vars so `enqueued`, `resolved`, `opId`,
   `continuation`, and `opArgs` include the resolved pending queue role, not
   the string `sys:pending`.
2. Update TLA export enqueue/dequeue branches to resolve explicit or sole
   pending queue role.
3. Keep failure precise if an exported model uses ambiguous implicit queues.

Acceptance criteria:

- A slicing test with a queue named `app:pendingOps` keeps that var for pending
  properties.
- TLA structured export can enqueue/dequeue over a non-`sys:pending` queue.

### Step 6 - Update extraction emitters minimally

Files to edit:

- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/transition/router-submit.ts`
- `src/extract/sources/next/cache.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- related tests

Implementation:

1. Mark the emitted pending queue var with `role: { kind: "pending-queue" }`.
2. Either add `queue: "sys:pending"` to emitted `enqueue`/`dequeue` effects or
   rely on the single pending queue role. Prefer relying on the role only when
   a model has exactly one queue.
3. Update generated reads/writes to use the chosen queue id through local
   constants, not string duplication.
4. Do not change operation ids, continuation ids, or argument capture semantics.

Acceptance criteria:

- Adapter fixtures still use the same operation behavior, but the trusted
  checker would work if the queue id were renamed.

## 7. Per-Step Files to Edit

- Step 1: `src/core/ir/types.ts`, `crates/checker/src/model.rs`.
- Step 2: `src/core/ir/validator.ts`, `crates/checker/src/model.rs`.
- Step 3: `src/core/ir/validator.ts`, `crates/checker/src/domain.rs`.
- Step 4: `crates/checker/src/effect.rs`, `crates/checker/src/step.rs`,
  `crates/checker/src/domain.rs`.
- Step 5: `src/check/slicing/slice-model.ts`,
  `src/cli/features/export/command.ts`,
  `src/cli/features/export/command.test.ts`.
- Step 6: `src/extract/engine/ts/transition/async.ts`,
  `src/extract/engine/ts/transition/router-submit.ts`,
  `src/extract/sources/next/cache.ts`,
  `src/extract/engine/ts/transition/statement-summary.ts`.

## 8. Acceptance Criteria

- `enqueue` and `dequeue` support optional `queue`.
- Pending effects resolve queues from explicit effect fields or from a single
  `pending-queue` role.
- No trusted code path relies on `sys:pending` as the pending queue id.
- Pending queue role shape is validated in TypeScript and Rust.
- `readOpArg` behavior is unchanged.
- Slicing and TLA export include the resolved queue var for pending facts.

## 9. Tests to Add or Update

- Add TypeScript validator tests for:
  - one implicit pending queue role;
  - explicit queue selection;
  - omitted queue with multiple pending queues;
  - omitted queue with zero pending queues;
  - wrong pending item shape;
  - pending queue `maxLen` mismatch with `bounds.maxPending`.
- Add Rust tests for:
  - enqueue/dequeue using `system:asyncQueue`;
  - readOpArg continuation reads captured args;
  - ambiguous implicit queue fails during compile/check.
- Add slicing test proving pending step properties keep role queue id.
- Update TLA export tests for non-`sys:pending` queue id.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run test/kernel/kernel.test.ts
rtk pnpm vitest run src/cli/features/export/command.test.ts
rtk cargo test -p modality-checker effect
rtk cargo test -p modality-checker step
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if existing pure effect read/write helpers cannot safely
  become model-aware. Do not keep a hidden `sys:pending` fallback.
- Stop and report if multiple queue effects in one transition require a new
  edge fact structure to preserve enqueued/resolved facts accurately.
- Stop and report if Rust serde cannot distinguish missing queue from empty
  string cleanly; require `Option<String>`, not sentinel strings.
- Do not guess which pending queue is primary when more than one exists.

## 12. Must Not Change

- Do not change operation id, continuation id, or argument record shapes.
- Do not change `readPre`.
- Do not remove `EffectIR.navigate`.
- Do not add framework-specific queue roles.
