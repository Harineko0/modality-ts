# Plan 02: Numeric IR, checker semantics, and TLA export

Phase B of the numeric-state work. This phase depends on Plan 01 for finite
numeric domains (`boundedInt` and `intSet`) and adds the IR/checker/export
semantics needed to use numeric state in guards and effects.

## Goal

Add the minimal numeric expression vocabulary and evaluate it over concrete
finite numeric state:

- ordered comparisons: `lt`, `lte`, `gt`, `gte`
- integer arithmetic: `add`, `sub`, `mod`
- assignment-time membership/overflow policy:
  `forbid | wrap | saturate`, default `forbid`

Reachable overflow must be a model-checking behavior, not something erased by
static validation.

## Non-goals

- No multiplication, division, nonlinear arithmetic, unbounded integers, or SMT
  backend.
- No eager enumeration of wide numeric ranges except through existing
  `havoc`/multi-initial mechanisms.
- No source-plugin numeric lowering changes beyond what is needed for tests.
- No heuristic state reduction; that is Plan 03.

## Current-state findings

- `ExprIR` has no ordered comparison or arithmetic variants.
- Rust `ExprIR` in `crates/checker/src/model.rs` mirrors the TS discriminants
  with serde `kind` tags; changes must stay lockstep.
- `crates/checker/src/expr.rs` has both `eval_expr` and `eval_expr_checked`.
  New variants must be added to both.
- `crates/checker/src/effect.rs` applies `Assign` by evaluating the expression
  and writing the value. Numeric overflow/membership policy belongs here.
- `src/core/ir/validator.ts` currently compares assigned expression domains
  with target domains. It must not reject reachable overflow statically.
- `src/cli/features/export/command.ts` currently materializes enumerated domain
  sets; wide `boundedInt` should export as TLC `min..max`, while `intSet` exports
  as an explicit finite set.

## Files

- `src/core/ir/types.ts`
- `src/core/ir/domains.ts`
- `src/core/ir/validator.ts`
- `crates/checker/src/model.rs`
- `crates/checker/src/expr.rs`
- `crates/checker/src/effect.rs`
- `crates/checker/src/domain.rs`
- `src/cli/features/export/command.ts`
- `tools/phase7-differential.ts`

## Implementation steps

1. Add TS IR variants in `src/core/ir/types.ts`.

   ```ts
   | { kind: "lt" | "lte" | "gt" | "gte"; args: readonly [ExprIR, ExprIR] }
   | { kind: "add" | "sub" | "mod"; args: readonly [ExprIR, ExprIR] }
   ```

   Numeric domains are `boundedInt` and `intSet`. Both may carry optional
   `overflow?: "forbid" | "wrap" | "saturate"`.

2. Update TS domain utilities.

   Ensure `overflow` is ignored by cardinality and enumeration. `intSet`
   validation/fingerprinting should already exist from Plan 01; keep it in sync
   if this phase lands together with Plan 01.

3. Update `src/core/ir/validator.ts`.

   - Comparisons require numeric operands and return `bool`.
   - Arithmetic requires numeric operands and returns a numeric result domain
     when statically useful.
   - Assignment to a numeric var rejects non-numeric expressions.
   - Assignment must not reject merely because an inferred arithmetic result may
     exceed the target. Overflow policy is checker/export semantics.
   - Boolean contexts reject numeric results with clear messages.

4. Mirror the IR in `crates/checker/src/model.rs`.

   Add serde discriminants:

   - `lt`
   - `lte`
   - `gt`
   - `gte`
   - `add`
   - `sub`
   - `mod`

   Add `IntSet { values, overflow }` and `BoundedInt { min, max, overflow }`.

5. Implement Rust expression evaluation in `crates/checker/src/expr.rs`.

   Add arms to both `eval_expr` and `eval_expr_checked`.

   - Comparisons return `Value::Bool`.
   - Arithmetic returns integer JSON values.
   - Operands should use integer semantics. If a JSON value is not an integer,
     return a conservative failure/default consistent with existing eval style,
     and add validation coverage so well-formed models avoid it.
   - `mod` should reject or bound-hit division by zero; do not silently invent a
     value.

6. Extend `domain_for_expr`.

   - Dense range operands may produce a dense result range.
   - Small exact-set cross-products may produce `intSet`.
   - Large products may return a conservative numeric range or `undefined`;
     assignment membership/overflow policy still handles concrete values.
   - `mod` with positive literal/range divisor can infer `[0, divisorMax - 1]`
     when safe.

7. Add numeric membership/overflow helpers in `crates/checker/src/domain.rs`.

   Behavior:

   - `forbid`: value not in target range/set triggers `on_bound_hit` and produces
     no successor.
   - `wrap`: dense ranges wrap modularly into `[min,max]`; `intSet` wraps over
     the sorted value list only if explicitly supported and documented.
   - `saturate`: dense ranges clamp to endpoints; `intSet` clamps to nearest set
     endpoint.
   - default: `forbid`.

8. Apply overflow policy in `crates/checker/src/effect.rs`.

   On `Assign` to a scalar numeric var, evaluate the concrete number, then apply
   the helper before writing. This is where reachable overflow becomes a
   checkable condition.

9. Update TLA export.

   - `boundedInt` -> `min..max`
   - `intSet` -> explicit finite set
   - `lt/lte/gt/gte` -> `< <= > >=`
   - `add/sub` -> `+ -`
   - `mod` -> `%` or the exporter’s existing TLA-compatible modulo form
   - `forbid` -> membership/in-range action condition or assertion
   - `wrap`/`saturate` -> generated expression matching Rust semantics

10. Add differential scenarios.

   Include:

   - bounded counter with `count < 3` guard and `count + 1` effect
   - sparse numeric set such as `0|2`
   - overflow `forbid`, `wrap`, and `saturate` cases where supported by export

## Acceptance criteria

- A guard `count < 3` lowered to `lt` evaluates correctly in Rust.
- An effect `count = count + 1` lowered to `add` evaluates correctly in Rust.
- A model that increments beyond `Bounded<0,3>` produces a `forbid`
  overflow/bound-hit, wraps, or saturates according to the target domain policy.
- The TS validator rejects arithmetic on non-numeric domains.
- The TS validator rejects comparison results used as non-bool.
- The TS validator does not reject numeric assignment merely because overflow
  might be reachable.
- `enumerate_domain` and `enumerateDomain` ignore `overflow`.
- A deterministic counter does not enumerate its full range; only reachable
  values appear in the state graph.
- TLA export emits ranges, exact sets, numeric operators, and overflow semantics
  consistent with Rust.
- `pnpm phase7` numeric scenarios pass.

## Tests

- `test/core/numeric-ir.test.ts`
  - comparison typing
  - arithmetic typing
  - numeric assignment compatibility
  - reachable-overflow-not-rejected-by-validator
  - non-numeric rejection cases
- `crates/checker/src/expr.rs` tests
  - comparison eval
  - add/sub/mod eval
  - result-domain inference
  - invalid divisor behavior
- `crates/checker/src/effect.rs` tests
  - exact-set membership
  - `forbid` overflow
  - `wrap` overflow
  - `saturate` overflow
- Existing export test directory
  - numeric model emits `min..max`
  - sparse set emits explicit finite set
  - numeric operators are generated
- `tools/phase7-differential.ts`
  - bounded counter
  - sparse set
  - overflow parity where export supports the same semantics

## Verification

```bash
rtk pnpm build:rust
rtk cargo test -p modality-checker --manifest-path crates/checker/Cargo.toml
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
```

The native addon must be rebuilt for Rust changes to affect JS tests.

## Risks and stop conditions

- IR lockstep is mandatory. If TS and Rust discriminants drift, stop before
  proceeding.
- `eval_expr` and `eval_expr_checked` must both gain every new expression arm.
- Static validation must not erase overflow counterexamples.
- `0|2` and `0..2` are semantically different. Do not widen exact sets in this
  phase.
- If TLA export cannot express `min..max` or exact sets without breaking the
  phase7 harness, stop and report instead of forcing a divergent export.
- If multiplication/division/unbounded integers become necessary, stop and open a
  separate SMT/symbolic-backend design discussion.
