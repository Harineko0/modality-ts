# Fix Plan: Numeric Updater Review Findings

## 1. Goal

Fix the three review findings from the Cursor implementation of `.cursor/plans/260616-08-numeric-updaters.md`:

- make numeric domain widening sound when clamp-derived bounds and direct literal assignments coexist;
- prevent string state updater expressions such as `setLabel((s) => s + 1)` from being lowered to numeric `add`;
- remove unrelated generated artifact churn from the staged output.

The repaired implementation should keep the Coffee DX `LaneTimer` behavior from the prior plan:

- `useState(0)` remains a numeric seed domain before widening;
- updater increments such as `(s) => s + 180` lower to exact numeric `add`;
- reset assignments such as `setDraftSec(0)` remain exact;
- final extracted domains cover the values reachable within configured `bounds.maxDepth`;
- unsupported or non-numeric updater expressions still fall back to the existing `unrepresentable`/havoc path.

## 2. Non-goals

- Do not rewrite the numeric updater feature broadly.
- Do not change checker overflow semantics.
- Do not add Coffee-DX-specific logic.
- Do not implement TypeScript type-checker-based evaluation in this fix.
- Do not remove the existing havoc fallback for expressions that remain unsupported.
- Do not change generated example models unless the change is intentional and directly caused by source behavior.
- Do not preserve backward compatibility for incorrect behavior; this project is experimental.

## 3. Current-state Findings

- The current staged implementation passes:
  - `rtk pnpm vitest run test/extraction/architecture.test.ts test/extraction/extraction.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts`
  - `rtk pnpm typecheck`
  - `rtk pnpm architecture`
  - `rtk pnpm test`
- Passing tests do not cover two semantic edge cases found in review.
- Finding 1: `widenDomain()` in `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts` uses `info.upperClamp` or `info.lowerClamp` as final bounds without reconciling direct literal assignments. A model with `Math.min(s + 10, 300)` and `setCount(500)` currently widens to `0..300`, even though `500` is directly assigned.
- Finding 1 also includes merge-order unsoundness: `mergeInfo()` keeps the first clamp via `left.upperClamp ?? right.upperClamp`, so two clamp updaters such as `Math.min(s + 1, 10)` and `Math.min(s + 1, 300)` can produce max `10` if the smaller clamp is seen first.
- Finding 2: `numericBinaryValueExpr()` in `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts` lowers any `+` with one numeric literal to numeric `add`. A string state updater `setLabel((s) => s + 1)` currently emits numeric `add`, but JavaScript performs string concatenation.
- Finding 3: `/Users/hari/proj/modality-ts/examples/todo-app/.modality/app.model.ts` has unrelated absolute path churn from `/Users/hari/proj/modality-ts-worktrees/lazy-array-initializer/...` to `/Users/hari/proj/modality-ts/...`. This is not part of the numeric updater fix and should not be included.
- Existing positive regression tests were added near:
  - `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
  - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
  - `/Users/hari/proj/modality-ts/test/sources/use-state/use-state-source.test.ts`
  - `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts`

## 4. Exact File Paths and Relevant Symbols

Primary edit files:

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts`
  - `NumericWideningInfo`
  - `mergeInfo`
  - `clampBoundsFromCond`
  - `collectFromAssignExpr`
  - `widenDomain`
  - `widenNumericDomainsFromTransitions`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`
  - `setterArgumentExpr`
  - `valueExpr`
  - `numericBinaryValueExpr`
  - `mathClampValueExpr`
- `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
  - add direct skeleton regressions for unsafe string-plus lowering and clamp/literal widening
- `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
  - optionally add pipeline-level clamp/literal widening regression if direct skeleton coverage is not enough

Cleanup file:

- `/Users/hari/proj/modality-ts/examples/todo-app/.modality/app.model.ts`
  - remove this staged change from the final patch unless a later intentional behavior change regenerates it

Reference paths:

- `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`
  - `metadata.numericSeed`
- `/Users/hari/proj/modality-ts/src/extract/sources/use-state/transitions.ts`
  - call to `widenNumericDomainsFromTransitions()`
- `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - call to `widenNumericDomainsFromTransitions()`
- `/Users/hari/proj/modality-ts/src/core/ir/types.ts`
  - numeric IR expression shapes
- `/Users/hari/proj/modality-ts/src/core/ir/eval.ts`
  - runtime interpretation of numeric IR

## 5. Existing Patterns To Follow

- Use `rtk` for shell commands.
- Keep TypeScript ESM imports with explicit `.js` extensions for local modules.
- Prefer small helper functions in the existing AST-lowering style.
- Keep arithmetic lowering conservative; unsupported expressions should remain unrepresentable rather than overfitted.
- Keep React batching semantics:
  - handler reads outside functional updaters use `readPre`;
  - functional updater parameters use live `read`.
- Keep the numeric widening helper independent of React source text where possible; it should operate on `StateVarDecl[]`, `Transition[]`, and seed provenance.
- Do not introduce a TypeScript Program/type-checker dependency for this targeted fix unless the existing local metadata is insufficient and you stop to report first.
- Preserve the existing `numericSeed` provenance guard so explicit singleton numeric types such as `useState<0>(0)` and finite unions such as `useState<0 | 1>(0)` are not widened.

## 6. Atomic Implementation Steps

### Step 1: Add failing regression coverage for clamp/literal widening

Add a test in `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts` using `extractUseStateSkeleton()`:

```tsx
import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount((s) => Math.min(s + 10, 300))}>Clamp</button>
      <button onClick={() => setCount(500)}>Set</button>
    </>
  );
}
```

Assert:

- `local:App.count` has `boundedInt` domain with `min: 0` and `max: 500`;
- `overflow: "forbid"` is preserved if existing widening still sets it;
- both transitions remain exact assignments.

Also add a merge-order test:

```tsx
setCount((s) => Math.min(s + 1, 10));
setCount((s) => Math.min(s + 1, 300));
```

Assert final max is `300`, not `10`.

If this behavior is easier to verify at pipeline level, add the second test to `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts` with `runExtractionPipeline({ sourcePlugins: [useStateSource()] })`, but keep at least one direct skeleton regression.

### Step 2: Fix clamp aggregation semantics

In `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts`, change clamp storage and merging so multiple clamp observations are sound:

- replace scalar `upperClamp?: number` / `lowerClamp?: number` with arrays such as `upperClamps: number[]` and `lowerClamps: number[]`, or keep scalars but merge with:
  - `upperClamp: Math.max(...)` for upper clamps;
  - `lowerClamp: Math.min(...)` for lower clamps.
- Prefer arrays if it keeps `hasEvidence` and tests easier to reason about.
- Update `emptyInfo()` and `mergeInfo()` accordingly.
- Update `clampBoundsFromCond()` to append clamp values rather than overwrite.

The final widened domain must use:

- `literalMin = min(initial, domain.min, domain.max, ...info.literals)`;
- `literalMax = max(initial, domain.min, domain.max, ...info.literals)`;
- `deltaMin = literalMin - maxNegativeDelta * maxDepth`;
- `deltaMax = literalMax + maxPositiveDelta * maxDepth`;
- if lower clamps exist, `candidateMin = min(deltaMin, minLowerClamp)` or another sound lower bound that never excludes direct literals;
- if upper clamps exist, `candidateMax = max(literalMax, maxUpperClamp)`.

For Coffee-style unclamped increments, this still produces `0..2160` with `maxDepth: 12`.

For `Math.min(s + 10, 300)` plus `setCount(500)`, this must produce max `500`, because the direct literal assignment is reachable.

For two upper clamps `10` and `300`, this must produce max `300`, because either transition can assign values up to its own cap.

For lower clamps, use the analogous sound behavior: multiple lower clamps should not exclude values reachable by another transition or by direct literal assignment.

### Step 3: Add failing regression coverage for string state plus number

Add a test in `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`:

```tsx
import { useState } from "react";

export function App() {
  const [label, setLabel] = useState("a");
  return <button onClick={() => setLabel((s) => s + 1)}>Append</button>;
}
```

Assert:

- the transition for `label` is not an `assign` whose expression is `add`;
- preferably, it remains `havoc` with an `.unrepresentable` id, matching the existing `s + "x"` test.

Keep the existing positive numeric test for `setCount((s) => s + 1)` so the fix does not disable the intended numeric lowering.

### Step 4: Make `+` lowering domain-aware enough to avoid string concatenation

In `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`, update `numericBinaryValueExpr()` so `+` lowers only when the expression is known numeric.

Minimal robust approach:

- detect when one side is a modeled state read;
- resolve the root state variable domain from `setters`:
  - for `read`/`readPre`, find the setter binding whose `varId` matches the read var;
  - if the read has a path, optionally use existing domain path helpers only if straightforward; otherwise do not lower path-based `+` in this fix;
  - require the domain to be numeric (`boundedInt` or `intSet`) before lowering `+`;
- allow numeric literal plus numeric state read in either order;
- allow numeric local bindings only if the local expression is already numeric IR and ultimately rooted in numeric state or numeric literal.

Simpler acceptable alternative:

- for `+`, require one operand to be a numeric literal and the other operand to be a `read`/`readPre` whose root domain is `boundedInt` or `intSet`;
- keep nested numeric expressions like `s + 10 + 20` unsupported unless tests already require them.

Do not lower `+` if the non-literal side is:

- a string literal;
- a read of an enum/string/token/record/option/lengthCat/boundedList domain;
- an unknown local expression;
- a property path whose domain cannot be resolved confidently.

Keep `-` and `%` conservative too if possible. JavaScript `-` and `%` coerce strings to numbers, but this model should avoid inventing numeric semantics for non-numeric state. Prefer requiring numeric-read evidence for all numeric binary operators.

### Step 5: Keep Math clamp lowering numeric-safe

`mathClampValueExpr()` currently calls `valueExpr()` on the non-literal argument. After Step 4, `Math.min(s + 10, 300)` should still lower for numeric state, while `Math.min(label + 1, 300)` should become unsupported.

Add or update tests if needed:

- numeric `Math.min(s + 10, 300)` still lowers to a `cond`;
- string state inside `Math.min(label + 1, 300)` does not lower to numeric `add` or a clamp.

### Step 6: Remove unrelated generated artifact churn

Remove the staged change to `/Users/hari/proj/modality-ts/examples/todo-app/.modality/app.model.ts`.

Preferred command:

```bash
rtk git restore --staged examples/todo-app/.modality/app.model.ts
rtk git restore examples/todo-app/.modality/app.model.ts
```

Only use this if the file contains no intentional user edits. If it has user edits unrelated to Cursor's generated path churn, stop and report instead of reverting.

### Step 7: Re-run focused and full verification

Run focused tests first:

```bash
rtk pnpm vitest run test/extraction/extraction.test.ts test/extraction/architecture.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts
```

Then run:

```bash
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm test
```

Run formatting/linting before handoff:

```bash
rtk pnpm fix
```

If `pnpm fix` rewrites unrelated files, inspect `rtk git diff` and keep only changes related to this fix.

## 7. Per-step Files To Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
  - optionally `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
- Step 2:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
- Step 4:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`
- Step 6:
  - `/Users/hari/proj/modality-ts/examples/todo-app/.modality/app.model.ts`
- Step 7:
  - no intentional file edits except formatting changes directly required by touched files

## 8. Acceptance Criteria

- `Math.min(s + 10, 300)` plus `setCount(500)` widens to include `500`.
- Multiple upper clamps merge soundly; max is the largest reachable cap, independent of transition order.
- Multiple lower clamps merge soundly; min does not exclude values reachable through another transition or direct literal assignment.
- Coffee-style `LaneTimer` still widens `draftSec` to `0..2160` with `maxDepth: 12`.
- `setCount((s) => s + 1)` for numeric `useState(0)` still lowers to exact `add`.
- `setLabel((s) => s + 1)` for string `useState("a")` does not lower to numeric `add`; it remains unsupported/havoc unless a future string-concat IR is introduced.
- Existing string concatenation test `s + "x"` still passes.
- Explicit finite numeric types are still not widened beyond their explicit domains.
- No unrelated generated artifact path churn remains in `examples/todo-app/.modality/app.model.ts`.
- Focused tests, typecheck, architecture, full tests, and formatting pass.

## 9. Tests To Add Or Update

Add to `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`:

- `widens clamp domains without excluding direct literal assignments`
  - source has `Math.min(s + 10, 300)` and `setCount(500)`;
  - expected domain includes max `500`.
- `merges multiple clamp bounds independent of encounter order`
  - source has `Math.min(s + 1, 10)` and `Math.min(s + 1, 300)`;
  - expected domain includes max `300`.
- `does not lower numeric-looking plus for string useState`
  - source has `useState("a")` and `setLabel((s) => s + 1)`;
  - expected transition is not numeric `add`, preferably havoc/unrepresentable.

Update existing tests only where their expectations encoded the now-fixed unsound behavior. Do not weaken the current positive LaneTimer/add/sub/Math.min tests.

Optional if implementation changes the pipeline path:

- Add a pipeline-level test in `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts` for clamp/literal widening through `runExtractionPipeline({ sourcePlugins: [useStateSource()] })`.

## 10. Verification Commands

Use:

```bash
rtk pnpm vitest run test/extraction/extraction.test.ts test/extraction/architecture.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm test
rtk pnpm fix
rtk git diff
rtk git diff --cached
```

If formatting changes after `pnpm fix`, rerun at least:

```bash
rtk pnpm typecheck
rtk pnpm vitest run test/extraction/extraction.test.ts
```

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if avoiding string `+` lowering requires a TypeScript type-checker dependency. Prefer a local domain-based guard first.
- Stop and report if numeric local expressions cannot be classified safely. Unsupported is better than unsound for this fix.
- Stop and report if clamp semantics become path-sensitive enough that a simple aggregate helper cannot represent them soundly. Do not ship a heuristic that excludes reachable literal assignments.
- Stop and report if fixing clamp bounds would require changing checker overflow behavior.
- Stop and report before reverting `/Users/hari/proj/modality-ts/examples/todo-app/.modality/app.model.ts` if it contains intentional user edits beyond path churn.
- Do not broaden numeric domains for explicit singleton or explicit finite numeric types.
- Do not remove the `.unrepresentable` fallback. It is the correct behavior for string concatenation until a string expression IR exists.
