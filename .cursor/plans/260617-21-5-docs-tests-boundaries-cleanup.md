# Adapter SPI Consolidation 5: Docs, Architecture Tests, and Cleanup

## Goal

Finish the adapter SPI consolidation by removing obsolete compatibility paths, tightening import-boundary tests, and updating user-facing docs plus internal specs to describe the capability-based adapter model.

This plan depends on plans 1 through 4.

## Non-goals

- Do not add new adapter capabilities in this plan.
- Do not rework extraction semantics.
- Do not preserve old compatibility paths.
- Do not loosen dependency-cruiser rules or architecture tests to make the migration pass.
- Do not edit generated `dist/` artifacts.

## Current-state Findings

- The umbrella plan identified several private CLI imports and old names that should be gone after capability splitting:
  - `routerSource`
  - `withServerEffectDiscovery`
  - `pluginSafetyWarning`
  - direct Next server-effect/cache imports in CLI extraction code
  - id-based `next`/`router` branches in extraction flow
- Active docs describe `RouterPlugin` and hidden navigation methods as part of the extension story.
- Architecture tests already cover some SPI seams, but they need to enforce the new dependency boundaries and old-name deletion.

## Exact File Paths and Relevant Symbols

- `src/cli/features/extract/command.ts`
  - `withServerEffectDiscovery`
  - `routerSource`
  - `parseReactRouterRoutes`
  - `pluginProvenance`
  - `applyMountScopesFromRouter`
- `src/extract/sources/router/index.ts`
  - `routerSource`
  - `reactRouterAdapter`
- `src/extract/engine/pipeline/index.ts`
  - `pluginSafetyWarning`
- `src/cli/registry/index.ts`
  - registry bundle output and provider validators
- `test/extraction/architecture.test.ts`
- `src/extract/engine/navigation-adapter-fit.test.ts`
- `src/cli/registry/index.test.ts`
- `src/cli/features/extract/command.test.ts`
- `docs/architecture/state-sources.md`
- `docs/architecture/navigation.md`
- `docs/architecture/type-library-adapters.md`
- `docs/architecture/conformance-and-replay.md`
- `docs/reference/package-entry-points.md`
- `docs/reference/schemas.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/05-architecture.md`

## Existing Patterns to Follow

- Keep docs aligned with behavior changes in the same feature area.
- Put user-facing architecture guidance in `docs/architecture/`.
- Put internal, precise behavioral invariants in `docs/_specs/`.
- Keep architecture tests explicit and easy to update when a boundary intentionally changes.
- Prefer deleting obsolete exports over leaving unused aliases.

## Atomic Implementation Steps

1. Remove obsolete compatibility paths.
   - Delete remaining `RouterPlugin` references if any survived plan 1.
   - Delete `withServerEffectDiscovery` if any survived plan 2.
   - Delete `pluginSafetyWarning` if any survived plan 4.
   - Delete `routerSource` export if no active test, doc, or public entry-point contract still needs it.
   - If `parseReactRouterRoutes` is still imported by CLI extraction, move the need behind a registered route-discovery/bootstrap capability or generic project loader hook instead of preserving a private import.

2. Remove private CLI framework imports.
   - Ensure `src/cli/features/extract/command.ts` does not import:
     - `discoverNextServerEffectApis`
     - `discoverNextCacheFromSources`
     - `routerSource`
   - Prefer no direct import of `parseReactRouterRoutes`; if still necessary, document the stop condition and add the public capability instead.

3. Remove id-based extraction branches.
   - Search extraction code for:
     - `adapter.id === "next"`
     - `adapter.id === "router"`
     - `routerAdapter.id ===`
   - Replace any remaining behavior with provider capabilities from the registry bundle.
   - It is acceptable for registry construction to inspect package names or dependency presence; extraction flow itself should not branch on adapter ids.

4. Tighten architecture tests.
   - Update `test/extraction/architecture.test.ts`.
   - Add assertions that:
     - `src/extract/engine/**` does not import `src/extract/sources/**` or `src/extract/type-libraries/**`;
     - `src/cli/features/extract/**` does not import private files under `src/extract/sources/*`;
     - built-in adapters implement only public SPI types;
     - no `RouterPlugin` string remains outside historical closed plans;
     - no id-based Next/Router checks remain in extraction flow;
     - no warning string parsing remains for `"Global taint "`.

5. Update focused behavior tests for final architecture.
   - Update registry tests for bundle shape, validators, provenance, and built-in capability registration.
   - Update navigation adapter fit tests to use separate fake capabilities.
   - Update extraction command tests for provider labels, provenance, disabling capabilities by id, and structured caveats.
   - Update Next cache/module-role and React Router effect provider tests if they were not fully covered in earlier plans.

6. Rewrite navigation docs around navigation only.
   - Update `docs/architecture/navigation.md`.
   - Describe route topology, navigation intent classification, route vars, mount scopes, and navigation harness behavior.
   - Do not describe module roles, effect API discovery, cache/storage, or observation as hidden `NavigationAdapter` methods.

7. Update state source docs.
   - Update `docs/architecture/state-sources.md`.
   - Ensure `safetyWarnings` matches implementation and returns structured warnings/caveats.
   - Document that storage-specific uncertainty stays in state-source plugins unless a source exposes a separate cache/storage provider.

8. Add or update adapter SPI architecture docs.
   - Update `docs/architecture/type-library-adapters.md` or add a new adapter SPI section/doc if a better home exists.
   - Cover:
     - navigation;
     - module roles;
     - effect API discovery;
     - cache/storage;
     - observation;
     - state sources;
     - domain refinements;
     - registry bundle and provenance.

9. Update schemas and internal specs.
   - Update `docs/reference/schemas.md` for provenance kind changes.
   - Update `docs/reference/package-entry-points.md` if public entry points changed.
   - Update `docs/_specs/02-extraction.md` and `docs/_specs/05-architecture.md` so they no longer describe `RouterPlugin` or hidden navigation methods as the generic extension story.
   - Update `docs/architecture/conformance-and-replay.md` for observation providers and explicit replay-blocking reasons.

10. Run full cleanup search and fix every active hit.
   - Search for obsolete names and patterns in `src`, `test`, and `docs`.
   - Remove or justify every hit in active code/docs/tests.
   - Historical closed plans can remain unchanged if architecture tests intentionally exclude them.

## Per-step Files to Edit

- Steps 1-3:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/extract/project.ts`
  - `src/extract/sources/router/index.ts`
  - `src/extract/engine/pipeline/index.ts`
- Steps 4-5:
  - `test/extraction/architecture.test.ts`
  - `src/extract/engine/navigation-adapter-fit.test.ts`
  - `src/cli/registry/index.test.ts`
  - `test/extraction/next-module-boundaries.test.ts`
  - `src/extract/sources/next/cache.test.ts`
  - `src/extract/sources/next/module-roles.test.ts`
  - `src/extract/sources/router/server-effects.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - `test/harness/replay.test.ts`
  - `test/harness/jsdom-replay.test.ts`
- Steps 6-9:
  - `docs/architecture/state-sources.md`
  - `docs/architecture/navigation.md`
  - `docs/architecture/type-library-adapters.md`
  - `docs/architecture/conformance-and-replay.md`
  - `docs/reference/package-entry-points.md`
  - `docs/reference/schemas.md`
  - `docs/_specs/02-extraction.md`
  - `docs/_specs/05-architecture.md`

## Acceptance Criteria

- `RouterPlugin` is absent from active source, tests, and docs.
- `routerSource` is deleted unless a public entry-point test proves it must remain; if it remains, there is a documented replacement plan and no private CLI import.
- `withServerEffectDiscovery` is deleted.
- `pluginSafetyWarning` is deleted.
- `src/cli/features/extract/command.ts` no longer imports private Next or React Router implementation files for server effects/cache.
- Extraction flow contains no `adapter.id === "next"` or `adapter.id === "router"` special cases.
- Architecture tests enforce the new dependency boundaries.
- Docs and internal specs describe the consolidated SPI accurately.
- Verification commands pass.

## Tests to Add or Update

- `test/extraction/architecture.test.ts`
  - no `RouterPlugin` imports/usages in active paths;
  - no CLI imports from private source adapter files;
  - no id-based Next/Router checks in extraction flow;
  - engine imports only public SPI/contracts, not built-in adapters;
  - no production warning-string parsing for global taint.
- `src/cli/registry/index.test.ts`
  - final bundle shape and capability provenance.
- `src/extract/engine/navigation-adapter-fit.test.ts`
  - separate fake navigation, module-role, effect API, cache/storage, and observation capabilities.
- `src/cli/features/extract/command.test.ts`
  - disabling a capability by id removes that capability without id-based extraction branches.

## Verification Commands

- `rtk rg -n "RouterPlugin|routerSource|withServerEffectDiscovery|pluginSafetyWarning|adapter\\.id ===|routerAdapter\\.id ===|Global taint " src test docs`
- `rtk pnpm vitest run test/extraction/architecture.test.ts`
- `rtk pnpm vitest run src/cli/registry/index.test.ts`
- `rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm vitest run test/extraction/next-module-boundaries.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/cache.test.ts`
- `rtk pnpm vitest run src/extract/sources/next/module-roles.test.ts`
- `rtk pnpm vitest run src/extract/sources/router/server-effects.test.ts`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run test/harness/replay.test.ts test/harness/jsdom-replay.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm test`
- `rtk pnpm fix`
- `rtk git diff --check`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if a built-in adapter still requires private CLI imports after all public capabilities exist. Add or adjust the SPI instead of preserving the import.
- Stop and report if package entry-point removal requires a coordinated public API decision; do not leave stale docs.
- Stop and report if architecture tests would need broad exclusions to pass. The boundary is the feature, so broad exclusions are a sign the implementation is incomplete.
- Do not add compatibility aliases for deleted SPI names.
- Do not add adapter id checks in new code.
- Do not make the extraction engine import built-in adapters.
