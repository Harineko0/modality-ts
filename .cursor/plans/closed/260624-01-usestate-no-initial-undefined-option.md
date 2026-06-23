# Fix no-arg useState undefined initial modeling

## Goal

Fix `docs/_issues/usestate-no-initial-arg-mispicks-enum-initial.md` by making `useState<T>()` with no initial argument model React's runtime initial value as absent/undefined instead of selecting the first finite domain member.

Use the existing IR representation for absence: `option(inner)` with `null` as the serialized absent value. After the fix, this source:

```ts
const [serviceToRestart, setServiceToRestart] =
  useState<"project" | "database">();
```

must extract as:

```json
{
  "domain": { "kind": "option", "inner": { "kind": "enum", "values": ["database", "project"] } },
  "initial": null
}
```

and guards such as `serviceToRestart !== undefined` must lower to comparisons against the same absent sentinel (`null`).

## Non-goals

- Do not introduce `undefined` as a new `Value` JSON primitive. The IR currently serializes absence as `null`.
- Do not add a warning-only workaround when exact modeling is possible.
- Do not change overlay semantics except insofar as existing `option(...)` validation continues to accept `null` initials.
- Do not preserve the old behavior for compatibility; this is an experimental tool and the previous behavior is unsound.

## Current-state findings

- `src/extract/lang/ts/driver/domains.ts` derives `useState` domains from the explicit type argument via `inferUseStateDomainDetailed` / `inferUseStateDomainSemanticDetailed`. For `useState<"project" | "database">()`, the explicit `T` is inferred as an enum, even though React's no-arg overload returns `T | undefined`.
- `initialValueForUseStateDetailed` returns `firstValue(domain)` when `call.arguments[0]` is missing. For an enum, `firstValue` is the first enum member, producing the fabricated initial state reported in the issue.
- The core domain layer already supports the desired abstraction: `option(inner)` enumerates and validates `null` plus the inner values, and `firstValue({ kind: "option", ... })` returns `null`.
- `docs/_specs/02-extraction.md` already specifies `T | null | undefined` as `option(D(T))`; the missing piece is treating no-argument `useState<T>()` as having an implicit undefined initial even when `T` itself excludes `undefined`.
- Guard/expression parsing currently imports `literalValue` from `src/extract/lang/ts/driver/ast.ts`, which recognizes `null` but not `undefined`. Without this, `serviceToRestart !== undefined` may remain unsupported or fail to compare against the option sentinel even after the domain fix.
- Relevant tests live in `src/cli/features/extract/command.run.test.ts` for end-to-end extraction, with report/caveat expectations in `src/cli/features/extract/command.report.test.ts` if a fallback warning path is added.

## Atomic implementation steps

1. Add a small domain helper in `src/extract/lang/ts/driver/domains.ts`, for example `withImplicitUndefined(domain: AbstractDomain): AbstractDomain`, that wraps a domain in `{ kind: "option", inner: domain }` unless it is already `option`.

2. Apply that helper whenever a `useState` call has no first argument:
   - In `inferUseStateDomainDetailed`, after inferring from `typeArg`, return the wrapped domain if `call.arguments[0]` is missing.
   - In `inferUseStateDomainSemanticDetailed`, do the same for semantic `typeArg` inference before returning `semantic` or `ast`.
   - For no type argument and no initializer, return `option(tokens(1))` rather than bare `tokens(1)`.
   - Preserve existing schema/numeric/type-plugin behavior when an initializer exists.

3. Make the initial helper explicit and defensive:
   - In `initialValueForUseStateDetailed`, when no initializer exists, return `null` if the final domain is `option`.
   - If no initializer exists and the domain is not `option`, keep `firstValue(domain)` only as a fallback and add a local comment or test coverage that this path should not occur for normal `useState` inference.

4. Add a shared TS-expression absence helper:
   - In `src/extract/lang/ts/driver/ast.ts`, add `undefinedLiteralValue(expression)` or extend literal parsing through a new exported helper that returns `null` for the identifier `undefined` and `void 0`.
   - Use it in `src/extract/lang/ts/driver/transition/expressions.ts` and `src/extract/lang/ts/driver/transition/guards.ts` so `x === undefined`, `x !== undefined`, `setX(undefined)`, and `cond ? undefined : value` lower consistently to `lit(null)` where the IR expects absence.
   - Keep ordinary `literalValue` behavior stable if too many call sites rely on `undefined` meaning "not a literal"; prefer a new helper over changing every caller blindly.

5. Ensure setter writes to optional state can clear back to absence:
   - In `setterArgumentExpr`, before generic `valueExpr`, recognize explicit undefined expressions when `setter.domain.kind === "option"` and return `{ expr: { kind: "lit", value: null }, reads: [] }`.
   - Verify this covers direct setters and functional updater returns if the return expression is `undefined`.

6. Update docs/specs:
   - In `docs/_specs/02-extraction.md`, add one sentence under `useState` or domain inference: no-arg `useState<T>()` is modeled as `option(D(T))` with `initial: null`, because React initializes the state to `undefined`.
   - In `docs/sources/use-state.md`, mention no-argument `useState<T>()` uses the same absent sentinel as `T | undefined` and that `undefined`/`null` guards collapse to the option absent value.
   - After implementation is accepted, move `docs/_issues/usestate-no-initial-arg-mispicks-enum-initial.md` to the closed issues area if that is the repository's issue workflow.

## Tests to add or update

- Add an end-to-end extraction test in `src/cli/features/extract/command.run.test.ts`:
  - Source uses `useState<"project" | "database">()` with no initializer.
  - Assert the local var domain is `option(enum(...))`.
  - Assert `initial` is `null`.
  - Assert `validateModel(result.model).ok` is true.

- Add a transition/guard test in the same file:
  - Source renders a button or modal under `serviceToRestart !== undefined`.
  - Assert the extracted guard contains `neq(read local:App.serviceToRestart, lit null)`.
  - Add the inverse `serviceToRestart === undefined` case if it is cheap.

- Add a setter write test:
  - Source starts with `useState<"project" | "database">()` and has buttons for `setServiceToRestart("database")` and `setServiceToRestart(undefined)`.
  - Assert the first write assigns `"database"` and the clear write assigns `null`, not `havoc`.

- Add a regression for an already optional type:
  - `useState<"project" | "database" | undefined>()` should produce one `option(enum(...))`, not nested `option(option(...))`, and initial `null`.

- Keep or update existing typed literal tests such as the `Color` test around `src/cli/features/extract/command.run.test.ts`; initialized `useState<Color>("gray")` must remain `enum` with initial `"gray"`.

## Verification

Run:

```bash
rtk pnpm test src/cli/features/extract/command.run.test.ts
rtk pnpm test src/cli/features/extract/command.report.test.ts
rtk pnpm test src/core/ir/domains.test.ts
rtk pnpm typecheck
rtk pnpm fix
```

If the guard/expression changes affect shared transition lowering, also run:

```bash
rtk pnpm test test/extraction src/cli/features/extract
rtk pnpm architecture
```

## Acceptance criteria

- No-argument `useState<T>()` never fabricates the first enum/int/token member as the initial value when the runtime initial is absent.
- Extracted domain for no-arg finite `useState<T>()` is `option(D(T))` and `initial` is `null`.
- `x === undefined` and `x !== undefined` guards against modeled option state lower to comparisons against `lit(null)`.
- `setX(undefined)` for option-modeled state assigns `null` rather than becoming `havoc`.
- Existing initialized `useState<T>(value)` behavior is unchanged.
- The model validates and the new regression tests fail before the implementation and pass after it.

## Risks, ambiguities, and stop conditions

- Risk: mapping all identifier `undefined` expressions to `null` could affect rare code that shadows `undefined`. Stop and localize the helper if tests show false positives; do not globally reinterpret identifiers in contexts that are not IR literals or option-state writes.
- Risk: checker, codegen, or report formatting may expose `option(enum)` differently than enum-only domains. This is expected for the bug fix, but generated app model type snapshots may need intentional updates.
- Ambiguity: TypeScript's React overload means the state variable type is effectively `T | undefined`, but the extractor currently looks at `call.typeArguments[0]`. Prefer an explicit no-arg `useState` rule over trying to infer the hook overload return type from React declarations.
- Stop condition: if `option(enum)` guards against `null` cannot be validated by existing IR validator/checker without broader core changes, stop and implement the caveat fallback described in the issue only as a temporary clearly reported `unsound-risk` caveat.
