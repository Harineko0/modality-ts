# Semantic Source Identity Pipeline

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-3.
Depends on:
- `260617-19-1-semantic-project-config-resolver.md`
- `260617-19-2-compiler-backed-project-surface.md`

## 1. Goal

Eliminate fragment-only semantic mismatch. Normal extraction should use actual
project `ts.SourceFile`s and compiler-owned `ts.Node`s instead of concatenating
source fragments and then trying to match them back to semantic files.

The intended end state of this plan is:

- `runProjectExtractionPipeline()` iterates interaction fragments with canonical
  file names and matching `types.sourceFile`;
- supplemental `__types__.ts` concatenation is removed from normal semantic
  extraction;
- `additionalComponentSources` and `additionalTypeAliases` are replaced by a
  typed project-wide discovery view;
- `findMatchingUseStateCall()` is deleted because semantic inference receives
  nodes from the same `SourceFile` as the active `SemanticTypeContext`;
- direct syntax-only unit calls still work as explicit fallback.

## 2. Non-goals

- Do not migrate setter, component, or custom hook matching to symbol keys in
  this plan. Later plans handle that.
- Do not centralize all domain inference here. Only remove the semantic source
  mismatch that forces call matching workarounds.
- Do not change checker IR, transition ids, var ids, Rust checker behavior, or
  TLA export.
- Do not delete syntax-only direct API fallback.
- Do not edit generated artifacts or `dist/`.

## 3. Current-State Findings

- `src/cli/features/extract/command.ts` creates semantic project state after
  source slicing but extraction still works with fragment source text.
- `src/extract/engine/pipeline/index.ts` passes semantic context when present
  but also has supplemental `typeAliasDeclarations()` handling for concatenated
  fragments.
- `src/extract/engine/ts/react-source-transitions.ts` recreates a
  `ts.SourceFile` from `sourceText`, builds local `typeAliases`, merges
  `additionalTypeAliases`, and parses supplemental component sources using the
  same `fileName`.
- `src/extract/engine/ts/domains.ts` uses
  `findMatchingUseStateCall()` inside semantic useState inference to bridge
  nodes from fragment source to semantic source.
- Multi-file component, custom hook, and type alias discovery currently depend
  on string/source merges that should become project-aware.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/cli/features/extract/command.ts`
  - `runProjectExtractionPipeline()`
  - project fragment construction and iteration
- `src/extract/engine/pipeline/index.ts`
  - `runExtractionPipeline()`
  - `semanticTypeContextForFile()`
  - supplemental `typeAliasDeclarations()` path
- `src/extract/engine/ts/react-source-transitions.ts`
  - `ReactSourceTransitionOptions.types`
  - `additionalTypeAliases`
  - `additionalComponentSources`
  - local `typeAliases`
  - `componentDeclarations()`
  - `customHookDeclarations()`
- `src/extract/engine/ts/domains.ts`
  - `inferUseStateDomainSemanticDetailed()`
  - `findMatchingUseStateCall()`
- `test/extract/semantic-project.test.ts`
- focused extraction tests under `test/extract/` or `test/extraction/`

## 5. Existing Patterns to Follow

- Keep `runExtractionPipeline()` as the central orchestration boundary for
  generic extraction and source plugins.
- Preserve direct `extractReactSourceTransitions(sourceText)` behavior when no
  `types` context exists.
- Prefer passing typed semantic context over concatenating synthetic source.
- Keep fallback behavior lower confidence and explicit in tests/comments.
- Avoid broad refactors of React extraction while changing source identity.

## 6. Atomic Implementation Steps

### Step 1 - Preserve canonical file identity through pipeline entry

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/extract/engine/pipeline/index.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Identify where project extraction builds raw, render, and interaction
   fragments.
2. Ensure each fragment carries:
   - canonical file name;
   - original source text for reporting;
   - matching `ts.SourceFile` from `semanticProject.getSourceFile()`;
   - semantic type context created from that exact source file.
3. Update `runProjectExtractionPipeline()` so each extraction unit uses the
   semantic source file from the project rather than reparsing the fragment as
   the semantic source of truth.
4. Add tests proving raw entry, render fragment, and interaction fragment
   resolve to the same canonical source file where appropriate.

Acceptance criteria:

- Semantic contexts are always tied to project `SourceFile`s.
- Existing syntax-only tests can still construct extraction from raw source
  without a semantic project.

### Step 2 - Replace supplemental source merges with project-wide discovery view

Files to edit:

- `src/extract/engine/pipeline/index.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/cli/features/extract/command.ts`

Implementation:

1. Remove normal semantic use of supplemental `__types__.ts` concatenation in
   `runExtractionPipeline()`.
2. Replace `additionalTypeAliases` and `additionalComponentSources` with a
   typed project-wide discovery view. Choose the smaller clean option:
   - pass `relatedFragments` plus each fragment's semantic context; or
   - expose relevant project source files from `SemanticTypeContext` and let
     discovery walk those files.
3. Keep syntax-only fallback fields only if direct no-program tests still need
   them during this plan, and mark them transitional.
4. Ensure multi-file extraction can still discover relevant components, custom
   hooks, and type aliases through project files.

Acceptance criteria:

- Supplemental semantic `__types__.ts` concatenation is deleted.
- Multi-file extraction no longer relies on parsing different source files with
  the same synthetic file name.
- Project-wide discovery has clear typed inputs and no string merge contract.

### Step 3 - Delete useState semantic call rematching

Files to edit:

- `src/extract/engine/ts/domains.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Update useState domain inference call sites so the `ts.CallExpression`
   passed to `inferUseStateDomainSemanticDetailed()` comes from
   `types.sourceFile`.
2. Remove `findMatchingUseStateCall()` and any matching-by-position workaround.
3. Keep syntax-only `inferUseStateDomainDetailed()` path for calls without
   semantic context.
4. Add regression tests where a useState call with imported/cross-file type
   context infers through the checker without source rematching.

Acceptance criteria:

- `findMatchingUseStateCall()` is deleted.
- Semantic useState inference never tries to match a node from one source file
  to another.
- No-program extraction remains covered as fallback.

## 7. Per-Step Files to Edit

- Step 1: `src/cli/features/extract/command.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `test/extract/semantic-project.test.ts`.
- Step 2: `src/extract/engine/pipeline/index.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/cli/features/extract/command.ts`.
- Step 3: `src/extract/engine/ts/domains.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `test/extract/semantic-project.test.ts`.

## 8. Acceptance Criteria

- Normal semantic extraction uses project-owned `ts.SourceFile`s and nodes.
- Supplemental semantic source concatenation is removed.
- `additionalTypeAliases` and `additionalComponentSources` no longer drive
  compiler-backed extraction.
- `findMatchingUseStateCall()` is gone.
- Multi-file extraction still finds components, custom hooks, and type aliases
  through semantic project files.
- Direct syntax-only API usage continues to work as explicit fallback.

## 9. Tests to Add or Update

Add or update focused tests for:

- canonical source file identity for raw entry/render/interaction fragments;
- multi-file type alias discovery without concatenated `__types__.ts`;
- multi-file component/custom hook discovery without supplemental sources;
- semantic useState inference with a node from the project source file;
- no-program `extractReactSourceTransitions()` fallback.

Prefer focused semantic fixtures in `test/extract/semantic-project.test.ts` and
targeted extraction tests over broad snapshots.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- test/extract
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if deleting `additionalComponentSources` causes extraction
  loss before a semantic project-wide component discovery view is in place.
- Stop and report if any extraction path still needs to parse a project file
  under a synthetic file name for semantic behavior.
- Stop and report if preserving syntax fallback requires keeping legacy options
  in normal semantic paths.
- Stop and report if this plan starts forcing component/custom hook symbol
  registry decisions. That belongs in plan 5.

## 12. Must Not Change

- Do not change public transition id or var id shapes.
- Do not modify Rust checker crates.
- Do not change checker semantics.
- Do not centralize source plugin domain inference here.
- Do not edit generated artifacts or `dist/`.
