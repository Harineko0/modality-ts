# Fix Zod Numeric Schema Refinements

## 1. Goal

Implement sound static support for additional Zod numeric schema refinements described in `docs/_issues/zod-numeric-schema-refinements-not-supported.md`.

Official Zod documentation checked: `https://zod.dev/api`, section "Numbers", documents:

- `z.number().gt(5)`
- `z.number().gte(5)` as alias of `.min(5)`
- `z.number().lt(5)`
- `z.number().lte(5)` as alias of `.max(5)`
- `z.number().positive()` as alias of `.gt(0)`
- `z.number().nonnegative()`
- `z.number().negative()`
- `z.number().nonpositive()`
- `z.number().multipleOf(5)` as alias of `.step(5)`

The extractor should continue to inspect static TypeScript syntax only. It should produce finite domains only when the Zod chain proves a finite integer set:

- `boundedInt` for dense finite integer ranges.
- `intSet` for finite integer ranges filtered by `multipleOf` / `step`.
- caveats, not guessed domains, for dynamic, non-finite, non-integer, contradictory, or unsupported numeric schemas.

## 2. Non-goals

- Do not execute or import Zod at extraction time.
- Do not implement full Zod schema semantics.
- Do not support floating-point numeric domains.
- Do not infer finite bounds from one-sided numeric constraints without an explicit finite opposite bound.
- Do not add backward-compatibility shims; this repository is experimental.
- Do not refactor unrelated domain-resolution, registry, or CLI code.
- Do not modify generated docs under `docs/build/`.

## 3. Current-State Findings

- `src/extract/type-libraries/zod/domains.ts`
  - `zodDomainRefinementProvider()` registers provider id `zod`, version `0.1.0`, package name `zod`.
  - `resolveZodNumericSchema(...)` calls `parseZodNumberChain(...)`, returns a caveat for `parsed.dynamic`, and only emits `boundedInt` when `integral`, `min`, and `max` are all present and static integers.
  - `parseZodNumberChain(...)` currently accepts only chain steps named `number`, `int`, `min`, and `max`.
  - Unsupported methods cause `parseZodNumberChain(...)` to return `null`, which makes the provider abstain; because the schema initializer still has broad TypeScript `number`, extraction later falls back to `tokens(1)`.
  - `staticNumericArg(...)` supports numeric literals and negative numeric literals via prefix unary `-`.

- `test/extract/type-libraries/zod-domain-refinement.test.ts`
  - Covers only `z.number().int().min(0).max(3)`, dynamic bounds, and abstaining for `z.string()`.
  - Uses `resolveDomainRefinements(...)` with a direct provider instance, which is the right place for most parser-domain behavior tests.

- `src/cli/features/extract/command.test.ts`
  - Has integration coverage around lines near the existing test named `refines Zod numeric schema initializers through registry providers`.
  - That test verifies registry wiring and metadata plugin provenance for `z.number().int().min(0).max(3)`.
  - Add one narrow registry regression for a newly supported alias chain; keep detailed parser matrix in the provider test.

- `docs/architecture/type-library-adapters.md`
  - Documents that type-library adapters are domain refinement providers, inspect static syntax, return `boundedInt` when integer min/max are provable, and caveat when bounds are dynamic or unsupported.
  - Update this doc only if the supported Zod examples shown there become misleading.

- `docs/_specs/02-extraction.md`
  - Currently lists Zod static integer schemas as `z.number().int().min(a).max(b)`.
  - Update this spec text if implementing the issue changes the documented domain-inference surface.

## 4. Exact File Paths and Relevant Symbols

- `src/extract/type-libraries/zod/domains.ts`
  - `resolveZodNumericSchema`
  - `ZodNumberParse`
  - `parseZodNumberChain`
  - `ChainStep`
  - `flattenCallChain`
  - `staticNumericArg`

- `test/extract/type-libraries/zod-domain-refinement.test.ts`
  - `refinementContext`
  - `describe("zod domain refinement provider", ...)`

- `src/cli/features/extract/command.test.ts`
  - `describe("schema type library extraction", ...)`
  - existing test `refines Zod numeric schema initializers through registry providers`

- `docs/architecture/type-library-adapters.md`
  - "What providers do"

- `docs/_specs/02-extraction.md`
  - section `3. P2 — Domain inference (TS types → AbstractDomain)`

## 5. Existing Patterns to Follow

- Keep the provider as a static AST parser over initializer expressions.
- Return `undefined` for clearly non-Zod chains such as `z.string()`.
- Return `DomainRefinementResolution` with `unprovableNumericDomainCaveat(...)` for Zod numeric chains that are recognized but cannot produce a sound finite domain.
- Use `sourceAnchorFromNode(expression, ctx.sourceFile)` for caveat provenance.
- Keep `overflow: "forbid"` on domains produced from schema constraints.
- Prefer small helpers inside `zod/domains.ts` over changing shared resolver contracts.
- Keep provider-level tests focused and cheap. Use CLI extraction tests only for registry integration.

## 6. Atomic Implementation Steps

1. Model richer parsed numeric constraints.

   Files to edit:
   - `src/extract/type-libraries/zod/domains.ts`

   Replace or extend `ZodNumberParse` so it can represent:
   - `integral: boolean`
   - lower bound value plus inclusivity
   - upper bound value plus inclusivity
   - optional positive integer `multipleOf`
   - `dynamic: boolean`
   - optional `recognizedNumericChain: boolean` if useful for caveat behavior

   Do not store only `min` and `max` if that loses exclusive-bound information.

2. Parse documented Zod numeric aliases.

   Files to edit:
   - `src/extract/type-libraries/zod/domains.ts`

   Extend `parseZodNumberChain(...)` to handle:
   - `int`
   - `min(n)` and `gte(n)` as inclusive lower bound
   - `max(n)` and `lte(n)` as inclusive upper bound
   - `gt(n)` as exclusive lower bound
   - `lt(n)` as exclusive upper bound
   - `positive()` as exclusive lower bound `0`
   - `nonnegative()` as inclusive lower bound `0`
   - `negative()` as exclusive upper bound `0`
   - `nonpositive()` as inclusive upper bound `0`
   - `multipleOf(k)` and `step(k)` as divisibility filters

   Rules:
   - Bounds must use `staticNumericArg(...)`; otherwise set `dynamic = true` and continue parsing.
   - `multipleOf` / `step` must use a static numeric literal; otherwise set `dynamic = true`.
   - If the same side is constrained more than once, keep the stricter bound.
   - For equal numeric bounds with different inclusivity, exclusive is stricter.
   - Continue returning `null` for non-`z.number()` roots and clearly non-numeric Zod schemas.
   - Return a recognized parse result, not `null`, for documented numeric methods that cannot later produce a finite domain.

3. Normalize parsed constraints into a finite integer domain.

   Files to edit:
   - `src/extract/type-libraries/zod/domains.ts`

   Add a helper such as `domainFromZodNumberParse(parsed): AbstractDomain | undefined`.

   Required behavior:
   - If `parsed.dynamic` is true, keep the existing dynamic-bound caveat path.
   - Require `parsed.integral === true` before converting numeric bounds to integer domains.
   - Require both a finite lower and upper bound after applying exclusivity.
   - Convert exclusive bounds only after integer-ness is proven:
     - `gt(5)` becomes lower integer bound `6`.
     - `lt(5)` becomes upper integer bound `4`.
     - `positive()` with `int()` becomes lower integer bound `1`.
     - `negative()` with `int()` becomes upper integer bound `-1`.
   - Reject non-integer inclusive bounds for integer domains unless they can be rounded soundly:
     - For integer schemas, `min(0.5)` can become lower bound `1`.
     - For integer schemas, `max(3.5)` can become upper bound `3`.
     - For integer schemas, `gt(0.5)` can become lower bound `1`.
     - For integer schemas, `lt(3.5)` can become upper bound `3`.
   - If normalized lower bound is greater than normalized upper bound, return no domain and let the caller emit a caveat.
   - Without `multipleOf` / `step`, emit `boundedInt` with `overflow: "forbid"`.
   - With `multipleOf` / `step`, enumerate values inside the normalized finite integer range that are divisible by `k`; emit:
     - `boundedInt` if the filtered values remain dense.
     - `intSet` if the filtered values are sparse.
   - If the divisibility filter leaves no values, return no domain and caveat.

   Decide and document in code whether divisibility follows JavaScript remainder semantics against `0`. For integer values, `value % k === 0` is the simplest local behavior.

4. Validate `multipleOf` / `step` arguments.

   Files to edit:
   - `src/extract/type-libraries/zod/domains.ts`

   Required behavior:
   - Accept only static positive integers for finite `intSet` construction.
   - Caveat for `0`, negative values, non-integers, `NaN`, or dynamic values.
   - Keep this conservative even though Zod has decimal multiple support; modality numeric domains are integer-only.

5. Improve caveat reasons without over-expanding the public surface.

   Files to edit:
   - `src/extract/type-libraries/zod/domains.ts`

   Keep the existing dynamic caveat reason `"Zod numeric schema uses dynamic bounds"` for dynamic bounds or dynamic divisibility arguments.

   Keep or slightly refine the unsupported caveat reason for recognized but unprovable chains, for example:
   - `"Unsupported or unprovable Zod numeric schema"`

   Do not emit caveats for `z.string()` or non-numeric schemas.

6. Add provider unit tests.

   Files to edit:
   - `test/extract/type-libraries/zod-domain-refinement.test.ts`

   Add focused cases:
   - `z.number().int().gte(0).lte(3)` -> `boundedInt 0..3`
   - `z.number().int().gt(0).lt(4)` -> `boundedInt 1..3`
   - `z.number().int().positive().max(3)` -> `boundedInt 1..3`
   - `z.number().int().nonnegative().lte(3)` -> `boundedInt 0..3`
   - `z.number().int().negative().gte(-3)` -> `boundedInt -3..-1`
   - `z.number().int().nonpositive().gte(-3)` -> `boundedInt -3..0`
   - `z.number().int().min(0).max(10).multipleOf(5)` -> `intSet [0, 5, 10]`
   - `z.number().int().min(0).max(10).step(5)` -> same as `multipleOf`
   - `z.number().int().min(0).max(3).multipleOf(limit)` -> no domain, dynamic caveat
   - `z.number().int().min(0).max(3).multipleOf(0)` -> no domain, unsupported/unprovable caveat
   - `z.number().gte(0).lte(3)` without `.int()` -> no domain, unsupported/unprovable caveat
   - `z.number().int().gte(0)` one-sided finite-lower-only -> no domain, unsupported/unprovable caveat
   - `z.number().int().min(4).max(0)` contradictory -> no domain, unsupported/unprovable caveat

   Keep assertions on caveat count and reason stable enough to catch regressions without overfitting line numbers.

7. Add one CLI registry regression.

   Files to edit:
   - `src/cli/features/extract/command.test.ts`

   Add a test near `refines Zod numeric schema initializers through registry providers` using a newly supported chain, for example:

   ```ts
   const [n] = useState(z.number().int().gt(0).lte(3));
   ```

   Assert:
   - `local:App.n` domain is `{ kind: "boundedInt", min: 1, max: 3, overflow: "forbid" }`.
   - metadata plugins still include `{ id: "zod", kind: "domain-refinement" }`.

   Do not duplicate the full provider test matrix in this slower CLI test.

8. Update docs/spec references.

   Files to edit:
   - `docs/architecture/type-library-adapters.md`
   - `docs/_specs/02-extraction.md`
   - optionally `docs/concepts/state-and-domains.md`
   - optionally `docs/sources/react-features.md`

   Replace overly narrow examples such as `z.number().int().min(a).max(b)` with wording that says Zod integer schemas with static two-sided bounds are supported, including aliases like `gte/lte`, exclusive bounds like `gt/lt` after `.int()`, and finite `multipleOf/step` filters.

   Do not edit `docs/build/`.

9. Close or update the issue document.

   Files to edit:
   - `docs/_issues/zod-numeric-schema-refinements-not-supported.md`

   After implementation, either:
   - move it to the closed issues convention if the repository has one for `_issues`, or
   - update it with a "Resolution" section listing the supported methods and remaining unsupported cases.

   Stop and report before deleting the issue file if there is no established issue-closing convention.

## 7. Per-Step Files to Edit

1. Parsed constraint model:
   - `src/extract/type-libraries/zod/domains.ts`

2. Alias parsing:
   - `src/extract/type-libraries/zod/domains.ts`

3. Domain normalization:
   - `src/extract/type-libraries/zod/domains.ts`

4. Divisibility validation:
   - `src/extract/type-libraries/zod/domains.ts`

5. Caveat reasons:
   - `src/extract/type-libraries/zod/domains.ts`

6. Provider tests:
   - `test/extract/type-libraries/zod-domain-refinement.test.ts`

7. CLI registry regression:
   - `src/cli/features/extract/command.test.ts`

8. Docs/spec:
   - `docs/architecture/type-library-adapters.md`
   - `docs/_specs/02-extraction.md`
   - `docs/concepts/state-and-domains.md`
   - `docs/sources/react-features.md`

9. Issue tracking:
   - `docs/_issues/zod-numeric-schema-refinements-not-supported.md`

## 8. Acceptance Criteria

- `z.number().int().gte(0).lte(3)` resolves to `boundedInt 0..3`.
- `z.number().int().gt(0).lt(4)` resolves to `boundedInt 1..3`.
- `positive`, `nonnegative`, `negative`, and `nonpositive` resolve when paired with `.int()` and an opposite finite static bound.
- `multipleOf(k)` and `step(k)` produce exact finite integer domains only when `.int()` plus static finite lower and upper bounds are present.
- Dynamic numeric bounds or dynamic `multipleOf` / `step` arguments still produce a caveat and no domain.
- One-sided, non-integral, contradictory, or non-finite numeric schemas do not produce guessed finite domains.
- Non-numeric Zod schemas still abstain without caveats.
- Registry-driven CLI extraction still records the `zod` domain-refinement plugin in model metadata.
- Documentation no longer says only `.int().min().max()` is supported if the implementation supports more aliases.

## 9. Tests to Add or Update

- Add provider unit cases in `test/extract/type-libraries/zod-domain-refinement.test.ts` for:
  - inclusive aliases
  - exclusive aliases
  - sign aliases
  - `multipleOf`
  - `step`
  - dynamic divisibility
  - invalid divisibility
  - missing `.int()`
  - one-sided constraints
  - contradictory constraints

- Add one CLI integration case in `src/cli/features/extract/command.test.ts` for a newly supported Zod numeric chain through the built-in registry provider.

- Update existing assertions only where behavior intentionally changes from caveat/token fallback to finite domain.

## 10. Verification Commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm exec vitest run test/extract/type-libraries/zod-domain-refinement.test.ts
rtk pnpm exec vitest run src/cli/features/extract/command.test.ts --testNamePattern "Zod numeric|schema type library"
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If the CLI test-name filter does not match under the installed Vitest version, run:

```bash
rtk pnpm exec vitest run src/cli/features/extract/command.test.ts
```

Before final handoff, inspect:

```bash
rtk git diff -- src/extract/type-libraries/zod/domains.ts test/extract/type-libraries/zod-domain-refinement.test.ts src/cli/features/extract/command.test.ts docs/architecture/type-library-adapters.md docs/_specs/02-extraction.md docs/_issues/zod-numeric-schema-refinements-not-supported.md
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if `AbstractDomain` no longer supports `intSet` or if its shape differs from `{ kind: "intSet", values: number[] }`.
- Stop and report if `resolveDomainRefinements(...)` semantics changed so provider abstention and provider caveats are no longer handled as assumed.
- Stop and report if the repository already has a shared numeric constraint parser that should replace local Zod parsing.
- Stop and report if existing tests depend on unsupported Zod numeric methods abstaining rather than caveating.
- Be conservative with decimal bounds and decimal `multipleOf`; modality numeric domains are integer domains, while Zod can validate general finite numbers. Do not model floats as finite integer domains unless `.int()` makes the integer normalization sound.
- Be careful with negative multiples. Use only positive integer divisors for `multipleOf` / `step`; caveat otherwise.
- Be careful with empty domains caused by contradictory constraints or divisibility filters. Emit no domain and surface a caveat rather than creating invalid `boundedInt` or empty `intSet`.
- Do not update `docs/build/`; generated docs should be handled by the docs build pipeline separately.
