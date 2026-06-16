# Part 1 of 4: Semantic Type Project Context

## Goal

Introduce a TypeScript semantic project layer for extraction so domain inference can use `ts.Program` and `ts.TypeChecker` instead of relying only on local `ts.SourceFile` ASTs and alias maps.

This part should make type information available to the extractor and source plugins, but it should not yet replace existing domain inference behavior.

## Non-goals

- Do not change `AbstractDomain`, `Model`, or checker IR schemas.
- Do not remove existing AST-based domain inference functions yet.
- Do not rewrite import reachability or router classification.
- Do not change checker behavior, TLA export, replay, or overlay semantics.
- Do not attempt Zod or ArkType semantic refinements in this part.

## Current-State Findings

- Extraction currently parses source text repeatedly with `ts.createSourceFile`.
- `runExtractCommand` in `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts` builds a client project surface through `sourceWithReachableImports`.
- `sourceWithReachableImports` in `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts` already resolves reachable source files and keeps full text plus interaction/render surface text.
- `runExtractionPipeline` in `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts` receives source text fragments, not semantic type context.
- Source plugin SPI contexts in `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts` include only `sourceText` and `fileName`.
- Existing type inference entry points are AST-oriented exports from `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`.

## Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts`
  - `TsConfigResolution`
  - `ProjectSourceEntry`
  - `ReachableImportsResult`
  - `sourceWithReachableImports`
  - local `createSourceFile`
  - `resolveImportPath`
- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `ExtractionProject`
  - `loadExtractionProject`
  - `buildClientProjectSurface`
  - `runProjectExtractionPipeline`
- `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runExtractionPipeline`
- `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`
  - `DiscoverCtx`
  - `TypeCtx`
  - `ChannelCtx`
  - `ExtractCtx`
  - `StateSourcePlugin`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/source.ts`
  - `parseTsxSource`
- `/Users/hari/proj/modality-ts/package.json`
  - existing TypeScript dependency and test scripts

## Existing Patterns to Follow

- Keep extractor context as serializable/simple data plus optional typed helpers.
- Preserve conservative E1 behavior: missing semantic info must fall back to existing over-approximation, not silently infer narrower domains.
- Prefer adding an optional context object first, then migrating call sites in later parts.
- Keep source plugin APIs additive within this branch; project guidance says backward compatibility is not a constraint, but this part should avoid avoidable churn before migration.
- Reuse `TsConfigResolution` path/baseUrl resolution rather than introducing a new resolver.

## Atomic Implementation Steps

1. Add a semantic project module.
   - Create `/Users/hari/proj/modality-ts/src/extract/engine/ts/semantic-project.ts`.
   - Define `SemanticSourceEntry`, `SemanticProject`, and helper lookup APIs:
     - `program: ts.Program`
     - `checker: ts.TypeChecker`
     - `sourceFiles: ReadonlyMap<string, ts.SourceFile>`
     - `getSourceFile(fileName: string): ts.SourceFile | undefined`
     - `getTypeAtLocation(node: ts.Node): ts.Type | undefined`
     - `getTypeFromTypeNode(node: ts.TypeNode): ts.Type | undefined`
   - Implement `createSemanticProject(entries, tsconfig)` with an in-memory compiler host.
   - Use `ts.createCompilerHost` as the base and override `readFile`, `fileExists`, `getSourceFile`, and `writeFile`.
   - Include reachable source entries as root names.
   - Use compiler options that match NodeNext ESM enough for existing app code:
     - `module: ts.ModuleKind.NodeNext`
     - `moduleResolution: ts.ModuleResolutionKind.NodeNext`
     - `jsx: ts.JsxEmit.ReactJSX`
     - `target: ts.ScriptTarget.ES2022`
     - `strict: true`
     - `skipLibCheck: true`
     - `noEmit: true`
     - `allowJs: true`
     - `checkJs: false`
   - Apply `baseUrl` and `paths` from `TsConfigResolution`.

2. Expose semantic context through SPI types.
   - In `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`, add a `SemanticTypeContext` interface:
     - `program: ts.Program`
     - `checker: ts.TypeChecker`
     - `sourceFile?: ts.SourceFile`
     - `getSourceFile(fileName: string): ts.SourceFile | undefined`
   - Add optional `types?: SemanticTypeContext` to `DiscoverCtx`, `TypeCtx`, `ChannelCtx`, and `ExtractCtx`.
   - Import `type * as ts from "typescript"` in the SPI file.

3. Thread the semantic project through CLI extraction.
   - In `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`, extend `ExtractionProject` with optional `semanticProject`.
   - In `buildClientProjectSurface`, after `reachable` is computed, build a semantic project from included full-text sources, not just stripped interaction text.
   - Use all reachable included sources, including type-only sources, so imported type aliases/interfaces remain visible to the TypeChecker.
   - Store semantic project on the returned project.

4. Thread semantic context through `runProjectExtractionPipeline`.
   - Add optional `semanticProject` to `ExtractionPipelineOptions`.
   - When invoking `runExtractionPipeline`, pass `semanticProject`.
   - In `runExtractionPipeline`, for each fragment, resolve the fragment’s semantic `sourceFile` from `semanticProject`.
   - Pass `{ program, checker, sourceFile, getSourceFile }` into plugin `discover`, `writeChannels`, `safetyWarnings`, `extract`, and generic React extraction options.

5. Extend generic React extraction options only.
   - In `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`, add optional `types?: SemanticTypeContext` to the options type.
   - Do not use it yet except to store/pass through where needed by later parts.

6. Preserve test helper ergonomics.
   - Keep existing `runExtractionPipeline({ sourceText, fileName, ... })` tests working by making semantic context optional.
   - Add a small helper only if needed for tests, for example `createSemanticProjectForTest`.

## Per-Step Files to Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/semantic-project.ts`
- Step 2:
  - `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts` only if `TsConfigResolution` needs exported conversion helpers
- Step 4:
  - `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
- Step 6:
  - `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/navigation-adapter-fit.test.ts`

## Acceptance Criteria

- Existing extraction tests still pass without requiring semantic context.
- `runExtractCommand` builds a `SemanticProject` for reachable included source files.
- Source plugin SPI contexts can receive `types`, and existing plugins compile unchanged.
- No generated model output changes in existing tests unless a test explicitly asserts new context presence.
- No changes to `AbstractDomain` or checker Rust model schema.

## Tests to Add or Update

- Add unit tests for `createSemanticProject`:
  - It resolves an imported type alias across two in-memory source files.
  - It respects `baseUrl`/`paths` from `TsConfigResolution`.
  - It returns the same `ts.SourceFile` for canonical file paths used by extraction fragments.
- Add a pipeline test:
  - A dummy source plugin receives `ctx.types?.checker` in `discover` and `writeChannels`.
  - Existing behavior remains unchanged when `types` is omitted.

Suggested new test file:

- `/Users/hari/proj/modality-ts/test/extract/semantic-project.test.ts`

## Verification Commands

- `rtk pnpm vitest run test/extract/semantic-project.test.ts`
- `rtk pnpm vitest run test/extraction/architecture.test.ts`
- `rtk pnpm vitest run src/extract/engine/navigation-adapter-fit.test.ts`
- `rtk pnpm typecheck`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if TypeScript cannot resolve project imports with the lightweight in-memory host without also reading `node_modules`; do not hand-roll broad package resolution.
- Stop and report if `TsConfigResolution` is too lossy for `ts.Program` compiler options. Prefer adding a narrow `CompilerOptions` extraction helper over duplicating tsconfig parsing.
- Stop and report if full reachable source text creates duplicate declarations when interaction surfaces are also passed as fragments. The semantic project should use full source files once, not merged fragment text.
- Do not add new source plugin behavior in this part. This plan only provides the semantic substrate.
