# Semantic TypeScript Foundation 2: Symbol-Backed React Extraction

Status: implementation plan.
Date: 2026-06-17.
Plan family: A — Semantic TypeScript Foundation.

## 1. Goal

Move generic React extraction away from concatenated source fragments and
string-only identity. React transition extraction should operate on actual
project `ts.SourceFile` nodes, bind write channels and setters by stable symbol
keys, and resolve components/custom hooks through symbol-backed registries.

This plan assumes `260617-19-1-semantic-project-and-resolution.md` has provided
compiler-backed project config, module resolution, and `SemanticTypeContext`
symbol helpers.

## 2. Non-goals

- Do not replace source adapter domain inference or import recognition in this
  plan. Those belong to `260617-19-3-source-adapter-semantic-migration.md`.
- Do not change checker IR semantics, Rust checker behavior, TLA export, or
  state-space slicing.
- Do not add new library support.
- Do not preserve compatibility with syntax-only internal APIs if a cleaner
  semantic API replaces them. Update tests and callers directly.
- Do not execute app code or rely on bundler-specific runtime behavior.
- Do not edit generated artifacts or `dist/`.

## 3. Current-State Findings

- `src/extract/engine/pipeline/index.ts` currently passes semantic context when
  `semanticProject` is present, but it also has supplemental
  `typeAliasDeclarations()` and `__types__.ts` concatenation behavior.
- `src/extract/engine/ts/react-source-transitions.ts` recreates a
  `ts.SourceFile` from `sourceText`, builds local `typeAliases`, merges
  `additionalTypeAliases` from concatenated fragments, parses supplemental
  component sources using the same `fileName`, and keys components, hooks,
  handlers, setters, and reset/fixed effects by strings.
- `src/extract/engine/ts/domains.ts` uses
  `findMatchingUseStateCall()` in `inferUseStateDomainSemanticDetailed()` when
  fragment source and semantic source differ.
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

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/cli/features/extract/command.ts`
  - `runProjectExtractionPipeline()`
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
- `src/extract/engine/ts/domains.ts`
  - `inferUseStateDomainSemanticDetailed()`
  - `findMatchingUseStateCall()`
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
- `src/extract/engine/ts/types.ts`
  - `SetterBinding`
  - `ContextBindings`
- `src/extract/engine/spi/index.ts`
  - `WriteChannel`
  - `SemanticTypeContext`
- `src/extract/sources/use-state/index.ts`

Tests to add/update:

- `test/extract/semantic-project.test.ts`
- `test/extraction/extraction.test.ts`
- focused source plugin tests under `src/extract/sources/use-state/` or
  `test/extract/`, matching existing placement.

## 5. Existing Patterns to Follow

- Keep TypeScript helper code in `src/extract/engine/ts/` and expose only stable
  adapter-facing shapes through `src/extract/engine/spi/index.ts`.
- Follow `runExtractionPipeline()` as the central place for passing typed
  context to plugins and generic extraction.
- Preserve structured caveat behavior. If semantic lookup is unavailable or
  ambiguous, report lower confidence where a caveat shape already exists rather
  than silently guessing.
- Keep display component names for transition ids and var ids. Internal
  matching can move to symbol keys without changing human-readable output.
- Follow current `sourceFileForDiscovery()` helpers initially, but converge them
  into one shared helper instead of duplicating across plugins.

## 6. Atomic Implementation Steps

### Step 1 — Eliminate fragment-only semantic mismatch

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

### Step 2 — Introduce symbol-keyed bindings and write channels

Files to edit:

- `src/extract/engine/spi/index.ts`
- `src/extract/engine/ts/types.ts`
- `src/extract/engine/ts/context.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/sources/use-state/index.ts`
- focused extraction tests

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

### Step 3 — Migrate component and custom hook resolution to symbols

Files to edit:

- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/context.ts`
- `src/extract/engine/spi/index.ts`
- focused component/custom-hook tests

Implementation:

1. Introduce `ComponentRegistry` and `CustomHookRegistry` internal shapes keyed
   by symbol key with secondary display-name indexes.
2. Update `componentDeclarations()` and `customHookDeclarations()` to accept
   optional `SemanticTypeContext` and return symbol-keyed entries when possible.
3. Resolve JSX component tags and called custom hooks via `checker` symbol
   lookup before falling back to uppercase/name heuristics.
4. Update `detectStatefulListComponents()`,
   `transitionsFromComponentPropAttribute()` call sites, and custom hook
   inlining to consume registry entries instead of raw `Map<string, ...>` where
   symbol identity matters.
5. Keep display component names for transition ids and var ids, but derive
   identity from the symbol key to avoid imported/shadowed component confusion.

Acceptance criteria:

- Imported components and custom hooks from project files are discoverable
  without concatenating supplemental sources.
- Shadowed component names do not cross-bind handlers or state.
- Transition ids remain readable, but internal matching does not depend only on
  names.

## 7. Per-Step Files to Edit

- Step 1: `src/cli/features/extract/command.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/domains.ts`,
  `test/extract/semantic-project.test.ts`.
- Step 2: `src/extract/engine/spi/index.ts`,
  `src/extract/engine/ts/types.ts`,
  `src/extract/engine/ts/context.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/sources/use-state/index.ts`, focused extraction tests.
- Step 3: `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/context.ts`,
  `src/extract/engine/spi/index.ts`, focused component/custom-hook tests.

## 8. Acceptance Criteria

- Generic React extraction uses project `ts.SourceFile` nodes as semantic source
  of truth for compiler-backed CLI extraction.
- Component/custom hook discovery can walk related project files through
  semantic context instead of concatenated supplemental source strings.
- `findMatchingUseStateCall()` is deleted.
- `additionalTypeAliases` and `additionalComponentSources` are removed from
  compiler-backed extraction paths.
- useState setter binding and write channels prefer symbol identity over local
  string names.
- Component/custom hook resolution can use symbol identity and does not require
  concatenating supplemental component sources.
- Syntax-only fallback remains only for tests or direct API usage without
  `semanticProject`, and fallback behavior is clearly isolated.

## 9. Tests to Add or Update

Add or update focused tests for:

- canonical source file identity for raw entry, render fragment, and
  interaction fragment;
- multi-file type/component/custom hook discovery without supplemental source
  concatenation;
- setter collision between same local setter names in different components;
- imported aliases that rename a setter-like function;
- shadowed local function sharing a setter name;
- imported/re-exported custom hook inlining;
- imported/re-exported component prop handler resolution;
- shadowed component names avoiding cross-binding;
- no-program fallback still works for direct `extractReactSourceTransitions()`
  calls.

Prefer small compiler-backed fixtures in `test/extract/semantic-project.test.ts`
and existing extraction/source tests over broad app snapshots.

## 10. Verification Commands

Run after each major step:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
```

Run after generic React extraction changes:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- test/extract
```

Run after useState source migration:

```bash
rtk pnpm test -- src/extract/sources/use-state
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if deleting `additionalComponentSources` causes a real
  extraction loss before a semantic project-wide component registry is in place.
- Stop and report if component/custom hook symbol migration would require
  changing transition id or var id public shapes. Internal matching should
  change first; human-readable ids can remain display-name based.
- Stop and report if symbol keys are missing for common local declarations
  despite `SemanticTypeContext` being available; fix resolver setup in the
  previous plan before continuing.
- Stop and report if same-name setter collision fixes require changing checker
  IR shapes. This plan should change extraction matching, not checker semantics.
- Stop and report if any step starts changing Rust checker behavior or TLA
  export.

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
