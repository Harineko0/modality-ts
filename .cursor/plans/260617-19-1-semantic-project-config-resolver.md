# Semantic Project Config and Resolver

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-1.

## 1. Goal

Make `SemanticProject` the canonical compiler-backed project object for
extraction setup. It should load real TypeScript parsed config data and expose
stable file, module, and symbol identity helpers that later plans can use.

The intended end state of this plan is:

- tsconfig loading uses `ts.findConfigFile()`, `ts.readConfigFile()`, and
  `ts.parseJsonConfigFileContent()`;
- project references, `extends`, JSONC comments, `baseUrl`, `paths`, JSX,
  NodeNext module resolution, and `allowJs` are represented through
  `ts.ParsedCommandLine`;
- callers can resolve modules, source files, symbols, aliases, and stable symbol
  keys through `SemanticProject` and `SemanticTypeContext`;
- existing in-memory test helpers still work without leaking legacy path-entry
  plumbing into normal extraction.

## 2. Non-goals

- Do not replace project-surface reachability in this plan. That belongs in
  `260617-19-2-compiler-backed-project-surface.md`.
- Do not change React extraction, source plugin behavior, or domain inference
  semantics here.
- Do not delete syntax-only fallback paths yet.
- Do not change checker IR, transition ids, var ids, Rust checker behavior, or
  TLA export.
- Do not edit generated artifacts or `dist/`.

## 3. Current-State Findings

- `src/extract/engine/ts/semantic-project.ts` already creates an in-memory
  `ts.Program`, exposes `program`, `checker`, `sourceFiles`, `getSourceFile()`,
  `getTypeAtLocation()`, and `getTypeFromTypeNode()`, and has tests in
  `test/extract/semantic-project.test.ts`.
- `src/extract/engine/spi/index.ts` exposes `SemanticTypeContext` with
  `program`, `checker`, `sourceFile`, and `getSourceFile()`. It is threaded
  through `DiscoverCtx`, `TypeCtx`, `ChannelCtx`, and `ExtractCtx`.
- `src/extract/engine/pipeline/index.ts` constructs semantic contexts per file
  when `semanticProject` is present.
- `src/cli/features/extract/command.ts` has local `readTsConfigResolution()`
  handling that returns a reduced `TsConfigResolution`.
- `src/cli/features/extract/project.ts` depends on that reduced
  `TsConfigResolution` and custom path-entry shapes.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/ts/semantic-project.ts`
  - `SemanticProjectTsConfig`
  - `SemanticSourceEntry`
  - `SemanticProject`
  - `createSemanticProject()`
  - `createSemanticProjectForTest()`
- `src/extract/engine/spi/index.ts`
  - `SemanticTypeContext`
  - `DiscoverCtx`
  - `TypeCtx`
  - `ChannelCtx`
  - `ExtractCtx`
- `src/extract/engine/pipeline/index.ts`
  - `semanticTypeContextForFile()`
  - `ExtractionPipelineOptions.semanticProject`
- `src/cli/features/extract/command.ts`
  - `ExtractionProject`
  - `loadExtractionProject()`
  - `readTsConfigResolution()`
- `src/cli/features/extract/project.ts`
  - `TsConfigResolution`
- `test/extract/semantic-project.test.ts`
- `src/cli/features/extract/command.test.ts`

## 5. Existing Patterns to Follow

- Keep TypeScript helper code in `src/extract/engine/ts/` and expose only stable
  adapter-facing shapes through `src/extract/engine/spi/index.ts`.
- Follow `createSemanticProjectForTest()` for compact compiler-backed fixtures.
- Follow `runExtractionPipeline()` as the central place for passing semantic
  context to plugins and generic extraction.
- Prefer TypeScript compiler APIs over bespoke parsing or path matching.
- Preserve structured caveat/fallback behavior; this plan should not silently
  broaden extraction.

## 6. Atomic Implementation Steps

### Step 1 - Add parsed semantic project config

Files to edit:

- `src/extract/engine/ts/semantic-project.ts`
- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/project.ts`
- `test/extract/semantic-project.test.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Introduce a `SemanticProjectConfig` shape in
   `src/extract/engine/ts/semantic-project.ts` with:
   - `configFilePath?: string`;
   - `configDir: string`;
   - `parsedCommandLine: ts.ParsedCommandLine`;
   - project references from the parsed command line;
   - canonical root names.
2. Add `loadSemanticProjectConfig(startDir: string)` or an equivalent helper.
   Use `ts.findConfigFile()`, `ts.readConfigFile()`, and
   `ts.parseJsonConfigFileContent()`.
3. Keep the existing in-memory fixture shape by adding a bridge in
   `createSemanticProject(entries, configOrLegacyTsConfig)`. The bridge is only
   for tests and transitional callers; normal CLI extraction should move to
   parsed config.
4. Update `ExtractionProject` so it stores parsed semantic config instead of
   only reduced path information.
5. Update `loadExtractionProject()` to call the new semantic config loader once
   and pass that config into semantic project creation.
6. Leave `TsConfigResolution` in place only where existing project-surface code
   still requires it. Mark the remaining use as transitional in code structure,
   not as a compatibility promise.

Acceptance criteria:

- Existing commented-tsconfig behavior still passes.
- New tests cover JSONC comments, `extends`, `baseUrl`, `paths`, JSX, NodeNext
  module resolution, `allowJs`, and a project reference that exports a type
  consumed by app source.
- No normal CLI caller manually constructs `{ prefix, suffix, targets }` path
  entries for semantic project creation.

### Step 2 - Add resolver APIs to `SemanticProject`

Files to edit:

- `src/extract/engine/ts/semantic-project.ts`
- `src/extract/engine/spi/index.ts`
- `src/extract/engine/pipeline/index.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Extend `SemanticProject` with reusable APIs:
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
3. Implement `canonicalFileName()` using the compiler host canonicalizer when
   available. Normalize paths consistently before comparing.
4. Implement `symbolAt()` with `checker.getSymbolAtLocation(node)`.
5. Implement `aliasedSymbolAt()` by resolving aliases with
   `checker.getAliasedSymbol()` only when the symbol has alias flags; otherwise
   return the direct symbol.
6. Implement `symbolKey()` with stable canonical information:
   - canonical declaration source file;
   - declaration start;
   - symbol name;
   - fallback to `checker.getFullyQualifiedName(symbol)` when declarations are
     absent.
7. Implement `localSymbolKey(node)` by looking up the node symbol or aliased
   symbol and passing it through `symbolKey()`.
8. Expose equivalent optional methods on `SemanticTypeContext` in
   `src/extract/engine/spi/index.ts`.
9. Update `semanticTypeContextForFile()` to pass these methods through.

Acceptance criteria:

- Tests prove that `./foo.js`, `./foo`, path aliases, re-export aliases, and
  type-only imports resolve to canonical files where TypeScript says they do.
- Tests prove `symbolKey()` is stable across two references to the same imported
  setter/type/component symbol.
- Tests prove `symbolKey()` differs for shadowed local identifiers with the same
  text.
- Existing semantic project tests continue to pass.

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

## 8. Acceptance Criteria

- Extraction setup can create one parsed semantic project config from the real
  TypeScript project.
- `SemanticProject` exposes canonical resolver methods for files, modules,
  symbols, aliased symbols, and stable symbol keys.
- `SemanticTypeContext` carries those resolver methods to pipeline callers.
- Transitional legacy tsconfig path shapes are isolated and not expanded.
- No checker IR or React extraction behavior changes are introduced by this
  plan.

## 9. Tests to Add or Update

Add or update focused tests for:

- JSONC tsconfig parsing with comments.
- `extends` tsconfig inheritance.
- `baseUrl` and `paths` resolution through compiler APIs.
- NodeNext `.js` import resolving to `.ts`/`.tsx`.
- project reference exporting a type consumed by a source file.
- canonical source file identity for raw entries and resolved modules.
- symbol key stability across imported aliases and re-exports.
- symbol key distinction for shadowed local identifiers.

Prefer compact compiler-backed fixtures in
`test/extract/semantic-project.test.ts`.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if project references require reading files outside the
  selected extraction roots in a way that changes CLI scope expectations.
- Stop and report if symbol keys are unstable across repeated program creation
  for the same files. Do not use TypeScript object identity as a persisted key.
- Stop and report if TypeScript config parsing produces a different file set
  than the existing extraction assumes and the difference is not explainable by
  compiler options.
- Stop and report if a resolver method would need package-specific logic. Keep
  the project resolver generic.

## 12. Must Not Change

- Do not modify Rust checker crates.
- Do not change core IR fields.
- Do not remove syntax fallback paths in this plan.
- Do not add framework-specific fields to `SemanticProject`.
- Do not add compatibility shims for removed internal options unless the shim is
  deleted before this plan ends.
