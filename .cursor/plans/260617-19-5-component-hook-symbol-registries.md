# Component and Hook Symbol Registries

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-5.
Depends on:
- `260617-19-1-semantic-project-config-resolver.md`
- `260617-19-3-semantic-source-identity-pipeline.md`
- `260617-19-4-symbol-keyed-write-channels.md`

## 1. Goal

Move component and custom hook discovery/resolution onto symbol-keyed internal
registries. Names should remain readable display indexes, but matching imported,
re-exported, and shadowed declarations should use semantic symbol identity when
available.

The intended end state of this plan is:

- component declarations and custom hook declarations can be keyed by symbol
  key;
- JSX component tags and called custom hooks resolve through the checker before
  name heuristics;
- imported project components and custom hooks are discoverable without
  concatenating supplemental sources;
- shadowed component or hook names do not cross-bind handlers, state, or custom
  hook inlining;
- transition ids and var ids remain human-readable.

## 2. Non-goals

- Do not change public transition id or var id shapes unless there is no
  alternative; stop and report first.
- Do not change write-channel identity except where registry integration
  requires existing plan 4 fields.
- Do not centralize domain inference.
- Do not change checker IR, Rust checker behavior, or TLA export.
- Do not remove no-program name-heuristic fallback.

## 3. Current-State Findings

- `src/extract/engine/ts/components.ts` discovers components and custom hooks by
  name and resolves inline custom hook state through syntax names.
- `src/extract/engine/ts/react-source-transitions.ts` keys components, hooks,
  handlers, setters, and reset/fixed effects by strings.
- `src/extract/engine/ts/context.ts` participates in component-scoped setter
  binding and will need registry-compatible component identity.
- Imported components/custom hooks cannot be represented by symbol identity yet.
- Plan 3 should remove supplemental source concatenation and provide a
  project-wide discovery view.
- Plan 4 should provide symbol-keyed setter/write-channel identity.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/ts/components.ts`
  - `componentDeclarations()`
  - `customHookDeclarations()`
  - `inlineCustomHookState()`
  - `calledCustomHook()`
  - `detectStatefulListComponents()`
- `src/extract/engine/ts/react-source-transitions.ts`
  - component/custom hook declaration maps
  - handler discovery and component prop transition call sites
- `src/extract/engine/ts/context.ts`
  - component-scoped setter binding call sites
- `src/extract/engine/spi/index.ts`
  - semantic context additions only if required
- relevant tests:
  - `test/extraction/extraction.test.ts`
  - `test/extract/semantic-project.test.ts`
  - focused component/custom-hook tests under `test/extract/`

## 5. Existing Patterns to Follow

- Keep display names stable and readable.
- Use semantic identity internally where it affects correctness.
- Keep fallback uppercase/name heuristics for direct no-program API usage.
- Prefer internal registry shapes over changing external IR.
- Add small compiler-backed fixtures for imported/re-exported components and
  hooks.

## 6. Atomic Implementation Steps

### Step 1 - Introduce registry shapes

Files to edit:

- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`

Implementation:

1. Introduce internal `ComponentRegistry` and `CustomHookRegistry` shapes.
2. Each registry entry should include:
   - `symbolKey?: string`;
   - display name;
   - declaration node;
   - source file/canonical file name if available;
   - any existing metadata needed by callers.
3. Maintain secondary display-name indexes for fallback and readable ids.
4. Keep the initial registry local to React extraction unless multiple modules
   need it immediately.

Acceptance criteria:

- Existing component/custom hook discovery can be represented by registry
  entries without changing behavior yet.
- Display-name lookup still supports no-program fallback.

### Step 2 - Populate registries with semantic keys

Files to edit:

- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Update `componentDeclarations()` and `customHookDeclarations()` to accept
   optional `SemanticTypeContext`.
2. When `types` is present, compute a symbol key from the declaration name or
   the symbol-bearing declaration node.
3. Walk the project-wide discovery view introduced by plan 3 so imported
   project files can contribute declarations.
4. Keep syntax-only single-source declaration discovery when no `types` context
   exists.
5. Add tests proving imported and re-exported components/custom hooks populate
   registry entries with symbol keys.

Acceptance criteria:

- Imported project declarations are discoverable without supplemental source
  concatenation.
- Registry entries include symbol keys under semantic extraction.

### Step 3 - Resolve JSX tags and custom hook calls by symbol

Files to edit:

- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- focused tests

Implementation:

1. Resolve JSX component tags with checker symbol lookup before uppercase/name
   heuristics.
2. Resolve called custom hooks with checker symbol lookup before name heuristics.
3. Update `calledCustomHook()` and custom hook inlining to consume registry
   entries instead of raw `Map<string, ...>` where symbol identity matters.
4. Keep display-name fallback for no-program calls.
5. Add tests for shadowed component names and shadowed custom hook names.

Acceptance criteria:

- Shadowed component/hook names do not cross-bind.
- No-program fallback remains name based and covered by tests.

### Step 4 - Update dependent React extraction call sites

Files to edit:

- `src/extract/engine/ts/components.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/context.ts`
- focused tests

Implementation:

1. Update `detectStatefulListComponents()` to use registry entries where
   identity matters.
2. Update `transitionsFromComponentPropAttribute()` call sites to resolve target
   components through the registry.
3. Update context binding paths that scope setters by component so they can use
   component registry identity if needed.
4. Keep emitted transition ids and var ids display-name based.
5. Add tests for imported/re-exported component prop handler resolution and
   imported/re-exported custom hook inlining.

Acceptance criteria:

- Imported/re-exported component prop handlers are resolved semantically.
- Imported/re-exported custom hooks inline semantically.
- Public ids remain readable.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`.
- Step 2: `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `test/extract/semantic-project.test.ts`.
- Step 3: `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`, focused tests.
- Step 4: `src/extract/engine/ts/components.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/context.ts`, focused tests.

## 8. Acceptance Criteria

- Components and custom hooks are internally represented by symbol-keyed
  registries when semantic context exists.
- Imported and re-exported project components/custom hooks are discoverable
  without source concatenation.
- JSX tag and custom hook call resolution use checker identity before name
  heuristics.
- Shadowed names do not cross-bind handlers, state, or hook inlining.
- Transition ids and var ids remain display-name based.

## 9. Tests to Add or Update

Add or update focused tests for:

- imported component discovery from project files;
- re-exported component discovery through a local barrel;
- imported custom hook inlining;
- re-exported custom hook inlining;
- shadowed component names;
- shadowed custom hook names;
- component prop handler resolution through imported/re-exported components;
- no-program fallback using name heuristics.

Prefer focused fixtures in `test/extract/semantic-project.test.ts` and
`test/extraction/extraction.test.ts`.

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

- Stop and report if registry migration would require changing public transition
  id or var id shapes.
- Stop and report if project-wide registry population becomes a broad app scan
  rather than a bounded related-source discovery view.
- Stop and report if a symbol lookup cannot distinguish imported/re-exported
  declarations because the semantic context is missing project files.
- Stop and report if component identity needs source-plugin-specific logic in
  the generic engine.

## 12. Must Not Change

- Do not modify Rust checker crates.
- Do not change checker IR fields.
- Do not remove display-name fallback.
- Do not centralize domain inference in this plan.
- Do not edit generated artifacts or `dist/`.
