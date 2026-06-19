# Generic Step Facts

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-4.
Depends on: `260617-20-3-assignment-based-location-effects.md`.

## 1. Goal

Replace navigation-specific step predicates with generic state-variable change
facts.

The intended end state of this plan is:

- `StepPredicateFlat.navigated` and `StepPredicateFlat.navigatedTo` are removed;
- `StepPredicateFlat.changed?: string` and
  `StepPredicateFlat.changedTo?: { var: string; value: Value }` are added;
- the public property helper API exposes `changed(varId)` and
  `changedTo(varId, value)`;
- Rust step facts match changed-var predicates by comparing pre/post values;
- slicing maps changed predicates to the named var instead of `sys:route`;
- no trusted code has route-specific step fact vocabulary.

## 2. Non-goals

- Do not change state predicates or expression semantics.
- Do not change pending step fact names except for queue dependency resolution
  already handled by plan 2.
- Do not add deprecated aliases for `navigated` or `navigatedTo`.
- Do not change event labels.
- Do not migrate all examples/docs beyond what is necessary for tests in this
  plan. Plan 7 owns broad docs/examples cleanup.

## 3. Current-State Findings

- `src/core/ir/types.ts` defines `StepPredicateFlat.navigated` and
  `navigatedTo`.
- `src/core/props/index.ts` exposes `StepFacts.navigated()` and
  `StepFacts.navigatedTo(route)`.
- `src/core/artifacts/index.ts` serializable predicate validation admits the old
  keys.
- `crates/checker/src/model.rs` has Rust fields `navigated` and
  `navigated_to`.
- `crates/checker/src/step.rs` computes navigation facts from
  `compiled.sys_route_index`.
- `src/check/slicing/slice-model.ts` maps navigation facts to `sys:route`.
- `docs/_specs/03-checker.md` describes `navigated()` in step facts.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/core/ir/types.ts`
  - `StepPredicateFlat`
- `src/core/props/index.ts`
  - `StepFacts`
  - helper constructors
  - `inferReads`
  - `inferEnabledTransitions`
- `src/core/artifacts/index.ts`
  - `STEP_PREDICATE_FLAT_KEYS`
  - `assertSerializableStepPredicateFlat`
- `src/check/types.ts`
  - exported `StepFacts` usage if needed
- `src/check/slicing/slice-model.ts`
  - `stepFactVars`
  - `enabledTransitionVars`
- `crates/checker/src/model.rs`
  - `StepPredicateIR`
- `crates/checker/src/step.rs`
  - `StepFacts`
  - `facts_for_step`
  - `matches_step_spec`
- Rust property/search tests that construct step predicates
- TypeScript tests under `test/kernel`, `test/core`, and CLI check/CI fixtures

## 5. Existing Patterns to Follow

- Keep step facts serializable and simple. `changed` stores a var id; `changedTo`
  stores both var id and target value.
- Use existing JSON/value equality in Rust where possible.
- Keep pending facts (`enqueued`, `resolved`, `opId`, `continuation`,
  `opArgs`) unchanged.
- Keep `transitionEnabled*` as expression/property helpers, but remove any
  implicit route dependency from their read inference.

Target shape:

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

## 6. Atomic Implementation Steps

### Step 1 - Change TypeScript predicate shape

Files to edit:

- `src/core/ir/types.ts`
- `src/core/artifacts/index.ts`

Implementation:

1. Remove `navigated` and `navigatedTo`.
2. Add `changed` and `changedTo`.
3. Update serializable artifact validation:
   - allow `changed` and `changedTo`;
   - validate `changed` is a non-empty string;
   - validate `changedTo.var` is a non-empty string;
   - validate `changedTo.value` is serializable using existing value checks.
4. Do not accept old keys.

Acceptance criteria:

- Artifact validation rejects old navigation step keys.
- Artifact validation accepts a predicate such as:

```ts
{ changedTo: { var: "app:location", value: "/checkout" } }
```

### Step 2 - Update property helper API

Files to edit:

- `src/core/props/index.ts`
- tests for property helpers

Implementation:

1. Remove `StepFacts.navigated()` and `StepFacts.navigatedTo(route)`.
2. Add:

```ts
changed(varId: string): StepPredicateFlat
changedTo(varId: string, value: Value): StepPredicateFlat
```

3. Update any helper names to match existing project conventions, for example
   `stepChanged()` if current helpers use the `step*` prefix.
4. Update read inference:
   - `changed` reads the named var;
   - `changedTo` reads `changedTo.var`;
   - no step fact injects `sys:route`.
5. Update `transitionEnabled*` read inference so it includes guard/read/write
   vars for referenced transitions but does not unconditionally add route vars.

Acceptance criteria:

- Public TypeScript property helpers can express route changes as
  `changedTo("app:location", "/checkout")`.
- A property using `transitionEnabled` for a transition with no route/location
  dependency does not infer a route/location read.

### Step 3 - Update Rust predicate deserialization and matching

Files to edit:

- `crates/checker/src/model.rs`
- `crates/checker/src/step.rs`
- Rust tests

Implementation:

1. Replace `navigated` and `navigated_to` with:
   - `changed: Option<String>`;
   - `changed_to: Option<ChangedToPredicate>` where the JSON field is
     `changedTo`.
2. Add a Rust struct for `{ var, value }`.
3. Compute changed var facts by comparing pre/post values for known vars.
   Prefer using an existing changed index list if one exists for the edge;
   otherwise compare all pre/post values.
4. Implement matching:
   - `changed: id` matches when `pre[id] != post[id]`;
   - `changedTo: { var, value }` matches when the var changed and
     `post[var] == value`.
5. Unknown var ids in step predicates should produce a validation/check error,
   not silently never match.

Acceptance criteria:

- Rust tests pass for changed facts on a var named `system:location`, with no
  `sys:route` in the model.

### Step 4 - Update slicing dependencies

Files to edit:

- `src/check/slicing/slice-model.ts`
- slicing tests

Implementation:

1. Replace navigation step fact handling with:
   - `changed` adds the named var;
   - `changedTo` adds `changedTo.var`.
2. Keep pending fact queue resolution from plan 2.
3. Remove `enabledTransitionVars` unconditional `sys:route` dependency.
4. Ensure transition-enabled dependency expansion includes:
   - guard reads;
   - effect reads;
   - effect writes;
   - mount guard reads for touched mount-local vars.

Acceptance criteria:

- Slicing tests prove changed-var facts keep the target var.
- Slicing tests prove `transitionEnabled` without a route dependency does not
  pull a route/location var.

### Step 5 - Update old tests and properties

Files to edit:

- `test/kernel/*.test.ts`
- `test/core/*.test.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- any `.props.ts` examples using navigation facts

Implementation:

1. Replace old `navigatedTo("/x")` expectations with
   `changedTo(routeVarId, "/x")`.
2. Replace `navigated()` expectations with `changed(routeVarId)`.
3. Where a fixture only existed to prove route-specific facts, rewrite it to
   use `app:location` or another neutral var.

Acceptance criteria:

- `rtk rg -n "navigated|navigatedTo" src test crates/checker/src` returns no
  trusted-layer or active-test hits.

## 7. Per-Step Files to Edit

- Step 1: `src/core/ir/types.ts`, `src/core/artifacts/index.ts`.
- Step 2: `src/core/props/index.ts`, property helper tests.
- Step 3: `crates/checker/src/model.rs`, `crates/checker/src/step.rs`, Rust
  tests.
- Step 4: `src/check/slicing/slice-model.ts`, slicing tests.
- Step 5: `test/kernel/*.test.ts`, `test/core/*.test.ts`,
  `src/cli/features/check/command.test.ts`,
  `src/cli/features/ci/command.test.ts`, affected examples.

## 8. Acceptance Criteria

- `navigated` and `navigatedTo` are removed from TypeScript, Rust, and active
  tests.
- `changed` and `changedTo` work in TypeScript artifacts and Rust matching.
- Property helper API exposes generic changed-var facts.
- Slicing uses structured changed-var dependencies.
- No compatibility aliases are added.

## 9. Tests to Add or Update

- Add alwaysStep tests where `changedTo` targets `system:location`.
- Add tests where `changed` targets a non-location var.
- Add artifact validation tests for accepted `changedTo` and rejected
  `navigatedTo`.
- Add Rust tests for:
  - `changed` true/false;
  - `changedTo` matching post value;
  - unknown var in changed predicate errors.
- Add slicing regression for `transitionEnabled` without implicit route.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run test/core test/kernel
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/ci/command.test.ts
rtk cargo test -p modality-checker step
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if Rust step matching lacks access to both pre and post state
  for all edge kinds. Do not approximate changed facts from transition writes
  alone if an assignment can write the same value.
- Stop and report if public docs or examples depend heavily on `navigatedTo`;
  update them directly in plan 7 rather than adding aliases here.
- Stop and report if changed-var slicing needs a shared structured IR walker
  that does not exist. Add the walker rather than string-prefix special cases.

## 12. Must Not Change

- Do not change event labels.
- Do not change pending fact names.
- Do not add route-specific helper aliases.
