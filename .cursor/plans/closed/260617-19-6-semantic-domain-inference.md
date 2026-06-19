# Semantic Domain Inference

Status: implementation plan.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.
Split sequence: 260617-19-6.
Depends on:
- `260617-19-1-semantic-project-config-resolver.md`
- `260617-19-3-semantic-source-identity-pipeline.md`

## 1. Goal

Centralize checker-backed domain inference and retire alias-map plumbing from
normal compiler-backed extraction paths. Syntax alias maps should remain only as
explicit no-program fallback.

The intended end state of this plan is:

- source plugins and generic useState inference call one semantic domain
  entrypoint;
- cross-file type aliases, imported aliases, interfaces, literal unions, tagged
  unions, optional fields, schema refinements, and numeric refinements infer
  through `ts.TypeChecker`;
- duplicate file-wide alias maps are removed from semantic paths;
- numeric caveat behavior for bare `number` remains intact;
- `typeAliasDeclarations()` survives only for fallback tests/branches.

## 2. Non-goals

- Do not change checker abstract domain semantics beyond using more accurate
  compiler facts.
- Do not add new schema or library support.
- Do not change import recognition for library APIs. Plan 7 handles that.
- Do not change transition ids, var ids, Rust checker behavior, or TLA export.
- Do not remove direct no-program fallback.

## 3. Current-State Findings

- `src/extract/engine/ts/domains.ts` exports syntax-first
  `typeAliasDeclarations()`, `inferDomainFromTypeNodeDetailed()`,
  `inferUseStateDomainDetailed()`, and
  `inferUseStateDomainSemanticDetailed()`.
- `src/extract/engine/ts/type-domains.ts` provides a semantic mapper from
  `ts.Type` to `AbstractDomain`, but also contains
  `typeAliasDeclarationsFromSource()` fallback for resolved aliases.
- `src/extract/sources/jotai/domains.ts`,
  `src/extract/sources/zustand/domains.ts`, and
  `src/extract/sources/swr/domains.ts` re-export or consume
  `typeAliasDeclarations()` and pass alias maps around.
- `src/extract/sources/use-state/index.ts` already receives semantic context but
  still interacts with domain helpers that support alias-map fallback.
- Plan 3 should ensure semantic inference receives nodes from the correct
  project `SourceFile`.

## 4. Exact File Paths and Relevant Symbols

Primary files to edit:

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
- `src/extract/sources/use-state/index.ts`
- `src/extract/sources/jotai/domains.ts`
- `src/extract/sources/zustand/domains.ts`
- `src/extract/sources/swr/domains.ts`
- `test/extract/semantic-project.test.ts`
- `test/extract/numeric-domain-resolver.test.ts`

## 5. Existing Patterns to Follow

- Keep domain conversion logic in `src/extract/engine/ts/type-domains.ts` and
  public/fallback wrappers in `src/extract/engine/ts/domains.ts`.
- Preserve structured caveats and confidence behavior.
- Prefer `checker.getTypeFromTypeNode()` and `checker.getTypeAtLocation()` over
  parsing alias maps.
- Keep source-plugin library files responsible for source-specific model
  choices; the engine domain entrypoint should be generic.
- Add focused compiler-backed fixtures for domain shapes.

## 6. Atomic Implementation Steps

### Step 1 - Create one semantic domain entrypoint

Files to edit:

- `src/extract/engine/ts/domains.ts`
- `src/extract/engine/ts/type-domains.ts`
- `test/extract/semantic-project.test.ts`

Implementation:

1. Create one public semantic domain entrypoint, for example
   `inferDomainSemantic(nodeOrType, ctx)`.
2. It should support:
   - `ts.TypeNode`;
   - `ts.Expression`;
   - `ts.Type` if useful for callers;
   - existing `DomainRefinementProvider`s;
   - initializer/varId/source caveats.
3. If `ctx.checker` or semantic context is absent, route to the existing
   syntax fallback rather than guessing.
4. Preserve existing detailed result/caveat shapes.
5. Add tests for the new entrypoint with a local type alias and a direct
   expression initializer.

Acceptance criteria:

- New callers have one semantic entrypoint to use.
- Existing helper functions can delegate to it without changing external
  behavior.

### Step 2 - Migrate useState and source plugin domain callers

Files to edit:

- `src/extract/sources/use-state/index.ts`
- `src/extract/sources/jotai/domains.ts`
- `src/extract/sources/zustand/domains.ts`
- `src/extract/sources/swr/domains.ts`
- focused source plugin tests

Implementation:

1. Update useState domain inference to call the semantic entrypoint when
   `types?.checker` exists.
2. Update Jotai, Zustand, and SWR domain helpers to call the semantic entrypoint
   rather than accepting or constructing alias maps for normal semantic paths.
3. Keep syntax alias-map fallback only when no semantic context exists.
4. Preserve source-specific caveat handling and refinement providers.

Acceptance criteria:

- Source plugin semantic paths do not pass file-wide alias maps.
- No-program source plugin tests still pass through fallback.

### Step 3 - Remove duplicate semantic alias-map fallback

Files to edit:

- `src/extract/engine/ts/domains.ts`
- `src/extract/engine/ts/type-domains.ts`
- source plugin domain files
- focused tests

Implementation:

1. Delete duplicate alias-map exports from source domain files once callers are
   migrated.
2. Delete `typeAliasDeclarationsFromSource()` if resolved alias declarations can
   be inferred directly from:
   - `checker.getTypeFromTypeNode()`;
   - `checker.getTypeAtLocation()`;
   - alias declaration symbols.
3. Keep `typeAliasDeclarations()` only for no-program fallback and tests.
4. Add tests for imported type aliases, interfaces, literal unions, tagged
   unions, and optional fields.

Acceptance criteria:

- Syntax alias maps are absent from normal compiler-backed plugin paths.
- `typeAliasDeclarations()` references are limited to fallback branches/tests.

### Step 4 - Preserve numeric/schema caveats

Files to edit:

- `src/extract/engine/ts/type-domains.ts`
- `src/extract/engine/ts/domains.ts`
- `test/extract/numeric-domain-resolver.test.ts`
- relevant source plugin tests

Implementation:

1. Verify bare `number` still emits the same numeric caveat behavior.
2. Verify schema/numeric refinements still apply through existing
   `DomainRefinementProvider`s.
3. Add regression tests for cross-file numeric refinements if fixtures are
   missing.
4. Do not broaden number domains silently when semantic lookup is ambiguous.

Acceptance criteria:

- No regression in numeric caveat emission for bare `number`.
- Refinement providers still influence semantic inference.

## 7. Per-Step Files to Edit

- Step 1: `src/extract/engine/ts/domains.ts`,
  `src/extract/engine/ts/type-domains.ts`,
  `test/extract/semantic-project.test.ts`.
- Step 2: `src/extract/sources/use-state/index.ts`,
  `src/extract/sources/jotai/domains.ts`,
  `src/extract/sources/zustand/domains.ts`,
  `src/extract/sources/swr/domains.ts`, source plugin tests.
- Step 3: `src/extract/engine/ts/domains.ts`,
  `src/extract/engine/ts/type-domains.ts`, source plugin domain files,
  focused tests.
- Step 4: `src/extract/engine/ts/type-domains.ts`,
  `src/extract/engine/ts/domains.ts`,
  `test/extract/numeric-domain-resolver.test.ts`, relevant source plugin tests.

## 8. Acceptance Criteria

- Domain inference for normal extraction is checker-backed and cross-file by
  default.
- useState, Jotai, Zustand, and SWR domain helpers use one shared semantic
  entrypoint.
- Syntax alias maps are isolated to no-program fallback paths.
- Cross-file aliases/interfaces/unions/tagged unions/optional fields infer
  through the checker.
- Numeric caveat and refinement behavior is preserved.

## 9. Tests to Add or Update

Add or update focused tests for:

- cross-file type alias domain inference;
- imported type alias domain inference;
- interface object domain inference;
- literal union domain inference;
- tagged union domain inference;
- optional field domain inference;
- schema/numeric refinement through semantic inference;
- bare `number` caveat preservation;
- no-program fallback using `typeAliasDeclarations()`.

Prefer small compiler-backed fixtures in
`test/extract/semantic-project.test.ts` and targeted numeric tests in
`test/extract/numeric-domain-resolver.test.ts`.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm test -- test/extract/semantic-project.test.ts
rtk pnpm test -- test/extract/numeric-domain-resolver.test.ts
rtk pnpm test -- src/extract/sources
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if TypeScript type facts produce a different domain than the
  syntax mapper for a common existing fixture; decide whether the old behavior
  was unsound before changing tests.
- Stop and report if deleting `typeAliasDeclarationsFromSource()` loses alias
  information that checker APIs should expose.
- Stop and report if a source plugin requires package-specific type handling in
  the generic engine entrypoint.
- Stop and report if preserving numeric caveats conflicts with new semantic
  type facts.

## 12. Must Not Change

- Do not modify Rust checker crates.
- Do not change checker IR fields.
- Do not add new library support.
- Do not silently downgrade semantic misses to guessed domains.
- Do not edit generated artifacts or `dist/`.
