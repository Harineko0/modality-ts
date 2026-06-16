# Fix ArkType Non-Numeric Schema Constraint Refinement

## Goal

Fix `docs/_issues/arktype-non-numeric-schema-constraints-not-refined.md` by extending the ArkType domain refinement provider to recognize a small, explicit, sound subset of ArkType string grammar beyond the current inclusive integer range case.

The implementation should:

- Preserve current `type("0 <= number.integer <= 3") -> boundedInt(0..3)` behavior.
- Add exact finite refinement for ArkType string literals where TypeScript semantic inference did not already preserve them:
  - `type("'typescript'")` -> `{ kind: "enum", values: ["typescript"] }`
  - `type("'idle' | 'posting' | 'failed'")` -> sorted `enum`
- Add exact finite numeric refinement for bounded integer divisor/range intersections:
  - `type("-50 < (number.integer % 2) < 50")` -> `intSet` of integer multiples of `2` between `-49` and `49`
  - `type("-50 < (number % 2) < 50")` should only refine if the grammar is treated as integer-valued by an explicit parser rule; otherwise emit a caveat. Prefer requiring `number.integer` for soundness unless repository tests or docs clearly justify `number % n` as finite integer state.
- Emit clear caveats for recognized but currently unrepresentable ArkType constraints:
  - string length constraints such as `type("string > 0")`
  - array length constraints such as `type("string[] > 0")`
  - unbounded divisor constraints such as `type("number % 2")`
- Update user-facing adapter docs to state exactly which ArkType constraints are refined and which are caveated.
- Close or update the issue file after the implementation is complete.

Official ArkType docs inspected for this plan:

- `https://arktype.io/docs/primitives`
  - string literals: `"'typescript'"`, `'"arktype"'`
  - string length constraints: `"string > 0"`, `"string.alphanumeric >= 3"`, `"0 < string <= 10"`
  - number ranges: `"number > 0"`, `"number.integer >= 3"`, `"0 < number <= 2.71828"`
  - number divisors: `"number % 2"`
  - bounded divisor/range example: `"-50 < (number % 2) < 50"`
- `https://arktype.io/docs/objects`
  - array length constraints: `"string[] > 0"`, `"number.integer[] >= 3"`, `"0 < string[] <= 10"`
- `https://arktype.io/docs/intro/adding-constraints`
  - constraints are first-class ArkType syntax and include examples such as `"number.integer < 100"`

## Non-goals

- Do not implement a full ArkType parser or runtime interpreter.
- Do not add a runtime dependency on `arktype`; keep the provider static AST/string based.
- Do not change `AbstractDomain` or checker semantics for this issue.
- Do not attempt to encode non-empty string or non-empty array as a restricted `lengthCat`; current `lengthCat` represents all three categories (`"0" | "1" | "many"`) and cannot exclude `"0"`.
- Do not convert broad `string`, broad `number`, or unconstrained arrays into larger invented finite domains.
- Do not change Zod behavior in this plan.
- Do not update generated `dist/` or `docs/build/` artifacts.
- Do not preserve backward compatibility for unsupported behavior; this tool is experimental, but keep existing passing tests green unless a test is explicitly corrected by this issue.

## Current-State Findings

- The issue file is:
  - `docs/_issues/arktype-non-numeric-schema-constraints-not-refined.md`
- Current ArkType provider is:
  - `src/extract/type-libraries/arktype/domains.ts`
- Current provider behavior:
  - Extracts a static string from either a string literal/template literal or `type(<static string>)`.
  - Matches only `^(-?\d+)\s*<=\s*number\.integer\s*<=\s*(-?\d+)$`.
  - Returns `boundedInt` with `overflow: "forbid"` for that one grammar.
  - Emits `Unprovable numeric domain: Unsupported arktype numeric schema grammar` only when `looksLikeArktypeSchema` is true.
  - `looksLikeArktypeSchema` currently detects `type(...)` calls or static strings containing `number.integer`; it does not recognize string literals, string length, array length, or `number % n`.
- Provider tests are:
  - `test/extract/type-libraries/arktype-domain-refinement.test.ts`
- Existing provider tests cover:
  - inclusive integer range to `boundedInt`
  - unsupported `number.integer` caveat
  - abstaining for non-ArkType expressions
- End-to-end CLI ArkType tests are in:
  - `src/cli/features/extract/command.test.ts`
- Existing CLI tests already prove that ArkType inferred structural TypeScript types work when `typeof StateSchema.infer` preserves finite structure.
- Current docs say type-library adapters recover static integer bounds only:
  - `docs/architecture/type-library-adapters.md`
  - `docs/concepts/state-and-domains.md`
  - `docs/reference/package-entry-points.md`
  - `docs/guides/refining-domains-and-overlays.md`
  - `docs/sources/react-features.md`
- Current IR domain vocabulary is in:
  - `src/core/ir/types.ts`
- Relevant current domain variants:
  - `enum` for finite string literal sets
  - `boundedInt` for contiguous integer ranges
  - `intSet` for sparse finite integer sets
  - `tokens` for opaque broad values
  - `lengthCat` for `"0" | "1" | "many"` collection abstraction
  - `boundedList` for element-sensitive bounded lists requested elsewhere, usually overlays
- `src/core/ir/domains.ts` confirms `lengthCat` enumerates all `["0", "1", "many"]`; it is not currently parameterized and cannot represent “non-empty only.”
- Caveat helpers live in:
  - `src/extract/engine/ts/caveats.ts`
- `unprovableNumericDomainCaveat` only names numeric domains. ArkType string/array constraints need either a new general schema caveat helper or direct `modelSlackCaveat` usage with precise reasons.
- `DomainRefinementProvider` returns `DomainRefinementResolution | undefined` from:
  - `src/extract/engine/spi/index.ts`
- A provider may return only caveats and no `domain`; use that for recognized but unsupported ArkType schemas.

## Exact File Paths and Relevant Symbols

- `src/extract/type-libraries/arktype/domains.ts`
  - `arktypeDomainRefinementProvider`
  - `resolveArktypeNumericSchema`
  - `ARKTYPE_INTEGER_RANGE`
  - `staticStringValue`
  - `looksLikeArktypeSchema`
  - `expressionFromContext`
  - Add/rename to a broader `resolveArktypeSchema`.
  - Add small parser helpers for literals, ranges, divisors, and length-like constraints.
- `test/extract/type-libraries/arktype-domain-refinement.test.ts`
  - Add focused provider tests for each supported and caveated grammar.
- `src/cli/features/extract/command.test.ts`
  - Add one or two CLI regressions only for behavior that must work through registry wiring.
- `docs/architecture/type-library-adapters.md`
  - Update adapter support matrix from “integer min/max only” to exact supported ArkType subset.
- `docs/concepts/state-and-domains.md`
  - Update the type-library refinement bullet and diagram language if needed.
- `docs/reference/package-entry-points.md`
  - Update ArkType entry purpose from numeric-only to static schema refinement.
- `docs/guides/refining-domains-and-overlays.md`
  - Update static ArkType examples if this page mentions only inclusive integer ranges.
- `docs/sources/react-features.md`
  - Update extraction support bullet if it mentions only ArkType numeric bounds.
- `docs/_issues/arktype-non-numeric-schema-constraints-not-refined.md`
  - After implementation, either mark as resolved with concrete behavior or move to a closed issue convention if one exists.

## Existing Patterns to Follow

- Keep type-library adapters under `src/extract/type-libraries/<library>/`.
- Keep adapters static: inspect TypeScript AST and literal schema strings only.
- Prefer exact finite domains over heuristic refinements.
- Return caveats instead of guessing when a constraint is recognized but cannot be represented exactly by the current IR.
- Follow the Zod provider pattern in `src/extract/type-libraries/zod/domains.ts`:
  - parse a narrow chain/grammar subset
  - mark dynamic/unprovable cases as caveats
  - return `boundedInt` only when all required static conditions are proven
- Follow existing test helper style in `test/extract/type-libraries/arktype-domain-refinement.test.ts`.
- For docs, update source Markdown under `docs/`; do not edit generated `docs/build/`.
- Preserve sorted/deterministic domain values for stable snapshots and fingerprints.

## Atomic Implementation Steps

### 1. Rename the ArkType resolver around generic schema refinement

Files to edit:

- `src/extract/type-libraries/arktype/domains.ts`

Implementation:

- Rename `resolveArktypeNumericSchema` to `resolveArktypeSchema`.
- Update `arktypeDomainRefinementProvider().refineDomain` to use the renamed resolver.
- Keep `staticStringValue` and `expressionFromContext` behavior unless tests reveal a better existing helper.
- Keep the current inclusive integer range test passing before adding new behavior.

Stop and ask/report if:

- The provider has moved or the SPI no longer returns `DomainRefinementResolution`.

### 2. Add a small parse-result model for ArkType schema strings

Files to edit:

- `src/extract/type-libraries/arktype/domains.ts`

Implementation:

- Add an internal discriminated union such as:
  - `{ kind: "domain"; domain: AbstractDomain }`
  - `{ kind: "caveat"; reason: string; numeric?: boolean }`
  - `{ kind: "abstain" }`
- Add a `parseArktypeSchema(schema: string)` helper that trims whitespace and delegates in this order:
  1. string literal union parser
  2. bounded integer range parser preserving existing behavior
  3. bounded integer divisor/range parser
  4. recognized-but-unrepresentable length/divisor constraint detector
  5. abstain
- Keep parser helpers pure string functions so they can be unit tested indirectly through provider tests.

Stop and ask/report if:

- Existing domain refinement orchestration treats a caveat-only provider result differently from expectations.

### 3. Support finite ArkType string literal unions

Files to edit:

- `src/extract/type-libraries/arktype/domains.ts`
- `test/extract/type-libraries/arktype-domain-refinement.test.ts`

Implementation:

- Parse one or more single-quoted or double-quoted string literals separated by `|`.
- Support whitespace around `|`.
- Do not parse arbitrary escape syntax unless the repo already has a string literal parser helper. If using TypeScript AST parsing is simpler and safer, create a tiny temporary source expression from the literal token and read `ts.StringLiteral.text`.
- Return `{ kind: "enum", values }` with unique sorted values.
- Reject mixed non-literal union members by abstaining or caveating as unsupported ArkType schema grammar. Prefer caveat when the expression came from `type(...)`.
- Add provider tests:
  - `type("'typescript'")` returns `enum ["typescript"]`
  - `type("'idle' | 'posting' | 'failed'")` returns sorted enum values
  - duplicate literal union members dedupe deterministically if accepted
  - broad `type("string")` should not become an enum

Stop and ask/report if:

- Existing semantic extraction already consumes `type("'x'")` initializers before the provider in a way that makes this test impossible. In that case, report the actual pipeline ordering and add only direct provider tests.

### 4. Support bounded integer divisor/range intersections as `intSet`

Files to edit:

- `src/extract/type-libraries/arktype/domains.ts`
- `test/extract/type-libraries/arktype-domain-refinement.test.ts`

Implementation:

- Parse static integer bounds with exclusive/inclusive operators on both sides:
  - `<`, `<=`, `>`, `>=`
- Parse parenthesized divisor expression:
  - `(number.integer % N)`
  - Allow whitespace around `%`.
  - Require `N` to be a positive non-zero integer.
- Prefer supporting these normalized forms first:
  - `MIN < (number.integer % N) < MAX`
  - `MIN <= (number.integer % N) <= MAX`
  - `MIN < (number.integer % N) <= MAX`
  - `MIN <= (number.integer % N) < MAX`
- Optionally support unparenthesized `number.integer % N` only if doing so stays simple and tested.
- Convert exclusive bounds to integer inclusive bounds:
  - `MIN < x` means `ceil(MIN + 1)` for integer `x` when `MIN` is integer.
  - `x < MAX` means `floor(MAX - 1)` for integer `x` when `MAX` is integer.
- Generate all integers in the inclusive range divisible by `N`.
- Return:
  - `boundedInt` only if `N === 1` and the resulting set is contiguous.
  - otherwise `intSet` with sorted values and `overflow: "forbid"`.
- If the generated set is empty, return a caveat for unsatisfiable or unsupported ArkType numeric schema bounds rather than an invalid empty `intSet`.
- Add provider tests:
  - `type("-5 <= (number.integer % 2) <= 5")` -> `intSet [-4, -2, 0, 2, 4]`
  - `type("-5 < (number.integer % 2) < 5")` -> `intSet [-4, -2, 0, 2, 4]`
  - `type("0 <= (number.integer % 1) <= 3")` -> `boundedInt 0..3`
  - `type("0 <= (number.integer % 0) <= 3")` emits caveat
  - `type("number % 2")` emits caveat because it is unbounded

Stop and ask/report if:

- ArkType docs or installed ArkType behavior prove `number % N` includes non-integers or non-multiples in a way that would make an integer `intSet` unsound. In that case, only support `number.integer % N`.

### 5. Emit precise caveats for recognized unrepresentable constraints

Files to edit:

- `src/extract/type-libraries/arktype/domains.ts`
- `src/extract/engine/ts/caveats.ts` only if adding a general helper is cleaner than direct `modelSlackCaveat` calls.
- `test/extract/type-libraries/arktype-domain-refinement.test.ts`

Implementation:

- Detect string length constraints from official docs:
  - `string > 0`
  - `string >= N`
  - `string < N`
  - `string <= N`
  - `LOW < string <= HIGH`
  - Allow qualified string bases such as `string.alphanumeric >= 3` as recognized but unsupported.
- Detect array length constraints from official docs:
  - `string[] > 0`
  - `number.integer[] >= 3`
  - `0 < string[] <= 10`
  - Generalize narrowly to `<arktype-base>[]` followed by static length comparison/range.
- For these, return caveat-only result with a reason like:
  - `Unsupported arktype string length schema; use an overlay predicate abstraction for non-empty strings`
  - `Unsupported arktype array length schema; current lengthCat cannot encode non-empty-only constraints`
- Detect unbounded divisor-only constraints:
  - `number % N`
  - `number.integer % N`
  - Return caveat-only result because no finite bounds are present.
- Keep current unsupported `number.integer` caveat behavior, but update reason if needed to fit the broader parser.
- Use `modelSlackCaveat` for non-numeric string/array constraints, or add a helper such as `unprovableSchemaDomainCaveat` if multiple providers need it. Do not label string/array caveats as “numeric.”
- Add provider tests asserting caveat reasons contain stable substrings:
  - `Unsupported arktype string length schema`
  - `Unsupported arktype array length schema`
  - `Unsupported arktype numeric schema grammar` or a clearer bounded-divisor-specific message

Stop and ask/report if:

- The repo has a stricter caveat taxonomy that should be extended before adding a generic schema caveat.

### 6. Add CLI regression coverage through registry wiring

Files to edit:

- `src/cli/features/extract/command.test.ts`

Implementation:

- Add one end-to-end test for a new exact provider refinement:
  - App imports `type` from `arktype`
  - `const [label] = useState(type("'idle' | 'posting'"));`
  - extracted `local:App.label` domain is `{ kind: "enum", values: ["idle", "posting"] }`
- Add one end-to-end test for bounded divisor refinement if provider tests alone are not enough:
  - `const [n] = useState(type("-5 <= (number.integer % 2) <= 5"));`
  - extracted domain is `intSet [-4, -2, 0, 2, 4]`
- Avoid many slow CLI tests; keep most cases in provider tests.

Stop and ask/report if:

- `useState(type("'idle' | 'posting'"))` produces a semantic type that bypasses provider output. If so, use a CLI case that proves the new parser path still affects extraction, or document why direct provider tests are the right coverage.

### 7. Update documentation for the new supported subset

Files to edit:

- `docs/architecture/type-library-adapters.md`
- `docs/concepts/state-and-domains.md`
- `docs/reference/package-entry-points.md`
- `docs/guides/refining-domains-and-overlays.md`
- `docs/sources/react-features.md`

Implementation:

- State that ArkType adapter support is intentionally a static subset:
  - string literal unions -> `enum`
  - inclusive integer range -> `boundedInt`
  - bounded integer divisor/range -> `intSet` or `boundedInt`
  - string length / array length / unbounded divisor -> caveat, usually overlay needed
- Keep docs explicit that structural ArkType inferred types still flow through TypeScript semantic inference when preserved by `typeof Schema.infer`.
- Do not claim full ArkType grammar support.
- Do not update generated docs output.

Stop and ask/report if:

- Docs have been reorganized and one of the listed files no longer contains ArkType schema adapter language.

### 8. Resolve the issue note

Files to edit:

- `docs/_issues/arktype-non-numeric-schema-constraints-not-refined.md`

Implementation:

- If the repository has a convention for closed issues under `docs/_issues/closed/`, follow it.
- Otherwise, append a short “Resolution” section describing:
  - exact refinements added
  - constraints intentionally caveated
  - tests added
- Keep the issue note honest: non-empty string and array constraints are not fully refined until the IR supports restricted length categories or predicate abstractions from schema providers.

Stop and ask/report if:

- There is no clear local convention for closing issue docs and changing the issue file would be noisy. In that case, leave the issue file untouched and mention it in the final implementation report.

## Per-Step Files to Edit

- Step 1:
  - `src/extract/type-libraries/arktype/domains.ts`
- Step 2:
  - `src/extract/type-libraries/arktype/domains.ts`
- Step 3:
  - `src/extract/type-libraries/arktype/domains.ts`
  - `test/extract/type-libraries/arktype-domain-refinement.test.ts`
- Step 4:
  - `src/extract/type-libraries/arktype/domains.ts`
  - `test/extract/type-libraries/arktype-domain-refinement.test.ts`
- Step 5:
  - `src/extract/type-libraries/arktype/domains.ts`
  - `src/extract/engine/ts/caveats.ts` only if adding a general helper
  - `test/extract/type-libraries/arktype-domain-refinement.test.ts`
- Step 6:
  - `src/cli/features/extract/command.test.ts`
- Step 7:
  - `docs/architecture/type-library-adapters.md`
  - `docs/concepts/state-and-domains.md`
  - `docs/reference/package-entry-points.md`
  - `docs/guides/refining-domains-and-overlays.md`
  - `docs/sources/react-features.md`
- Step 8:
  - `docs/_issues/arktype-non-numeric-schema-constraints-not-refined.md`

## Acceptance Criteria

- `type("'typescript'")` can refine to an `enum` domain when the provider receives it as a static ArkType initializer.
- Static ArkType string literal unions refine to deterministic `enum` domains.
- Existing `type("0 <= number.integer <= 3")` behavior still returns `boundedInt` with `overflow: "forbid"`.
- Static bounded integer divisor/range grammar refines to an exact finite `intSet` or `boundedInt`.
- Unbounded `number % N` / `number.integer % N` does not produce an invented finite domain.
- ArkType string length constraints produce clear caveats rather than silently abstaining.
- ArkType array length constraints produce clear caveats rather than silently abstaining.
- Non-ArkType expressions still abstain.
- Broad ArkType schemas such as `type("string")` do not become finite domains.
- Docs accurately describe supported and unsupported ArkType adapter behavior.
- No generated artifacts are modified.

## Tests to Add or Update

- `test/extract/type-libraries/arktype-domain-refinement.test.ts`
  - Add direct provider tests for:
    - single string literal -> `enum`
    - string literal union -> sorted `enum`
    - existing bounded integer range still works
    - bounded integer divisor/range -> `intSet`
    - modulo by zero -> caveat
    - unbounded divisor -> caveat
    - string length -> caveat
    - array length -> caveat
    - broad string -> no finite domain or clear caveat depending parser policy
    - non-ArkType expression -> abstain
- `src/cli/features/extract/command.test.ts`
  - Add one registry-level ArkType literal-union extraction regression.
  - Add one registry-level bounded-divisor regression only if provider tests do not sufficiently prove integration.

## Verification Commands

Run commands with `rtk` where practical:

```bash
rtk pnpm test -- test/extract/type-libraries/arktype-domain-refinement.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm typecheck
rtk pnpm fix
rtk pnpm test
```

If docs-only formatting changes are small and `pnpm fix` rewrites many unrelated files, stop and report before accepting broad churn.

## Risks, Ambiguities, and Stop Conditions

- ArkType docs show `number % 2`, but modality domains only model finite integer state. Do not treat unbounded divisors as finite.
- ArkType docs show `-50 < (number % 2) < 50`; if `number % 2` is not guaranteed to imply integer multiples, supporting only `number.integer % 2` is safer. Stop and report if this ambiguity blocks exactness.
- String and array length constraints are real ArkType features, but current `AbstractDomain` cannot represent “non-empty string” or “non-empty array” exactly. Caveat them instead of widening or pretending `lengthCat` excludes `"0"`.
- Empty `intSet` is invalid in the core validator. Unsatisfiable parsed constraints must become caveats unless the project has an explicit empty-domain representation.
- String literal parsing can become surprisingly complex with escapes. Keep initial support narrow and tested; do not build a full grammar.
- If semantic TypeScript extraction already handles some ArkType literal cases before provider refinement, do not fight pipeline ordering. Keep provider tests for parser behavior and use CLI tests only where the provider output is observable.
- If adding a general schema caveat helper would require broad caveat taxonomy changes, use `modelSlackCaveat` locally in the ArkType provider.
