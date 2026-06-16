# Refactor Zod/ArkType Domain Adapters Out of Numeric Engine

## Goal

Move Zod- and ArkType-specific domain refinement code out of `src/extract/engine/ts/numeric/` into dedicated type-library adapter slices under `src/extract/type-libraries/`, while preserving current behavior:

- Zod and ArkType inferred TypeScript types still flow through semantic `ts.Type` mapping for non-numerical domains.
- Zod and ArkType schema initializer chains still refine finite numeric bounds when TypeScript erases those bounds.
- Native modality numeric aliases remain engine-owned numeric support.
- The extraction engine must not import type-library adapter implementations.
- `src/extract/sources/` remains reserved for state providers.

The target architecture is:

```text
src/extract/engine
  defines DomainRefinementProvider SPI + resolver orchestration
  owns native numeric aliases
  never imports zod/arktype adapter slices

src/extract/type-libraries/zod
  owns Zod-specific schema AST recognition

src/extract/type-libraries/arktype
  owns ArkType-specific schema AST recognition

src/cli/registry
  wires built-in domain refinement providers into extraction
```

## Non-goals

- Do not implement a full Zod or ArkType interpreter.
- Do not add runtime dependencies on `zod` or `arktype`; these providers should keep using static TypeScript AST/type information.
- Do not change `AbstractDomain` or checker semantics.
- Do not move native branded numeric aliases out of the engine.
- Do not put state-source responsibilities, write channels, harnesses, or templates into Zod/ArkType providers.
- Do not place Zod/ArkType adapters under `src/extract/sources/`; that directory is only for state providers.
- Do not update generated `dist/` artifacts.
- Do not weaken dependency-cruiser boundaries by allowing engine-to-sources imports.

## Current-state Findings

- Zod and ArkType adapter files currently live in:
  - `src/extract/engine/ts/numeric/adapters/zod.ts`
  - `src/extract/engine/ts/numeric/adapters/arktype.ts`
- The numeric resolver currently imports these adapters directly from:
  - `src/extract/engine/ts/numeric/resolver.ts`
- Semantic type mapping calls the numeric resolver from:
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/ts/type-domains.ts`
- Current docs already describe Zod/ArkType as schema adapters/refinement providers, but the code still places them under `numeric`.
- `tools/depcruise.config.cjs` already forbids `src/extract/engine` importing `src/extract/sources`; a similar boundary should exist for the new `src/extract/type-libraries` directory.
- `src/extract/sources/*` is for state providers only; Zod/ArkType are type-library domain refinement providers and should live under `src/extract/type-libraries/*`.
- The CLI registry currently wires state sources and router adapters, but not domain-refinement providers:
  - `src/cli/registry/index.ts`
- `PluginProvenance.kind` currently supports only `"state-source" | "router"`:
  - `src/core/ir/types.ts`
- Tests currently assert Zod/ArkType numeric behavior in:
  - `test/extract/numeric-domain-resolver.test.ts`
- End-to-end non-numerical Zod/ArkType tests exist in:
  - `src/cli/features/extract/command.test.ts`

## Exact File Paths and Relevant Symbols

- `src/extract/engine/spi/index.ts`
  - Add `DomainRefinementProvider`
  - Add `DomainRefinementContext`
  - Add `DomainRefinementResolution`
  - Thread provider arrays through extraction contexts if needed
- `src/extract/engine/ts/numeric/resolver.ts`
  - Remove Zod/ArkType imports
  - Either delete or narrow to native numeric helpers only
- `src/extract/engine/ts/numeric/adapters/zod.ts`
  - Move to `src/extract/type-libraries/zod/domains.ts`
- `src/extract/engine/ts/numeric/adapters/arktype.ts`
  - Move to `src/extract/type-libraries/arktype/domains.ts`
- `src/extract/engine/ts/domain-refinements.ts`
  - New engine-owned resolver orchestration module
- `src/extract/engine/ts/domains.ts`
  - Replace `resolveNumericDomain` calls with generic refinement resolution
- `src/extract/engine/ts/type-domains.ts`
  - Replace `resolveNumericDomain` calls with generic refinement resolution
- `src/extract/engine/ts/react-source-transitions.ts`
  - Accept/pass domain refinement providers to useState inference
- `src/extract/engine/pipeline/index.ts`
  - Accept/pass domain refinement providers to plugins and generic React extraction
- `src/extract/sources/use-state/index.ts`
  - Pass providers from `DiscoverCtx` into shared domain inference
- `src/extract/sources/jotai/domains.ts`
  - Pass providers into shared domain inference where type/initializer domains are inferred
- `src/extract/sources/zustand/domains.ts`
  - Pass providers into shared domain inference where field domains are inferred
- `src/extract/sources/swr/domains.ts`
  - Pass providers into payload domain inference if applicable
- `src/cli/registry/index.ts`
  - Register built-in Zod/ArkType domain refinement providers
- `src/cli/features/extract/command.ts`
  - Thread registry domain refinement providers into `runExtractionPipeline`
- `package.json`
  - Add public subpath exports if Zod/ArkType providers are intended to be public
- `tsconfig.base.json`
  - Add paths for new public subpaths if exported
- `vitest.config.ts`
  - Add aliases for new public subpaths if tests import them by package name
- `tools/depcruise.config.cjs`
  - Ideally no change; only change if a new provider category needs explicit rules

## Existing Patterns to Follow

- State providers live under `src/extract/sources/<library>/`; do not add type-library adapters there.
- Type-library adapters should live under `src/extract/type-libraries/<library>/`.
- The engine defines contracts; the CLI registry wires built-ins.
- Type-library adapter slices may import `modality-ts/extract/engine/spi` and narrowly shared engine helpers, but the engine must not import adapter slices.
- Built-ins are enabled by package dependency presence via `packageNames`.
- Extraction metadata should identify code that influenced the model.
- Existing direct tests should be split by ownership:
  - engine tests for native numeric aliases and generic resolver orchestration
  - Zod tests under source/provider ownership
  - ArkType tests under source/provider ownership
  - CLI extraction tests for end-to-end behavior

## Atomic Implementation Steps

1. Define a generic domain-refinement provider contract.
   - In `src/extract/engine/spi/index.ts`, add:
     - `DomainRefinementContext`
     - `DomainRefinementResolution`
     - `DomainRefinementProvider`
   - Suggested shape:
     ```ts
     export interface DomainRefinementContext {
       typeNode?: ts.TypeNode;
       initializer?: ts.Expression;
       declaration?: ts.VariableDeclaration;
       sourceFile?: ts.SourceFile;
       typeAliases: ReadonlyMap<string, ts.TypeNode>;
       visited: ReadonlySet<string>;
       varId?: string;
     }

     export interface DomainRefinementResolution {
       domain?: AbstractDomain;
       caveats: ExtractionCaveat[];
       reductions?: NumericReduction[];
     }

     export interface DomainRefinementProvider {
       id: string;
       version?: string;
       packageNames: readonly string[];
       refineDomain(
         ctx: DomainRefinementContext,
       ): DomainRefinementResolution | undefined;
     }
     ```
   - Import `ExtractionCaveat` and `NumericReduction` types from `modality-ts/core`.
   - Add optional `domainRefinements?: readonly DomainRefinementProvider[]` to `DiscoverCtx`, `TypeCtx`, `ChannelCtx`, and `ExtractCtx`.

2. Add an engine-owned refinement orchestration module.
   - Create `src/extract/engine/ts/domain-refinements.ts`.
   - Move shared helpers from numeric resolver if they are generic:
     - `sourceAnchorFromNode`
   - Keep `emptyDomainRefinementResolution`.
   - Implement `resolveDomainRefinements(ctx, providers)`:
     - Always try native numeric aliases first via `resolveNativeNumericAlias`.
     - Then try each passed `DomainRefinementProvider`.
     - Return the first result with `domain` or caveats.
     - Return `{ caveats: [] }` otherwise.
   - This file may import `./numeric/native-aliases.js`, but must not import Zod/ArkType type-library adapter slices.

3. Narrow or remove the old numeric resolver.
   - In `src/extract/engine/ts/numeric/resolver.ts`, remove imports of `./adapters/zod.js` and `./adapters/arktype.js`.
   - Prefer deleting this file if all useful shared symbols move to `domain-refinements.ts`.
   - If keeping it, make it native-numeric-only and rename exported symbols to avoid implying schema ownership.
   - Update imports across the engine from `resolveNumericDomain` to `resolveDomainRefinements`.

4. Move Zod adapter code into a type-library adapter slice.
   - Create:
     - `src/extract/type-libraries/zod/domains.ts`
     - `src/extract/type-libraries/zod/index.ts`
   - Move logic from `src/extract/engine/ts/numeric/adapters/zod.ts`.
   - Rename `resolveZodNumericSchema` to something provider-owned, for example `zodDomainRefinementProvider` plus private `resolveZodNumericSchema`.
   - Export a factory:
     ```ts
     export function zodDomainRefinementProvider(): DomainRefinementProvider
     ```
   - Keep all Zod-specific AST grammar code private to this adapter slice.
   - Do not add a harness file.

5. Move ArkType adapter code into a type-library adapter slice.
   - Create:
     - `src/extract/type-libraries/arktype/domains.ts`
     - `src/extract/type-libraries/arktype/index.ts`
   - Move logic from `src/extract/engine/ts/numeric/adapters/arktype.ts`.
   - Rename `resolveArktypeNumericSchema` to something provider-owned, for example `arktypeDomainRefinementProvider` plus private `resolveArktypeNumericSchema`.
   - Export a factory:
     ```ts
     export function arktypeDomainRefinementProvider(): DomainRefinementProvider
     ```
   - Keep ArkType-specific grammar code private to this adapter slice.
   - Do not add a harness file.

6. Thread providers through domain inference APIs.
   - Extend `DomainInferenceContext` in `src/extract/engine/ts/domains.ts` with:
     - `domainRefinements?: readonly DomainRefinementProvider[]`
   - Extend `TypeDomainInferenceContext` in `src/extract/engine/ts/type-domains.ts` with the same field.
   - Update every current `resolveNumericDomain(...)` call to `resolveDomainRefinements(..., ctx.domainRefinements ?? [])`.
   - Preserve existing behavior when no providers are passed:
     - native numeric aliases still work
     - Zod/ArkType initializer refinement does not run unless providers are present
   - Preserve existing semantic mapping behavior for non-numerical Zod/ArkType inferred types; that path does not require provider AST parsing.

7. Thread providers through extraction.
   - Add `domainRefinements?: readonly DomainRefinementProvider[]` to `ExtractionPipelineOptions`.
   - In `runExtractionPipeline`, pass providers into:
     - `plugin.discover`
     - `plugin.writeChannels`
     - `plugin.safetyWarnings`
     - `plugin.extract`
     - `extractReactSourceTransitions`
   - In `extractReactSourceTransitions`, pass providers into `inferUseStateDomainSemanticDetailed`.
   - In source plugins that call shared domain inference directly, pass `ctx.domainRefinements`:
     - `use-state`
     - `jotai`
     - `zustand`
     - `swr` if relevant

8. Wire built-in providers in the CLI registry.
   - In `src/cli/registry/index.ts`, import:
     - `zodDomainRefinementProvider` from `modality-ts/extract/type-libraries/zod`
     - `arktypeDomainRefinementProvider` from `modality-ts/extract/type-libraries/arktype`
   - Extend `ModalityPluginRegistry`, `BuiltinRegistryOptions`, and `RegistrySummary` with `domainRefinementProviders`.
   - Enable providers using the same dependency-gated pattern as state sources:
     - `zod` provider when app has `zod`
     - `arktype` provider when app has `arktype`
     - when dependencies are unknown, enable built-ins by default, matching current state-source behavior
   - Respect `disabledPlugins` for `zod` and `arktype`.
   - Add optional `extraDomainRefinementProviders` for future out-of-tree providers.

9. Pass registry providers into extraction command.
   - In `src/cli/features/extract/command.ts`, pass `registry.domainRefinementProviders` into `runProjectExtractionPipeline`.
   - Extend `runProjectExtractionPipeline` options and calls accordingly.
   - If `ModalityConfig` or `ExtractCommandOptions` should support custom providers, add a separate `domainRefinements` field rather than overloading `plugins`, because these providers are not `StateSourcePlugin`s.

10. Decide and implement provenance.
   - Prefer extending `src/core/ir/types.ts`:
     - `PluginProvenance.kind: "state-source" | "router" | "domain-refinement"`
   - Include domain-refinement providers in registry `plugins` and model metadata.
   - Update report/trust-ledger tests that assert plugin lists.
   - If this creates too much blast radius, stop and report before omitting provenance; schema/domain providers influence extracted domains and should be visible somewhere.

11. Update public entry points for Zod/ArkType providers.
   - Add package exports for:
     - `./extract/type-libraries/zod`
     - `./extract/type-libraries/arktype`
   - Do not add `/harness` exports for these providers.
   - Add matching `tsconfig.base.json` path aliases.
   - Add matching `vitest.config.ts` aliases if tests import by package subpath.
   - Update architecture tests so source-slice harness expectations remain scoped to `src/extract/sources/*` only.

12. Move and rename tests by ownership.
   - Keep native alias and numeric literal tests in `test/extract/numeric-domain-resolver.test.ts`.
   - Move Zod-specific numeric schema adapter tests to a new file:
     - `test/extract/type-libraries/zod-domain-refinement.test.ts`
   - Move ArkType-specific numeric schema adapter tests to a new file:
     - `test/extract/type-libraries/arktype-domain-refinement.test.ts`
   - Update tests to invoke provider factories and `resolveDomainRefinements`, or run extraction with registry-provided providers.
   - Keep end-to-end non-numerical extraction tests in `src/cli/features/extract/command.test.ts`.

13. Update documentation.
   - Add or update docs for type-library adapters separately from state sources.
   - Do not describe Zod/ArkType adapters as state sources.
   - Suggested new doc: `docs/architecture/type-library-adapters.md`.
   - Update `docs/architecture/extraction-pipeline.md` P2 wording to say schema providers are wired through the registry, not embedded in the numeric engine.
   - Update `docs/concepts/state-and-domains.md` to remove references implying Zod/ArkType are numeric-engine adapters.
   - Update `docs/reference/package-entry-points.md` if public Zod/ArkType subpaths are added.
   - Update `docs/intro/index.md` and `docs/sources/react-features.md` if they still describe schema support as numeric-only.

14. Delete old adapter directory once all imports are gone.
   - Delete:
     - `src/extract/engine/ts/numeric/adapters/zod.ts`
     - `src/extract/engine/ts/numeric/adapters/arktype.ts`
   - Delete `src/extract/engine/ts/numeric/adapters/` if empty.
   - Run `rtk rg -n "numeric/adapters|resolveZodNumericSchema|resolveArktypeNumericSchema|resolveNumericDomain" src test docs` and ensure remaining references are intentional.

## Per-step Files to Edit

- Step 1:
  - `src/extract/engine/spi/index.ts`
- Steps 2-3:
  - `src/extract/engine/ts/domain-refinements.ts`
  - `src/extract/engine/ts/numeric/resolver.ts`
  - `src/extract/engine/ts/numeric/native-aliases.ts`
- Steps 4-5:
  - `src/extract/type-libraries/zod/domains.ts`
  - `src/extract/type-libraries/zod/index.ts`
  - `src/extract/type-libraries/arktype/domains.ts`
  - `src/extract/type-libraries/arktype/index.ts`
- Steps 6-7:
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/ts/type-domains.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/pipeline/index.ts`
  - `src/extract/sources/use-state/index.ts`
  - `src/extract/sources/jotai/domains.ts`
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/zustand/domains.ts`
  - `src/extract/sources/zustand/discover.ts`
  - `src/extract/sources/swr/domains.ts`
  - `src/extract/sources/swr/discover.ts`
- Steps 8-10:
  - `src/cli/registry/index.ts`
  - `src/cli/registry/index.test.ts`
  - `src/cli/features/extract/command.ts`
  - `src/core/ir/types.ts`
  - `src/core/report/types.ts`
- Step 11:
  - `package.json`
  - `tsconfig.base.json`
  - `vitest.config.ts`
  - `test/extraction/architecture.test.ts`
- Step 12:
  - `test/extract/numeric-domain-resolver.test.ts`
  - `test/extract/type-libraries/zod-domain-refinement.test.ts`
  - `test/extract/type-libraries/arktype-domain-refinement.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - `test/modality/registry.test.ts`
- Step 13:
  - `docs/architecture/type-library-adapters.md`
  - `docs/architecture/extraction-pipeline.md`
  - `docs/concepts/state-and-domains.md`
  - `docs/reference/package-entry-points.md`
  - `docs/intro/index.md`
  - `docs/sources/react-features.md`
- Step 14:
  - delete old adapter files under `src/extract/engine/ts/numeric/adapters/`

## Acceptance Criteria

- No file under `src/extract/engine` imports from `src/extract/type-libraries`.
- No Zod/ArkType adapter code is placed under `src/extract/sources`.
- No Zod- or ArkType-specific code remains under `src/extract/engine/ts/numeric`.
- Native numeric aliases still work without any registered provider.
- Zod bounded integer schema initializer refinement works only when the Zod domain-refinement provider is wired in.
- ArkType bounded integer schema initializer refinement works only when the ArkType domain-refinement provider is wired in.
- Zod/ArkType non-numerical inferred types still extract through semantic TypeScript mapping.
- Disabling `zod` or `arktype` through existing disabled-plugin mechanisms prevents that provider’s schema initializer refinement.
- Model/report provenance includes domain-refinement providers, or the implementation explicitly reports why provenance was deferred.
- `pnpm architecture` passes without relaxing the engine-to-sources boundary.

## Tests to Add or Update

- Add `test/extract/type-libraries/zod-domain-refinement.test.ts`:
  - provider resolves `z.number().int().min(0).max(3)` to `boundedInt`.
  - provider emits caveat for dynamic bounds.
  - provider abstains for `z.string()` without caveats.
  - provider is not required for semantic `z.infer` non-numerical extraction.
- Add `test/extract/type-libraries/arktype-domain-refinement.test.ts`:
  - provider resolves `type("0 <= number.integer <= 3")` to `boundedInt`.
  - provider emits caveat for unsupported `number.integer` grammar.
  - provider abstains for non-ArkType expressions.
- Update `test/extract/numeric-domain-resolver.test.ts`:
  - keep native aliases, numeric literal unions, bare number, numeric initializers.
  - remove direct Zod/ArkType expectations from engine-only tests.
- Update `src/cli/features/extract/command.test.ts`:
  - assert Zod/ArkType initializer refinements still work through `runExtractCommand`.
  - assert disabling `zod`/`arktype` removes initializer-chain refinement while semantic inferred-type extraction still works when the TypeScript type is explicit and finite.
- Update `test/modality/registry.test.ts`:
  - domain refinement providers are auto-enabled by dependencies.
  - disabled providers are omitted.
  - registry plugin provenance includes `domain-refinement` entries.
- Update `test/extraction/architecture.test.ts`:
  - engine does not import type-library adapters.
  - source package export test remains state-provider-only.
  - type-library adapter export tests are separate from source harness export tests.

## Verification Commands

- `rtk pnpm vitest run test/extract/type-libraries/zod-domain-refinement.test.ts`
- `rtk pnpm vitest run test/extract/type-libraries/arktype-domain-refinement.test.ts`
- `rtk pnpm vitest run test/extract/numeric-domain-resolver.test.ts`
- `rtk pnpm vitest run test/extract/semantic-domain-resolver.test.ts`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run test/modality/registry.test.ts`
- `rtk pnpm vitest run test/extraction/architecture.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm fix`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if an implementation requires `src/extract/engine` to import `src/extract/type-libraries/zod` or `src/extract/type-libraries/arktype`; the engine must depend only on the provider SPI.
- Stop and report if Zod/ArkType adapters are placed under `src/extract/sources`; that directory is reserved for state providers.
- Stop and report if provider threading requires global mutable registries. Prefer explicit provider arrays through pipeline/context objects.
- Stop and report if provenance expansion to `PluginProvenance.kind` causes unexpected artifact/parser or report breakage beyond straightforward additive updates.
- Stop and report if package export tests conflate `src/extract/sources/*` state providers with `src/extract/type-libraries/*` adapters.
- Do not preserve old direct Zod/ArkType behavior in engine-only unit tests by adding default source imports back into the engine.
- Do not move Zod/ArkType under `src/extract/sources/shared`; `src/extract/sources` is not the right ownership boundary for type-library adapters.
- Do not add `zod` or `arktype` to runtime dependencies. The providers should inspect syntax and TypeScript types, matching the current implementation style.
