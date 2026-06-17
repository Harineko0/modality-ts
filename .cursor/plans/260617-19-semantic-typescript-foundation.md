# Semantic TypeScript Foundation

Status: implementation plan.
Date: 2026-06-17.
Plan family: A — Semantic TypeScript Foundation.

## 1. Goal

Make extraction compiler-backed by default. The extractor should use one
canonical TypeScript project service for file identity, module resolution,
symbol identity, type/domain inference, component discovery, setter binding,
import classification, and project surface slicing.

The intended end state is:

- `ts.Program` and `ts.TypeChecker` are created from parsed project config and
  propagated through every extraction stage.
- file/module/symbol identity is canonical and reusable from CLI project
  loading, pipeline execution, source plugins, and React transition extraction;
- domain inference prefers semantic `ts.Type` facts and only uses syntax
  fallback when no `ts.Program` exists;
- setters, component declarations, custom hooks, state-source write channels,
  and library import recognition can be keyed by symbol identity instead of
  only by local string names;
- duplicated syntax-only alias maps and path resolution helpers are deleted
  where the TypeChecker or compiler module resolver can answer the question.

## 2. Non-goals

- Do not change checker IR semantics, Rust checker behavior, TLA export, or
  state-space slicing in this plan.
- Do not add new library support. Existing React, Jotai, Zustand, SWR, Zod, and
  router support should be migrated onto shared semantic infrastructure.
- Do not preserve compatibility with syntax-only internal APIs if a cleaner
  semantic API replaces them. Update tests and callers directly.
- Do not execute app code or rely on bundler-specific runtime behavior.
- Do not edit generated artifacts or `dist/`.
- Do not edit `.cursor/plans/260617-18-versatility-plan-of-plans.md` or other
  worker plan files.

## 3. Current-State Findings

- `src/extract/engine/ts/semantic-project.ts` already creates an in-memory
  `ts.Program`, exposes `program`, `checker`, `sourceFiles`,
  `getSourceFile()`, `getTypeAtLocation()`, and `getTypeFromTypeNode()`, and
  has tests in `test/extract/semantic-project.test.ts`.
- `src/extract/engine/spi/index.ts` already exposes `SemanticTypeContext` with
  `program`, `checker`, `sourceFile`, and `getSourceFile()`. It is threaded
  through `DiscoverCtx`, `TypeCtx`, `ChannelCtx`, and `ExtractCtx`.
- `src/extract/engine/pipeline/index.ts` passes semantic context to source
  plugin `discover`, `writeChannels`, `safetyWarnings`, and generic React
  extraction when `semanticProject` is present.
- `src/cli/features/extract/command.ts` creates `SemanticProject` only after
  `sourceWithReachableImports()` has already performed syntax-only import graph
  slicing. This means project surface discovery and compiler project creation
  are currently separate worlds.
- `src/cli/features/extract/project.ts` performs its own AST import graph,
  import binding parsing, re-export following, `baseUrl`/`paths` matching, and
  extension probing. This duplicates TypeScript module resolution behavior and
  misses project references/package export semantics.
- `src/cli/features/extract/command.ts` has local `readTsConfigResolution()`
  handling that returns a reduced `TsConfigResolution`. Existing tests prove
  commented JSON can be read, but the extractor does not yet use the full
  TypeScript parsed command line/project reference model.
- `src/extract/engine/ts/domains.ts` still exports syntax-first
  `typeAliasDeclarations()`, `inferDomainFromTypeNodeDetailed()`, and
  `inferUseStateDomainDetailed()`. `inferUseStateDomainSemanticDetailed()` wraps
  semantic inference but still needs syntax alias fallbacks and a
  `findMatchingUseStateCall()` workaround when fragment source and semantic
  source differ.
- `src/extract/engine/ts/type-domains.ts` provides a good semantic mapper from
  `ts.Type` to `AbstractDomain`, but also has a private
  `typeAliasDeclarationsFromSource()` fallback for resolved aliases.
- `src/extract/engine/ts/react-source-transitions.ts` recreates a
  `ts.SourceFile` from `sourceText`, builds local `typeAliases`, merges
  `additionalTypeAliases` from concatenated fragments, parses supplemental
  component sources using the same `fileName`, and keys components, hooks,
  handlers, setters, and reset/fixed effects by strings.
- `src/extract/engine/ts/context.ts` discovers context provider setter aliases
  with syntax-only maps keyed by local identifier names. `bindSetter()` uses a
  string key plus an ad hoc scoped key `${component}:${symbolName}` to handle
  collisions.
- `src/extract/engine/ts/components.ts` discovers components/custom hooks by
  name and resolves inline custom hook state through syntax names. Imported
  components/custom hooks cannot be represented by symbol identity yet.
- `src/extract/sources/use-state/index.ts` uses `SemanticTypeContext` for source
  file reuse and semantic domain inference, but `WriteChannel.symbolName` is
  still only the local setter string.
- `src/extract/sources/jotai/imports.ts`,
  `src/extract/sources/zustand/imports.ts`, and
  `src/extract/sources/swr/discover.ts` recognize imports by string module
  specifier and local imported names. This is acceptable as a fallback, but it
  should be replaced by shared semantic import/symbol helpers when a
  TypeChecker exists.
- `src/extract/sources/jotai/domains.ts`,
  `src/extract/sources/zustand/domains.ts`, and
  `src/extract/sources/swr/domains.ts` re-export or consume
  `typeAliasDeclarations()` and pass alias maps around. They already call
  semantic domain helpers when `types?.checker` exists.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/ts/semantic-project.ts`
  - `SemanticProjectTsConfig`
  - `SemanticSourceEntry`
  - `SemanticProject`
  - `createSemanticProject()`
  - `createSemanticProjectForTest()`
- `src/extract/engine/spi/index.ts`
  - `DomainRefinementContext`
  - `SemanticTypeContext`
  - `WriteChannel`
  - `DiscoverCtx`
  - `TypeCtx`
  - `ChannelCtx`
  - `ExtractCtx`
  - import/module classification context types
- `src/cli/features/extract/command.ts`
  - `ExtractionProject`
  - `loadExtractionProject()`
  - `buildClientProjectSurface()`
  - `runProjectExtractionPipeline()`
  - `readTsConfigResolution()`
- `src/cli/features/extract/project.ts`
  - `TsConfigResolution`
  - `sourceWithReachableImports()`
  - `resolveImportPath()`
  - `importBases()`
  - `firstExistingModulePath()`
  - `followDeclarationReference()`
  - `discoverServerActionImportAliases()`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions.semanticProject`
  - `semanticTypeContextForFile()`
  - supplemental `typeAliasDeclarations()` path
- `src/extract/engine/ts/react-source-transitions.ts`
  - `ReactSourceTransitionOptions.types`
  - `additionalTypeAliases`
  - `additionalComponentSources`
  - local `typeAliases`
  - `componentDeclarations()`
  - `customHookDeclarations()`
  - `discoverContextBindings()`
  - `bindSetter()`
- `src/extract/engine/ts/context.ts`
  - `ContextBindings`
  - `bindSetter()`
  - `settersForComponent()`
  - `discoverContextBindings()`
  - `bindContextHookObjectDeclaration()`
  - `setterAliasBinding()`
- `src/extract/engine/ts/components.ts`
  - `componentDeclarations()`
  - `customHookDeclarations()`
  - `inlineCustomHookState()`
  - `calledCustomHook()`
  - `detectStatefulListComponents()`
- `src/extract/engine/ts/domains.ts`
  - `DomainInferenceContext`
  - `inferDomainFromTypeNodeDetailed()`
  - `inferUseStateDomainDetailed()`
  - `inferUseStateDomainSemanticDetailed()`
  - `typeAliasDeclarations()`
- `src/extract/engine/ts/type-domains.ts`
  - `TypeDomainInferenceContext`
  - `inferDomainFromTypeDetailed()`
  - `inferDomainFromTypeNodeSemanticDetailed()`
  - `inferDomainFromExpressionSemanticDetailed()`
  - `inferFromResolvedAliasDeclaration()`
  - `typeAliasDeclarationsFromSource()`
- `src/extract/engine/ts/types.ts`
  - `SetterBinding`
  - `ContextBindings`

Source plugin migration files:

- `src/extract/sources/use-state/index.ts`
- `src/extract/sources/jotai/imports.ts`
- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/domains.ts`
- `src/extract/sources/zustand/imports.ts`
- `src/extract/sources/zustand/discover.ts`
- `src/extract/sources/zustand/domains.ts`
- `src/extract/sources/swr/discover.ts`
- `src/extract/sources/swr/domains.ts`

Tests to add/update:

- `test/extract/semantic-project.test.ts`
- `src/cli/features/extract/command.test.ts`
- focused source plugin tests under `src/extract/sources/**` or
  `test/extract/**`, matching existing placement.

## 5. Existing Patterns to Follow

- Keep TypeScript helper code in `src/extract/engine/ts/` and expose only stable
  adapter-facing shapes through `src/extract/engine/spi/index.ts`.
- Follow `createSemanticProjectForTest()` for small compiler-backed fixtures.
- Follow `runExtractionPipeline()` as the central place for passing typed
  context to plugins and generic extraction.
- Follow current `sourceFileForDiscovery()` helpers initially, but converge them
  into one shared helper instead of duplicating across plugins.
- Preserve structured caveat behavior. If semantic lookup is unavailable or
  ambiguous, report lower confidence where a caveat shape already exists rather
  than silently guessing.
- Prefer compiler APIs such as `ts.parseJsonConfigFileContent()`,
  `ts.readConfigFile()`, `ts.resolveModuleName()`,
  `checker.getSymbolAtLocation()`, `checker.getAliasedSymbol()`,
  `program.getSourceFile()`, and `checker.getExportsOfModule()` over bespoke
  import/path parsing.

## 6. Atomic Implementation Steps

### Step 1 — Replace reduced tsconfig parsing with TypeScript parsed config

Files to edit:

- `src/extract/engine/ts/semantic-project.ts`
- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/project.ts`
- `test/extract/semantic-project.test.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Introduce a `SemanticProjectConfig` shape in
   `src/extract/engine/ts/semantic-project.ts` that stores:
   - `configFilePath?: string`;
   - `configDir: string`;
   - `parsedCommandLine: ts.ParsedCommandLine`;
   - project references from the parsed command line;
   - canonical root names.
2. Add `loadSemanticProjectConfig(startDir: string)` or equivalent helper using
   `ts.findConfigFile()`, `ts.readConfigFile()`, and
   `ts.parseJsonConfigFileContent()`.
3. Preserve support for the current in-memory test shape by adding a
   `createSemanticProject(entries, configOrLegacyTsConfig)` bridge only during
   this step. By the end of this plan, direct legacy `paths` plumbing should be
   removed from internal callers.
4. Ensure JSONC comments, `extends`, `baseUrl`, `paths`, `jsx`, NodeNext module
   resolution, `allowJs`, and project references are represented through
   `ParsedCommandLine` instead of manual parsing.
5. Update CLI project loading to store parsed semantic config on
   `ExtractionProject` instead of only `TsConfigResolution`.

Acceptance criteria:

- Existing commented-tsconfig test still passes.
- New tests cover `extends`, JSONC comments, `baseUrl`, `paths`, and a project
  reference that exports a type consumed by an app source.
- No caller outside test helpers has to manually construct `{ prefix, suffix,
  targets }` path entries for new semantic project creation.

### Step 2 — Add a canonical resolver service to `SemanticProject`

Files to edit:

- `src/extract/engine/ts/semantic-project.ts`
- `src/extract/engine/spi/index.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Extend `SemanticProject` with reusable resolver APIs:
   - `canonicalFileName(fileName: string): string`;
   - `getSourceFile(fileName: string): ts.SourceFile | undefined`;
   - `resolveModuleName(specifier: string, containingFile: string):
     { fileName: string; sourceFile?: ts.SourceFile; isExternal: boolean } |
     undefined`;
   - `symbolAt(node: ts.Node): ts.Symbol | undefined`;
   - `aliasedSymbolAt(node: ts.Node): ts.Symbol | undefined`;
   - `symbolKey(symbol: ts.Symbol): string`;
   - `localSymbolKey(node: ts.Node): string | undefined`.
2. Implement `resolveModuleName()` with `ts.resolveModuleName()` using the same
   compiler options and host as the program.
3. Implement `symbolKey()` with stable canonical information:
   - canonical declaration source file;
   - declaration start;
   - symbol name;
   - fallback to `checker.getFullyQualifiedName(symbol)` when declarations are
     absent.
4. Expose the same resolver methods on `SemanticTypeContext` in
   `src/extract/engine/spi/index.ts`.
5. Update `semanticTypeContextForFile()` in
   `src/extract/engine/pipeline/index.ts` to pass these methods through.

Acceptance criteria:

- Tests prove that `./foo.js`, `./foo`, path aliases, re-export aliases, and
  type-only imports resolve to the same canonical source/symbol where TypeScript
  says they do.
- Tests prove `symbolKey()` is stable across two references to the same imported
  setter/type/component symbol and different for shadowed local identifiers with
  the same text.

### Step 3 — Make source surface discovery use compiler module resolution

Files to edit:

- `src/cli/features/extract/project.ts`
- `src/cli/features/extract/command.ts`
- `src/extract/engine/ts/semantic-project.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Pass `SemanticProject` or a lightweight `SemanticModuleResolver` into
   `sourceWithReachableImports()`.
2. Replace `resolveImportPath()`, `importBases()`, and
   `firstExistingModulePath()` with `semanticProject.resolveModuleName()`.
3. Keep syntax parsing for identifying import declarations and referenced
   identifiers in this step, but remove custom `baseUrl`/`paths` matching and
   extension probing.
4. Update `followDeclarationReference()` to resolve re-export module targets via
   compiler resolution.
5. Update `discoverServerActionImportAliases()` to resolve imported server
   action modules via the resolver rather than manual candidate paths.
6. Treat unresolved modules as explicit surface warnings with enough source
   information to later become structured caveats.

Acceptance criteria:

- Existing reachability tests still pass.
- New tests cover:
  - path alias import;
  - extensionless import;
  - `.js` specifier resolving to `.ts`/`.tsx` source under NodeNext;
  - re-export from an aliased module;
  - type-only import excluded from interaction surface.
- `importBases()` and `firstExistingModulePath()` are deleted.

### Step 4 — Eliminate fragment-only semantic mismatch

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/domains.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Stop passing concatenated `sourceText` as the semantic source of truth.
   `runProjectExtractionPipeline()` should iterate actual interaction fragments
   with their canonical file names and matching `types.sourceFile`.
2. Replace `additionalComponentSources` and `additionalTypeAliases` with a
   typed project-wide discovery view:
   - either pass `relatedFragments` plus their semantic contexts; or
   - expose project source files from `SemanticTypeContext` and let component
     discovery walk relevant files.
3. Remove the need for `findMatchingUseStateCall()` in
   `inferUseStateDomainSemanticDetailed()` by ensuring the `ts.CallExpression`
   used for semantic inference comes from the same `SourceFile` as
   `types.sourceFile`.
4. Keep a syntax-only path for direct unit tests that call
   `extractReactSourceTransitions(sourceText)` without `types`, but mark it as
   lower-confidence fallback in comments and tests.

Acceptance criteria:

- `findMatchingUseStateCall()` is deleted.
- Supplemental `__types__.ts` concatenation in `runExtractionPipeline()` is
  deleted.
- Multi-file extraction still finds components/custom hooks/type aliases across
  fragments through semantic project files, not through same-file string merges.

### Step 5 — Introduce symbol-keyed bindings and write channels

Files to edit:

- `src/extract/engine/spi/index.ts`
- `src/extract/engine/ts/types.ts`
- `src/extract/engine/ts/context.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/sources/use-state/index.ts`
- source plugins with write channels as needed
- tests under `test/extract/` and source plugin tests

Implementation:

1. Extend `WriteChannel` with optional `symbolKey?: string` and, if useful,
   `declarationKey?: string`. Keep `symbolName` only as display/fallback.
2. Extend `SetterBinding` with optional `symbolKey?: string`.
3. Change `bindSetter()` to prefer `symbolKey` for exact identity and only use
   `symbolName` for syntax-only fallback.
4. Change `settersForComponent()` to scope local setters by component plus
   symbol key rather than only `${component}:${symbolName}`.
5. In `use-state` discovery/write channel extraction, compute the setter
   binding key with `ctx.types.localSymbolKey(setterIdentifier)` when available.
6. In generic React extraction, compute local useState setter symbol keys and
   resolve handler calls/setter calls by `checker.getSymbolAtLocation()`.
7. Add collision tests where two components have setters with the same local
   name, imported aliases rename a setter-like function, and a shadowed local
   function shares a setter name.

Acceptance criteria:

- Same-name setters in different scopes no longer require deleting the unscoped
  string binding as the primary correctness mechanism.
- Existing behavior still works without `types`, but tests label it as fallback.
- `WriteChannel.symbolName` remains only for reporting/fallback and is not the
  primary matching key when `symbolKey` exists.

### Step 6 — Migrate component and custom hook resolution to symbols

Files to edit:

- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/context.ts`
- `src/extract/engine/spi/index.ts`
- relevant tests in `test/extraction/extraction.test.ts` and
  `test/extract/semantic-project.test.ts`

Implementation:

1. Introduce `ComponentRegistry` and `CustomHookRegistry` internal shapes keyed
   by symbol key with secondary display-name indexes.
2. Update `componentDeclarations()` and `customHookDeclarations()` to accept
   optional `SemanticTypeContext` and return symbol-keyed entries when possible.
3. Resolve JSX component tags and called custom hooks via `checker` symbol
   lookup before falling back to uppercase/name heuristics.
4. Update `detectStatefulListComponents()`, `transitionsFromComponentPropAttribute()`
   call sites, and custom hook inlining to consume registry entries instead of
   raw `Map<string, ...>` where symbol identity matters.
5. Keep display component names for transition ids and var ids, but derive
   identity from the symbol key to avoid imported/shadowed component confusion.

Acceptance criteria:

- Imported components and custom hooks from project files are discoverable
  without concatenating supplemental sources.
- Shadowed component names do not cross-bind handlers or state.
- Transition ids remain readable, but internal matching does not depend only on
  names.

### Step 7 — Centralize semantic domain inference and retire alias-map plumbing

Files to edit:

- `src/extract/engine/ts/domains.ts`
- `src/extract/engine/ts/type-domains.ts`
- `src/extract/sources/jotai/domains.ts`
- `src/extract/sources/zustand/domains.ts`
- `src/extract/sources/swr/domains.ts`
- `src/extract/sources/use-state/index.ts`
- `test/extract/semantic-project.test.ts`
- `test/extract/numeric-domain-resolver.test.ts`

Implementation:

1. Create one public semantic domain entrypoint, for example
   `inferDomainSemantic(nodeOrType, ctx)`, that handles:
   - `ts.TypeNode`;
   - `ts.Expression`;
   - existing `DomainRefinementProvider`s;
   - initializer/varId/source caveats;
   - semantic fallback to syntax only when no checker exists.
2. Update useState, Jotai, Zustand, and SWR domain helpers to call this
   entrypoint instead of directly passing `typeAliasDeclarations()` maps.
3. Delete duplicate alias-map exports from source domain files once callers are
   migrated.
4. Delete private `typeAliasDeclarationsFromSource()` if resolved alias
   declarations can be inferred directly from `checker.getTypeFromTypeNode()` or
   from the alias declaration symbol without building a file-wide name map.
5. Keep `typeAliasDeclarations()` only for the no-program fallback path and test
   it explicitly as fallback-only.

Acceptance criteria:

- Cross-file type aliases, imported type aliases, interfaces, literal unions,
  tagged unions, optional fields, and schema/numeric refinements infer domains
  through the checker.
- Syntax alias maps are absent from normal compiler-backed source plugin paths.
- Tests prove no regression in numeric caveat emission for bare `number`.

### Step 8 — Migrate import recognition helpers to semantic import/symbol helpers

Files to edit:

- `src/extract/engine/ts/semantic-project.ts`
- `src/extract/engine/spi/index.ts`
- `src/extract/sources/jotai/imports.ts`
- `src/extract/sources/zustand/imports.ts`
- `src/extract/sources/swr/discover.ts`
- corresponding tests

Implementation:

1. Add shared helper(s) for resolving whether an identifier refers to a named
   export from a package/module set:
   - input: `Identifier`, allowed package names, allowed exported names;
   - output: `{ localName, exportedName, moduleName, symbolKey } | undefined`.
2. Use TypeChecker alias resolution when `types` exists; keep current
   import-declaration parsing as fallback.
3. Migrate Jotai atom creators/hooks/store creators, Zustand store creators and
   middlewares, and SWR `useSWR` recognition onto the shared helper.
4. Preserve package-name abstraction: helpers should accept sets of package names
   and export names, not hard-code one library in the engine.

Acceptance criteria:

- Import aliases, re-exports from local barrels, and renamed imports are
  recognized when TypeScript can resolve them.
- Fallback syntax behavior remains for no-program unit calls.
- Library files still own their package/export lists; the engine only provides
  generic symbol resolution.

### Step 9 — Remove obsolete syntax-only infrastructure

Files to edit:

- all files touched above
- tests that depended on old internal shapes

Implementation:

1. Remove `TsConfigResolution` from compiler-backed paths. If an adapter still
   needs serializable path info, derive it from `ParsedCommandLine` at the edge.
2. Remove `additionalTypeAliases` and `additionalComponentSources` from
   `ReactSourceTransitionOptions` if Step 4 fully replaces them.
3. Remove custom path matching helpers from project surface discovery.
4. Remove alias-map plumbing from source plugin semantic paths.
5. Update tests to assert semantic behavior rather than old helper shapes.

Acceptance criteria:

- `rtk grep "additionalTypeAliases|additionalComponentSources|importBases\\(|firstExistingModulePath\\(|findMatchingUseStateCall\\(" src test -n`
  returns no live implementation references.
- `typeAliasDeclarations()` references are limited to explicit no-program
  fallback tests and fallback branches.

## 7. Per-Step Files to Edit

- Step 1: `semantic-project.ts`, `command.ts`, `project.ts`,
  `semantic-project.test.ts`, `command.test.ts`.
- Step 2: `semantic-project.ts`, `spi/index.ts`, `pipeline/index.ts`,
  `semantic-project.test.ts`.
- Step 3: `project.ts`, `command.ts`, `semantic-project.ts`,
  `command.test.ts`.
- Step 4: `command.ts`, `pipeline/index.ts`, `react-source-transitions.ts`,
  `domains.ts`, `semantic-project.test.ts`.
- Step 5: `spi/index.ts`, `types.ts`, `context.ts`,
  `react-source-transitions.ts`, `use-state/index.ts`, focused extraction tests.
- Step 6: `components.ts`, `react-source-transitions.ts`, `context.ts`,
  `spi/index.ts`, focused component/custom-hook tests.
- Step 7: `domains.ts`, `type-domains.ts`, Jotai/Zustand/SWR/useState domain
  files, semantic and numeric domain tests.
- Step 8: `semantic-project.ts`, `spi/index.ts`, Jotai/Zustand/SWR import
  helpers/discover files, source plugin tests.
- Step 9: all migrated files and stale tests.

## 8. Acceptance Criteria

- Extraction creates and threads one canonical semantic project for normal CLI
  extraction.
- Compiler module resolution replaces bespoke path alias/extension probing in
  project surface discovery.
- Source plugin and generic extraction contexts can resolve source files,
  modules, symbols, aliased symbols, and stable symbol keys.
- Domain inference for normal extraction is checker-backed and cross-file by
  default.
- useState setter binding and write channels prefer symbol identity over local
  string names.
- Component/custom hook resolution can use symbol identity and does not require
  concatenating supplemental component sources.
- Library import recognition uses shared semantic symbol helpers where a
  TypeChecker exists.
- Syntax-only fallback remains only for tests or direct API usage without
  `semanticProject`, and fallback behavior is clearly isolated.
- Obsolete syntax-only alias/path helpers are deleted where replaced.

## 9. Tests to Add or Update

Add or update focused tests for:

- JSONC tsconfig parsing with comments.
- `extends` tsconfig inheritance.
- `baseUrl` and `paths` resolution through compiler APIs.
- NodeNext `.js` import resolving to `.ts`/`.tsx`.
- project reference exporting a type consumed by a source file.
- canonical source file identity for raw entry, render fragment, and
  interaction fragment.
- symbol key stability across imported aliases and re-exports.
- symbol key distinction for shadowed local identifiers.
- cross-file type alias/interface/tagged-union domain inference.
- bare `number` caveat preservation.
- setter collision between same local setter names in different components.
- imported/re-exported custom hook inlining.
- imported/re-exported component prop handler resolution.
- Jotai/Zustand/SWR import alias and local barrel recognition.
- no-program fallback still works for direct `extractReactSourceTransitions()`
  calls.

Prefer small compiler-backed fixtures in `test/extract/semantic-project.test.ts`
and existing source plugin test files over broad app snapshots.

## 10. Verification Commands

Run after each major step:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
```

Run after project surface/import resolution changes:

```bash
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm test -- test/extract
```

Run after source plugin migration:

```bash
rtk pnpm test -- src/extract/sources
rtk pnpm test -- test/extraction/extraction.test.ts
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if TypeScript `ts.resolveModuleName()` cannot resolve a case
  that current extraction supports; add a minimal fixture and decide whether the
  current behavior was unsound or whether compiler host setup is incomplete.
- Stop and report if project references require reading files outside the
  selected extraction roots in a way that changes CLI scope expectations.
- Stop and report if symbol keys are unstable across repeated program creation
  for the same files. Do not use TypeScript object identity as a persisted key.
- Stop and report if component/custom hook symbol migration would require
  changing transition id or var id public shapes. Internal matching should
  change first; human-readable ids can remain display-name based.
- Stop and report if deleting `additionalComponentSources` causes a real
  extraction loss before a semantic project-wide component registry is in place.
- Stop and report if a library recognition helper needs package-specific logic
  in the engine. The engine helper should stay generic; package/export sets
  belong in source adapters.
- Stop and report if any step starts changing checker semantics or IR shapes.
  That belongs in Plan Family B, not this plan.

## 12. Must Not Change

- Do not modify Rust checker crates for this plan.
- Do not add framework-specific fields to core IR.
- Do not add compatibility shims for removed internal options unless the shim is
  deleted in the same plan.
- Do not add broad real-app debugging as the primary proof. Real apps may run
  after conformance fixtures pass.
- Do not silently downgrade semantic misses to guessed domains or guessed
  writes. Use fallback only when no semantic project exists, and report
  ambiguity when a modeled write could be missed.
