# Fix Plan: Numeric Updaters Collapse To Zero

## 1. Goal

Fix `docs/_issues/coffee-dx-numeric-updaters-collapse-to-zero.md` by making extracted React `useState` numeric updater controls produce a finite, useful numeric model instead of `boundedInt 0..0` plus `unrepresentable` havoc transitions.

For the Coffee DX `LaneTimer` shape:

```tsx
const [draftSec, setDraftSec] = useState(0);
setDraftSec((s) => s + 10);
setDraftSec((s) => s + 60);
setDraftSec((s) => s + 180);
setDraftSec(0);
```

the extracted model should:

- keep `local:LaneTimer.draftSec` numeric;
- include positive values within the configured model depth;
- lower the increment buttons to exact `add` assignments;
- lower reset to an exact literal assignment;
- stop emitting `.unrepresentable.*` transitions for these simple updater expressions.

## 2. Non-goals

- Do not edit the Coffee DX application.
- Do not add a Coffee-DX-specific special case.
- Do not change checker overflow semantics.
- Do not implement arbitrary JavaScript numeric evaluation.
- Do not make all untyped `number` state exact. Bare, unbounded `number` without usable initializer/update evidence should still produce the existing model-slack behavior.
- Do not build the full overlay/config refinement path in this fix unless the updater/domain inference route proves impossible.

## 3. Current-state Findings

- The issue file is `/Users/hari/proj/modality-ts/docs/_issues/coffee-dx-numeric-updaters-collapse-to-zero.md`.
- The CLI extraction path uses `useStateSource()` from `/Users/hari/proj/modality-ts/src/cli/registry/index.ts`.
- `runExtractionPipeline()` in `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts` discovers plugin state vars first, then passes those vars into `extractReactSourceTransitions()`. Because `options.stateVars` is present, generic React extraction does not replace plugin-discovered domains.
- The source plugin implementation in `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts` has a plugin-local `inferUseStateDomain()` that maps an untyped numeric initializer to `{ kind: "boundedInt", min: initial, max: initial }`. For `useState(0)`, this is `0..0`.
- The richer engine domain code is in `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`, but its untyped numeric initializer branch currently returns an enum-like literal domain rather than a numeric bounded domain. Do not blindly swap the plugin to this helper without fixing that behavior.
- Functional updater parameters are already bound as live reads in `setterArgumentExpr()` in `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`.
- `valueExpr()` in that file does not currently lower arithmetic binary expressions such as `s + 10`, so `setterArgumentExpr()` returns `undefined`.
- `transitionsFromInlineHandler()` in `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts` converts an undefined assignment into a `havocSetterTransition(..., "unrepresentable")`.
- The IR already supports numeric operations:
  - `/Users/hari/proj/modality-ts/src/core/ir/types.ts`: `lt`, `lte`, `gt`, `gte`, `add`, `sub`, `mod`;
  - `/Users/hari/proj/modality-ts/src/core/ir/eval.ts`: numeric expression evaluation;
  - `/Users/hari/proj/modality-ts/src/core/ir/validator.ts`: numeric expression/domain validation;
  - `/Users/hari/proj/modality-ts/src/cli/features/export/command.ts`: TLA+ export for numeric arithmetic and overflow policies.
- Zustand already has a useful pattern for lowering numeric updates in `/Users/hari/proj/modality-ts/src/extract/sources/zustand/effects.ts`, especially `lowerExpr()` and tests in `/Users/hari/proj/modality-ts/test/sources/zustand/zustand-source.test.ts`.
- The actual local Coffee DX `LaneTimer` component, currently at `/Users/hari/proj/coffee-dx/apps/web/app/_drip2/components/LaneTimer.tsx`, has unclamped positive updater buttons and reset. There is no explicit upper clamp in that component.

## 4. Exact File Paths and Relevant Symbols

Edit:

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`
  - `setterArgumentExpr`
  - `valueExpr`
  - `booleanExpr`
  - new helpers for numeric binary expressions and `Math.min`/`Math.max` clamps
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - `inferUseStateDomainDetailed`
  - `initialValueForUseState`
- `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`
  - `discoverUseState`
  - plugin-local `inferUseStateDomain`
  - plugin-local `initialValueForUseState`
- `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runExtractionPipeline`
- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - the `bounds` object near the top-level extract command flow
  - `extractProjectSources(...)`
  - calls to `runExtractionPipeline(...)`
- `/Users/hari/proj/modality-ts/src/extract/sources/use-state/types.ts`
  - `UseStateExtractionOptions`
- `/Users/hari/proj/modality-ts/src/extract/sources/use-state/transitions.ts`
  - `extractUseStateSkeleton`

Add if helpful:

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts`
  - helper to infer/widen finite numeric domains from extracted transitions and model bounds

Tests to edit or add:

- `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
- `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
- `/Users/hari/proj/modality-ts/test/sources/use-state/use-state-source.test.ts`
- optionally `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts` if a CLI-level report/model regression is more natural after implementation

## 5. Existing Patterns To Follow

- Use `rtk` for commands, per repository instructions.
- Keep TypeScript ESM imports with explicit `.js` extensions for local modules.
- Follow the existing AST visitor style: small helper functions, no broad framework abstraction.
- Follow the Zustand numeric lowering shape in `src/extract/sources/zustand/effects.ts`, but do not import Zustand internals into React/useState extraction.
- Use existing `ExprIR` numeric nodes instead of inventing new effect kinds.
- Preserve React batching semantics:
  - direct reads in event handlers should remain `readPre`;
  - functional updater parameters should remain live `read`.
- Preserve the existing `havoc` fallback for expressions that remain unsupported.
- Prefer a shared helper for useState numeric domain widening so the CLI pipeline and `extractUseStateSkeleton()` do not diverge again.

## 6. Atomic Implementation Steps

### Step 1: Add failing regression coverage first

Add a pipeline-level test in `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts` that uses `runExtractionPipeline()` with `sourcePlugins: [useStateSource()]` and a minimal `LaneTimer`-like component:

```tsx
import { useState } from "react";

export function LaneTimer() {
  const [draftSec, setDraftSec] = useState(0);
  return (
    <>
      <button onClick={() => setDraftSec((s) => s + 10)}>+10秒</button>
      <button onClick={() => setDraftSec((s) => s + 60)}>+1分</button>
      <button onClick={() => setDraftSec((s) => s + 180)}>+3分</button>
      <button onClick={() => setDraftSec(0)}>リセット</button>
    </>
  );
}
```

Assert:

- `stateVars.find((v) => v.id === "local:LaneTimer.draftSec")` exists.
- Its domain is `boundedInt`, `min` is `0`, and `max` is at least `180`. If the implementation uses configured depth, assert `max === 180 * maxDepth` for the test's explicit `bounds.maxDepth`.
- There are exact `assign` transitions for the increment buttons whose expressions are `add(read local:LaneTimer.draftSec, lit 10|60|180)`.
- The reset transition assigns literal `0`.
- No transition id for `draftSec` contains `.unrepresentable`.

Also add a direct extraction regression in `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts` for `extractUseStateSkeleton()` so the non-pipeline public helper does not regress.

### Step 2: Fix untyped numeric initializer domain classification

In `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`, update `inferUseStateDomainDetailed()` so an untyped numeric literal initializer returns:

```ts
{ kind: "boundedInt", min: Number(initializer.text), max: Number(initializer.text) }
```

not an enum domain.

Keep string literals as enum domains.

Update `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts` or `/Users/hari/proj/modality-ts/test/sources/use-state/use-state-source.test.ts` with a direct assertion for `useState(0)`.

### Step 3: Remove split-brain useState domain inference

In `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`, replace the plugin-local `inferUseStateDomain()` and `initialValueForUseState()` with imports from `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts` or the public SPI barrel if suitable.

When calling `inferUseStateDomainDetailed()`, pass:

- the parsed `ts.SourceFile`;
- the computed `varId`;
- existing `typeAliases`.

Use `.domain` for the `StateVarDecl`.

Do not drop the existing metadata fields:

- `component`
- `stateName`
- `setterName`

Update `/Users/hari/proj/modality-ts/test/sources/use-state/use-state-source.test.ts` if snapshot expectations change.

### Step 4: Lower simple numeric updater expressions to existing numeric IR

In `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`, extend expression lowering:

- In `valueExpr()`, support binary:
  - `+` as `{ kind: "add" }` only when at least one lowered operand is a numeric literal, to avoid mis-lowering string concatenation.
  - `-` as `{ kind: "sub" }`.
  - `%` as `{ kind: "mod" }`.
- In `booleanExpr()`, support:
  - `<` as `lt`;
  - `<=` as `lte`;
  - `>` as `gt`;
  - `>=` as `gte`.
- Support `Math.min(expr, numericLiteral)` as a `cond` clamp:
  - `expr <= cap ? expr : cap`
- Support `Math.max(numericLiteral, expr)` as a `cond` clamp:
  - `expr >= floor ? expr : floor`
- Accept reversed `Math.min(numericLiteral, expr)` and `Math.max(expr, numericLiteral)` forms too.

Keep unsupported multiplication, division, dynamic call arguments, and ambiguous string concatenation unsupported so existing havoc behavior remains available.

Add focused tests in `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts` for:

- `setCount((s) => s + 1)`;
- `setCount((s) => s - 1)`;
- `setCount((s) => Math.min(s + 10, 300))`;
- `setCount((s) => label + "x")` remains unrepresentable or otherwise does not lower to numeric `add`.

### Step 5: Widen numeric domains from extracted updater transitions and bounds

Add a helper, preferably in `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts`, to widen singleton numeric domains based on extracted transitions and configured model bounds.

Suggested signature:

```ts
export function widenNumericDomainsFromTransitions(args: {
  vars: readonly StateVarDecl[];
  transitions: readonly Transition[];
  maxDepth: number;
}): StateVarDecl[];
```

Rules:

- Only consider vars whose current domain is numeric and finite.
- Only auto-widen singleton domains inferred from numeric initializers. If the var already has a wider explicit type/schema domain, preserve it.
- Inspect transition effects recursively through `seq` and `if`.
- For direct numeric literal assignments to the var, include those literals.
- For assignments of the form:
  - `read(var) + numericLiteral`
  - `numericLiteral + read(var)`
  - `read(var) - numericLiteral`
  - clamp condition forms emitted by Step 4
  collect positive deltas, negative deltas, and clamp literals.
- If an upper clamp is present, use that upper bound.
- If no upper clamp is present, use the configured bounded search depth:
  - `max = max(initial/literal values) + maxPositiveDelta * maxDepth`
- If a lower clamp is present, use it.
- If no lower clamp is present, use:
  - `min = min(initial/literal values) + minNegativeDelta * maxDepth`
- For the Coffee shape with `maxDepth: 12`, derive `0..2160`.
- Preserve `overflow: "forbid"` when the widened domain covers all values reachable within `maxDepth`.
- Do not widen for unsupported arithmetic such as multiplication/division; keep existing fallback behavior.

If there is no reliable way to tell whether a singleton numeric domain came from an untyped initializer versus an explicit `0` literal type, stop and report. Do not silently widen explicit singleton types. A small provenance marker may be needed in `SourceDecl.metadata` or an internal side map, but avoid changing public `StateVarDecl` unless necessary.

### Step 6: Thread bounds into extraction where needed

`runExtractionPipeline()` currently does not accept bounds, while `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts` computes:

```ts
const bounds = {
  maxDepth: 12,
  maxPending: 1,
  maxInternalSteps: 4,
  ...
};
```

Add optional `bounds?: Bounds` or `bounds?: Pick<Bounds, "maxDepth">` to `ExtractionPipelineOptions`.

In `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`, pass the computed bounds through `extractProjectSources(...)` into every `runExtractionPipeline(...)` call.

In `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`, after transitions are assembled and before returning `stateVars`, call `widenNumericDomainsFromTransitions()` using `options.bounds?.maxDepth ?? 12`.

Use the widened vars in the returned `stateVars`. Keep `routeVars`, `templateFragments`, and plugin provenance unchanged.

For `extractUseStateSkeleton()` in `/Users/hari/proj/modality-ts/src/extract/sources/use-state/transitions.ts`, either:

- add optional `bounds` to `UseStateExtractionOptions` and apply the same helper before returning, or
- clearly keep the widening only in the pipeline and adjust tests accordingly.

Prefer applying the helper there too, to keep the public helper behavior aligned with CLI extraction.

### Step 7: Preserve reports and caveats

If the widened domain is exact within the configured model depth, no new caveat is required.

If implementation falls back to a hard-coded cap instead of using `bounds.maxDepth`, add a visible warning and stop before merging unless the user explicitly accepts the heuristic. The better implementation is bounds-derived, not hard-coded.

Do not depend on source plugin `safetyWarnings()` for rich caveats unless the SPI is intentionally extended; that path currently does not carry `ExtractionCaveat` objects through to model metadata except for special pipeline conversions.

### Step 8: Verify the Coffee DX reproduction shape indirectly

Do not require the Coffee DX repo for normal tests.

After tests pass, optionally run the original reproduction manually if `/Users/hari/proj/coffee-dx` is available:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality extract app/_drip2/home.tsx --out .modality/probe-drip2.model.json --report .modality/probe-drip2.extraction-report.json
```

Expected manual check:

- `local:LaneTimer.draftSec` is not `min: 0, max: 0`.
- The `+10秒`, `+1分`, and `+3分` handlers are exact arithmetic assignments.
- No `LaneTimer.onClick.draftSec.unrepresentable.*` transition is emitted for those increment buttons.

## 7. Per-step Files To Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/test/extraction/architecture.test.ts`
  - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
- Step 2:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts`
- Step 3:
  - `/Users/hari/proj/modality-ts/src/extract/sources/use-state/index.ts`
  - `/Users/hari/proj/modality-ts/test/sources/use-state/use-state-source.test.ts`
- Step 4:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/expressions.ts`
  - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/use-state-updaters.ts`
  - possibly `/Users/hari/proj/modality-ts/src/extract/engine/numeric.ts` if exporting the helper is useful
- Step 6:
  - `/Users/hari/proj/modality-ts/src/extract/engine/pipeline/index.ts`
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/use-state/types.ts`
  - `/Users/hari/proj/modality-ts/src/extract/sources/use-state/transitions.ts`
- Step 7:
  - no file unless a warning/caveat path is needed
- Step 8:
  - no repository file; optional manual verification only

## 8. Acceptance Criteria

- A minimal `LaneTimer` fixture extracted through `runExtractionPipeline(..., sourcePlugins: [useStateSource()])` produces a widened numeric domain for `local:LaneTimer.draftSec`.
- The widened domain covers repeated `+180` clicks for the configured `bounds.maxDepth`.
- Increment handlers lower to exact `assign` effects with `add` expressions.
- Reset lowers to exact literal assignment `0`.
- No increment transition id contains `.unrepresentable`.
- Existing boolean, enum, record, tagged, and length-category `useState` extraction behavior remains unchanged.
- Explicit finite numeric domains such as `useState<0 | 1>(0)` are not widened beyond their explicit type.
- Unsupported numeric expressions still fall back to the existing over-approx/havoc path.
- `pnpm typecheck`, relevant Vitest tests, and `pnpm architecture` pass.

## 9. Tests To Add Or Update

Add:

- `test/extraction/architecture.test.ts`
  - pipeline regression with `useStateSource()` and LaneTimer-like updater buttons.
- `test/extraction/extraction.test.ts`
  - direct extraction lowers functional updater arithmetic to `add`/`sub`;
  - direct extraction lowers simple `Math.min`/`Math.max` clamps;
  - unsupported string concatenation does not become numeric `add`.
- `test/sources/use-state/use-state-source.test.ts`
  - plugin discovery for `useState(0)` yields numeric `boundedInt 0..0` as the seed domain before widening.
- `test/extract/numeric-domain-resolver.test.ts`
  - `inferUseStateDomainDetailed()` returns numeric `boundedInt` for untyped numeric literal initializers.

Update existing expectations only where they currently encode the wrong numeric-literal enum behavior or the `0..0` final pipeline behavior.

## 10. Verification Commands

Run focused checks first:

```bash
rtk pnpm vitest run test/extraction/architecture.test.ts test/extraction/extraction.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts
```

Then run the normal repository checks:

```bash
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm test
```

Run formatting/linting before final handoff:

```bash
rtk pnpm fix
```

If the implementation touches checker/native behavior unexpectedly, also run:

```bash
rtk pnpm phase7
```

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if widening cannot distinguish explicit singleton numeric types from untyped numeric initializer seeds. Do not widen `useState<0>(0)` or `useState<0 | 1>(0)` beyond the declared type.
- Stop and report if `bounds.maxDepth` cannot be threaded into extraction without changing public API surfaces more broadly than described above.
- Stop and report if the arithmetic lowering causes string concatenation regressions. `+` should be conservative.
- Stop and report if widened domains cause TLA export to enumerate huge ranges unexpectedly. The intended Coffee-style domain with default depth is modest (`0..2160`).
- Stop and report if source plugin discovery and generic React extraction still disagree after replacing the plugin-local inference. The final architecture should have one shared source of truth for untyped numeric initializer handling.
- Do not change checker overflow handling to make this work. The fix belongs in extraction and domain inference.
- Do not remove the existing `unrepresentable` fallback; it is still correct for unsupported expressions.
