# Semantic TypeScript Foundation 1: Project and Resolution

Status: implementation plan.
Date: 2026-06-17.
Plan family: A — Semantic TypeScript Foundation.

## 1. Goal

Make extraction start from one compiler-backed TypeScript project model. The CLI
should load the real parsed `tsconfig`, create a canonical `SemanticProject`,
and use compiler module resolution for project surface discovery before any
source plugin or React extraction runs.

The intended end state for this plan is:

- `ts.Program` and `ts.TypeChecker` are created from `ts.ParsedCommandLine`;
- project config parsing supports JSONC, `extends`, `baseUrl`, `paths`,
  NodeNext resolution, JSX, `allowJs`, and project references through compiler
  APIs;
- `SemanticProject` exposes reusable canonical file, module, symbol, aliased
  symbol, and symbol-key helpers;
- CLI reachable-source discovery uses `SemanticProject.resolveModuleName()`
  instead of bespoke path alias and extension probing.

## 2. Non-goals

- Do not change checker IR semantics, Rust checker behavior, TLA export, or
  state-space slicing.
- Do not migrate setter binding, component/custom hook resolution, or source
  adapter import recognition in this plan. Those belong to the follow-up
  `260617-19-2-*` and `260617-19-3-*` plans.
- Do not add new library support.
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
  slicing. Project surface discovery and compiler project creation are
  currently separate worlds.
- `src/cli/features/extract/project.ts` performs its own AST import graph,
  import binding parsing, re-export following, `baseUrl`/`paths` matching, and
  extension probing. This duplicates TypeScript module resolution behavior and
  misses project references/package export semantics.
- `src/cli/features/extract/command.ts` has local `readTsConfigResolution()`
  handling that returns a reduced `TsConfigResolution`. Existing tests prove
  commented JSON can be read, but the extractor does not yet use the full
  TypeScript parsed command line/project reference model.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/ts/semantic-project.ts`
  - `SemanticProjectTsConfig`
  - `SemanticSourceEntry`
  - `SemanticProject`
  - `createSemanticProject()`
  - `createSemanticProjectForTest()`
  - new `SemanticProjectConfig`
  - new `loadSemanticProjectConfig()`
- `src/extract/engine/spi/index.ts`
  - `SemanticTypeContext`
  - `DiscoverCtx`
  - `TypeCtx`
  - `ChannelCtx`
  - `ExtractCtx`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions.semanticProject`
  - `semanticTypeContextForFile()`
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

Tests to add/update:

- `test/extract/semantic-project.test.ts`
- `src/cli/features/extract/command.test.ts`

## 5. Existing Patterns to Follow

- Keep TypeScript helper code in `src/extract/engine/ts/` and expose only stable
  adapter-facing shapes through `src/extract/engine/spi/index.ts`.
- Follow `createSemanticProjectForTest()` for small compiler-backed fixtures.
- Follow `runExtractionPipeline()` as the central place for passing typed
  context to plugins and generic extraction.
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
- `src/extract/engine/pipeline/index.ts`
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
- Tests prove `symbolKey()` is stable across two references to the same
  imported setter/type/component symbol and different for shadowed local
  identifiers with the same text.

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

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/ts/semantic-project.ts`,
  `src/cli/features/extract/command.ts`,
  `src/cli/features/extract/project.ts`,
  `test/extract/semantic-project.test.ts`,
  `src/cli/features/extract/command.test.ts`.
- Step 2: `src/extract/engine/ts/semantic-project.ts`,
  `src/extract/engine/spi/index.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `test/extract/semantic-project.test.ts`.
- Step 3: `src/cli/features/extract/project.ts`,
  `src/cli/features/extract/command.ts`,
  `src/extract/engine/ts/semantic-project.ts`,
  `src/cli/features/extract/command.test.ts`.

## 8. Acceptance Criteria

- Extraction creates one canonical semantic project before normal CLI project
  surface discovery.
- Compiler parsed config replaces reduced internal tsconfig parsing for normal
  extraction.
- Compiler module resolution replaces bespoke path alias/extension probing in
  project surface discovery.
- Source plugin and generic extraction contexts can resolve source files,
  modules, symbols, aliased symbols, and stable symbol keys.
- Syntax parsing may still identify import declarations and referenced
  identifiers, but path resolution decisions come from TypeScript.
- Obsolete `importBases()` and `firstExistingModulePath()` implementation paths
  are removed.

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
- type-only import exclusion from interaction surface.

Prefer small compiler-backed fixtures in `test/extract/semantic-project.test.ts`
and `src/cli/features/extract/command.test.ts` over broad app snapshots.

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

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
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
- Stop and report if replacing `TsConfigResolution` would require changing
  public CLI behavior or checker-facing output. Keep this plan focused on
  extraction project loading and resolution infrastructure.
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
