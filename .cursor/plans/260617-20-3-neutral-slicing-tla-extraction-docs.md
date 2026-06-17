# Neutral Slicing, TLA Export, Extraction, and Specs

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-17.

This is plan 3 of 3 split from
`.cursor/plans/260617-20-framework-neutral-ir-checker.md`. It assumes plan 1 has
introduced neutral roles/pending queues and plan 2 has removed navigation
semantics and navigation-specific step facts. This plan finishes parity,
slicing, adapter migration, and internal specification updates.

## 1. Goal

Make every remaining integration point understand the neutral IR:

- TLA structured export supports role-based pending queues, ordinary
  assignment-driven location changes, generic mount reset, and commit ordinals;
- slicing walks structured dependencies for mount guards, changed-var facts,
  transition-enabled facts, and pending queues;
- extraction and source adapters emit only neutral IR while preserving
  route-like user behavior;
- harnesses and reports discover system variables by role, not by `sys:*` names;
- internal specs document the neutral checker contract.

After this plan, no trusted core/checker/export/slicing layer should require
React, Next, route, history, navigation, or `sys:*` vocabulary.

## 2. Non-goals

- Do not reintroduce `route-local`, `navigate`, `navigated`, or `navigatedTo`.
- Do not make source adapters more capable than required to compile and preserve
  existing behavior.
- Do not add broad adapter SPI redesigns; if one is needed, stop and write a
  smaller adapter SPI plan.
- Do not optimize state-space performance beyond making slices correct.
- Do not blanket-regenerate snapshots without a clear semantic reason.
- Do not preserve backward compatibility for old model artifacts.

## 3. Current-state findings

Verified before splitting:

- `src/check/slicing/slice-model.ts`
  - maps pending step facts to `sys:pending`;
  - maps navigation facts to `sys:route`;
  - route-local scopes force `sys:route`;
  - `enabledTransitionVars` always adds `sys:route`.
- `src/cli/features/export/command.ts`
  - TLA export implements `EffectIR.navigate` by manipulating `sys:route` and
    `sys:history`, then resetting mount-local state.
  - generic mount-local reset after ordinary assignments is not modeled by a
    generic effect boundary; it is tied to navigate handling.
- Extraction/source files still need full neutral migration:
  - `src/extract/engine/ts/routes.ts`;
  - `src/extract/engine/ts/components.ts`;
  - `src/extract/engine/ts/react-source-transitions.ts`;
  - `src/extract/engine/ts/transition/navigation.ts`;
  - `src/extract/engine/ts/transition/statement-summary.ts`;
  - `src/extract/engine/pipeline/redirects.ts`;
  - `src/extract/engine/ts/static-navigation.ts`;
  - `src/extract/sources/next/config.ts`;
  - `src/extract/sources/next/routes.ts`;
  - `src/extract/sources/next/harness.ts`.
- `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`,
  `docs/_specs/03-checker.md`, and `docs/_specs/05-architecture.md` still
  describe route-local compatibility and `sys:next:*`/route vocabulary inside
  the core IR/checker spec.

## 4. Exact file paths and relevant symbols

Slicing:

- `src/check/slicing/slice-model.ts`
  - edit `stepFactVars`, `addRouteVarsForNeededRouteLocals`,
    `enabledTransitionVars`;
  - add or reuse walkers for mount guard reads, transition reads/writes,
    pending queue role vars, and changed-var predicates.
- `src/check/serialize-properties.ts`
  - inspect after property type changes; update only if serialized predicate
    shapes changed there.

TLA export:

- `src/cli/features/export/command.ts`
  - remove route-specific `navigateBranches`;
  - add role-based pending queue lookup;
  - add generic mount reset after effects whose writes may change mount guards;
  - represent `readPre`/`readOpArg` correctly or fail precisely.
- `src/cli/features/export/command.test.ts`
  - update and add structured export tests.

Extraction and source adapters:

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

Docs/specs:

- `docs/_specs/01-ir.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/05-architecture.md`

Tests:

- slicing tests under `test/check` or the existing slicing test location;
- `src/cli/features/export/command.test.ts`;
- extraction/check/ci/conform tests that still assert old vocabulary.

## 5. Existing patterns to follow

- Use structured IR walkers instead of string-prefix special cases.
- Include dependencies because a predicate, transition, effect, or mount guard
  actually reads/writes them, not because a variable is named like a route.
- Use `role.kind` for generic mechanics:
  - `pending-queue` for queue facts;
  - `location-current`/`location-history` for adapter/report discovery only;
  - tree/cache/environment roles as metadata, not checker primitives.
- Use ordinary effects to model route/current/history behavior.
- Keep specs aligned with behavior changes in the same branch.
- Prefer focused expected-output updates over broad snapshot regeneration.

## 6. Target neutral behavior

Slicing must include:

- vars named by `changed` and `changedTo.var`;
- role-resolved pending queue vars for pending/op facts;
- transition guard/read/write vars for `transitionEnabled*`;
- mount guard reads when a transition touches a mount-local var;
- effect dependencies discovered by walking structured `EffectIR` and `ExprIR`.

Slicing must not include:

- implicit `sys:route` or `sys:history`;
- unrelated tree/cache/environment system vars;
- route/history coupling unless adapter-emitted transitions actually read/write
  both vars.

TLA export must represent the same branches as the Rust checker for:

- assignment-driven location changes;
- enqueue/dequeue with op args and role-based queues;
- mount-local activation/deactivation reset;
- internal commit ordinal ordering;
- models with no route/location vars.

## 7. Atomic implementation steps

### Step 1 - Complete slicing neutral dependency fixpoint

Edit `src/check/slicing/slice-model.ts` and slicing tests.

- Replace `addRouteVarsForNeededRouteLocals` with
  `addMountGuardVarsForNeededMountLocals`.
- Replace hard-coded step fact vars with:
  - pending queue role vars for op facts;
  - `changed`/`changedTo.var` for changed facts;
  - transition guard/read/write vars for `transitionEnabled*`.
- Include mount guard reads whenever a transition touches a mount-local var.
- Include role-paired vars only where a predicate or transition actually reads
  them.
- Do not keep implicit route/history coupling except in transition reads/writes
  emitted by extraction.

Stop if a dependency form cannot be discovered by walking structured IR. Add a
walker instead of adding string-prefix special cases.

### Step 2 - Make TLA export role-based and navigation-free

Edit `src/cli/features/export/command.ts` and
`src/cli/features/export/command.test.ts`.

- Remove route-specific branches such as `navigateBranches`.
- Resolve pending queues through role metadata and explicit `queue`.
- Export ordinary assignment/if/seq effects for location changes.
- Ensure `readPre` and `readOpArg` either export correctly where currently
  supported or fail with a precise error that matches checker limitations.
- Add generic mount reset to branches after any effect whose writes may change a
  mount guard.
- Use existing `mountGuardForScope` and `exprReads` to decide which local vars
  are affected by a write set.
- Preserve commit ordinal ordering in structured export.

Stop if TLA export cannot express generic mount reset without duplicating a
large chunk of Rust logic. Report the divergence rather than silently letting
TLA drift.

### Step 3 - Finish extraction and source adapter migration

Edit only the extraction files required to compile and emit valid neutral IR.

- Route/local lowering:
  - use `mount-local` guards instead of route-local scopes.
- Navigation lowering:
  - use ordinary location/history assignments produced by the plan 2 helper.
- Next route tree/cache/environment:
  - keep vars, but add roles and remove assumptions that the checker
    understands `sys:next:*`.
- Pending queues:
  - mark pending queue vars with `{ kind: "pending-queue" }`;
  - set explicit `queue` on effects if more than one queue exists.
- Harnesses:
  - discover location vars by `location-current`/`location-history` roles rather
    than by `sys:route` and `sys:history`.
- Reports:
  - show role-bearing location vars when present; otherwise show raw ids.

Stop if a source adapter requires a new checker primitive. Write a smaller
adapter SPI plan instead of hiding adapter knowledge in Rust or core validation.

### Step 4 - Update user-facing tests and examples

Edit focused tests only.

- Update extraction/check/ci/conform tests that currently construct
  `route-local`, `navigate`, `navigated`, or mandatory `sys:*` fixtures.
- Add one extraction regression proving a React/Next app still emits route-like
  behavior, but as role-bearing vars and ordinary effects.
- Add a Next route-tree test proving `sys:next:*` names are not inspected by the
  checker; role metadata carries meaning.
- Update examples and `.props.ts` files to use `changedTo(routeVarId, route)`.

Do not blanket-regenerate snapshots. Update focused expected outputs and note
the semantic delta in test names or comments where helpful.

### Step 5 - Update internal specs

Edit docs in `docs/_specs`.

- `docs/_specs/01-ir.md`
  - remove route-local compatibility language;
  - document `mount-local`, `SystemVarRole`, pending queues, ordinary effects,
    `changed`/`changedTo`, and commit ordinals.
- `docs/_specs/02-extraction.md`
  - describe adapters lowering framework concepts into role-bearing vars and
    ordinary effects.
- `docs/_specs/03-checker.md`
  - describe role-based pending queues, changed-var step facts, mount-local
    reset, and commit ordinals.
- `docs/_specs/05-architecture.md`
  - state that adapters lower framework concepts to neutral system vars and
    effects; core/checker must not inspect framework names.

Stop if docs reveal an unresolved semantic gap between Rust checker and TLA
export. Add a test or report the gap before continuing.

## 8. Per-step files to edit

| Step | Files |
| --- | --- |
| 1 | `src/check/slicing/slice-model.ts`, slicing tests |
| 2 | `src/cli/features/export/command.ts`, `src/cli/features/export/command.test.ts` |
| 3 | `src/extract/engine/ts/routes.ts`, `src/extract/engine/ts/components.ts`, `src/extract/engine/ts/react-source-transitions.ts`, `src/extract/engine/ts/transition/navigation.ts`, `src/extract/engine/ts/transition/statement-summary.ts`, `src/extract/engine/pipeline/redirects.ts`, `src/extract/engine/ts/static-navigation.ts`, `src/extract/sources/next/config.ts`, `src/extract/sources/next/routes.ts`, `src/extract/sources/next/harness.ts` |
| 4 | extraction/check/ci/conform tests, examples, `.props.ts` fixtures |
| 5 | `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`, `docs/_specs/03-checker.md`, `docs/_specs/05-architecture.md` |

## 9. Acceptance criteria

1. A hand-authored model with no `sys:*` variables validates, checks, slices,
   and exports to TLA.
2. A hand-authored model with `app:location` and `app:history` role-bearing vars
   validates, checks, exports to TLA, and supports `changedTo` step properties.
3. Enqueue/dequeue TLA export works with a pending queue var not named
   `sys:pending`.
4. Sliced checking includes mount guards, changed-var predicates, and pending
   queues through structured dependencies.
5. Sliced checking drops unrelated tree/cache/environment system vars.
6. TLA structured export and Rust checker agree for neutral assignment,
   pending-queue, mount-local, and commit-ordinal fixtures.
7. Harnesses/reports discover location vars by role rather than by hard-coded
   `sys:route`/`sys:history`.
8. Internal specs no longer claim `route-local`, `navigate`,
   `navigated`/`navigatedTo`, or required `sys:*` checker variables are part of
   the core contract.
9. Any remaining `sys:route`/`sys:history` strings are adapter-owned names,
   focused test fixtures, examples, or migration notes. Trusted checker logic
   must not inspect those names.

## 10. Tests to add or update

Slicing:

- Add tests for:
  - mount-local guard vars;
  - `changed` and `changedTo` vars;
  - `transitionEnabled` without implicit route;
  - pending queue role vars;
  - unrelated tree/cache/environment vars removed from property slices.

TLA:

- Update `src/cli/features/export/command.test.ts`.
- Add structured-model tests for:
  - model with no route vars;
  - ordinary assignment route/location transition;
  - pending queue role using a non-`sys:pending` queue id;
  - assignment-driven mount-local activation/deactivation reset.

Extraction/CLI:

- Update tests that currently construct or assert `route-local`, `navigate`,
  `navigated`, `navigatedTo`, or mandatory `sys:*` fixtures.
- Add one extraction regression proving router adapters still emit route-like
  behavior as role-bearing vars and ordinary effects.
- Add a Next route-tree/cache regression proving checker semantics come from
  role metadata, not `sys:next:*` prefixes.

Docs:

- Update internal specs in the same branch. Do not leave docs claiming
  route-local or route-specific checker primitives are supported.

## 11. Verification commands

Run targeted checks while developing:

```bash
rtk pnpm vitest run src/cli/features/export/command.test.ts
rtk pnpm vitest run test/check
rtk pnpm vitest run test/core
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

- **Mount reset parity can drift.** If Rust and TLA mount reset logic diverge,
  stop and factor a shared algorithm description in docs/tests before
  continuing.
- **Slicing may miss dependencies hidden inside new forms.** Add structured
  walkers. Do not add string-prefix special cases.
- **Reports and harnesses may assume `sys:route`.** Update them to discover
  `location-current` roles. If no role metadata exists, show raw var ids rather
  than falling back to required names.
- **Generated example snapshots may churn.** Update focused expected outputs
  only and explain the semantic delta in the implementation handoff.
- **Adapters may want new checker primitives.** Stop and write a smaller adapter
  SPI plan. Do not smuggle framework knowledge into Rust, core validation, or
  slicing.
- **Do not split compatibility aliases into core.** Old `.props.ts` and model
  artifacts should be migrated directly to the neutral API.
