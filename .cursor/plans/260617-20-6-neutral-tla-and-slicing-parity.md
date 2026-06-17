# Neutral TLA and Slicing Parity

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-6.
Depends on:
`260617-20-2-role-based-pending-queues.md`,
`260617-20-3-assignment-based-location-effects.md`,
`260617-20-4-generic-step-facts.md`,
`260617-20-5-role-based-system-validation-and-commit-ordinals.md`.

## 1. Goal

Make TLA structured export and model slicing use the same neutral dependency
forms as the TypeScript validator and Rust checker.

The intended end state of this plan is:

- TLA export has no navigate branch or hard-coded route/history/pending ids;
- TLA export resolves pending queues through roles and explicit queue fields;
- TLA export models generic mount-local reset after effects that change mount
  guards;
- slicing uses mount guards, changed-var step facts, pending queue roles, and
  transition-enabled dependencies without route-specific special cases;
- parity tests cover neutral assignment, pending queue, mount-local reset, and
  commit ordinal fixtures.

## 2. Non-goals

- Do not add new adapter behavior.
- Do not change Rust checker semantics except for fixing parity bugs discovered
  by the new tests.
- Do not implement compatibility for removed navigate or navigated facts.
- Do not optimize state-space size beyond preserving correct slicing.
- Do not rewrite the whole TLA exporter if focused changes are sufficient.

## 3. Current-State Findings

- `src/cli/features/export/command.ts` has `navigateBranches()` that writes
  `sys:route` and `sys:history`.
- The same exporter handles enqueue/dequeue using `sys:pending`.
- Generic mount-local reset is not represented as a neutral branch relation; it
  is tied to route navigation handling.
- `src/check/slicing/slice-model.ts` maps pending facts to `sys:pending`,
  navigation facts to `sys:route`, route-local scopes to `sys:route`, and
  `transitionEnabled*` to `sys:route`.
- Plans 1-5 should have removed the old IR shapes, so this plan should focus on
  parity and cleanup rather than schema design.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/cli/features/export/command.ts`
  - effect branch generation
  - pending enqueue/dequeue handling
  - deleted `navigateBranches`
  - mount reset support
  - readPre/readOpArg support or precise unsupported errors
- `src/cli/features/export/command.test.ts`
  - structured TLA tests
  - parity-style fixtures
- `src/check/slicing/slice-model.ts`
  - `sliceModelForProperty`
  - `stepFactVars`
  - `addRouteVarsForNeededRouteLocals`
  - `enabledTransitionVars`
  - dependency fixpoint
- slicing tests, likely under `test/check` or colocated with `src/check`
- `src/core/ir/domains.ts`
  - `mountGuardForScope`
  - `exprReads` callers if needed

## 5. Existing Patterns to Follow

- Use structured IR walkers, not id-prefix tests.
- Use `mountGuardForScope()` and `exprReads()` to decide which local vars are
  affected by a changed guard.
- For TLA export, prefer failing with a precise error over silently exporting a
  model that diverges from Rust semantics.
- Keep role lookup helpers shared or colocated if they already exist from
  validator work. Avoid duplicating subtly different queue/location selection
  rules.

## 6. Atomic Implementation Steps

### Step 1 - Remove route-specific TLA branches

Files to edit:

- `src/cli/features/export/command.ts`
- `src/cli/features/export/command.test.ts`

Implementation:

1. Delete `navigateBranches()` and all references to `EffectIR.navigate`.
2. Ensure ordinary `assign`, `choose`, `havoc`, `if`, and `seq` effects are the
   only way to mutate location/history vars.
3. Update old route navigation export tests into assignment-driven location
   tests.
4. Do not special-case `role.kind === "location-current"` in TLA semantics; it
   is an ordinary var.

Acceptance criteria:

- A TLA fixture with `app:location` assignment exports without `sys:route`.
- `rtk rg -n "navigateBranches|kind === \"navigate\"|sys:route|sys:history" src/cli/features/export`
  has no semantic hits.

### Step 2 - Resolve pending queues in TLA export

Files to edit:

- `src/cli/features/export/command.ts`
- `src/cli/features/export/command.test.ts`

Implementation:

1. Use the same pending queue resolution rule as plan 2:
   - explicit `queue` wins;
   - omitted queue requires exactly one `pending-queue` role.
2. Replace `envValue(env, "sys:pending")` and writes to `"sys:pending"` with
   resolved queue id.
3. Add precise export errors for ambiguous implicit queues.

Acceptance criteria:

- Structured export test passes for queue id `app:asyncQueue`.
- Ambiguous queue export fails with a targeted message.

### Step 3 - Add generic mount reset to TLA branches

Files to edit:

- `src/cli/features/export/command.ts`
- `src/cli/features/export/command.test.ts`

Implementation:

1. After a top-level effect branch computes a post-state, compare each
   mount-local guard in pre and post state.
2. For every mount-local var whose guard changes false-to-true or true-to-false,
   reset the var to its declared initial value.
3. Use existing expression evaluation/export helpers if available. If TLA export
   cannot evaluate a guard precisely for a branch, stop and report rather than
   omitting reset.
4. Apply reset after the whole effect, matching Rust top-level effect
   application.

Acceptance criteria:

- TLA structured test proves assigning `app:route` activates/deactivates a
  mount-local var and resets it.
- TLA and Rust agree on the same small fixture.

### Step 4 - Preserve readPre/readOpArg parity

Files to edit:

- `src/cli/features/export/command.ts`
- `src/cli/features/export/command.test.ts`

Implementation:

1. Verify current TLA export handling for `readPre` and `readOpArg`.
2. If supported, update tests to cover:
   - `readPre` reads pre-state during assignment;
   - `readOpArg` reads the dequeued op arg snapshot.
3. If unsupported, fail with precise export errors that name the unsupported
   expression and transition. Do not export incorrect semantics.

Acceptance criteria:

- Export behavior for stale reads and op args is either correct and tested or
  explicitly rejected.

### Step 5 - Rewrite slicing neutral dependency fixpoint

Files to edit:

- `src/check/slicing/slice-model.ts`
- slicing tests

Implementation:

1. Replace `addRouteVarsForNeededRouteLocals()` with
   `addMountGuardVarsForNeededMountLocals()`.
2. Include mount guard reads whenever:
   - a selected transition touches a mount-local var;
   - a selected transition writes a var read by a mount guard;
   - property evaluation can observe mounted/unmounted local values.
3. Replace step fact vars with:
   - resolved pending queue role vars for pending facts;
   - `changed`/`changedTo.var` for changed facts.
4. Update `transitionEnabled*` dependencies:
   - include guard reads of matching transitions;
   - include effect reads;
   - include effect writes where needed to evaluate local mount eligibility;
   - do not inject route/location vars unless structured IR reads them.
5. Include role-paired vars only when predicates/transitions read them. Do not
   implicitly keep location history with current location unless adapter effects
   read/write both.

Acceptance criteria:

- Slicing drops unrelated tree/cache/environment vars.
- Slicing includes mount guard vars for touched mount-local vars.
- Slicing includes non-`sys:pending` pending queue vars.

### Step 6 - Add parity fixtures

Files to edit:

- `src/cli/features/export/command.test.ts`
- slicing tests
- possibly `test/check` parity tests if an existing phase7 fixture structure
  exists

Implementation:

1. Add a model with no route vars and a simple assignment transition.
2. Add a model with `app:location`, `app:history`, and assignment-based
   navigation-like transitions.
3. Add a pending queue model with queue id `app:asyncQueue`.
4. Add a mount-local reset fixture.
5. Add a commit ordinal/internal stabilization fixture if a TLA parity test
   structure already exists; otherwise add focused export and Rust tests.

Acceptance criteria:

- `rtk pnpm phase7` exercises the neutral fixtures or a clear targeted test
  documents why phase7 does not cover them yet.

## 7. Per-Step Files to Edit

- Steps 1-4: `src/cli/features/export/command.ts`,
  `src/cli/features/export/command.test.ts`.
- Step 5: `src/check/slicing/slice-model.ts`, slicing tests.
- Step 6: `src/cli/features/export/command.test.ts`, slicing tests, parity
  fixtures.

## 8. Acceptance Criteria

- TLA export has no route navigation semantics.
- TLA export uses role/explicit queue resolution for pending effects.
- TLA export models generic mount-local reset after top-level effects.
- Slicing has no route-local, navigated, or hard-coded pending/route special
  cases.
- Neutral parity fixtures cover assignment, pending queue, mount-local reset,
  and commit ordinal behavior.

## 9. Tests to Add or Update

- Add `generateTlaStructuredModel` tests for:
  - model with no `sys:*` vars;
  - assignment-driven location change;
  - non-`sys:pending` pending queue;
  - mount-local guard reset.
- Add slicing tests for:
  - changed/changedTo vars;
  - pending queue role vars;
  - mount-local guard vars;
  - transitionEnabled without implicit route;
  - unrelated tree/cache/environment system vars removed from slice.
- Add or update phase7/parity fixtures for the same semantics if the harness
  supports them.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/cli/features/export/command.test.ts
rtk pnpm vitest run test/check
rtk pnpm phase7
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if TLA mount reset would require duplicating a large portion
  of Rust effect logic. Add a shared algorithm note/test before continuing.
- Stop and report if `readOpArg` cannot be exported correctly. Do not export a
  misleading approximation.
- Stop and report if slicing discovers dependencies by string prefix. Add a
  structured walker instead.
- Do not keep route/history coupling in TLA or slicing for convenience.

## 12. Must Not Change

- Do not change adapter extraction behavior beyond test fixtures needed for
  export/slicing.
- Do not change Rust checker semantics except to fix demonstrated parity bugs.
