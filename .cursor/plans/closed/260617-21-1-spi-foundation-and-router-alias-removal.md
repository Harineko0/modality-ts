# SPI Foundation and Router Alias Removal

Status: implementation plan.
Date: 2026-06-17.
Plan family: C - Adapter SPI Consolidation.
Split sequence: 260617-21-1.

## 1. Goal

Prepare the adapter SPI for capability splitting by tightening the shared
contract surface and deleting the deprecated `RouterPlugin` alias everywhere.

The intended end state of this plan is:

- common adapter identity lives in a reusable `ModalityAdapterBase`;
- navigation lowering uses named context/result types instead of inline object
  shapes;
- `ExtractionWarning` can carry structured metadata without requiring later
  warning-message parsing;
- every source, test, and doc that currently names `RouterPlugin` has moved to
  `NavigationAdapter`;
- behavior stays equivalent while the type surface becomes explicit enough for
  later plans to split module roles, effect APIs, cache/storage, and replay
  observation.

## 2. Non-goals

- Do not split `NavigationAdapter` capabilities in this plan. That belongs in
  `260617-21-2-module-role-and-effect-api-capabilities.md`.
- Do not add cache/storage providers in this plan.
- Do not migrate replay harness observation in this plan.
- Do not change checker semantics, route discovery behavior, navigation
  lowering behavior, or source plugin extraction behavior.
- Do not keep `RouterPlugin` as a compatibility export.
- Do not edit generated `dist/` or `docs/build/` artifacts.

## 3. Current-State Findings

- `src/extract/engine/spi/index.ts` defines `NavigationAdapter` and exports
  `RouterPlugin` as a deprecated alias.
- `NavigationAdapter.lowerNavigation()` currently accepts and returns inline
  object types.
- `ExtractionWarning` currently has only `message` and optional `source`, while
  downstream code already has `ExtractionCaveat` and transition `confidence`
  concepts.
- `RouterPlugin` appears in extraction engine options, source adapter transition
  options, CLI config types, tests, and docs.
- Existing source adapters still use a `routerPlugin` option name. This plan may
  keep the option property name where changing it would cause unrelated churn,
  but the type must be `NavigationAdapter`.

## 4. Exact File Paths and Relevant Symbols

Primary files:

- `src/extract/engine/spi/index.ts`
  - `ExtractionWarning`
  - `StateSourcePlugin`
  - `NavigationAdapter`
  - `RouterPlugin`
  - `EffectApiDiscoveryCtx`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `ExtractionPipelineRunOptions`
  - `runExtractionPipeline()`
  - `provenanceForRouter()`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `ReactSourceTransitionOptions`
  - `routerPlugin`
- `src/extract/engine/ts/transition/handlers.ts`
  - handler options that currently use `RouterPlugin`
- `src/extract/sources/jotai/transitions.ts`
- `src/extract/sources/swr/transitions.ts`
- `src/extract/sources/use-state/types.ts`
- `src/extract/sources/zustand/transitions.ts`
- `src/cli/features/extract/command.ts`
  - `ModalityConfig`
  - `ExtractCommandOptions`
  - `RunProjectExtractionPipelineOptions`
- `test/extraction/architecture.test.ts`
- `test/extraction/extraction.test.ts`
- `docs/architecture/navigation.md`
- `docs/reference/package-entry-points.md`
- `docs/sources/next.md`
- `docs/sources/router.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/05-architecture.md`

## 5. Existing Patterns to Follow

- Keep SPI contracts in `src/extract/engine/spi/index.ts`.
- Keep built-in adapter implementations under `src/extract/sources/*`; the
  engine must not import them.
- Use plain exported TypeScript interfaces for public extension contracts.
- Preserve existing runtime behavior while changing type names in this plan.
- Prefer deleting obsolete aliases over preserving compatibility.
- Leave generated docs output alone; update source Markdown only.

## 6. Atomic Implementation Steps

### Step 1 - Add common adapter and structured warning types

Files to edit:

- `src/extract/engine/spi/index.ts`
- `src/core/ir/types.ts` only if an imported provenance/producer type is needed

Implementation:

1. Add:

   ```ts
   export interface ModalityAdapterBase {
     id: string;
     version?: string;
     packageNames: readonly string[];
   }
   ```

2. Update `DomainRefinementProvider`, `StateSourcePlugin`, and
   `NavigationAdapter` to extend or structurally use `ModalityAdapterBase`.
3. Add named types for navigation lowering:

   ```ts
   export interface NavigationLoweringCtx {
     inventory: RouteInventory;
     routePatterns: readonly string[];
   }

   export interface NavigationLoweringResult {
     effect: EffectIR;
     reads: readonly string[];
     writes: readonly string[];
     confidence?: "exact" | "over-approx";
   }
   ```

4. Change `NavigationAdapter.lowerNavigation` to use those named types.
5. Extend `ExtractionWarning` with optional fields only:
   - `caveat?: ExtractionCaveat`;
   - `confidence?: "exact" | "over-approx" | "manual"`;
   - `producer?: { kind: string; id: string }`.
6. Do not require producers or caveats yet. Plan 4 makes structured caveats
   authoritative.

Acceptance criteria:

- TypeScript callers of `lowerNavigation` compile with the named types.
- Existing warning producers compile without behavior changes.

### Step 2 - Delete the `RouterPlugin` export

Files to edit:

- `src/extract/engine/spi/index.ts`

Implementation:

1. Remove the deprecated comment and `export type RouterPlugin =
   NavigationAdapter`.
2. Do not add an alias under another name.

Acceptance criteria:

- `rtk grep -n "export type RouterPlugin" src/extract/engine/spi/index.ts`
  returns no matches.

### Step 3 - Replace type imports and annotations

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/transition/handlers.ts`
- `src/extract/sources/jotai/transitions.ts`
- `src/extract/sources/swr/transitions.ts`
- `src/extract/sources/use-state/types.ts`
- `src/extract/sources/zustand/transitions.ts`
- `test/extraction/architecture.test.ts`
- `test/extraction/extraction.test.ts`

Implementation:

1. Replace imports of `RouterPlugin` with `NavigationAdapter`.
2. Replace type annotations with `NavigationAdapter`.
3. Keep variable/property names such as `routerPlugin` only where changing them
   would be unrelated API churn for this plan.
4. Do not update `NavigationAdapter` capability methods yet.

Acceptance criteria:

- No TypeScript source or test imports `RouterPlugin`.
- Existing extraction and navigation tests still exercise the same runtime paths.

### Step 4 - Update docs and specs for the alias removal

Files to edit:

- `docs/architecture/navigation.md`
- `docs/reference/package-entry-points.md`
- `docs/sources/next.md`
- `docs/sources/router.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/05-architecture.md`

Implementation:

1. Remove language that says `RouterPlugin` is an older/deprecated name.
2. Use `NavigationAdapter` for current navigation/topology extension points.
3. Where docs mention `routerPlugin` as a config property, keep it only if that
   is still the live config property name. Be explicit that its value is a
   `NavigationAdapter`.
4. Do not document module-role/effect/cache capability splitting yet; later
   plans own that content.

Acceptance criteria:

- Source docs no longer present `RouterPlugin` as a supported alias.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/spi/index.ts`; optionally
  `src/core/ir/types.ts` if needed for shared producer/provenance typing.
- Step 2: `src/extract/engine/spi/index.ts`.
- Step 3: `src/cli/features/extract/command.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/transition/handlers.ts`,
  `src/extract/sources/jotai/transitions.ts`,
  `src/extract/sources/swr/transitions.ts`,
  `src/extract/sources/use-state/types.ts`,
  `src/extract/sources/zustand/transitions.ts`,
  `test/extraction/architecture.test.ts`,
  `test/extraction/extraction.test.ts`.
- Step 4: `docs/architecture/navigation.md`,
  `docs/reference/package-entry-points.md`, `docs/sources/next.md`,
  `docs/sources/router.md`, `docs/_specs/02-extraction.md`,
  `docs/_specs/05-architecture.md`.

## 8. Acceptance Criteria

- `RouterPlugin` is absent from `src/`, `test/`, and source `docs/`.
- `NavigationAdapter` uses `NavigationLoweringCtx` and
  `NavigationLoweringResult`.
- `ExtractionWarning` can carry an optional structured caveat, confidence, and
  producer without forcing any behavior changes.
- Existing navigation adapter behavior is unchanged.
- No generated artifacts are edited.

## 9. Tests to Add or Update

- Update `test/extraction/architecture.test.ts` type fixtures to use
  `NavigationAdapter`.
- Update `test/extraction/extraction.test.ts` fixtures that currently import
  `RouterPlugin`.
- Update any compile-time fixture comments in `src/cli/registry/index.test.ts`
  if they mention legacy router plugins.
- Add a small type-level assertion in `src/extract/engine/navigation-adapter-fit.test.ts`
  only if the named lowering types need direct coverage.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts test/extraction/extraction.test.ts
rtk grep -n "RouterPlugin" src test docs --exclude-dir=docs/build
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if any public package entry point depends on `RouterPlugin`
  in a way that cannot be deleted without also changing generated package
  exports. Do not preserve the alias; identify the required package export
  update.
- Stop and report if structured warning fields require schema or reporter
  changes beyond optional typing. That work belongs in plan 4.
- Stop and report if renaming the `routerPlugin` config property is required to
  typecheck. This plan should not rename config keys unless the implementation
  has already removed the old key in the same coherent diff.

## 12. Must Not Change

- Do not split `NavigationAdapter` methods yet.
- Do not change built-in adapter registration behavior.
- Do not change extraction output, transition ids, state var ids, confidence, or
  caveat contents.
- Do not edit `dist/` or `docs/build/`.
