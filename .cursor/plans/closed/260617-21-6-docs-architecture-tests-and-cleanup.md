# Docs Architecture Tests and Cleanup

Status: implementation plan.
Date: 2026-06-17.
Plan family: C - Adapter SPI Consolidation.
Split sequence: 260617-21-6.

## 1. Goal

Finish the adapter SPI consolidation by updating documentation/specs, tightening
architecture tests, and deleting obsolete compatibility paths left after the
capability split.

The intended end state of this plan is:

- public docs describe navigation, module roles, effect APIs, cache/storage,
  observation, state sources, and domain refinements as distinct capabilities;
- internal specs match the implemented SPI;
- architecture tests prevent private CLI imports from built-in adapter slices;
- architecture tests prevent id-based Next/React Router extraction branches;
- obsolete names such as `routerSource`, `withServerEffectDiscovery`,
  `pluginSafetyWarning`, and `RouterPlugin` are gone from active source/tests/docs;
- focused behavioral tests cover the final capability shape.

## 2. Non-goals

- Do not introduce new adapter capabilities in this plan.
- Do not change extraction or checker semantics except to remove dead
  compatibility paths left by prior plans.
- Do not edit generated `dist/` or `docs/build/` artifacts.
- Do not keep compatibility aliases for deleted SPI names.
- Do not loosen dependency-cruiser or architecture rules to make tests pass.

## 3. Current-State Findings

- Source docs currently describe `NavigationAdapter` as the owner of router,
  module-role, and effect API responsibilities.
- Some docs mention `RouterPlugin`, `routerPlugin`, and `routerSource()`.
- `docs/reference/schemas.md` needs updates if `PluginProvenance.kind` changed.
- `test/extraction/architecture.test.ts` already validates several extraction
  boundaries and is the right place to add import/id-check rules.
- Earlier plans may leave transitional exports or comments to keep diffs small;
  this plan removes them.

## 4. Exact File Paths and Relevant Symbols

Docs/specs:

- `docs/architecture/state-sources.md`
- `docs/architecture/navigation.md`
- `docs/architecture/type-library-adapters.md`
- `docs/architecture/conformance-and-replay.md`
- `docs/reference/package-entry-points.md`
- `docs/reference/schemas.md`
- `docs/sources/next.md`
- `docs/sources/router.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/05-architecture.md`

Tests:

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

Cleanup targets:

- `src/extract/sources/router/index.ts`
  - `routerSource`
- `src/cli/features/extract/command.ts`
  - private Next/React Router imports
  - id-based adapter checks
- `src/extract/engine/pipeline/index.ts`
  - `pluginSafetyWarning`
- active source/test/doc references to:
  - `RouterPlugin`
  - `withServerEffectDiscovery`
  - `routerSource`
  - `adapter.id === "next"`
  - `adapter.id === "router"`
  - `routerAdapter.id ===`
  - `"Global taint "` parsing

## 5. Existing Patterns to Follow

- Keep user-facing docs under `docs/`; keep internal requirements under
  `docs/_specs/`.
- Do not edit generated docs output under `docs/build/`.
- Use architecture tests for import boundary enforcement rather than relying on
  convention.
- Keep tests focused on public SPI behavior.
- Prefer deleting obsolete code over adding compatibility comments.
- Preserve current package entry point style and NodeNext ESM import examples.

## 6. Atomic Implementation Steps

### Step 1 - Update architecture docs

Files to edit:

- `docs/architecture/navigation.md`
- `docs/architecture/state-sources.md`
- `docs/architecture/type-library-adapters.md`
- `docs/architecture/conformance-and-replay.md`

Implementation:

1. Rewrite navigation docs so `NavigationAdapter` covers:
   - route discovery;
   - navigation call/JSX classification;
   - location vars;
   - route tree vars;
   - navigation lowering;
   - mount scope mapping;
   - navigation harness behavior.
2. Remove module-role and effect API responsibilities from navigation docs.
3. Update state-source docs so `safetyWarnings()` returns structured
   `ExtractionWarning[]` with optional `caveat`, `confidence`, and `producer`.
4. Add or update an adapter SPI section that covers:
   - `ModuleRoleAdapter`;
   - `EffectApiProvider`;
   - `CacheStorageProvider`;
   - `ObservationProvider`;
   - registry bundle ownership.
5. Update replay/conformance docs to describe observation providers.

Acceptance criteria:

- Docs describe the final capability split and no longer promote hidden
  navigation methods.

### Step 2 - Update reference docs and specs

Files to edit:

- `docs/reference/package-entry-points.md`
- `docs/reference/schemas.md`
- `docs/sources/next.md`
- `docs/sources/router.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/05-architecture.md`

Implementation:

1. Update package entry point docs for public SPI exports and built-in provider
   exports.
2. Update schema docs for expanded `PluginProvenance.kind` values.
3. Update Next and React Router source docs to show provider exports rather than
   `routerSource()` or navigation-owned effect discovery.
4. Remove all `RouterPlugin` references from source docs/specs.
5. Align internal extraction specs with module-role/effect/cache/observation
   capabilities.

Acceptance criteria:

- Source docs and internal specs match implemented public contracts.

### Step 3 - Tighten architecture tests

Files to edit:

- `test/extraction/architecture.test.ts`

Implementation:

1. Add tests that fail if `src/extract/engine/**` imports:
   - `src/extract/sources/**`;
   - `src/extract/type-libraries/**`.
2. Add tests that fail if `src/cli/features/extract/**` imports private files
   under:
   - `src/extract/sources/next/*`;
   - `src/extract/sources/router/*`.
3. Allow CLI registry imports only from public package entry points such as
   `modality-ts/extract/sources/next` and
   `modality-ts/extract/sources/router`.
4. Add tests that fail on active source/test/doc references to:
   - `RouterPlugin`;
   - `withServerEffectDiscovery`;
   - `pluginSafetyWarning`;
   - production warning-prefix parsing.
5. Add tests that fail on extraction flow id checks:
   - `adapter.id === "next"`;
   - `adapter.id === "router"`;
   - `routerAdapter.id ===`.

Acceptance criteria:

- New architecture tests fail against the old monolithic SPI and pass against
  the consolidated capability implementation.

### Step 4 - Update focused behavioral tests

Files to edit:

- `src/extract/engine/navigation-adapter-fit.test.ts`
- `src/cli/registry/index.test.ts`
- `test/extraction/next-module-boundaries.test.ts`
- `src/extract/sources/next/cache.test.ts`
- `src/extract/sources/next/module-roles.test.ts`
- `src/extract/sources/router/server-effects.test.ts`
- `src/cli/features/extract/command.test.ts`
- `test/harness/replay.test.ts`
- `test/harness/jsdom-replay.test.ts`

Implementation:

1. Ensure navigation fit tests use separate fake providers:
   - navigation;
   - module-role;
   - effect API;
   - cache/storage;
   - observation.
2. Ensure registry tests validate every capability independently.
3. Ensure Next module-boundary tests assert `ModuleRoleAdapter` behavior.
4. Ensure Next cache tests assert `CacheStorageProvider` behavior.
5. Ensure command tests assert provenance labels and structured caveats.
6. Ensure replay tests assert observation provider behavior and missing
   observation blocking.

Acceptance criteria:

- Tests prove built-in adapters satisfy public contracts, not private CLI
  assumptions.

### Step 5 - Delete obsolete compatibility paths

Files to edit:

- `src/extract/sources/router/index.ts`
- any files found by search

Implementation:

1. Delete `routerSource` export if still present.
2. Delete `withServerEffectDiscovery` if still present.
3. Delete `pluginSafetyWarning` if still present.
4. Remove remaining active references to `RouterPlugin`.
5. Remove remaining id-based Next/Router special cases in extraction flow.
6. Remove remaining production parsing of `"Global taint "` or equivalent
   warning prefixes.
7. If a remaining hit is only in a closed historical plan, leave it alone and
   document that architecture tests exclude closed plans.

Acceptance criteria:

- Searches listed in verification return no active source/test/doc hits, except
  intentionally excluded historical plans or generated docs.

## 7. Per-Step Files to Edit

- Step 1: `docs/architecture/state-sources.md`,
  `docs/architecture/navigation.md`,
  `docs/architecture/type-library-adapters.md`,
  `docs/architecture/conformance-and-replay.md`.
- Step 2: `docs/reference/package-entry-points.md`,
  `docs/reference/schemas.md`, `docs/sources/next.md`,
  `docs/sources/router.md`, `docs/_specs/02-extraction.md`,
  `docs/_specs/05-architecture.md`.
- Step 3: `test/extraction/architecture.test.ts`.
- Step 4: focused tests listed above.
- Step 5: `src/extract/sources/router/index.ts` and files found by cleanup
  searches.

## 8. Acceptance Criteria

- Active docs/specs describe the consolidated adapter SPI accurately.
- Architecture tests enforce engine and CLI import boundaries.
- Architecture tests prevent adapter-id branching in extraction flow.
- `RouterPlugin`, `routerSource`, `withServerEffectDiscovery`, and
  `pluginSafetyWarning` are gone from active code/tests/docs.
- Production warning-prefix parsing is gone.
- Built-in adapters are tested through public capability contracts.
- Generated docs and `dist/` remain untouched.

## 9. Tests to Add or Update

- `test/extraction/architecture.test.ts`
  - import boundary rules;
  - obsolete-name searches;
  - id-branch searches;
  - warning-prefix parsing searches.
- `src/extract/engine/navigation-adapter-fit.test.ts`
  - separate fake providers for each capability.
- `src/cli/registry/index.test.ts`
  - bundle shape and provider validation.
- `test/extraction/next-module-boundaries.test.ts`
  - Next module-role provider integration.
- `src/extract/sources/next/cache.test.ts`
  - cache provider contract.
- `src/extract/sources/next/module-roles.test.ts`
  - Next module-role provider contract.
- `src/extract/sources/router/server-effects.test.ts`
  - React Router effect API provider contract.
- `src/cli/features/extract/command.test.ts`
  - final report/provenance/caveat assertions.
- `test/harness/replay.test.ts` and `test/harness/jsdom-replay.test.ts`
  - observation provider replay behavior.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run test/extraction/architecture.test.ts
rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts
rtk pnpm vitest run src/cli/registry/index.test.ts
rtk pnpm vitest run test/extraction/next-module-boundaries.test.ts
rtk pnpm vitest run src/extract/sources/next/cache.test.ts
rtk pnpm vitest run src/extract/sources/next/module-roles.test.ts
rtk pnpm vitest run src/extract/sources/router/server-effects.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run test/harness/replay.test.ts test/harness/jsdom-replay.test.ts
rtk pnpm architecture
rtk pnpm test
rtk pnpm fix
rtk grep -n "RouterPlugin|routerSource|withServerEffectDiscovery|pluginSafetyWarning|adapter\\.id ===|routerAdapter\\.id ===|Global taint " src test docs --exclude-dir=docs/build --exclude-dir=.cursor/plans/closed
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if a public entry point still needs an old export for an
  active doc/test path. Delete the compatibility path and update the consumer
  instead of preserving the alias.
- Stop and report if an architecture test would require parsing TypeScript in a
  brittle way. Prefer focused source-text searches for forbidden import/id
  patterns unless the repo already has a better architecture-test helper.
- Stop and report if docs reveal an implemented behavior that does not match
  the intended SPI split. Fix the implementation or narrow the docs; do not
  paper over the mismatch.

## 12. Must Not Change

- Do not loosen architecture rules.
- Do not edit generated `docs/build/` or `dist/`.
- Do not add compatibility aliases.
- Do not introduce new adapter-id branches.
