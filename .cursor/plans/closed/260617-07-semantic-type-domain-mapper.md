# Part 2 of 4: Semantic Type to AbstractDomain Mapper

## Goal

Add a new conservative domain inference layer that maps `ts.Type` from the TypeScript checker to existing `AbstractDomain` values. This layer should handle non-numerical finite TypeScript features structurally and become the future primary implementation of `D(τ): TypeScript type -> AbstractDomain`.

This part may add semantic inference APIs, but it should not yet migrate all state-source plugins.

## Non-goals

- Do not change IR domain variants.
- Do not infer unbounded `string` or broad `number` as finite domains.
- Do not implement field pruning beyond the existing record field behavior.
- Do not replace Zod/ArkType numeric schema adapters yet.
- Do not evaluate arbitrary TypeScript expressions.
- Do not add checker-side behavior.

## Current-State Findings

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts` currently contains `inferDomainFromTypeNodeDetailed`, `inferUseStateDomainDetailed`, initial value inference, local alias walking, and numeric resolver integration.
- Existing IR supports the target non-numerical domains in `/Users/hari/proj/modality-ts/src/core/ir/types.ts`.
- Domain enumeration and validation already work for `bool`, `enum`, `option`, `record`, `tagged`, `tokens`, `lengthCat`, and `boundedList` in `/Users/hari/proj/modality-ts/src/core/ir/domains.ts`.
- Docs already describe structural `D(τ)` in `/Users/hari/proj/modality-ts/docs/architecture/extraction-pipeline.md` and `/Users/hari/proj/modality-ts/docs/concepts/state-and-domains.md`.
- Numeric resolvers are centralized under `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/`.

## Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - `DomainInferenceResult`
  - `DomainInferenceContext`
  - `inferDomainFromTypeNodeDetailed`
  - `inferUseStateDomainDetailed`
  - `firstValue`
  - `initialValueForUseStateDetailed`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/resolver.ts`
  - `resolveNumericDomain`
  - `NumericDomainResolverContext`
- `/Users/hari/proj/modality-ts/src/core/ir/types.ts`
  - `AbstractDomain`
  - `Value`
- `/Users/hari/proj/modality-ts/src/core/ir/domains.ts`
  - `validateValue`
  - `domainCardinality`
  - `WIDE_NUMERIC_DOMAIN_THRESHOLD`
- `/Users/hari/proj/modality-ts/src/extract/engine/index.ts`
  - domain inference exports
- `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`
  - public SPI exports for plugin authors

## Existing Patterns to Follow

- Return `tokens(1)` for broad, recursive, unresolved, dynamic, or unsafe types.
- Preserve caveat behavior for unprovable numeric domains.
- Keep exact finite literal unions exact; do not widen sparse numeric unions.
- Treat `null` and `undefined` as `option`.
- Preserve discriminated unions as `tagged` when a string literal tag is exact across variants.
- Keep arrays as `lengthCat` by default.
- Use `firstValue` and `validateValue` for initial values instead of duplicating validation.

## Atomic Implementation Steps

1. Add semantic domain inference types.
   - In `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts` or a new `/Users/hari/proj/modality-ts/src/extract/engine/ts/type-domains.ts`, define:
     - `TypeDomainInferenceContext`
     - `inferDomainFromTypeDetailed(type: ts.Type, ctx: TypeDomainInferenceContext): DomainInferenceResult`
     - `inferDomainFromType(type: ts.Type, ctx: TypeDomainInferenceContext): AbstractDomain`
   - Prefer a new `type-domains.ts` if `domains.ts` becomes too large.

2. Implement primitive and literal mapping.
   - Boolean-like exact type -> `{ kind: "bool" }`.
   - String literal type -> `{ kind: "enum", values: [value] }`.
   - Number literal type -> `{ kind: "boundedInt", min: value, max: value }`.
   - Boolean literal union should normalize to `{ kind: "bool" }`.
   - Broad `string`, broad `number`, `any`, `unknown`, `never`, template literal types, and unique symbols -> `{ kind: "tokens", count: 1 }`.
   - For broad `number`, preserve the existing unprovable numeric caveat behavior when a `varId` is available.

3. Implement union mapping.
   - Flatten unions with `type.isUnion()`.
   - Remove null/undefined constituents and wrap the inferred inner domain in `option`.
   - String literal-only unions -> sorted deterministic `enum`.
   - Numeric literal-only unions -> existing `domainFromNumericLiterals` behavior.
   - Boolean literal-only unions -> `bool`.
   - Mixed object unions -> attempt discriminated union mapping.
   - Any unsafe mixed union -> `tokens(1)`.

4. Implement object/interface/type literal mapping.
   - Use checker properties via `checker.getPropertiesOfType(type)`.
   - Skip methods and call signatures.
   - For property declarations, infer field domain from `checker.getTypeOfSymbolAtLocation`.
   - Optional properties should become `option(inner)` unless the property type already includes null/undefined.
   - Readonly does not affect domain.
   - Index signatures and mapped types without finite known properties should fallback to `tokens(1)`.
   - Detect recursion with a visited type identity set and fallback to `tokens(1)` at the recursive edge.

5. Implement discriminated union mapping.
   - For object union constituents, find a common property whose type is a single string literal in every variant.
   - Build `{ kind: "tagged", tag, variants }`.
   - Variant domains should be `record` domains excluding the tag field.
   - If any variant cannot produce a record domain, fallback to `tokens(1)`.

6. Implement arrays and tuples.
   - Arrays and readonly arrays -> `{ kind: "lengthCat" }`.
   - Tuples should also default to `lengthCat` in this part.
   - Do not introduce `boundedList` inference yet; leave that to overlays/future refinement.

7. Add semantic wrappers for type nodes and expressions.
   - Add `inferDomainFromTypeNodeSemanticDetailed(typeNode, ctx)`:
     - Use `checker.getTypeFromTypeNode(typeNode)`.
     - Fall back to `inferDomainFromTypeNodeDetailed` if no checker/sourceFile exists.
   - Add `inferDomainFromExpressionSemanticDetailed(expression, ctx)`:
     - Use `checker.getTypeAtLocation(expression)`.
     - Fall back to existing initializer-based inference if no semantic context exists.

8. Preserve numeric resolver integration.
   - For explicit `Bounded`, `Wrapping`, `Uint8`, Zod, and ArkType numeric cases, keep existing `resolveNumericDomain` before using semantic broad-number fallback.
   - If TypeScript erases schema bounds to `number`, do not pretend the semantic layer can recover them.
   - Add a clear comment near the wrapper explaining that schema adapters are refinement providers for information erased from TypeScript types.

9. Export semantic APIs.
   - Update `/Users/hari/proj/modality-ts/src/extract/engine/index.ts`.
   - Update `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts` only if plugin authors should be able to call the new functions.

## Per-Step Files to Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/type-domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
- Steps 2-8:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/type-domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/resolver.ts` only if context type needs optional semantic fields
- Step 9:
  - `/Users/hari/proj/modality-ts/src/extract/engine/index.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/spi/index.ts`

## Acceptance Criteria

- New semantic mapper can infer:
  - imported string literal unions as `enum`
  - imported boolean aliases as `bool`
  - nullable unions as `option`
  - interfaces and imported object aliases as `record`
  - discriminated unions as `tagged`
  - arrays as `lengthCat`
  - broad string/number as `tokens(1)` with numeric caveat for broad number where applicable
- Existing AST-domain tests continue to pass.
- Existing numeric schema adapter tests continue to pass.
- No model output changes yet except in tests that explicitly call the new semantic APIs.

## Tests to Add or Update

- Add `/Users/hari/proj/modality-ts/test/extract/semantic-domain-resolver.test.ts`.
- Cover at least:
  - `type Status = "idle" | "posting" | "failed"` imported from another file.
  - `interface User { role: "admin" | "user"; active: boolean }`.
  - `type MaybeStatus = Status | null | undefined`.
  - `type Result = { kind: "ok"; data: Data } | { kind: "err"; message: string }`.
  - `type Items = readonly Item[]`.
  - recursive type fallback: `type Node = { value: "x"; next?: Node }`.
  - broad `number` fallback and caveat.
  - sparse numeric union remains `intSet`.
  - dense numeric union remains `boundedInt`.

## Verification Commands

- `rtk pnpm vitest run test/extract/semantic-domain-resolver.test.ts`
- `rtk pnpm vitest run test/extract/numeric-domain-resolver.test.ts`
- `rtk pnpm vitest run test/sources/use-state/use-state-source.test.ts`
- `rtk pnpm typecheck`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if `ts.Type` identity recursion detection is unstable across TypeScript versions. Use symbol/name/path based fallback only if tests demonstrate the problem.
- Stop and report if mapped types appear as huge synthetic property sets. Add a cardinality guard before enumerating many properties.
- Do not infer finite domains from broad `string` even if current initializer is a string literal. The initializer can still provide an initial value, but the domain must remain sound.
- Do not widen mixed unions into invented states. If exact structural mapping is unclear, use `tokens(1)`.
