# Adapter Migration, Docs, and Cleanup

Status: implementation plan.
Date: 2026-06-17.
Plan family: B - Framework-Neutral IR and Checker Semantics.
Split sequence: 260617-20-7.
Depends on:
`260617-20-1-neutral-scopes-and-system-var-roles.md`,
`260617-20-2-role-based-pending-queues.md`,
`260617-20-3-assignment-based-location-effects.md`,
`260617-20-4-generic-step-facts.md`,
`260617-20-5-role-based-system-validation-and-commit-ordinals.md`,
`260617-20-6-neutral-tla-and-slicing-parity.md`.

## 1. Goal

Finish the migration across source adapters, CLI fixtures, examples, and docs so
the trusted layers remain framework-neutral and the repository no longer teaches
or tests removed IR vocabulary.

The intended end state of this plan is:

- source adapters still model route-like behavior, but only by emitting
  role-bearing vars, mount-local scopes, ordinary effects, and generic step
  facts;
- CLI reports, replay harness generation, conformance, and example tests no
  longer require `sys:route`, `sys:history`, or `sys:pending`;
- internal specs describe neutral IR/checker semantics;
- obsolete compatibility paths and tests are deleted;
- architecture checks or grep assertions protect the trusted layers from
  reintroducing framework-owned ids.

## 2. Non-goals

- Do not add new framework support.
- Do not refactor the adapter SPI beyond what is required by plans 1-6. Plan 21
  owns broader adapter SPI consolidation.
- Do not preserve old model artifact compatibility.
- Do not regenerate large snapshots without explaining the semantic change.
- Do not change checker semantics unless a cleanup test exposes a missed
  migration bug.

## 3. Current-State Findings

The original monolithic plan and symbol sweep identified old vocabulary across:

- extraction and source adapters:
  - `src/extract/engine/ts/routes.ts`
  - `src/extract/engine/ts/components.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/ts/transition/navigation.ts`
  - `src/extract/engine/ts/transition/async.ts`
  - `src/extract/engine/ts/transition/router-submit.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - `src/extract/engine/pipeline/redirects.ts`
  - `src/extract/engine/ts/static-navigation.ts`
  - `src/extract/sources/next/config.ts`
  - `src/extract/sources/next/routes.ts`
  - `src/extract/sources/next/harness.ts`
  - `src/extract/sources/next/cache.ts`
- CLI features:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/check/command.test.ts`
  - `src/cli/features/ci/command.test.ts`
  - `src/cli/features/conform/command.test.ts`
  - `src/cli/features/export/command.test.ts`
  - replay/conformance harness tests
- specs/docs:
  - `docs/_specs/01-ir.md`
  - `docs/_specs/02-extraction.md`
  - `docs/_specs/03-checker.md`
  - `docs/_specs/05-architecture.md`
  - user docs that mention route-local, navigate effects, or navigated facts

## 4. Exact File Paths and Relevant Symbols

Primary files to inspect and edit:

- `src/extract/engine/ts/routes.ts`
  - route guard helpers
  - route var declarations
- `src/extract/engine/ts/components.ts`
  - local state scoping
- `src/extract/engine/ts/react-source-transitions.ts`
  - route/component scope selection
- `src/extract/engine/ts/transition/navigation.ts`
  - location lowering
  - label preservation
- `src/extract/engine/ts/transition/async.ts`
  - pending queue id/role use
- `src/extract/engine/ts/transition/router-submit.ts`
  - route action data vars
  - pending queue use
- `src/extract/engine/ts/transition/statement-summary.ts`
  - effect footprint summaries
- `src/extract/engine/pipeline/redirects.ts`
  - redirect lowering
- `src/extract/engine/ts/static-navigation.ts`
  - static transition generation
- `src/extract/sources/next/config.ts`
  - Next generated route/env transitions
- `src/extract/sources/next/routes.ts`
  - route/history/tree vars
  - route tree transition effects
- `src/extract/sources/next/harness.ts`
  - route/history observation by role
- `src/extract/sources/next/cache.ts`
  - cache vars and pending queues
- docs/specs listed above
- tests under `test/`, `src/cli/features/*/*.test.ts`, and source-specific
  tests that still assert old vocabulary

## 5. Existing Patterns to Follow

- Keep framework vocabulary in source adapters and docs examples only when it
  describes adapter input/output names, not checker semantics.
- Keep examples concrete, but mark role metadata explicitly:

```ts
{
  id: "sys:route",
  role: { kind: "location-current", group: "default" },
  // ...
}
```

- Prefer focused fixture edits over broad snapshot regeneration.
- Use grep sweeps to decide cleanup completion. Every remaining old string must
  be in one of:
  - historical closed plans;
  - this plan family documentation explaining migration;
  - adapter-owned variable names in examples/tests;
  - event labels for replay/reporting.

## 6. Atomic Implementation Steps

### Step 1 - Sweep and classify remaining old vocabulary

Files to inspect:

- `src`
- `crates/checker/src`
- `test`
- `docs`
- `examples`

Implementation:

1. Run:

```bash
rtk rg -n "route-local|EffectIR::Navigate|kind: \"navigate\"|navigatedTo|navigated|sys_route_index|sys_history_index|sys_pending_index|sys:route|sys:history|sys:pending" src crates/checker/src test docs examples
```

2. Classify each hit as:
   - trusted semantic code that must be removed;
   - adapter-owned var id or event label that may remain;
   - active docs/tests that need migration;
   - historical plan text that can remain.
3. Add a short cleanup checklist to the PR description or commit notes if the
   implementation spans multiple commits. Do not leave unexplained trusted-layer
   hits.

Acceptance criteria:

- The implementer has an explicit list of remaining allowed hits before making
  final edits.

### Step 2 - Finish extraction/source adapter migration

Files to edit:

- `src/extract/engine/ts/routes.ts`
- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/transition/navigation.ts`
- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/transition/router-submit.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- `src/extract/engine/pipeline/redirects.ts`
- `src/extract/engine/ts/static-navigation.ts`
- `src/extract/sources/next/config.ts`
- `src/extract/sources/next/routes.ts`
- `src/extract/sources/next/harness.ts`
- `src/extract/sources/next/cache.ts`

Implementation:

1. Ensure route/local lowering uses `mount-local` scopes.
2. Ensure navigation lowering uses ordinary effects.
3. Ensure pending effects include explicit/role-resolved queues.
4. Ensure location/history/tree/cache/environment vars have roles.
5. Ensure harnesses discover location/history vars by role.
6. Keep existing adapter-owned ids such as `sys:route` where tests rely on
   stable output names, but do not let core/checker/slicing/TLA branch on them.

Acceptance criteria:

- Extraction tests prove React/Next route-like behavior is still emitted, but
  effects are ordinary and vars are role-bearing.

### Step 3 - Update CLI, replay, conformance, and examples

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- `src/cli/features/conform/command.test.ts`
- `src/cli/features/export/command.test.ts`
- `src/cli/codegen/replay-test.ts`
- `src/cli/features/replay/command.ts`
- `test/harness/replay.test.ts`
- `test/harness/jsdom-replay.test.ts`
- `examples/**/app.props.ts`
- any example snapshots or expected model fixtures

Implementation:

1. Update fixtures to include role metadata where they use route/history/pending
   vars.
2. Replace old navigation step properties with `changed`/`changedTo`.
3. Replace assumptions that initial state contains `sys:*` with role-aware
   helpers where appropriate.
4. Update replay observation to discover location vars by role.
5. Keep user-facing route labels in replay if they remain useful.

Acceptance criteria:

- Check, CI, conform, replay, and examples tests no longer require trusted
  `sys:*` names.

### Step 4 - Update internal specs and user docs

Files to edit:

- `docs/_specs/01-ir.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/05-architecture.md`
- `docs/_specs/04-conformance.md` if pending/route observation text is stale
- user-facing docs under `docs/` that mention old fields

Implementation:

1. Update IR spec:
   - remove route-local compatibility;
   - describe `SystemVarRole`;
   - describe pending queues by role;
   - describe ordinary effects for location changes.
2. Update extraction spec:
   - adapters may emit vars named `sys:route`/`sys:history`, but roles carry
     meaning;
   - route-scoped local state lowers to mount-local guards;
   - navigation lowering emits ordinary effects.
3. Update checker spec:
   - no required `sys:*` vars;
   - changed-var step facts;
   - generic mount-local reset;
   - commit ordinals.
4. Update architecture spec:
   - trusted layers are framework-neutral;
   - adapters lower framework concepts into neutral vars/effects.

Acceptance criteria:

- Docs no longer claim core supports route-local, navigate effects, or
  navigated step facts.

### Step 5 - Add regression guards against framework semantics in trusted layers

Files to edit:

- `test/extraction/architecture.test.ts` or a better existing architecture test
- dependency-cruiser config only if there is already a relevant rule pattern

Implementation:

1. Add assertions that trusted files under `src/core`, `src/check`, and
   `crates/checker/src` do not contain removed strings:
   - `route-local`;
   - `EffectIR::Navigate`;
   - semantic `kind: "navigate"` effect handling;
   - `navigated`;
   - `navigatedTo`;
   - `sys_route_index`;
   - `sys_history_index`;
   - `sys_pending_index`.
2. Do not forbid adapter-owned ids globally. Instead, scope string bans to
   trusted layers or assert remaining hits are only in allowed adapter/docs
   contexts.
3. If architecture tests cannot read Rust files today, add a small test helper
   or use existing repository-file scanning patterns.

Acceptance criteria:

- Future reintroduction of old trusted vocabulary fails a focused test.

### Step 6 - Final verification and focused cleanup

Files to inspect:

- whole repository

Implementation:

1. Run targeted tests for changed areas.
2. Run full verification commands.
3. Run a final grep sweep and justify remaining hits.
4. Do not commit generated `dist/` or unrelated formatting churn.

Acceptance criteria:

- Full verification passes.
- Remaining old strings are limited to allowed adapter-owned ids, labels,
  examples, migration docs, or historical closed plans.

## 7. Per-Step Files to Edit

- Step 1: inspection across `src`, `crates/checker/src`, `test`, `docs`,
  `examples`.
- Step 2: extraction/source adapter files listed in section 6.
- Step 3: CLI/replay/conformance/example files listed in section 6.
- Step 4: `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`,
  `docs/_specs/03-checker.md`, `docs/_specs/05-architecture.md`, related user
  docs.
- Step 5: `test/extraction/architecture.test.ts` or equivalent architecture
  regression tests.
- Step 6: no new files unless verification reveals a missed focused fixture.

## 8. Acceptance Criteria

- Source adapters emit valid neutral IR and role metadata.
- CLI, replay, conformance, and examples use roles and generic step facts.
- Docs/specs describe neutral IR and checker semantics accurately.
- Trusted layers have no removed framework-specific vocabulary or id-based
  semantics.
- Architecture/regression tests protect against reintroduction.
- Full verification passes.

## 9. Tests to Add or Update

- Update extraction tests that currently assert:
  - `route-local`;
  - `navigate` effects;
  - mandatory `sys:*` system vars without roles.
- Update CLI check/CI/conform/export tests to role-bearing fixtures.
- Update replay tests to role-based location observation.
- Update examples and `.props.ts` files to use `changed`/`changedTo`.
- Add architecture regression tests for trusted-layer forbidden vocabulary.

## 10. Verification Commands

Run targeted checks while implementing:

```bash
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/ci/command.test.ts
rtk pnpm vitest run src/cli/features/conform/command.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts
rtk pnpm vitest run test/harness/replay.test.ts test/harness/jsdom-replay.test.ts
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

Run final cleanup sweep:

```bash
rtk rg -n "route-local|EffectIR::Navigate|kind: \"navigate\"|navigatedTo|navigated|sys_route_index|sys_history_index|sys_pending_index" src crates/checker/src test docs examples
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if a source adapter appears to require a new checker
  primitive. Write a smaller adapter SPI or neutral IR plan instead of hiding
  adapter knowledge in Rust.
- Stop and report if docs imply incompatible semantics between Rust checker and
  TLA export.
- Stop and report if example snapshot churn becomes broad. Prefer focused
  fixture edits and explain any unavoidable large diff.
- Do not add compatibility aliases for old properties or effects.
- Do not let adapters smuggle framework meaning into trusted id prefixes.

## 12. Must Not Change

- Do not add new framework/library support.
- Do not edit `dist/`.
- Do not change plan family A, C, D, or E files except where a test fixture
  directly depends on this family’s IR schema.
