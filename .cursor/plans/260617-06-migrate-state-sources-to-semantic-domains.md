# Part 3 of 4: Migrate State Sources to Semantic Domains

## Goal

Switch React `useState`, generic React extraction, and built-in state-source plugins to use the semantic TypeScript domain mapper when a `TypeChecker` is available. Existing AST-based inference remains the fallback for unit tests and synthetic plugin usage without semantic context.

## Non-goals

- Do not change source discovery semantics beyond domain inference.
- Do not change write-channel discovery, escape analysis, or transition summarization.
- Do not change SWR/Jotai/Zustand templates except where their state variable domains improve.
- Do not remove AST fallback APIs in this part.
- Do not introduce field pruning.

## Current-State Findings

- Generic React extraction discovers `useState` in `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts` and uses `inferUseStateDomainDetailed`.
- Built-in `use-state` source plugin in `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts` duplicates `useState` discovery and uses the same AST-based API.
- Jotai domain inference in `/Users/hari/proj/modality-ts/src/extract/sources/jotai/domains.ts` uses `inferDomainFromTypeNode` and initializer AST heuristics.
- Zustand field inference in `/Users/hari/proj/modality-ts/src/extract/sources/zustand/domains.ts` uses `inferDomainFromTypeNodeDetailed`.
- SWR payload inference in `/Users/hari/proj/modality-ts/src/extract/sources/swr/domains.ts` only accepts a type node and local alias map.
- Pipeline plugin contexts currently pass text-only discovery and channel contexts unless Part 1 has already added optional semantic context.

## Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `ReactExtractionOptions`
  - `inferUseStateDomainDetailed` call around useState discovery
  - `initialValueForUseStateDetailed`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/components.ts`
  - custom hook/useState helper paths using `inferUseStateDomainDetailed`
- `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`
  - `discoverUseState`
  - `discoverUseStateWriteChannels`
- `/Users/hari/proj/modality-ts/src/extract/sources/jotai/discover.ts`
  - `jotaiSource().discover`
  - `classifyAtomCall`
- `/Users/hari/proj/modality-ts/src/extract/sources/jotai/domains.ts`
  - `classifyAtomCall`
  - `inferAtomDomain`
  - `initialValueForAtom`
- `/Users/hari/proj/modality-ts/src/extract/sources/zustand/discover.ts`
  - `zustandSource().discover`
- `/Users/hari/proj/modality-ts/src/extract/sources/zustand/domains.ts`
  - `inferFieldDomain`
- `/Users/hari/proj/modality-ts/src/extract/sources/swr/discover.ts`
  - `swrSource().discover`
- `/Users/hari/proj/modality-ts/src/extract/sources/swr/domains.ts`
  - `inferPayloadDomain`

## Existing Patterns to Follow

- Every source plugin should remain conservative when semantic info is missing.
- Reuse `initialValueForUseStateDetailed` and existing initial-value helpers; domain inference is changing, not literal initial evaluation.
- Keep caveats surfaced through `domainInferenceWarnings`.
- Avoid duplicating semantic inference logic inside plugins. Plugins should call shared engine functions.
- Keep source plugin tests text-driven by default, and add semantic integration tests at pipeline/CLI level.

## Atomic Implementation Steps

1. Add semantic-aware useState API wrappers.
   - In `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`, add:
     - `inferUseStateDomainSemanticDetailed(call, typeAliases, sourceFile, varId, types?)`
   - Behavior:
     - If `call.typeArguments?.[0]` and `types?.checker`, infer from `checker.getTypeFromTypeNode`.
     - Else if initializer and `types?.checker`, infer from `checker.getTypeAtLocation(initializer)` unless the numeric/schema resolver returns a more precise domain first.
     - Else fall back to `inferUseStateDomainDetailed`.
   - Preserve existing initial value calculation.

2. Migrate generic React extraction.
   - In `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`, replace direct useState domain calls with semantic-aware wrappers when `options.types` exists.
   - Make sure line/column anchors and `domainInferenceWarnings` still point at the original source.
   - Preserve `additionalTypeAliases` fallback for tests and merged supplemental types.

3. Migrate custom hook/component useState helpers.
   - In `/Users/hari/proj/modality-ts/src/extract/engine/ts/components.ts`, thread `types` through any helper options that infer domains.
   - Use semantic-aware wrappers where possible.
   - Do not change component traversal behavior.

4. Migrate `use-state` source plugin.
   - Update `DiscoverCtx` usage in `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`.
   - Use `ctx.types?.sourceFile` instead of reparsing when available.
   - Use semantic-aware useState domain inference.
   - Keep reparsing fallback for standalone plugin unit tests.

5. Migrate SWR payload domain inference.
   - Update `/Users/hari/proj/modality-ts/src/extract/sources/swr/domains.ts` to accept optional semantic context and source file.
   - If `typeArg` and semantic context exist, infer from `checker.getTypeFromTypeNode(typeArg)`.
   - Fallback to existing `inferDomainFromTypeNode`.
   - Update `/Users/hari/proj/modality-ts/src/extract/sources/swr/discover.ts` to pass `ctx.types`.

6. Migrate Jotai domain inference.
   - Update `classifyAtomCall`, `inferAtomDomain`, and helper signatures to accept optional semantic context and source file.
   - For explicit type arguments, use semantic mapper first.
   - For initializer expressions, use semantic mapper only when it does not narrow broad primitives unsafely.
   - Keep current Jotai-specific abstractions for async derived/read-only atoms.
   - Update discover call sites in `/Users/hari/proj/modality-ts/src/extract/sources/jotai/discover.ts`.

7. Migrate Zustand field domain inference.
   - Update `/Users/hari/proj/modality-ts/src/extract/sources/zustand/domains.ts`.
   - For store state fields with declared type nodes, use semantic mapper first.
   - For initializer-only fields, use semantic expression inference when available, otherwise fallback.
   - Update `/Users/hari/proj/modality-ts/src/extract/sources/zustand/discover.ts` call sites.

8. Add CLI-level integration tests for imported non-numerical types.
   - Use `runExtractCommand` with multiple files or a temp project.
   - Assert extracted domains, not just direct mapper output.
   - Cover React, Jotai, Zustand, and SWR separately if fixtures stay manageable.

## Per-Step Files to Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/type-domains.ts`
- Step 2:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/components.ts`
- Step 4:
  - `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/extract/sources/swr/domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/swr/discover.ts`
- Step 6:
  - `/Users/hari/proj/modality-ts/src/extract/sources/jotai/domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/jotai/discover.ts`
- Step 7:
  - `/Users/hari/proj/modality-ts/src/extract/sources/zustand/domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/zustand/discover.ts`
- Step 8:
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - `/Users/hari/proj/modality-ts/test/sources/use-state/use-state-source.test.ts`
  - `/Users/hari/proj/modality-ts/test/sources/jotai/jotai-source.test.ts`
  - `/Users/hari/proj/modality-ts/test/sources/zustand/zustand-source.test.ts`
  - `/Users/hari/proj/modality-ts/test/sources/swr/swr-template.test.ts`

## Acceptance Criteria

- A React `useState<ImportedStatus>("idle")` extracts an `enum` domain from an imported type alias.
- A React `useState<ImportedTaggedUnion>(...)` extracts a `tagged` domain.
- Jotai atom type arguments can resolve imported non-numerical aliases.
- Zustand store fields can resolve imported interface/type aliases.
- SWR payload types can resolve imported object/tagged domains when the payload type is explicitly supplied.
- Existing source plugin tests still pass when no semantic context is provided.
- Numeric Zod/ArkType tests from the existing suite still pass.

## Tests to Add or Update

- In `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`, add integration fixtures with:
  - `types.ts` exporting `Status`, `User`, and `LoadState`.
  - `App.tsx` importing those types and using `useState`.
  - Assert `model.vars[].domain`.
- In source-specific tests:
  - Add semantic-context tests only if a helper from Part 1 makes this concise.
  - Otherwise keep source plugin text-only tests unchanged and rely on CLI integration tests for semantic behavior.
- Add regression tests ensuring broad imported `string` and `number` still produce token domains.

## Verification Commands

- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run test/sources/use-state/use-state-source.test.ts`
- `rtk pnpm vitest run test/sources/jotai/jotai-source.test.ts`
- `rtk pnpm vitest run test/sources/zustand/zustand-source.test.ts`
- `rtk pnpm vitest run test/sources/swr/swr-template.test.ts`
- `rtk pnpm typecheck`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if plugin APIs become awkward because `discover` and `writeChannels` are called separately with different `sourceFile` objects. They should share semantic project lookup.
- Stop and report if `interactionText` no longer matches semantic `SourceFile` positions. Semantic source files should come from full source text; parsed interaction fragments should remain only for traversal.
- Do not make initializer literals determine finite domains for variables typed as broad `string` or `number`.
- Do not migrate one plugin by copying semantic inference logic into it. Add shared wrappers instead.
