# Observation Provider Replay

Status: implementation plan.
Date: 2026-06-17.
Plan family: C - Adapter SPI Consolidation.
Split sequence: 260617-21-5.

## 1. Goal

Normalize replay harness observation as an explicit capability so state sources,
navigation, cache/storage, and future framework phase variables can participate
in replay without private harness assumptions.

The intended end state of this plan is:

- `ObservationProvider` is part of the public SPI;
- state-source harnesses and navigation harnesses can be exposed as observation
  providers through the registry bundle;
- replay code consumes observation providers rather than assuming only
  source/navigation harness shapes;
- missing observations produce explicit replay-blocking reasons;
- generated replay behavior remains equivalent for route, useState, Jotai, SWR,
  and Zustand values.

## 2. Non-goals

- Do not redesign replay file format unless it is necessary to represent
  explicit missing-observation errors.
- Do not implement cache/storage runtime observation unless a provider already
  exposes enough harness support.
- Do not change extraction semantics or checker semantics.
- Do not add browser automation or app-runtime execution beyond existing replay
  harness behavior.
- Do not edit generated `dist/` or `docs/build/` artifacts.

## 3. Current-State Findings

- `StateSourcePlugin.harness` contains `setup`, `observe`, and optional
  `witness`.
- `NavigationAdapter.harness` contains `setup`, `observe`, and `navigate`.
- Replay code knows about state source and navigation harnesses directly.
- There is no provider/provenance surface for observing non-state capabilities
  such as framework phase vars or cache/storage vars.
- Current replay tests cover harness behavior in
  `test/harness/replay.test.ts` and `test/harness/jsdom-replay.test.ts`.

## 4. Exact File Paths and Relevant Symbols

Primary files:

- `src/extract/engine/spi/index.ts`
  - `HarnessHooks`
  - `HarnessCtx`
  - `ObservedRead`
  - `WitnessFactory`
  - `StateSourcePlugin.harness`
  - `NavigationAdapter.harness`
  - new `ObservationProvider`
- `src/cli/registry/index.ts`
  - registry adapter bundle
  - provider validation
  - provenance output
- `src/cli/codegen/replay-test.ts`
  - replay harness generation
- `src/cli/features/replay/command.ts`
  - replay command execution
- `src/cli/harness/index.ts`
  - harness runtime helpers if present
- `test/harness/replay.test.ts`
- `test/harness/jsdom-replay.test.ts`
- `docs/architecture/conformance-and-replay.md`

## 5. Existing Patterns to Follow

- Keep harness contract types in `src/extract/engine/spi/index.ts`.
- Keep generated replay code deterministic and stable.
- Preserve current state-source harness behavior by adapting it into the new
  provider path rather than rewriting every source adapter.
- Make absence explicit: use a replay-blocking reason for unobservable vars
  instead of silently ignoring them.
- Keep navigation actions (`navigate`) on navigation harnesses; observation
  providers observe values and produce witnesses.

## 6. Atomic Implementation Steps

### Step 1 - Add observation SPI

Files to edit:

- `src/extract/engine/spi/index.ts`

Implementation:

1. Add:

   ```ts
   export interface ObservationProvider extends ModalityAdapterBase {
     kind: "observation";
     setup(ctx: HarnessCtx): HarnessHooks;
     observe(varId: string, handles: HarnessHooks): ObservedRead | "unobservable";
     witness?(domain: AbstractDomain, varId: string): WitnessFactory | undefined;
   }
   ```

2. Do not remove `StateSourcePlugin.harness` or `NavigationAdapter.harness` in
   this step. They are adapted in registry/codegen first.
3. If navigation observation currently does not accept `varId`, write a small
   adapter wrapper that maps route/location var ids to
   `NavigationAdapter.harness.observe(handles)`.

Acceptance criteria:

- Observation providers can represent state-source harnesses directly.

### Step 2 - Populate observation providers in the registry bundle

Files to edit:

- `src/cli/registry/index.ts`
- `src/cli/registry/index.test.ts`

Implementation:

1. Add `observations: readonly ObservationProvider[]` to the authoritative
   `adapters` bundle if plan 3 only left a placeholder.
2. For each active `StateSourcePlugin`, create an observation provider wrapper:
   - `id` matches or is derived from the source plugin id;
   - `packageNames` and `version` mirror the source plugin;
   - `setup`, `observe`, and `witness` delegate to `plugin.harness`.
3. For active navigation, create a navigation observation provider wrapper if it
   observes route/location state.
4. Validate observation providers independently.
5. Include observation providers in `PluginProvenance` with kind
   `"observation"` if plan 4 has expanded provenance.

Acceptance criteria:

- Registry tests can inspect observation providers for active built-ins.

### Step 3 - Update replay codegen to consume observations

Files to edit:

- `src/cli/codegen/replay-test.ts`
- `src/cli/harness/index.ts` if replay helper APIs live there

Implementation:

1. Replace direct enumeration of source plugin harnesses with
   `adapters.observations`.
2. Keep navigation command execution through the navigation harness where
   `navigate()` is needed.
3. When generating observation code for a var id:
   - call providers in deterministic order;
   - use the first non-`"unobservable"` read;
   - if all providers return `"unobservable"`, emit or record a
     replay-blocking reason that names the var id and active providers.
4. Preserve witness lookup behavior by using observation provider `witness()`.
5. Keep generated tests readable and avoid broad formatting churn.

Acceptance criteria:

- Generated replay tests still observe existing state/navigation vars.
- Missing observations are explicit.

### Step 4 - Update replay command execution

Files to edit:

- `src/cli/features/replay/command.ts`
- `src/cli/harness/index.ts` if used by command execution

Implementation:

1. Thread observation providers from registry/config into replay execution.
2. Replace direct source/navigation observation assumptions with provider
   lookup.
3. Surface replay-blocking reasons in command output and nonzero exit behavior
   using existing error/report conventions.
4. Keep successful replay output unchanged except for provider labels where
   useful.

Acceptance criteria:

- Replay command handles observable and unobservable vars deterministically.

### Step 5 - Update tests and docs

Files to edit:

- `test/harness/replay.test.ts`
- `test/harness/jsdom-replay.test.ts`
- `src/cli/registry/index.test.ts`
- `docs/architecture/conformance-and-replay.md`

Implementation:

1. Update replay tests to assert route, useState, Jotai, SWR, and Zustand
   observation still works.
2. Add a test for a missing observation provider that produces an explicit
   replay-blocking reason.
3. Update docs to describe observation providers as the replay/conformance
   extension point.
4. Do not document cache observation as implemented unless this plan actually
   implements it.

Acceptance criteria:

- Replay documentation matches the new provider path.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/spi/index.ts`.
- Step 2: `src/cli/registry/index.ts`,
  `src/cli/registry/index.test.ts`.
- Step 3: `src/cli/codegen/replay-test.ts`,
  optional `src/cli/harness/index.ts`.
- Step 4: `src/cli/features/replay/command.ts`,
  optional `src/cli/harness/index.ts`.
- Step 5: `test/harness/replay.test.ts`,
  `test/harness/jsdom-replay.test.ts`,
  `src/cli/registry/index.test.ts`,
  `docs/architecture/conformance-and-replay.md`.

## 8. Acceptance Criteria

- `ObservationProvider` exists in the public SPI.
- Registry bundle includes observation providers for active state sources and
  navigation where applicable.
- Replay code consumes observation providers for reads/witnesses.
- Missing observations produce explicit replay-blocking reasons.
- Existing generated replay behavior remains equivalent for current built-ins.
- Observation providers are included in provenance if plan 4 has expanded
  provenance kinds.

## 9. Tests to Add or Update

- `src/cli/registry/index.test.ts`
  - active source plugins produce observation providers;
  - active navigation produces observation provider when observable;
  - invalid observation provider shape is rejected.
- `test/harness/replay.test.ts`
  - provider-based observation reads current values;
  - missing provider emits a replay-blocking reason.
- `test/harness/jsdom-replay.test.ts`
  - jsdom replay still observes route, useState, Jotai, SWR, and Zustand values.
- `src/cli/features/replay/command.test.ts` if it exists
  - replay command surfaces blocking reasons.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/cli/registry/index.test.ts
rtk pnpm vitest run test/harness/replay.test.ts test/harness/jsdom-replay.test.ts
rtk pnpm vitest run src/cli/features/replay/command.test.ts
rtk grep -n "harness\\.observe|harness\\.witness" src/cli test/harness
rtk git diff --check
```

If `src/cli/features/replay/command.test.ts` does not exist, skip that command
and rely on the harness replay tests plus typecheck.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if generated replay APIs would need a broad breaking redesign
  to consume providers. Implement a small adapter layer first.
- Stop and report if navigation observation cannot map to specific var ids.
  Document the minimum mapping needed rather than silently observing the wrong
  value.
- Stop and report if observation providers require runtime access to private
  source adapter internals that are not already part of `harness`.

## 12. Must Not Change

- Do not change checker behavior.
- Do not execute application code beyond existing replay harness behavior.
- Do not implement cache/storage observation unless the provider surface is
  already sufficient.
- Do not silently ignore unobservable vars.
