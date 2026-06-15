# Plan 01: Type-driven finite numeric domains

Phase A of the numeric-state work. This phase is extraction-only and should be
landable before checker arithmetic exists. It makes numeric state finite and
type-driven, in the SPIN spirit: numbers are concrete state values when the
domain is finite, but bare `number` stays abstract.

## Goal

Derive exact finite numeric domains from TypeScript types and nearby static
schema/refinement expressions.

- TS numeric literal unions become exact `intSet` domains: `0 | 2` is `{0,2}`,
  not `0..2`.
- `Bounded<Min, Max>` and width aliases such as `Uint8`, `Byte`, `Uint16`, and
  `Short` carry statically readable finite ranges.
- Runtime-schema adapters such as zod and arktype can produce dense numeric
  ranges only when integrality and bounds are statically provable.
- Unprovable numeric constraints abstain with extraction caveats instead of
  guessing.
- Wide numeric domains are allowed as finite domains, but this phase only
  records cardinality warnings; Phase 03 handles reduction.

## Non-goals

- No arithmetic IR or checker evaluation in this phase.
- No source-plugin behavior changes for jotai, swr, use-state, router, or
  Zustand.
- No silent promotion of bare `number`; it remains `{ kind: "tokens", count: 1 }`.
- No bounded floats. Only statically provable integer domains become numeric
  state domains.

## Current-state findings

- `src/core/ir/types.ts` already has
  `{ kind: "boundedInt"; min: number; max: number }`, but no sparse exact
  numeric set domain.
- `src/extract/engine/ts/domains.ts` currently widens numeric literal unions by
  `min/max`; `0 | 2` becomes `boundedInt{0,2}` and accidentally adds `1`.
- `inferDomainFromTypeNode` currently returns only `AbstractDomain`, so it has
  no channel for caveats. This must be fixed for numeric abstentions and
  reductions.
- zod/arktype adapters need initializer/schema expressions, not just
  `TypeNode`, so the resolver API must accept declaration/source context.
- `package.json` exports `modality-ts/core`; there is no `modality-ts/kernel`
  export today.

## Files

- `src/core/ir/types.ts` - add `intSet` domain shape.
- `src/core/ir/domains.ts` - add `intSet` cardinality, enumeration, validation,
  and fingerprinting; expose a numeric-cardinality threshold constant if useful.
- `src/core/numeric/types.ts` - new author-facing branded numeric aliases.
- `src/core/index.ts` - export numeric aliases through `modality-ts/core`.
- `src/extract/engine/ts/numeric/resolver.ts` - new resolver interface and
  registry.
- `src/extract/engine/ts/numeric/native-aliases.ts` - native alias resolver.
- `src/extract/engine/ts/numeric/adapters/zod.ts` - zod adapter.
- `src/extract/engine/ts/numeric/adapters/arktype.ts` - arktype adapter.
- `src/extract/engine/ts/domains.ts` - wire type-node and initializer-aware
  inference.
- `src/cli/features/extract/command.ts` and/or extraction report assembly -
  attach caveats to `metadata.extractionCaveats`.

## Implementation steps

1. Add the numeric domain type:

   ```ts
   | {
       kind: "intSet";
       values: readonly number[];
       overflow?: "forbid" | "wrap" | "saturate";
     }
   ```

   `values` must be integer, unique, sorted, and non-empty. `overflow` is
   metadata for Phase 02; domain enumeration/cardinality ignore it.

2. Add `intSet` support in `src/core/ir/domains.ts`:

   - `domainCardinality(intSet)` is `values.length`.
   - `enumerateDomain(intSet)` returns exactly the listed values.
   - `validateValue(intSet, value)` requires integer membership.
   - `domainFingerprint(intSet)` distinguishes `0|2` from `0..2`.

3. Add `NumericDomainResolver` in `numeric/resolver.ts`.

   The resolver must not be a plain `AbstractDomain | undefined` helper. Use a
   detailed result so caveats can flow into the trust ledger:

   ```ts
   interface NumericDomainResolution {
     domain?: AbstractDomain;
     caveats: ExtractionCaveat[];
     reductions?: NumericReduction[];
   }
   ```

   Inputs should support `{ typeNode?, initializer?, declaration?, sourceFile? }`
   plus type-alias/import context.

4. Add native aliases in `numeric/native-aliases.ts`.

   - `Bounded<Min, Max>` -> `boundedInt{min,max, overflow:"forbid"}`.
   - `Wrapping<Min, Max>` -> `boundedInt{min,max, overflow:"wrap"}`.
   - `Uint8` / `Byte` -> `boundedInt{0,255, overflow:"wrap"}`.
   - `Uint16` / `Short` -> agreed finite width. If `Short` is signed, document
     `-32768..32767`; if it is an alias for `Uint16`, document `0..65535`.

5. Change numeric literal union inference.

   - `0 | 2` -> `intSet{values:[0,2]}`.
   - `0 | 1 | 2 | 3` may remain `intSet` or normalize to
     `boundedInt{0,3}` because no value is added.
   - Never widen a sparse numeric union without a named reduction and caveat.

6. Add schema adapters.

   - zod: statically read `z.number().int().min(a).max(b)`.
   - arktype: support only the simple static form
     `"a <= number.integer <= b"` initially.
   - Dynamic values, `.refine`, `.transform`, cross-module unknowns, and
     unsupported grammar return no domain plus a caveat.

7. Wire initializer-aware inference.

   `inferDomainFromTypeNode` should use the resolver for `NumberKeyword` and
   `TypeReference`. Add detailed wrappers such as:

   - `inferDomainFromTypeNodeDetailed`
   - `inferUseStateDomainDetailed`

   Existing plain-return helpers may wrap the detailed helpers for compatibility
   with current call sites.

8. Add caveat plumbing.

   Resolver caveats must flow into `metadata.extractionCaveats`. Do not silently
   keep only the plain `AbstractDomain` return path, because that recreates the
   current trust-ledger gap.

9. Add cardinality guardrail diagnostics.

   Keep `src/core/ir/domains.ts` pure. It can expose constants/helpers, but the
   warning must be emitted where declarations/effects or multi-initials are
   visible. Warn when a numeric/product domain above the threshold is reachable
   through `havoc` or multi-initial generation.

## Acceptance criteria

- `Bounded<0,3>` resolves to `boundedInt{0,3}`.
- `0 | 2` resolves to `intSet{values:[0,2]}` and does not add `1`.
- `0 | 1 | 2 | 3` resolves to either exact set or equivalent dense range without
  adding values.
- `z.number().int().min(0).max(3)` resolves through initializer/schema-aware
  inference to `boundedInt{0,3}`.
- arktype `"0 <= number.integer <= 3"` resolves to `boundedInt{0,3}`.
- Bare `number`, floats, dynamic constraints, unsupported schema grammar, and
  non-statically-provable constraints return `tokens` through compatibility
  helpers and emit caveats through detailed inference.
- `domainFingerprint` distinguishes exact set `0|2` from range `0..2`.
- Numeric aliases are exported from `modality-ts/core`.

## Tests

- `test/extract/numeric-domain-resolver.test.ts`
  - native aliases
  - zod static schema
  - arktype static schema
  - exact sparse literal union
  - bare `number` -> abstract + caveat
  - dynamic schema -> abstract + caveat
  - initializer/schema-expression resolution path
- `src/core/ir/domains.test.ts`
  - `intSet` exact enumeration/cardinality/validation/fingerprint
  - `overflow` ignored by cardinality/enumeration
  - guardrail threshold helper, if added

## Verification

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
```

No native rebuild is required for this phase unless Rust mirror types are added
early.

## Risks and stop conditions

- If caveats cannot reach `metadata.extractionCaveats`, stop and fix the
  extraction-report path before merging.
- If architecture rules reject the resolver import edge, mirror existing
  `engine/ts/domains.ts` import patterns and stop if a new cross-layer edge is
  still flagged.
- Do not add a `modality-ts/kernel` export unless the package export map is
  intentionally changed. The current public path is `modality-ts/core`.
- A wrong numeric bound is unsound. Adapters must abstain rather than guess.
