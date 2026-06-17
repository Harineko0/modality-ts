# Adapter SPI Consolidation 4: Structured Caveats, Provenance, and Observation

## Goal

Remove warning-string conventions, expand provider provenance/confidence metadata, and normalize replay observation behind an explicit capability surface.

This plan depends on the provider and registry bundle work from plans 1 through 3.

## Non-goals

- Do not change checker semantics except where structured metadata requires schema or report updates.
- Do not implement new framework adapters.
- Do not implement a full cache/runtime/storage interpreter.
- Do not change generated replay behavior beyond making missing observations explicit.
- Do not parse warning strings to recover typed caveats.
- Do not edit generated `dist/` artifacts.

## Current-state Findings

- `StateSourcePlugin.safetyWarnings` returns `ExtractionWarning[]`, but production code still has hidden conventions around warning messages.
- `src/extract/engine/pipeline/index.ts` converts plugin safety warning strings with a `"Global taint "` prefix into structured caveats.
- Next cache and some state sources produce approximation warnings close to the source of imprecision but not always as structured caveats.
- `PluginProvenance.kind` currently supports only `"state-source" | "router" | "domain-refinement"`.
- Replay harness observation is embedded in `StateSourcePlugin.harness` and `NavigationAdapter.harness`, with no common provider surface for route, state, cache, or framework phase observations.

## Exact File Paths and Relevant Symbols

- `src/extract/engine/spi/index.ts`
  - `ExtractionWarning`
  - `HarnessHooks`
  - `ObservedRead`
  - `StateSourcePlugin`
  - `NavigationAdapter`
  - `CacheStorageProvider`
  - `EffectApiProvider`
- `src/core/ir/types.ts`
  - `PluginProvenance`
  - `ExtractionCaveat`
  - `Transition.confidence`
  - `Model.metadata.plugins`
  - `Model.metadata.extractionCaveats`
- `src/extract/engine/pipeline/index.ts`
  - `pluginSafetyWarning`
  - `runExtractionPipeline`
- `src/extract/engine/ts/caveats.ts`
  - `globalTaintCaveat`
- `src/extract/sources/jotai/plugin.ts`
- `src/extract/sources/jotai/writes.ts`
  - `discoverJotaiSafetyWarnings`
- `src/extract/sources/zustand/plugin.ts`
- `src/extract/sources/zustand/writes.ts`
  - `discoverZustandSafetyWarnings`
- `src/extract/sources/next/cache.ts`
- `src/cli/features/extract/command.ts`
  - `createExtractionCaveats`
  - `pluginProvenance`
- `src/cli/codegen/replay-test.ts`
- `src/cli/features/replay/command.ts`
- `src/cli/harness/index.ts`
- `test/harness/replay.test.ts`
- `test/harness/jsdom-replay.test.ts`

## Existing Patterns to Follow

- Create caveats at the source of imprecision.
- Keep model metadata plain and serializable.
- Keep replay harness code generated from adapter/source declarations rather than framework-private assumptions.
- Keep confidence explicit on transitions that are approximations.
- Prefer extending existing schema/report paths over adding parallel metadata channels.

## Atomic Implementation Steps

1. Finalize structured warning shape.
   - Edit `src/extract/engine/spi/index.ts`.
   - Make warning producers capable of returning `ExtractionWarning` values with direct `caveat` and `producer` metadata.
   - Keep `message` for human-readable reporting, but production code must not parse it.

2. Replace global taint string parsing.
   - Remove `pluginSafetyWarning` from `src/extract/engine/pipeline/index.ts`.
   - Update state-source warning producers to create `globalTaintCaveat(...)` directly:
     - Jotai plugin/writes;
     - Zustand plugin/writes;
     - SWR/use-state if they have matching safety warning paths.
   - Ensure `createExtractionCaveats` collects `warning.caveat` only.

3. Structure Next cache/storage caveats.
   - Update Next cache provider/discovery so cache/storage approximations return `ExtractionCaveat[]` through `CacheStorageFragment`.
   - Remove any command-side conversion of plain cache warning messages into caveats.

4. Add confidence/provenance metadata to provider outputs.
   - Expand result types where providers create transitions:
     - navigation lowering result;
     - state-source extraction result if needed;
     - effect API discovery result if it creates operations/transitions;
     - cache/storage fragments.
   - Require `"exact"` for exact lowered semantics and `"over-approx"` for bounded or broad abstractions.
   - Reserve `"manual"` for overlays/manual artifacts, not adapter guesses.

5. Expand `PluginProvenance.kind`.
   - Edit `src/core/ir/types.ts`.
   - Replace coarse `"router"` with capability kinds as needed:
     - `"navigation"`
     - `"module-roles"`
     - `"effect-api"`
     - `"cache-storage"`
     - `"observation"`
     - `"state-source"`
     - `"domain-refinement"`
   - Update schema, report, and tests that enumerate provenance kinds.

6. Add observation capability.
   - Add `ObservationProvider` or a shared `ObservationCapability` type to SPI.
   - It should cover:
     - setup hooks;
     - observing a variable by `varId`;
     - optional witness factory lookup for abstract domains.
   - Adapt `StateSourcePlugin.harness` and `NavigationAdapter.harness` to expose or be wrapped by observation providers through the registry bundle.

7. Update replay consumers.
   - Update replay codegen and replay command paths to consume observation providers where possible.
   - Keep generated replay behavior equivalent for route, useState, Jotai, SWR, and Zustand values.
   - Missing observation should produce an explicit replay-blocking reason, not an implicit failure or silent omission.

8. Update reports and docs touched by metadata shape.
   - Make extraction reports show which adapter/provider produced caveats and over-approximations.
   - Keep docs changes minimal here; broader architecture docs are handled by plan 5.

## Per-step Files to Edit

- Steps 1, 4, 6:
  - `src/extract/engine/spi/index.ts`
- Step 2:
  - `src/extract/engine/pipeline/index.ts`
  - `src/extract/engine/ts/caveats.ts`
  - `src/extract/sources/jotai/plugin.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/zustand/plugin.ts`
  - `src/extract/sources/zustand/writes.ts`
- Step 3:
  - `src/extract/sources/next/cache.ts`
  - `src/extract/sources/next/index.ts`
- Steps 4-5:
  - `src/core/ir/types.ts`
  - `src/cli/features/extract/command.ts`
  - `docs/reference/schemas.md`
- Step 7:
  - `src/cli/codegen/replay-test.ts`
  - `src/cli/features/replay/command.ts`
  - `src/cli/harness/index.ts`
  - `test/harness/replay.test.ts`
  - `test/harness/jsdom-replay.test.ts`

## Acceptance Criteria

- Production code no longer parses `"Global taint "` or other warning-message prefixes to recover typed caveats.
- Structured caveats are created at warning source sites.
- `createExtractionCaveats` collects typed warning caveats without string parsing.
- Provider output provenance can distinguish navigation, module roles, effect APIs, cache/storage, observation, state sources, and domain refinements.
- Transitions created by adapters/providers carry explicit confidence when exactness is not obvious.
- Replay observation has a shared capability surface or registry-bundle path.
- Missing replay observation produces an explicit structured replay-blocking condition.

## Tests to Add or Update

- `src/cli/features/extract/command.test.ts`
  - structured caveats survive into model metadata and extraction report;
  - plugin labels/provenance include new capability kinds.
- `src/extract/sources/next/cache.test.ts`
  - cache/storage caveats are returned as structured caveats.
- Jotai/Zustand source tests under `test/sources/*` or `src/extract/sources/*`
  - safety warnings include direct caveats.
- `test/harness/replay.test.ts`
  - observation provider path observes route and state values.
- `test/harness/jsdom-replay.test.ts`
  - JS DOM replay still observes useState, Jotai, SWR, and Zustand values.
- Add a test for missing observation if no existing replay error test fits.

## Verification Commands

- `rtk rg -n "Global taint |pluginSafetyWarning|Unextractable handler " src test docs`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/cache.test.ts`
- `rtk pnpm vitest run test/harness/replay.test.ts test/harness/jsdom-replay.test.ts`
- `rtk pnpm typecheck`
- `rtk git diff --check`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if provenance expansion breaks artifact readers in a way that requires broad schema churn. Do not omit provenance silently.
- Stop and report if replay observation cannot be split cleanly without changing generated replay APIs. Document the minimum shared observation capability and defer only codegen migration if necessary.
- Do not use warning message parsing as a substitute for typed caveats.
- Do not label adapter guesses as `"manual"` confidence.
