# Semantic TypeScript Foundation 3: Source Adapter Semantic Migration

Status: implementation plan.
Date: 2026-06-17.
Plan family: A — Semantic TypeScript Foundation.

## 1. Goal

Move source adapters and domain inference onto shared semantic infrastructure.
Jotai, Zustand, SWR, and useState extraction should infer domains through the
TypeChecker, recognize imports through shared semantic import/symbol helpers,
and retire syntax-only alias/path plumbing from normal compiler-backed paths.

This plan assumes:

- `260617-19-1-semantic-project-and-resolution.md` has created canonical
  project config, module resolution, and symbol helpers.
- `260617-19-2-symbol-backed-react-extraction.md` has removed supplemental
  source concatenation and moved generic React extraction to symbol-backed
  matching.

## 2. Non-goals

- Do not change checker IR semantics, Rust checker behavior, TLA export, or
  state-space slicing.
- Do not add new library support. Existing React, Jotai, Zustand, SWR, Zod, and
  router support should be migrated onto shared semantic infrastructure.
- Do not preserve compatibility with syntax-only internal APIs if a cleaner
  semantic API replaces them. Update tests and callers directly.
- Do not execute app code or rely on bundler-specific runtime behavior.
- Do not edit generated artifacts or `dist/`.

## 3. Current-State Findings

- `src/extract/engine/ts/domains.ts` still exports syntax-first
  `typeAliasDeclarations()`, `inferDomainFromTypeNodeDetailed()`, and
  `inferUseStateDomainDetailed()`. `inferUseStateDomainSemanticDetailed()`
  wraps semantic inference but still needs syntax alias fallbacks in current
  code.
- `src/extract/engine/ts/type-domains.ts` provides a good semantic mapper from
  `ts.Type` to `AbstractDomain`, but also has a private
  `typeAliasDeclarationsFromSource()` fallback for resolved aliases.
- `src/extract/sources/use-state/index.ts` already uses `SemanticTypeContext`
  for source file reuse and semantic domain inference, but should be migrated to
  the final shared domain entrypoint and symbol-keyed write channel shape.
- `src/extract/sources/jotai/imports.ts`,
  `src/extract/sources/zustand/imports.ts`, and
  `src/extract/sources/swr/discover.ts` recognize imports by string module
  specifier and local imported names. This is acceptable as a fallback, but
  should be replaced by shared semantic import/symbol helpers when a TypeChecker
  exists.
- `src/extract/sources/jotai/domains.ts`,
  `src/extract/sources/zustand/domains.ts`, and
  `src/extract/sources/swr/domains.ts` re-export or consume
  `typeAliasDeclarations()` and pass alias maps around. They already call
  semantic domain helpers when `types?.checker` exists.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/ts/domains.ts`
  - `DomainInferenceContext`
  - `inferDomainFromTypeNodeDetailed()`
  - `inferUseStateDomainDetailed()`
  - `inferUseStateDomainSemanticDetailed()`
  - `typeAliasDeclarations()`
  - new `inferDomainSemantic()` or equivalent
- `src/extract/engine/ts/type-domains.ts`
  - `TypeDomainInferenceContext`
  - `inferDomainFromTypeDetailed()`
  - `inferDomainFromTypeNodeSemanticDetailed()`
  - `inferDomainFromExpressionSemanticDetailed()`
  - `inferFromResolvedAliasDeclaration()`
  - `typeAliasDeclarationsFromSource()`
- `src/extract/engine/ts/semantic-project.ts`
  - semantic import/export helper implementation if kept in engine
- `src/extract/engine/spi/index.ts`
  - `DomainRefinementContext`
  - `SemanticTypeContext`
  - shared import/module classification context types
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
- `test/extract/numeric-domain-resolver.test.ts`
- focused source plugin tests under `src/extract/sources/**` or
  `test/extract/**`, matching existing placement.

## 5. Existing Patterns to Follow

- Keep TypeScript helper code in `src/extract/engine/ts/` and expose only stable
  adapter-facing shapes through `src/extract/engine/spi/index.ts`.
- Follow `createSemanticProjectForTest()` for small compiler-backed fixtures.
- Follow source plugin ownership boundaries: library files own their package and
  export lists; the engine provides generic semantic symbol resolution.
- Preserve structured caveat behavior. If semantic lookup is unavailable or
  ambiguous, report lower confidence where a caveat shape already exists rather
  than silently guessing.
- Prefer compiler APIs such as `checker.getSymbolAtLocation()`,
  `checker.getAliasedSymbol()`, `checker.getTypeFromTypeNode()`, and
  `checker.getExportsOfModule()` over file-wide alias maps.

## 6. Atomic Implementation Steps

### Step 1 — Centralize semantic domain inference and retire alias-map plumbing

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

### Step 2 — Migrate import recognition helpers to semantic import/symbol helpers

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

### Step 3 — Remove obsolete syntax-only infrastructure

Files to edit:

- all files touched above
- tests that depended on old internal shapes

Implementation:

1. Remove `TsConfigResolution` from compiler-backed paths. If an adapter still
   needs serializable path info, derive it from `ParsedCommandLine` at the edge.
2. Remove `additionalTypeAliases` and `additionalComponentSources` from
   `ReactSourceTransitionOptions` if the previous plan fully replaces them.
3. Remove custom path matching helpers from project surface discovery if any
   survived the first plan.
4. Remove alias-map plumbing from source plugin semantic paths.
5. Update tests to assert semantic behavior rather than old helper shapes.

Acceptance criteria:

- `rtk grep "additionalTypeAliases|additionalComponentSources|importBases\\(|firstExistingModulePath\\(|findMatchingUseStateCall\\(" src test -n`
  returns no live implementation references.
- `typeAliasDeclarations()` references are limited to explicit no-program
  fallback tests and fallback branches.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/ts/domains.ts`,
  `src/extract/engine/ts/type-domains.ts`,
  `src/extract/sources/jotai/domains.ts`,
  `src/extract/sources/zustand/domains.ts`,
  `src/extract/sources/swr/domains.ts`,
  `src/extract/sources/use-state/index.ts`,
  `test/extract/semantic-project.test.ts`,
  `test/extract/numeric-domain-resolver.test.ts`.
- Step 2: `src/extract/engine/ts/semantic-project.ts`,
  `src/extract/engine/spi/index.ts`,
  `src/extract/sources/jotai/imports.ts`,
  `src/extract/sources/zustand/imports.ts`,
  `src/extract/sources/swr/discover.ts`, corresponding tests.
- Step 3: all migrated files and stale tests.

## 8. Acceptance Criteria

- Domain inference for normal extraction is checker-backed and cross-file by
  default.
- useState, Jotai, Zustand, and SWR domain helpers call one shared semantic
  domain entrypoint.
- Syntax-only alias maps are absent from normal compiler-backed source plugin
  paths.
- Library import recognition uses shared semantic symbol helpers where a
  TypeChecker exists.
- Import aliases, local barrels, renamed imports, and re-exports are recognized
  semantically for Jotai, Zustand, and SWR where TypeScript can resolve them.
- Syntax-only fallback remains only for tests or direct API usage without
  `semanticProject`, and fallback behavior is clearly isolated.
- Obsolete syntax-only alias/path helpers are deleted where replaced.

## 9. Tests to Add or Update

Add or update focused tests for:

- cross-file type alias/interface/tagged-union domain inference;
- imported type aliases;
- optional fields;
- literal unions;
- schema/numeric refinements;
- bare `number` caveat preservation;
- Jotai import aliases, renamed imports, and local barrel recognition;
- Zustand import aliases, middleware recognition, and local barrel recognition;
- SWR `useSWR` import alias and local barrel recognition;
- no-program fallback still works for direct source helper calls.

Prefer small compiler-backed fixtures in `test/extract/semantic-project.test.ts`
and existing source plugin test files over broad app snapshots.

## 10. Verification Commands

Run after domain migration:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- test/extract/numeric-domain-resolver.test.ts
```

Run after source plugin migration:

```bash
rtk pnpm test -- src/extract/sources
rtk pnpm test -- test/extraction/extraction.test.ts
```

Run stale-reference checks:

```bash
rtk grep "additionalTypeAliases|additionalComponentSources|importBases\\(|firstExistingModulePath\\(|findMatchingUseStateCall\\(" src test -n
rtk grep "typeAliasDeclarations\\(" src test -n
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

- Stop and report if semantic domain inference loses an existing caveat, such as
  the bare `number` caveat. Preserve caveats even when type facts improve.
- Stop and report if a library recognition helper needs package-specific logic
  in the engine. The engine helper should stay generic; package/export sets
  belong in source adapters.
- Stop and report if TypeScript alias resolution cannot distinguish an import
  alias from a local function with the same name in a tested source adapter
  case. Fix semantic helper identity before migrating more libraries.
- Stop and report if removing alias-map plumbing exposes a no-program direct API
  regression. Keep an explicit fallback branch rather than mixing fallback data
  into compiler-backed paths.
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
