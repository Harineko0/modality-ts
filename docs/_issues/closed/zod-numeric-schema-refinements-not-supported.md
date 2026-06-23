# Zod Numeric Schema Refinements Are Not Fully Supported

## Summary

The Zod domain refinement provider currently recognizes only static integer schemas with both `.min(...)` and `.max(...)`:

```ts
z.number().int().min(0).max(3);
```

Other Zod numeric refinements are not currently parsed into modality domains:

```ts
z.number().gt(5);
z.number().gte(5);
z.number().lt(5);
z.number().lte(5);
z.number().positive();
z.number().nonnegative();
z.number().negative();
z.number().nonpositive();
z.number().multipleOf(5);
z.number().step(5);
```

## Why This Matters

Zod users commonly express numeric constraints using aliases and one-sided bounds. When these constraints are erased to TypeScript `number`, modality-ts falls back to `tokens(1)` or an unprovable numeric caveat rather than producing a finite numeric domain.

That fallback is sound, but it is surprising when the schema appears statically finite or partially finite. It also means users must rewrite schemas as `.int().min(a).max(b)` or add explicit TypeScript/overlay refinements to get model-checkable numeric state.

## Reproduction

Inspect the current Zod refinement provider:

```bash
cd /Users/hari/proj/modality-ts
rtk read src/extract/plugins/type/zod/domains.ts
rtk read test/extract/plugins/type/zod-domain-refinement.test.ts
```

The parser only accepts chain steps named:

```text
number
int
min
max
```

Any other method in the chain returns unsupported/unprovable behavior instead of a finite domain.

## Expected Behavior

Zod numeric aliases and refinements should be supported when they can be mapped soundly to finite domains.

Candidate behavior:

- `.gte(n)` should behave like `.min(n)`.
- `.lte(n)` should behave like `.max(n)`.
- `.gt(n)` / `.lt(n)` should become exclusive integer bounds only when `.int()` is present or integer-ness is otherwise proven.
- `.positive()`, `.nonnegative()`, `.negative()`, `.nonpositive()` should expand to the corresponding one-sided bound.
- `.multipleOf(k)` / `.step(k)` should refine to `intSet` only when finite lower and upper integer bounds are also known.
- One-sided or unbounded numeric constraints should remain `tokens(1)` with a clear caveat unless an overlay supplies a finite bound.

## Observed Behavior

Only `.int().min(a).max(b)` with static integer `a` and `b` produces `boundedInt`.

Other numeric methods are not recognized by `parseZodNumberChain(...)`, so the provider does not refine them.

## Possible Fix Directions

- Extend `src/extract/plugins/type/zod/domains.ts` to parse known Zod numeric aliases.
- Track integer-ness, inclusive/exclusive bounds, and optional divisibility in the intermediate parse result.
- Produce `boundedInt` for dense finite integer ranges and `intSet` for finite modulo-filtered ranges.
- Emit caveats for dynamic bounds, non-integer finite bounds, or one-sided constraints that cannot produce a finite domain.
- Add provider tests in `test/extract/plugins/type/zod-domain-refinement.test.ts`.
- Add CLI extraction regression tests in `src/cli/features/extract/command.test.ts` for supported aliases through the registry provider.

## Resolution

The Zod domain refinement provider now parses documented static numeric chain methods on `z.number()` initializer expressions:

- **Refined:** `.int()` with static two-sided bounds via inclusive aliases (`min`/`gte`, `max`/`lte`), exclusive bounds (`gt`/`lt`), sign aliases (`positive`, `nonnegative`, `negative`, `nonpositive`), and finite positive-integer `multipleOf`/`step` filters → `boundedInt` when dense, `intSet` when sparse.
- **Caveated:** dynamic bound or divisibility arguments; one-sided constraints; missing `.int()`; contradictory bounds; invalid divisors (`0`, negative, non-integer).
- **Tests:** `test/extract/plugins/type/zod-domain-refinement.test.ts` and Zod CLI regressions in `src/cli/features/extract/command.test.ts`.
- **Docs:** type-library adapter, extraction spec, state-and-domains, and react-features pages updated.

Floating-point numeric domains, decimal `multipleOf`, and one-sided unbounded schemas remain intentionally unsupported; overlays supply finite bounds when needed.
