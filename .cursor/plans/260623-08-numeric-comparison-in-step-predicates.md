# 260623-08 — Support numeric comparison/arithmetic exprs in step predicate `pre`/`post`

Fixes `docs/_issues/lessthan-unsupported-in-alwaysstep-pre.md`.

## 1. Goal

Make numeric comparison expressions (`lt`, `lte`, `gt`, `gte`) — and, for the same
root cause, arithmetic expressions (`add`, `sub`, `mod`) — accepted inside the
`pre` and `post` predicates of an `alwaysStep` (and `leadsToWithin` trigger) step
predicate, so that guard invariants like *"a reset must never be enqueued while
strength is below the minimum"* can be expressed and checked.

The fix is structural: the artifact serializer's hand-written `ExprIR` kind
allowlist (`assertSerializableExpr` in `src/core/artifacts/index.ts`) has drifted
from the canonical `ExprIR` union in `src/core/ir/types.ts`. Close the drift and
add a guard so it cannot silently recur.

Secondary: when an expression kind is genuinely unsupported, the diagnostic must
name the offending **property** (not just its positional index) so users can find
it in a multi-property file.

## 2. Non-goals

- No change to checker evaluation semantics. `lt/lte/gt/gte/add/sub/mod` are
  already implemented in `src/core/ir/eval.ts` and `src/core/ir/validator.ts`;
  only the artifact ingestion gate rejects them. Do **not** touch eval/validator
  comparison logic.
- No error aggregation / partial-file checking. A bad property still fails the
  parse fast; we only improve *which* property the message points at. (Explicitly
  deferred per planning decision.)
- No new public `properties` builder API; `lessThan`/`greaterThan` etc. already
  exist (`src/core/props/index.ts`).
- No change to how `temporal` (always/reachable) atom predicates are validated
  beyond what Step 4 covers (see Risks).

## 3. Current-state findings

- Error origin: `src/core/artifacts/index.ts:691-694`, the `default` arm of
  `assertSerializableExpr`, throws
  `` `${path} has unsupported expression kind ${String(value.kind)}` ``.
- `assertSerializableExpr` (`src/core/artifacts/index.ts:617-696`) is a manual
  allowlist. It handles: `lit`, `read`, `readPre`, `readOpArg`, `freshToken`,
  `transitionEnabled`, `transitionEnabledPrefix`, `tagIs`, `lenCat`, `not`,
  `cond`, `updateField`, `eq`, `neq`, `and`, `or`.
- Canonical `ExprIR` (`src/core/ir/types.ts:62-82`) additionally defines:
  - `{ kind: "lt" | "lte" | "gt" | "gte"; args: readonly [ExprIR, ExprIR] }`
  - `{ kind: "add" | "sub" | "mod"; args: readonly [ExprIR, ExprIR] }`
  These two groups are the entire gap.
- Step predicate `pre`/`post` route through this allowlist:
  `assertSerializableStepPredicate` calls `assertSerializableExpr(value.pre, …)`
  and `assertSerializableExpr(value.post, …)` at
  `src/core/artifacts/index.ts:530-535`.
- Why `always`/`reachable` appear to "work": `assertSerializableTemporalFormula`
  `atom` case (`src/core/artifacts/index.ts:469-476`) only checks the predicate is
  a record with a string `kind`; it never recurses into the expression, so any
  kind passes. The asymmetry is the source of the user's confusion, not a second
  bug to fix here.
- Downstream support already exists for the missing kinds:
  - `src/core/ir/eval.ts:73-114` evaluates `lt/lte/gt/gte` (and `add/sub/mod`).
  - `src/core/ir/validator.ts:719-722, 805-814, 1026-1069` walks and validates
    them.
  - `src/core/ir/field-pruning.ts:86-196` handles them.
  This confirms the allowlist is the *only* gate rejecting the expressions.
- Property path/name: properties are validated at
  `src/core/artifacts/index.ts:274-276` with path `properties[${index}]`; the
  property object carries `value.name` (asserted a string at line 402-404). The
  name is available to thread into the path.
- Test home: `test/kernel/artifacts.test.ts` exercises `parsePropertyArtifact`
  for step predicates and temporal formulas (see lines 380-498). This is where new
  cases belong (fast tier; not e2e).

## 4. Atomic implementation steps

1. **Add comparison + arithmetic kinds to the allowlist.**
   In `src/core/artifacts/index.ts`, inside `assertSerializableExpr`, extend the
   existing two-or-more-arg `case "eq": case "neq": case "and": case "or":` block
   to also cover `"lt"`, `"lte"`, `"gt"`, `"gte"`, `"add"`, `"sub"`, `"mod"`.
   - Keep validating that `args` is an array and recursing into each entry via
     `assertSerializableExpr`. The existing block already does exactly this and is
     shape-compatible (comparison/arithmetic args are a 2-tuple, which is a valid
     array). Do **not** add a stricter `length === 2` check here — runtime arity is
     enforced by the canonical IR validator (`validator.ts`); the serializer's job
     is structural JSON shape only, matching how `eq`/`and` are handled today.

2. **Centralize the kind list to prevent re-drift.**
   Introduce a single source of truth for "binary/variadic arg-list expr kinds" so
   the allowlist and the drift guard reference the same set. Add an exported const
   near `assertSerializableExpr`, e.g.:
   ```ts
   // kinds whose payload is { args: ExprIR[] }
   const ARG_LIST_EXPR_KINDS = new Set([
     "eq", "neq", "and", "or",
     "lt", "lte", "gt", "gte",
     "add", "sub", "mod",
   ]);
   ```
   Use this set to drive the `case` arm (a single `default`-guarded membership
   check, or keep explicit `case` labels but assert the set covers them). Prefer:
   collapse the explicit `case` labels for arg-list kinds into one check using
   `ARG_LIST_EXPR_KINDS.has(value.kind)` placed before the `default` throw, so the
   list lives in exactly one place.

3. **Thread the property name into the validation path.**
   In `assertSerializableProperty` (`src/core/artifacts/index.ts:392`), after the
   `value.name` string check, build a richer path for downstream asserts, e.g.
   `const namedPath = \`${path} (${value.name})\`;` and pass `namedPath` to
   `assertSerializableStepPredicate` / `assertSerializableTemporalFormula` /
   `leadsToWithin` asserts. Result: an unsupported kind reports e.g.
   `properties[2] (cannotSubmitWeakPassword).predicate.pre has unsupported
   expression kind <kind>` instead of `properties[2].predicate.pre …`.
   - Keep the existing `path` for the structural `must be an object` / `missing
     name` errors that fire *before* the name is known.

4. **Add a drift guard test (allowlist vs. canonical `ExprIR`).**
   Add a unit test (see Step 5) that enumerates every `ExprIR` kind and asserts a
   minimal well-formed instance of each is accepted by `parsePropertyArtifact`
   when embedded in an `alwaysStep` `pre`. This locks the allowlist to the union so
   a future `ExprIR` addition that forgets the serializer fails CI loudly.
   - Source the kind list from a hand-maintained array in the test that mirrors
     `ExprIR`, with a comment pointing at `src/core/ir/types.ts:62`. (We cannot
     reflect a TS union at runtime; the test array *is* the guard, and reviewers
     update both together.) Include `lt/lte/gt/gte/add/sub/mod` explicitly.

## 5. Tests to add or update

File: `test/kernel/artifacts.test.ts` (fast tier).

- **`accepts numeric comparison exprs in alwaysStep pre/post`** — parse an
  `alwaysStep` whose `predicate` is `{ step: { transitionId: "t" }, pre: { kind:
  "lt", args: [ { kind: "read", var: "x" }, { kind: "lit", value: 4 } ] } }` and
  expect `.toHaveLength(1)`. Repeat (or table-drive) for `lte`, `gt`, `gte` and for
  `post`.
- **`accepts arithmetic exprs in step predicates`** — same shape with `add`/`sub`/
  `mod` nested inside an `lt` (e.g. `score - 1 < 4`) to prove recursion works.
- **`reproduces the issue scenario`** — mirror the issue's predicate exactly
  (`negate: true`, `step: { enqueued: … }` or `transitionId`, `pre: lt(read,
  lit 4)`) and assert it parses. This is the regression lock for the bug report.
- **`names the property on unsupported kind`** — feed a deliberately bogus kind
  (e.g. `{ kind: "bogus" }`) in `pre` of a property named `weakGuard` and assert
  the thrown message contains both `weakGuard` and `unsupported expression kind
  bogus`.
- **`drift guard: every ExprIR kind is accepted`** — Step 4 test; iterate the kind
  array, build a minimal valid node per kind, embed in `pre`, expect parse success.
- Confirm existing temporal/step tests (lines 380-498) still pass unchanged.

## 6. Verification

Run, in order:

- `rtk pnpm typecheck`
- `rtk pnpm test test/kernel/artifacts.test.ts` (targeted)
- `rtk pnpm test` (fast tier, <30s, no regressions)
- `rtk pnpm fix` (Biome lint + format)
- Optional end-to-end sanity using the issue's predicate: add a temporary
  `*.props.ts` with the `lessThan(passwordStrengthScore, 4)` step guard in an
  existing example/fixture and run `modality check` to confirm no "unsupported
  expression kind lt"; remove the temporary file afterward. (Do not commit it.)

## 7. Acceptance criteria

- `assertSerializableExpr` accepts `lt`, `lte`, `gt`, `gte`, `add`, `sub`, `mod`
  with recursive arg validation; the issue's reproduction predicate parses.
- The allowlist's arg-list kinds are defined in exactly one place
  (`ARG_LIST_EXPR_KINDS`) and the drift-guard test fails if any `ExprIR` kind is
  not accepted.
- Unsupported-kind diagnostics include the property name, e.g.
  `properties[2] (cannotSubmitWeakPassword).predicate.pre has unsupported
  expression kind …`.
- `pnpm typecheck`, `pnpm test`, and `pnpm fix` are clean.
- No change to `eval.ts` / `validator.ts` comparison semantics.

## 8. Risks, ambiguities, and stop conditions

- **Risk — temporal-atom inconsistency stays.** `always`/`reachable` atoms remain
  un-deep-validated (Step 3 only adds the name to the path; it does not start
  recursing into atom predicates). This is intentional and out of scope. If you
  decide to also deep-validate temporal atoms via `assertSerializableExpr`,
  **stop** and confirm — it could reject currently-accepted artifacts and belongs
  in a separate plan.
- **Risk — arity strictness.** Do not enforce `args.length === 2` for comparison/
  arithmetic in the serializer; the canonical validator owns arity. Adding it here
  would diverge from how `eq`/`and` are treated and risk rejecting valid IR.
- **Ambiguity — runtime reflection of the union.** TS unions are not reflectable
  at runtime, so the drift guard is a hand-maintained array. Mitigation: colocate
  it with an explicit comment referencing `src/core/ir/types.ts:62` so the union
  and the test array are updated together.
- **Stop condition.** If targeted parsing still fails after Steps 1–2, the gate is
  not the only rejection point — re-grep for other ingestion validators (e.g. TLA
  export at `src/cli/features/export/command.ts:560`, or a slice-manifest
  validator) before widening the change, and surface findings rather than patching
  blindly.
- **Out-of-scope discovery.** If checking the issue predicate end-to-end surfaces a
  *semantic* failure (e.g. domain inference collapsing the variable to `boundedInt
  0..0`, mentioned in the issue), that is a separate extraction/overlay concern;
  note it but do not fold it into this plan.
