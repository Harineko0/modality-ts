# Semantic Import Recognition and Cleanup

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-7.
Depends on:
- `260617-19-1-semantic-project-config-resolver.md`
- `260617-19-2-compiler-backed-project-surface.md`
- `260617-19-3-semantic-source-identity-pipeline.md`
- `260617-19-4-symbol-keyed-write-channels.md`
- `260617-19-5-component-hook-symbol-registries.md`
- `260617-19-6-semantic-domain-inference.md`

## 1. Goal

Move library import recognition onto shared semantic import/export helpers and
remove obsolete syntax-only infrastructure left behind by the semantic
foundation migration.

The intended end state of this plan is:

- engine helpers can answer whether an identifier refers to an allowed named
  export from an allowed package/module set;
- Jotai, Zustand, and SWR use those helpers when semantic context exists;
- import aliases, local re-export barrels, and renamed imports are recognized
  through TypeScript symbol resolution;
- package/export lists remain owned by source adapters, not hard-coded in the
  engine;
- obsolete path, alias, supplemental source, and matching helpers are removed
  after prior plans have replaced them.

## 2. Non-goals

- Do not add new library support or broaden package lists.
- Do not change checker IR, transition ids, var ids, Rust checker behavior, or
  TLA export.
- Do not remove no-program import-declaration fallback.
- Do not perform broad real-app debugging as the primary proof.
- Do not edit generated artifacts or `dist/`.

## 3. Current-State Findings

- `src/extract/sources/jotai/imports.ts`,
  `src/extract/sources/zustand/imports.ts`, and
  `src/extract/sources/swr/discover.ts` recognize imports by string module
  specifier and local imported names.
- These syntax helpers are acceptable fallback but should use shared semantic
  symbol helpers when a `TypeChecker` exists.
- `src/extract/engine/ts/semantic-project.ts` and
  `src/extract/engine/spi/index.ts` should already expose file/module/symbol
  resolver methods from plan 1.
- Earlier plans should have removed or isolated:
  - custom path matching;
  - supplemental component/type sources;
  - `findMatchingUseStateCall()`;
  - alias-map plumbing in semantic domain paths.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/ts/semantic-project.ts`
  - generic semantic import/export helper if placed near resolver APIs
- `src/extract/engine/spi/index.ts`
  - semantic helper exposure on `SemanticTypeContext` if needed
- possible new helper file under `src/extract/engine/ts/`
  - for example `semantic-imports.ts`
- `src/extract/sources/jotai/imports.ts`
- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/zustand/imports.ts`
- `src/extract/sources/zustand/discover.ts`
- `src/extract/sources/swr/discover.ts`
- cleanup targets across:
  - `src/cli/features/extract/project.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/ts/type-domains.ts`
  - source plugin domain files
- corresponding tests

## 5. Existing Patterns to Follow

- Keep source adapters responsible for package names and exported API names.
- Keep engine helpers generic: inputs should be sets of allowed modules and
  exported names, not a Jotai/Zustand/SWR-specific decision.
- Use TypeChecker alias resolution when `types` exists.
- Keep import-declaration parsing as fallback when no semantic context exists.
- Remove obsolete helpers only after tests cover the semantic replacement.

## 6. Atomic Implementation Steps

### Step 1 - Add shared semantic import/export helper

Files to edit:

- `src/extract/engine/ts/semantic-project.ts` or new
  `src/extract/engine/ts/semantic-imports.ts`
- `src/extract/engine/spi/index.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Add a generic helper for resolving whether an identifier refers to a named
   export from a package/module set.
2. Input:
   - `Identifier`;
   - allowed package/module names;
   - allowed exported names;
   - semantic context or resolver/checker access.
3. Output:
   - `{ localName, exportedName, moduleName, symbolKey } | undefined`.
4. Use checker alias resolution and module source information where available.
5. Keep helper package-neutral. Do not hard-code library names in the engine.
6. Add tests for direct import, renamed import, local barrel re-export, and
   unrelated local shadowing.

Acceptance criteria:

- The helper recognizes semantic imports/re-exports through TypeScript symbols.
- The helper rejects local shadows and unrelated modules.

### Step 2 - Migrate Jotai, Zustand, and SWR recognition

Files to edit:

- `src/extract/sources/jotai/imports.ts`
- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/zustand/imports.ts`
- `src/extract/sources/zustand/discover.ts`
- `src/extract/sources/swr/discover.ts`
- corresponding source plugin tests

Implementation:

1. Migrate Jotai atom creators/hooks/store creators to use the shared semantic
   helper when `types` exists.
2. Migrate Zustand store creators and middlewares to use the shared semantic
   helper when `types` exists.
3. Migrate SWR `useSWR` recognition to use the shared semantic helper when
   `types` exists.
4. Preserve existing syntax import-declaration parsing as no-program fallback.
5. Keep package/export name lists in the source adapter files.
6. Add tests for import aliases, renamed imports, local barrels, and local
   shadows for each migrated source where relevant.

Acceptance criteria:

- Import aliases and local barrels are recognized semantically.
- Fallback syntax behavior remains for direct no-program unit calls.
- No package-specific logic is added to engine helpers.

### Step 3 - Remove obsolete semantic-foundation infrastructure

Files to edit:

- all migrated files from plans 1-7
- tests that depended on old internal helper shapes

Implementation:

1. Remove `TsConfigResolution` from compiler-backed paths. If an adapter still
   needs serializable path info, derive it from `ParsedCommandLine` at the edge.
2. Remove `additionalTypeAliases` and `additionalComponentSources` from
   `ReactSourceTransitionOptions` if plan 3 fully replaced them.
3. Remove custom path matching helpers from project surface discovery.
4. Remove alias-map plumbing from source plugin semantic paths.
5. Ensure `findMatchingUseStateCall()` is absent.
6. Update tests to assert semantic behavior rather than old helper shapes.

Acceptance criteria:

- The following command returns no live implementation references:

```bash
rtk grep "additionalTypeAliases|additionalComponentSources|importBases\\(|firstExistingModulePath\\(|findMatchingUseStateCall\\(" src test -n
```

- `typeAliasDeclarations()` references are limited to explicit no-program
  fallback tests and fallback branches.

### Step 4 - Run family-level verification

Files to edit:

- only fixes required by verification failures

Implementation:

1. Run the focused source plugin and extraction tests listed below.
2. Run full project checks before handoff.
3. Fix only issues caused by this plan family. Do not opportunistically refactor
   unrelated code.
4. Document any remaining syntax-only fallback references in tests or comments
   so future workers do not treat them as semantic path requirements.

Acceptance criteria:

- Full verification passes or failures are clearly reported with minimal
  repro commands and suspected owning plan.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/ts/semantic-project.ts` or
  `src/extract/engine/ts/semantic-imports.ts`,
  `src/extract/engine/spi/index.ts`,
  `test/extract/semantic-project.test.ts`.
- Step 2: Jotai/Zustand/SWR import and discover files plus corresponding tests.
- Step 3: migrated files across `src/cli/features/extract/`,
  `src/extract/engine/ts/`, `src/extract/sources/`, and stale tests.
- Step 4: only files with verification failures caused by this plan family.

## 8. Acceptance Criteria

- Shared semantic import/export helpers exist and are package-neutral.
- Jotai, Zustand, and SWR import recognition uses semantic helpers when a
  `TypeChecker` exists.
- Import aliases, renamed imports, local re-export barrels, and local shadows
  are covered by tests.
- Syntax import parsing remains only as no-program fallback.
- Obsolete syntax-only helpers replaced by this plan family are deleted or
  isolated to explicit fallback.
- Full family-level verification passes or any failures are clearly documented.

## 9. Tests to Add or Update

Add or update focused tests for:

- direct package import recognition through semantic helper;
- renamed import recognition;
- local barrel re-export recognition;
- local shadow rejection;
- Jotai atom creator/hook alias recognition;
- Zustand store creator/middleware alias recognition;
- SWR `useSWR` alias recognition;
- no-program fallback for each migrated import helper;
- absence of stale helper references after cleanup.

Prefer source plugin test files and compact semantic fixtures over broad app
snapshots.

## 10. Verification Commands

Run after semantic import migration:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- src/extract/sources
rtk pnpm test -- test/extraction/extraction.test.ts
```

Run cleanup checks:

```bash
rtk grep "additionalTypeAliases|additionalComponentSources|importBases\\(|firstExistingModulePath\\(|findMatchingUseStateCall\\(" src test -n
rtk pnpm test -- test/extract
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

- Stop and report if a library recognition helper needs package-specific logic
  in the engine. Package/export sets belong in source adapters.
- Stop and report if semantic alias resolution recognizes more APIs than the
  existing adapter package/export lists allow.
- Stop and report if cleanup removes a helper still needed by explicit
  no-program fallback.
- Stop and report if final verification failures indicate checker semantics or
  IR behavior changed. That belongs outside this plan family.

## 12. Must Not Change

- Do not modify Rust checker crates.
- Do not add new library support.
- Do not add framework-specific fields to core IR.
- Do not remove no-program fallback tests.
- Do not edit generated artifacts or `dist/`.
