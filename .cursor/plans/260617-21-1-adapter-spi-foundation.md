# Adapter SPI Consolidation 1: Foundation and RouterPlugin Removal

## Goal

Prepare the adapter SPI for capability-based consolidation by adding shared adapter primitives, making navigation lowering result types explicit, and deleting the deprecated `RouterPlugin` alias everywhere.

This is the first slice of `.cursor/plans/260617-21-adapter-spi-consolidation.md`. Keep this plan focused on type foundation and the compatibility-name removal only.

## Non-goals

- Do not split module-role, effect API, cache/storage, or observation capabilities in this plan.
- Do not change extraction semantics.
- Do not add new built-in adapters.
- Do not preserve `RouterPlugin` as an alias, deprecated export, compatibility type, or doc concept.
- Do not edit generated `dist/` artifacts.
- Do not loosen architecture rules.

## Current-state Findings

- `src/extract/engine/spi/index.ts` defines the central SPI and currently exports `RouterPlugin` as a deprecated alias for `NavigationAdapter`.
- `NavigationAdapter.lowerNavigation` currently uses an inline object result shape, which makes later capability splitting harder to describe and validate.
- `StateSourcePlugin.safetyWarnings` returns `ExtractionWarning[]`, but related docs still show `ExtractionCaveat[]`.
- Several source, engine, CLI, test, and doc files still import or mention `RouterPlugin`.

## Exact File Paths and Relevant Symbols

- `src/extract/engine/spi/index.ts`
  - `NavigationAdapter`
  - `RouterPlugin`
  - `ExtractionWarning`
  - `NavIntent`
  - `RouteInventory`
  - `ResolvedOptions`
  - `LocationLowering`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runExtractionPipeline`
  - `provenanceForRouter`
- `src/cli/features/extract/command.ts`
  - `ModalityConfig`
  - `ExtractCommandOptions`
  - `runProjectExtractionPipeline`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/transition/handlers.ts`
- `src/extract/sources/jotai/transitions.ts`
- `src/extract/sources/swr/transitions.ts`
- `src/extract/sources/zustand/transitions.ts`
- `test/extraction/architecture.test.ts`
- `test/extraction/extraction.test.ts`
- Docs under `docs/`

## Existing Patterns to Follow

- Keep public SPI contracts in `src/extract/engine/spi/index.ts`.
- Keep built-in registration and dependency probing outside the extraction engine.
- Prefer explicit exported interfaces over inline object shapes when a shape crosses adapter boundaries.
- Use strict TypeScript and NodeNext ESM imports.
- Prefer deleting compatibility names over preserving aliases.

## Atomic Implementation Steps

1. Add a shared adapter base.
   - Edit `src/extract/engine/spi/index.ts`.
   - Add:
     ```ts
     export interface ModalityAdapterBase {
       id: string;
       version?: string;
       packageNames: readonly string[];
     }
     ```
   - Do not force every existing interface to extend it yet unless the diff is tiny and mechanical.

2. Add explicit navigation lowering types.
   - In the same SPI file, add `NavigationLoweringCtx` and `NavigationLoweringResult`.
   - Replace the inline `lowerNavigation` return object on `NavigationAdapter` with `NavigationLoweringResult`.
   - Keep the fields exactly equivalent to the current inline result unless a name is already established locally.

3. Prepare structured warning shape without behavioral migration.
   - Update `ExtractionWarning` to allow future structured metadata:
     - `caveat?: ExtractionCaveat`
     - `confidence?: Transition["confidence"]`
     - `producer?: { kind: string; id: string }`
   - Keep `message` and existing behavior valid for now.
   - Import only the required core IR types.

4. Delete the `RouterPlugin` alias.
   - Remove `export type RouterPlugin = NavigationAdapter`.
   - Replace all `RouterPlugin` imports and type annotations with `NavigationAdapter`.
   - Do not add a replacement alias.

5. Update docs and tests that mention the alias.
   - Replace `RouterPlugin` wording with `NavigationAdapter` where the document is still about navigation.
   - If a doc section is describing broader framework behavior, add a short TODO-style statement that later plans split those responsibilities into separate capabilities.
   - Keep this doc change minimal so later plans can rewrite the architecture text.

6. Add or update an architecture assertion.
   - In `test/extraction/architecture.test.ts`, ensure no source/test/doc file imports `RouterPlugin`.
   - If the existing test already scans for old names, extend it instead of adding a duplicate scanner.
   - Historical closed plans may be excluded if existing architecture tests already exclude `.cursor/plans/closed`.

## Per-step Files to Edit

- Steps 1-3:
  - `src/extract/engine/spi/index.ts`
- Step 4:
  - `src/cli/features/extract/command.ts`
  - `src/extract/engine/pipeline/index.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/ts/transition/handlers.ts`
  - `src/extract/sources/jotai/transitions.ts`
  - `src/extract/sources/swr/transitions.ts`
  - `src/extract/sources/zustand/transitions.ts`
  - `test/extraction/extraction.test.ts`
- Steps 5-6:
  - `docs/architecture/navigation.md`
  - `docs/architecture/state-sources.md`
  - `docs/_specs/02-extraction.md`
  - `docs/_specs/05-architecture.md`
  - `test/extraction/architecture.test.ts`

## Acceptance Criteria

- `RouterPlugin` is removed from source, tests, and active docs.
- No compatibility export or alias for `RouterPlugin` remains.
- `NavigationAdapter.lowerNavigation` uses an exported `NavigationLoweringResult`.
- The SPI exposes a reusable `ModalityAdapterBase`.
- `ExtractionWarning` can carry structured caveat, confidence, and producer metadata without forcing all producers to migrate in this slice.
- Existing extraction behavior remains unchanged.

## Tests to Add or Update

- `test/extraction/architecture.test.ts`
  - Add or update a test that fails on `RouterPlugin` imports/usages outside intentionally excluded historical plans.
- Existing tests that compile fake adapters:
  - Update type names from `RouterPlugin` to `NavigationAdapter`.
  - Update fake `lowerNavigation` implementations only if needed for the new result type.

## Verification Commands

- `rtk rg -n "RouterPlugin" src test docs`
- `rtk pnpm vitest run test/extraction/architecture.test.ts`
- `rtk pnpm vitest run test/extraction/extraction.test.ts`
- `rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm typecheck`
- `rtk git diff --check`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if deleting `RouterPlugin` reveals a public package export that must be intentionally removed from an entry-point test.
- Stop and report if adding structured warning fields creates circular imports between core IR and extraction SPI.
- Do not start moving module-role or effect API methods in this plan; leave them for the next split.
- Do not convert warning-string parsing in this plan unless it is required by typecheck.
