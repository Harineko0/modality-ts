# Symbol-Keyed Write Channels

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-4.
Depends on:
- `260617-19-1-semantic-project-config-resolver.md`
- `260617-19-3-semantic-source-identity-pipeline.md`

## 1. Goal

Move write-channel and setter binding identity from local string names to stable
semantic symbol keys when a `TypeChecker` is available. Local names should
remain display/fallback data only.

The intended end state of this plan is:

- `WriteChannel` and `SetterBinding` can carry stable symbol identity;
- `bindSetter()` and `settersForComponent()` prefer symbol keys for exact
  matching;
- useState discovery/write-channel extraction computes setter symbol keys from
  semantic context;
- generic React setter calls resolve by checker symbol lookup before local-name
  fallback;
- same-name setters in different scopes no longer depend on deleting or
  overriding unscoped string bindings for correctness.

## 2. Non-goals

- Do not migrate component/custom hook discovery to symbol registries here.
  That belongs in plan 5.
- Do not centralize all semantic domain inference.
- Do not change transition ids, var ids, or report display names.
- Do not remove no-program string-name fallback.
- Do not modify checker IR, Rust checker behavior, or TLA export.

## 3. Current-State Findings

- `src/extract/engine/spi/index.ts` defines `WriteChannel` with
  `symbolName` as the local setter/display string.
- `src/extract/engine/ts/types.ts` defines `SetterBinding` without stable
  symbol identity.
- `src/extract/engine/ts/context.ts` discovers context provider setter aliases
  with syntax-only maps keyed by local identifier names.
- `bindSetter()` uses a string key plus an ad hoc scoped key
  `${component}:${symbolName}` to handle collisions.
- `src/extract/sources/use-state/index.ts` uses `SemanticTypeContext` but
  `WriteChannel.symbolName` is still only the local setter string.
- Plan 1 should provide `ctx.types.localSymbolKey(identifier)` and related
  symbol helper methods.
- Plan 3 should ensure semantic extraction nodes come from the active project
  `SourceFile`.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

- `src/extract/engine/spi/index.ts`
  - `WriteChannel`
  - `SemanticTypeContext`
  - `ChannelCtx`
  - `ExtractCtx`
- `src/extract/engine/ts/types.ts`
  - `SetterBinding`
  - `ContextBindings`
- `src/extract/engine/ts/context.ts`
  - `ContextBindings`
  - `bindSetter()`
  - `settersForComponent()`
  - `discoverContextBindings()`
  - `bindContextHookObjectDeclaration()`
  - `setterAliasBinding()`
- `src/extract/engine/ts/react-source-transitions.ts`
  - setter discovery and setter call resolution
- `src/extract/sources/use-state/index.ts`
  - write channel construction
- source plugins with write channels as needed
- focused tests under `test/extract/` and source plugin tests

## 5. Existing Patterns to Follow

- Preserve human-readable names for reporting and transition ids.
- Use optional semantic fields so no-program fallback remains available.
- Keep source adapter-facing shapes in `src/extract/engine/spi/index.ts`.
- Prefer `ctx.types.localSymbolKey(node)` over direct checker access in source
  plugins.
- Add focused collision tests rather than relying on broad snapshots.

## 6. Atomic Implementation Steps

### Step 1 - Extend write-channel and setter binding shapes

Files to edit:

- `src/extract/engine/spi/index.ts`
- `src/extract/engine/ts/types.ts`

Implementation:

1. Extend `WriteChannel` with optional `symbolKey?: string`.
2. Add optional `declarationKey?: string` only if there is a real distinction
   between a write function symbol and the declaration site needed by callers.
   Otherwise prefer one `symbolKey` field.
3. Keep `symbolName` as required only if existing reporting/tests rely on it.
   Document by type naming/comments that it is display/fallback identity.
4. Extend `SetterBinding` with optional `symbolKey?: string`.
5. Update any compile errors by passing through `symbolKey` without changing
   behavior yet.

Acceptance criteria:

- Typecheck guides all required shape updates.
- No behavior changes are intended in this step alone.

### Step 2 - Prefer symbol keys in context setter binding

Files to edit:

- `src/extract/engine/ts/context.ts`
- `src/extract/engine/ts/types.ts`
- focused tests

Implementation:

1. Change `bindSetter()` to use `symbolKey` as the primary binding key when
   present.
2. Keep `symbolName` matching only as a syntax-only fallback.
3. Change `settersForComponent()` to scope local setters by component plus
   symbol key rather than only `${component}:${symbolName}`.
4. Preserve existing display names in returned bindings.
5. Add collision tests where two components have setters with the same local
   name and both remain independently bindable.

Acceptance criteria:

- Same-name setters in different scopes bind independently by symbol key.
- Existing no-program fallback tests still pass.

### Step 3 - Compute useState setter symbol keys

Files to edit:

- `src/extract/sources/use-state/index.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- focused source plugin tests

Implementation:

1. In useState discovery/write channel extraction, compute setter identity with
   `ctx.types.localSymbolKey(setterIdentifier)` when available.
2. Populate `WriteChannel.symbolKey` and keep `symbolName` as local display.
3. In generic React extraction, compute local useState setter symbol keys from
   the setter identifier.
4. Ensure write channels emitted from the generic path and source-plugin path
   agree on symbol keys for the same setter declaration.

Acceptance criteria:

- useState write channels include symbol keys under semantic extraction.
- The same setter declaration receives the same symbol key across discovery and
  extraction stages.
- No-program extraction still emits local names.

### Step 4 - Resolve setter calls by symbol

Files to edit:

- `src/extract/engine/ts/react-source-transitions.ts`
- `src/extract/engine/ts/context.ts`
- focused extraction tests

Implementation:

1. When visiting handler calls and setter calls, use
   `types.localSymbolKey(identifier)` or the equivalent checker lookup to
   resolve the call target.
2. Match call targets to `SetterBinding.symbolKey` before falling back to local
   name matching.
3. Add tests for:
   - imported aliases that rename a setter-like function;
   - a shadowed local function sharing a setter name;
   - same local setter names in different components.
4. Confirm fallback behavior remains when `types` is absent.

Acceptance criteria:

- Symbol identity is the primary correctness mechanism whenever available.
- `WriteChannel.symbolName` remains only for reporting/fallback and is not the
  primary matching key when `symbolKey` exists.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/spi/index.ts`,
  `src/extract/engine/ts/types.ts`.
- Step 2: `src/extract/engine/ts/context.ts`,
  `src/extract/engine/ts/types.ts`, focused tests.
- Step 3: `src/extract/sources/use-state/index.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`, source plugin tests.
- Step 4: `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/context.ts`, focused extraction tests.

## 8. Acceptance Criteria

- `WriteChannel` and `SetterBinding` support optional symbol identity.
- Context setter binding and React setter call resolution prefer symbol keys.
- useState source-plugin and generic extraction paths compute consistent setter
  symbol keys.
- Same-name and shadowed setter scenarios are covered by tests.
- Fallback behavior still works without `types`.

## 9. Tests to Add or Update

Add or update focused tests for:

- same local setter name in two components;
- imported alias renaming a setter-like function;
- shadowed local function sharing a setter name;
- consistent symbol key between discovery/write channel and generic extraction;
- no-program fallback using `symbolName`.

Use existing test placement under `test/extract/` or source plugin tests.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- src/extract/sources
rtk pnpm test -- test/extraction/extraction.test.ts
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if symbol keys are not stable between discovery and extraction
  stages for the same setter.
- Stop and report if adding symbol identity requires changing public transition
  ids or var ids.
- Stop and report if imported setter-like functions need component/hook symbol
  registry work. That belongs in plan 5 unless the change is strictly about
  write channels.
- Stop and report if no-program fallback starts masking a semantic miss.

## 12. Must Not Change

- Do not modify Rust checker crates.
- Do not change checker IR fields.
- Do not remove local display names.
- Do not migrate component/custom hook registries in this plan.
- Do not edit generated artifacts or `dist/`.
