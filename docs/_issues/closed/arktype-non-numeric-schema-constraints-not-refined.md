# ArkType Non-Numeric Schema Constraints Are Not Refined

## Summary

ArkType schemas currently contribute finite domains through TypeScript semantic inference when the inferred type preserves finite structure, and through a narrow numeric refinement provider for inclusive integer ranges. ArkType grammar constraints such as string length, divisors, and non-empty arrays are not converted into modality domains.

Examples that are not currently refined:

```ts
type("'typescript'");
type("string > 0");
type("number % 2");
type("string[] > 0");
```

## Why This Matters

Users may expect ArkType schema syntax to affect the extracted state domain. Today, only finite structure visible in TypeScript types is captured, plus the static integer range grammar:

```ts
type("0 <= number.integer <= 3");
```

Other ArkType constraints either collapse to broad TypeScript types such as `string`, `number`, or arrays, or emit a caveat when they look like unsupported numeric grammar. This can make extracted models coarser than the schema author expects.

## Reproduction

Inspect the current ArkType refinement provider:

```bash
cd /Users/hari/proj/modality-ts
rtk read src/extract/plugins/type/arktype/domains.ts
rtk read test/extract/plugins/type/arktype-domain-refinement.test.ts
```

The provider recognizes only:

```text
(-?\d+) <= number.integer <= (-?\d+)
```

End-to-end semantic extraction does support ArkType inferred literal object fields when TypeScript preserves them, for example `status: "'idle'|'posting'|'failed'"`, but it does not parse the broader ArkType grammar into domains.

## Expected Behavior

ArkType type-library support should either:

- refine supported finite ArkType constraints into existing domains; or
- clearly document and caveat unsupported constraints when they appear in modeled state initializers.

Candidate mappings:

- `"'typescript'"` -> `enum { "typescript" }`, when not already preserved by TypeScript inference
- `"string > 0"` -> a documented predicate abstraction or token domain with caveat
- `"number % 2"` -> finite only when paired with finite numeric bounds; otherwise token domain with caveat
- `"string[] > 0"` -> `lengthCat` initial/constraint refinement, or token/domain caveat if non-empty cannot be enforced

## Observed Behavior

Only inclusive bounded integer ArkType strings refine to `boundedInt`. Other ArkType constraints are not interpreted by the provider.

## Possible Fix Directions

- Extend `src/extract/plugins/type/arktype/domains.ts` with a small, explicit ArkType grammar parser for constraints that can soundly map to existing finite domains.
- Require both divisor and finite range information before producing finite numeric `intSet` domains for modulo constraints.
- For non-empty arrays, decide whether existing `lengthCat` can represent the constraint without changing transition semantics.
- Add focused provider tests in `test/extract/plugins/type/arktype-domain-refinement.test.ts`.
- Add CLI extraction regression tests for any supported ArkType grammar that should work through `runExtractCommand`.
- Document unsupported ArkType constraints in the type-library adapter docs.

## Resolution

The ArkType domain refinement provider now parses a small static subset of ArkType schema strings on `type("…")` initializer chains:

- **Refined:** string literal unions → `enum`; inclusive `number.integer` ranges → `boundedInt`; bounded `number.integer % n` intersections → `intSet` or `boundedInt`.
- **Caveated:** string length, array length, and unbounded divisor grammars (current `lengthCat` cannot encode non-empty-only constraints; overlays/predicates are the documented path).
- **Tests:** `test/extract/plugins/type/arktype-domain-refinement.test.ts` and ArkType CLI regressions in `src/cli/features/extract/command.test.ts`.
- **Docs:** type-library adapter, state-and-domains, package entry points, refining-domains, and react-features pages updated.

Non-empty string and array constraints remain intentionally caveated until the IR supports restricted length categories or predicate abstractions from schema providers.
