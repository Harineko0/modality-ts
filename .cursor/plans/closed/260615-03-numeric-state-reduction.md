# Plan 03: Numeric state-space reduction

Phase C of the numeric-state work. This phase depends on Plan 01 for finite
numeric domains and Plan 02 for numeric IR/checker semantics. It keeps wide
numeric state useful without pretending that `Uint16` should usually explode
into 65,536 eagerly enumerated states.

## Goal

Add explicit state-space reduction strategies for numeric domains while keeping
modality-ts honest about verification claims.

The default posture:

- exact when cheap and semantically important
- lazy when deterministic transitions only reach a small subset
- property-preserving abstraction when provable
- heuristic abstraction only with a downgraded claim

## Non-goals

- No SMT/symbolic arithmetic backend.
- No general nonlinear arithmetic.
- No silent lossy compression of numeric domains.
- No claim of exact verification when a heuristic reduction may hide relevant
  distinctions.

## Reduction strategies

### C1. Exact-first policy

Preserve exact numeric sets from TypeScript:

- `0 | 2` remains `intSet{values:[0,2]}`.
- Literal initial alternatives remain exact.
- An explicit `IntSet<...>` alias may be added later, but is not required for
  the first implementation.

Never widen a sparse domain unless a named reduction records the lost precision
and the report explains the claim level.

### C2. Lazy reachable expansion

Keep dense range bounds as membership/overflow constraints. Do not enumerate the
full range unless the model operation requires nondeterminism.

Full enumeration is limited to:

- `havoc`
- multi-initial sources
- explicit nondeterministic choices

A deterministic counter starting from `0` should explore only the concrete
values reached by transitions within the search bound.

### C3. Saturation counters

Support a policy/config/annotation for counts, queue lengths, retry counters,
page counts, and similar monotone-ish values.

Example: if the relevant property is `len <= 3`, a `0..255` value may use:

```ts
0 | 1 | 2 | 3 | 4
```

where `4` means "4 or more".

This can be property-preserving for matching upper-bound safety properties if
increment/decrement semantics preserve the sentinel meaning:

- `satInc(3) = 4`
- `satInc(4) = 4`
- decrement from sentinel must be conservative unless the exact hidden value is
  known

If decrement or reset behavior makes the sentinel ambiguous, require an explicit
annotation or mark the reduction heuristic.

### C4. Interval abstraction

Derive finite category domains from numeric cut points found in:

- guards
- properties
- transition branches
- user annotations/config

Example cuts `[0, 10]` can become:

- `Zero`
- `Small`
- `Large`

or representative intervals:

- `0`
- `1..9`
- `10+`

Only report this as verification-preserving when every relevant numeric
observation is represented by the partition.

### C5. Predicate abstraction

When checks and future branches only observe predicates, store predicate/category
state instead of the full integer.

Examples:

- `x === 0`
- `x <= LIMIT`
- `x > maxPage`

The abstraction must cover all numeric observations in:

- property predicates
- transition guards
- transition effects that branch on the numeric value
- enqueue args if later transitions inspect them
- navigation decisions

If coverage cannot be proven, fall back to exact/lazy numeric state or mark the
reduction heuristic.

### C6. Cone-of-influence dropping

If a numeric state var does not affect a property, transition guard, future
write, navigation, enqueue arg, replay-relevant observation, or another retained
var, remove it from the per-property checked state slice.

This is sound when the dependency graph is conservative. If dependency tracking
is incomplete, prefer keeping the variable.

### C7. Input-class abstraction

For user-entered numbers, do not model every integer in a width alias by default.
Model input classes such as:

- `empty`
- `invalid`
- `belowMin`
- `validSmall`
- `validLarge`
- `aboveMax`

Use exact numeric exploration only when the user explicitly requests it or the
input domain is already small.

### C8. Claim-level reporting

Every numeric reduction must be visible in reports/caveats.

Claim levels:

- `exact`: verified within the exact finite numeric domain
- `property-preserving`: verified within the stated abstraction/bounds
- `heuristic`: tested, not verification, or a downgraded verification claim that
  names the hidden numeric distinctions

Do not let AI, heuristics, or convenience suppress behavior from the model
without reporting it.

## Files

- `src/extract/engine/ts/numeric/abstraction.ts` - new abstraction/reduction
  helpers.
- `src/core/ir/types.ts` - additive metadata types if needed for reductions.
- `src/core/report` and/or `src/cli/features/check` report rendering - claim
  levels and reduction summaries.
- Checker slicing / cone-of-influence code - numeric COI dropping.
- `src/cli/features/export/command.ts` - export reduced models when the reduction
  is already represented in the IR/domain.
- Tests under `test/extract`, `test/core`, checker slicing tests, and phase7
  scenarios where export parity is meaningful.

## Implementation steps

1. Define reduction metadata.

   Use a shape like:

   ```ts
   interface NumericReduction {
     varId: string;
     kind:
       | "exact"
       | "lazy-range"
       | "saturation"
       | "interval"
       | "predicate"
       | "input-class"
       | "dropped";
     claim: "exact" | "property-preserving" | "heuristic";
     reason: string;
     source?: SourceAnchor;
   }
   ```

   Store this in extraction/check reports or model metadata, following existing
   `extractionCaveats`/trust-ledger patterns.

2. Implement exact-first and lazy-range defaults.

   - Exact `intSet` domains are kept.
   - Dense numeric ranges remain bounds/membership constraints.
   - Deterministic successors do not enumerate full ranges.
   - `havoc`/multi-initial over a wide range emits a warning before enumeration.

3. Add saturation counter support.

   Start with explicit config/annotation if automatic proof is too much for the
   first pass. Automatic use requires proving the property and transition
   semantics are compatible with the sentinel.

4. Add interval abstraction.

   Collect numeric cut points from guards/properties/annotations. Produce finite
   categories only when all relevant numeric observations are covered.

5. Add predicate abstraction.

   Collect numeric predicates used by properties and branches. Replace numeric
   state with predicate/category state only when every relevant observation is
   represented.

6. Add numeric COI dropping.

   Reuse existing slicing/dependency machinery. A numeric var can be removed from
   a per-property check only when conservative dependency analysis proves it
   cannot influence the property.

7. Add input-class abstraction.

   Model arbitrary user-entered numeric values as classes rather than every value
   in a width alias. Keep classes configurable and report them.

8. Add report rendering.

   Every exact, property-preserving, or heuristic reduction must show up in the
   report with:

   - variable id
   - reduction kind
   - claim level
   - reason
   - any source anchor available

## Acceptance criteria

- Exact numeric sets remain exact and are not widened silently.
- A deterministic counter over a wide range reaches only values produced by
  transitions within the search bound.
- A wide `havoc` or multi-initial numeric range emits a guardrail warning.
- Saturation counter reductions are represented and reported.
- Interval abstraction reductions are represented and reported.
- Predicate abstraction reductions are represented and reported.
- Input-class abstractions are represented and reported.
- COI-dropping of numeric vars is conservative and reported.
- Heuristic reductions downgrade the claim; they never appear as exact
  verification.

## Tests

- `test/extract/numeric-abstraction.test.ts`
  - exact-first sparse sets
  - saturation counter metadata
  - interval cuts
  - predicate classes
  - input classes
  - heuristic downgrade
- Checker slicing tests
  - numeric variable dropped when irrelevant
  - numeric variable retained when it affects guards/properties/effects
- Report tests
  - exact/property-preserving/heuristic claim rendering
  - caveat/reduction metadata included
- `tools/phase7-differential.ts`
  - saturation-counter scenario when the same reduced model can be exported to
    TLA

## Verification

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
```

Run `rtk pnpm build:rust` first if any reduction scenario depends on Rust changes
from Plan 02 that are not already built.

## Risks and stop conditions

- Reduction soundness is per property. If every relevant numeric observation is
  not represented, downgrade the claim or keep exact/lazy numeric state.
- Saturation can be unsound when decrement/reset behavior depends on the hidden
  exact value. Require proof, annotation, or downgrade.
- Predicate abstraction is only safe when all numeric predicates that affect the
  transition relation and property are represented.
- COI dropping must be conservative. If dependency tracking is uncertain, keep
  the var.
- Do not hide state-space pruning under a normal verification result.
