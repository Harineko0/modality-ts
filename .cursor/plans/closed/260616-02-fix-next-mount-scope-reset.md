# Fix Next Mount Scope Reset Semantics

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-16.

## 1. Goal

Fix Next.js route-tree mountedness so `mount-local` state is initialized,
preserved, reset, and unmounted using the final route-tree state for the current
route.

The current implementation can leave Next page/layout/template state
`UNMOUNTED` because `sys:next:slot:*` starts as `__none` and because lowered
Next navigation runs `navigate` before assigning route-tree slot variables.

The finished fix should ensure:

- Initial Next extraction state has slot vars aligned with the configured
  initial `sys:route`.
- A Next navigation updates `sys:route`, `sys:history`, slot vars, and phase vars
  before local scope reset decisions are finalized.
- Existing React Router and plain `route-local` behavior remains unchanged.
- The fix is covered by checker-level or end-to-end extraction tests that fail
  before the change.

## 2. Non-goals

- Do not redesign `EffectIR`.
- Do not add a new effect kind unless a smaller fix is impossible.
- Do not rework general route discovery, server effects, cache modeling, or
  module-role classification.
- Do not change public `reactRouterAdapter`, `routerSource`, `nextAdapter`, or
  `nextSource` export names.
- Do not loosen mountedness filtering for transitions touching local vars.
- Do not update generated artifacts under `dist`, `native`, `.modality`, or
  `docs/build`.

## 3. Current-State Findings

- `src/extract/sources/next/routes.ts` creates route-tree slot vars with
  `initial: NEXT_SLOT_NONE` for every slot, ignoring `ResolvedOptions.route`.
- Next page local state uses `mount-local` with a guard that reads both
  `sys:route` and the relevant slot var.
- `lowerNextNavigation` emits `seq([navigate, assign slot vars, assign phase
  vars])`.
- Rust mounted-scope reset runs inside `navigation::navigate`, immediately
  after `sys:route` and `sys:history` are updated.
- `EffectIR::Seq` in `crates/checker/src/effect.rs` simply applies child
  effects in order and does not run a final mounted-scope normalization pass
  after later `assign`/`choose`/`havoc` effects mutate guard inputs.
- Therefore:
  - Initial Next page state is inactive when slot vars start as `__none`.
  - Navigating to a Next page can reset/unmount locals against the old slot
    state, then assign the new slot without activating the page local.
  - Layout/template/parallel-slot state can be reset or preserved incorrectly
    when its guard depends on slot vars assigned after `navigate`.

## 4. Exact File Paths and Relevant Symbols

- `src/extract/sources/next/routes.ts`
  - `routeTreeVars`
  - `lowerNextNavigation`
  - `mountScopeForNode`
  - `nextSlotVarId`
  - `NEXT_SLOT_NONE`
- `crates/checker/src/navigation.rs`
  - `navigate`
  - `reset_local_scopes`
  - `normalize_initial_route_locals`
- `crates/checker/src/effect.rs`
  - `apply_effect`
  - `apply_effect_inner`
  - `EffectIR::Seq`
  - `EffectIR::Navigate`
- `crates/checker/src/model.rs`
  - `mount_guard_for_scope`
  - `transition_locals_mounted`
- `test/kernel/mounted-scope.test.ts`
  - existing TypeScript-level mounted-scope coverage
- `src/cli/features/extract/next-extract.test.ts`
  - Next extraction end-to-end tests
- `src/extract/sources/next/navigation.test.ts`
  - route-tree var and lowered navigation tests

## 5. Existing Patterns To Follow

- Follow the existing `reset_local_scopes(compiled, previous_state, next_state,
  preserve_mounted)` semantics. The bug is when it is invoked, not the core
  active/inactive rules.
- Follow existing Rust checker tests near `navigation.rs` and `effect.rs` for
  compact model construction.
- Follow `src/cli/features/extract/next-extract.test.ts` for Next fixture
  extraction, but add at least one assertion that checks local state is actually
  mounted/initialized after initial extraction or navigation.
- Prefer a small checker normalization helper over spreading ad hoc reset calls
  across many effect branches.

## 6. Atomic Implementation Steps

### Step 1 - Add a failing checker test for sequenced guard-input updates

Create or extend a Rust checker test that builds a model with:

- `sys:route` global enum: `["/", "/dashboard"]`
- `sys:history` global bounded list
- `sys:next:slot:children` global enum:
  `["__none", "app/page", "app/dashboard/page"]`
- `local:Dashboard.count` as `mount-local` guarded by:
  `sys:route == "/dashboard" && sys:next:slot:children == "app/dashboard/page"`
- A transition effect:
  `seq([navigate push "/dashboard", assign sys:next:slot:children
  "app/dashboard/page"])`

Assert the post-state has:

- `sys:route == "/dashboard"`
- `sys:next:slot:children == "app/dashboard/page"`
- `local:Dashboard.count` reset to its declared initial value, not
  `"__UNMOUNTED__"`.

This test should fail before the fix.

### Step 2 - Fix local-scope reset timing for composite effects

Implement a minimal mechanism so local scopes are normalized against the final
state after a top-level effect finishes.

Preferred approach:

- In `crates/checker/src/effect.rs`, keep `apply_effect_inner` as the recursive
  effect executor.
- In top-level `apply_effect`, capture the original pre-state and, after
  `apply_effect_inner` returns successor states, run
  `navigation::reset_local_scopes(compiled, Some(pre_state), successor, false)`
  for each successor.
- Avoid double-normalizing pure `navigate` in a way that changes behavior. If
  double normalization would re-reset newly active nondeterministic initials,
  either:
  - move reset out of `navigation::navigate` and into top-level `apply_effect`,
    while keeping direct `navigate` tests passing, or
  - mark/reset only once by adding a narrow option flag.

Implementation constraints:

- Preserve initial normalization through `normalize_initial_route_locals`.
- Preserve transition mountedness filtering before the transition runs.
- Preserve `pre_state` use for expressions that intentionally reference the
  state before an effect.
- Do not reset local vars after every nested `seq` child; reset using the
  top-level pre-state and final successor state.

Stop and report if moving normalization out of `navigate` breaks direct callers
outside `apply_effect`.

### Step 3 - Initialize Next route-tree slot vars from the initial route

Update `routeTreeVars(inventory, options)` so each slot var initial value matches
the route-tree node that should be active for `options.route`.

Rules:

- For known initial UI route patterns, compute the primary leaf and ancestor
  path using the same helper logic used by `lowerNextNavigation`.
- For each slot represented on that path, initialize the slot var to the
  corresponding node id.
- For slots not active on the initial route, keep `NEXT_SLOT_NONE`.
- If `options.route` is unknown or ambiguous, keep `NEXT_SLOT_NONE` and avoid
  throwing.
- Keep `sys:route` as the compatibility leaf route; do not remove or rename it.

### Step 4 - Recheck lowered Next navigation ordering

After Step 2, `lowerNextNavigation` may still emit `navigate` before slot
assignments, as long as the checker normalizes once against the final state.

Review whether this ordering affects:

- `sys:history` push origin recording.
- `back` transitions. Back currently has no slot-var restoration. If exact slot
  restoration is not implemented, add a warning or over-approximation test, but
  do not silently claim exact route-tree restoration for back navigation.
- Unknown/dynamic targets that use `choose`/`havoc` on slot vars.

If the checker fix cannot safely normalize after arbitrary `choose`/`havoc`
slot assignments, change `lowerNextNavigation` so route-tree assignments happen
before final mountedness normalization by another minimal, explicit mechanism.

### Step 5 - Add end-to-end Next regression coverage

Add an extraction/checker test using a minimal App Router fixture:

- `app/page.tsx` links to `/dashboard`.
- `app/dashboard/page.tsx` is a client component with `useState`.
- Extract the model with the Next adapter.
- Assert the dashboard local var has a `mount-local` guard.
- Run or compile/check a transition path where navigation to `/dashboard`
  reaches a state with the dashboard local var initialized, not unmounted.

Also add a test for initial route:

- Configure extraction route as `/dashboard`, or call `routeTreeVars` directly
  with `{ route: "/dashboard" }`.
- Assert `sys:next:slot:children.initial` is the dashboard node id, not
  `__none`.

### Step 6 - Run focused and full verification

Run targeted checks first, then full checks:

- `rtk cargo test --manifest-path crates/checker/Cargo.toml`
- `rtk pnpm vitest run src/extract/sources/next test/kernel/mounted-scope.test.ts src/cli/features/extract/next-extract.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm test`
- `rtk pnpm architecture`
- `rtk pnpm phase7`
- `rtk pnpm fix`
- `rtk git diff --check`

## 7. Per-Step Files To Edit

| Step | Files |
| --- | --- |
| 1 | `crates/checker/src/effect.rs` or `crates/checker/src/navigation.rs` |
| 2 | `crates/checker/src/effect.rs`, `crates/checker/src/navigation.rs` |
| 3 | `src/extract/sources/next/routes.ts`, `src/extract/sources/next/navigation.test.ts` |
| 4 | `src/extract/sources/next/routes.ts`, `crates/checker/src/effect.rs` |
| 5 | `src/cli/features/extract/next-extract.test.ts`, optionally `test/kernel/mounted-scope.test.ts` |
| 6 | no source edits unless verification reveals issues |

## 8. Acceptance Criteria

1. A `mount-local` var whose guard depends on route-tree slot vars becomes
   active and initializes after a sequenced Next navigation updates the route
   and slot.
2. Initial Next route-tree slot vars reflect `ResolvedOptions.route` when the
   route is known.
3. Existing `route-local` compatibility tests continue to pass.
4. Existing React Router extraction and checker behavior is unchanged.
5. Unknown/dynamic Next navigation targets still over-approximate safely.
6. No generated artifacts are modified.

## 9. Tests To Add Or Update

- Rust checker regression:
  - sequenced `navigate` plus slot `assign` activates and initializes a
    `mount-local` var.
  - dynamic `choose`/`havoc` slot update normalizes local scopes against each
    final successor state.
- Next route-tree vars:
  - `routeTreeVars(inventory, { route: "/dashboard" })` initializes the
    `children` slot to the dashboard node id.
  - unknown initial route keeps `__none`.
- End-to-end extraction:
  - client page state under `/dashboard` is mounted after navigation.
  - initial extraction route `/dashboard` does not leave dashboard state
    unmounted.

## 10. Verification Commands

Run commands with `rtk`:

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
rtk pnpm vitest run src/extract/sources/next test/kernel/mounted-scope.test.ts src/cli/features/extract/next-extract.test.ts
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
rtk git diff --check
```

## 11. Risks, Ambiguities, And Stop Conditions

- **Risk - double reset:** Running `reset_local_scopes` both inside `navigate`
  and after top-level effects may reset newly active nondeterministic locals
  more than once. Prefer a single final reset per top-level transition.
- **Risk - direct `navigate` callers:** If any checker path calls
  `navigation::navigate` outside `apply_effect`, moving reset out of `navigate`
  may regress route-local behavior. Find those callers before changing it.
- **Risk - back navigation route tree:** `sys:history` stores only flat routes,
  not slot snapshots. If back navigation cannot restore exact slot state, mark
  it over-approximate or add a bounded route-to-slot recomputation.
- **Risk - guards depending on mutable local vars:** The validator rejects
  self-reference, but other local-var guard dependencies could still be order
  sensitive. Do not broaden allowed guard shapes while fixing this issue.
- **STOP** if the fix requires a new public IR effect kind. Report the minimal
  IR extension needed instead of shipping a broad change.
- **STOP** if full `pnpm test` reveals React Router mountedness regressions.
  Fix the regression or narrow the reset behavior before proceeding.
