# Compiler-Backed Project Surface

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-2.
Depends on: `260617-19-1-semantic-project-config-resolver.md`.

## 1. Goal

Make project surface discovery use the canonical compiler resolver introduced
in plan 1. The import graph walker should still use syntax to find import and
re-export declarations, but all module target decisions should come from
`SemanticProject.resolveModuleName()`.

The intended end state of this plan is:

- `sourceWithReachableImports()` accepts `SemanticProject` or a lightweight
  semantic module resolver;
- custom `baseUrl`/`paths` matching and extension probing are removed from the
  compiler-backed path;
- re-export following and server action import discovery resolve modules
  through the compiler resolver;
- unresolved modules are explicit surface warnings rather than silent misses.

## 2. Non-goals

- Do not change semantic project config/resolver APIs except for small fixes
  needed by this plan.
- Do not change React transition extraction or source plugin domain inference.
- Do not replace fragment concatenation in this plan.
- Do not change checker IR, transition ids, var ids, Rust checker behavior, or
  TLA export.
- Do not edit generated artifacts or `dist/`.

## 3. Current-State Findings

- `src/cli/features/extract/project.ts` performs AST import graph traversal,
  import binding parsing, re-export following, `baseUrl`/`paths` matching, and
  extension probing.
- `sourceWithReachableImports()` currently depends on reduced
  `TsConfigResolution` rather than compiler module resolution.
- `resolveImportPath()`, `importBases()`, and `firstExistingModulePath()`
  duplicate TypeScript module resolution and miss project references/package
  export semantics.
- `followDeclarationReference()` and `discoverServerActionImportAliases()`
  perform path candidate resolution that should defer to the semantic resolver.
- Plan 1 should provide `SemanticProject.resolveModuleName()` backed by
  `ts.resolveModuleName()`.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/cli/features/extract/project.ts`
  - `TsConfigResolution`
  - `sourceWithReachableImports()`
  - `resolveImportPath()`
  - `importBases()`
  - `firstExistingModulePath()`
  - `followDeclarationReference()`
  - `discoverServerActionImportAliases()`
- `src/cli/features/extract/command.ts`
  - `ExtractionProject`
  - `loadExtractionProject()`
  - `buildClientProjectSurface()`
  - `runProjectExtractionPipeline()`
- `src/extract/engine/ts/semantic-project.ts`
  - `SemanticProject.resolveModuleName()`
  - any exported resolver type introduced by plan 1
- `src/cli/features/extract/command.test.ts`

## 5. Existing Patterns to Follow

- Keep CLI project loading in `src/cli/features/extract/command.ts`.
- Keep project surface traversal in `src/cli/features/extract/project.ts`.
- Use compiler APIs for resolution and keep syntax parsing only for finding
  imports, exports, and locally referenced identifiers.
- Preserve existing surface behavior unless tests demonstrate previous behavior
  was unsound.
- Prefer explicit warnings over silent guesses when a module cannot be resolved.

## 6. Atomic Implementation Steps

### Step 1 - Thread semantic resolver into project surface discovery

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/project.ts`
- `src/extract/engine/ts/semantic-project.ts`

Implementation:

1. Define a small `SemanticModuleResolver` type if using the full
   `SemanticProject` would create an avoidable dependency. It should include
   only:
   - `canonicalFileName(fileName: string): string`;
   - `getSourceFile(fileName: string): ts.SourceFile | undefined`;
   - `resolveModuleName(specifier: string, containingFile: string): ...`.
2. Pass the semantic resolver into `sourceWithReachableImports()` from
   `buildClientProjectSurface()` or the closest existing call site.
3. Keep the current syntax scanning for import declarations, export
   declarations, and referenced identifiers.
4. Ensure every discovered source path is canonicalized through the semantic
   resolver before set membership comparisons.

Acceptance criteria:

- Existing reachability tests continue to pass.
- No project-surface caller has to provide reduced `paths` entries when a
  semantic resolver is available.

### Step 2 - Replace custom import path resolution

Files to edit:

- `src/cli/features/extract/project.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Replace `resolveImportPath()` internals with
   `semanticResolver.resolveModuleName(specifier, containingFile)`.
2. Delete compiler-backed use of `importBases()` and
   `firstExistingModulePath()`.
3. Remove custom `baseUrl`/`paths` matching and extension probing from the
   normal semantic path.
4. Keep a tightly scoped no-program fallback only if a direct unit path still
   calls `sourceWithReachableImports()` without semantic resolution.
5. Add tests for:
   - path alias import;
   - extensionless import;
   - `.js` specifier resolving to `.ts`/`.tsx` source under NodeNext.

Acceptance criteria:

- `importBases()` and `firstExistingModulePath()` have no live compiler-backed
  implementation references.
- NodeNext and path alias behavior comes from TypeScript resolution, not local
  string expansion.

### Step 3 - Resolve re-exports and server actions through the compiler

Files to edit:

- `src/cli/features/extract/project.ts`
- `src/cli/features/extract/command.test.ts`

Implementation:

1. Update `followDeclarationReference()` to resolve re-export module targets
   with the semantic resolver.
2. Update `discoverServerActionImportAliases()` to resolve imported server
   action modules with the semantic resolver.
3. Preserve current syntax checks for identifying which imports matter.
4. Treat unresolved modules as explicit surface warnings with source file,
   specifier, and import/export kind.
5. Add tests for:
   - re-export from an aliased module;
   - type-only import excluded from interaction surface;
   - unresolved module warning shape.

Acceptance criteria:

- Re-export target discovery uses compiler resolution.
- Server action import discovery uses compiler resolution.
- Type-only imports do not expand the interaction surface.

## 7. Per-Step Files to Edit

- Step 1: `src/cli/features/extract/command.ts`,
  `src/cli/features/extract/project.ts`,
  `src/extract/engine/ts/semantic-project.ts`.
- Step 2: `src/cli/features/extract/project.ts`,
  `src/cli/features/extract/command.test.ts`.
- Step 3: `src/cli/features/extract/project.ts`,
  `src/cli/features/extract/command.test.ts`.

## 8. Acceptance Criteria

- Project surface discovery uses compiler module resolution for normal CLI
  extraction.
- Custom path alias and extension-probing helpers are deleted or limited to
  explicit no-program fallback paths.
- Re-export and server action module targets are resolved through the same
  semantic resolver.
- Unresolved module cases are visible as explicit warnings.
- Existing reachability behavior remains covered by tests.

## 9. Tests to Add or Update

Add or update focused tests in `src/cli/features/extract/command.test.ts` for:

- path alias import;
- extensionless import;
- NodeNext `.js` import resolving to `.ts`/`.tsx`;
- re-export from an aliased module;
- type-only import excluded from interaction surface;
- unresolved module warning source details.

Prefer small synthetic project fixtures over broad app snapshots.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- test/extract
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if TypeScript `ts.resolveModuleName()` cannot resolve a case
  current extraction supports; add a minimal fixture and decide whether current
  behavior was unsound or compiler host setup is incomplete.
- Stop and report if package export conditions require a project-level policy
  decision not already represented by parsed TypeScript config.
- Stop and report if unresolved module warnings would change CLI output format
  in a user-visible way outside existing warning/caveat patterns.
- Stop and report if removing a custom resolver helper breaks a no-program unit
  path that cannot reasonably receive a semantic resolver.

## 12. Must Not Change

- Do not modify Rust checker crates.
- Do not change extraction IR shapes.
- Do not change React transition extraction internals.
- Do not add bundler-specific resolution logic.
- Do not edit `dist/` or generated artifacts.
