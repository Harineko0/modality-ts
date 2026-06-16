# Fix lazy array initializer length categories

## 1. Goal

Fix `docs/_issues/coffee-dx-lazy-array-initializer-collapses-to-empty.md` by teaching extraction to derive the initial `lengthCat` value for common finite lazy array initializers, especially:

```ts
const [laneSlots, setLaneSlots] = useState<LaneSlot[]>(() =>
  Array.from({ length: LANE_COUNT }, buildIdleSlot),
);
```

The generated model should keep the `lengthCat` domain for `LaneSlot[]`, but initialize the state to:

- `"0"` for statically finite length `0`
- `"1"` for statically finite length `1`
- `"many"` for statically finite length `>= 2`

When a lazy array initializer is recognized as array-like but its length is not statically finite, extraction should emit a structured `model-slack` caveat instead of silently falling back to the first `lengthCat` value (`"0"`).

## 2. Non-goals

- Do not introduce element-sensitive list modeling or convert these states to `boundedList`.
- Do not execute user initializer functions or factories.
- Do not attempt full JavaScript constant folding.
- Do not change checker semantics for `lengthCat`.
- Do not change generated model format or public IR types.
- Do not make backwards-compatibility accommodations; this is an experimental tool.
- Do not refactor unrelated transition extraction, router extraction, or numeric domain inference.

## 3. Current-state findings

- The issue reproduces in `docs/_issues/coffee-dx-lazy-array-initializer-collapses-to-empty.md`: `useState<LaneSlot[]>(() => Array.from({ length: LANE_COUNT }, buildIdleSlot))` produces domain `"0" | "1" | "many"` but initial state `"0"`, even though `LANE_COUNT` is statically `3`.
- `src/extract/engine/ts/domains.ts:95` exports `inferUseStateDomainDetailed`. With a type argument like `LaneSlot[]`, the domain is inferred from the type and becomes `{ kind: "lengthCat" }`.
- `src/extract/engine/ts/domains.ts:163` exports `initialValueForUseState`. It handles direct literals and direct array literals, then returns `firstValue(domain)` for everything else.
- `src/extract/engine/ts/domains.ts:193` returns `"0"` as `firstValue({ kind: "lengthCat" })`, which is the observed collapse.
- `src/extract/engine/ts/domains.ts:342` has `initialValueFromExpression`, but it only handles literals, options, and records. It does not unwrap lazy initializer callbacks and does not inspect `Array.from`.
- `src/extract/engine/ts/react-source-transitions.ts:365` calls `inferUseStateDomainDetailed`, then `src/extract/engine/ts/react-source-transitions.ts:385` calls `initialValueForUseState`. This is the CLI-facing path used by `modality extract`.
- `src/extract/engine/ts/components.ts:321` also calls `initialValueForUseState` for custom hook state returns, so the fix should work for custom hooks too.
- `src/extract/sources/use-state/index.ts:119` and `src/extract/sources/use-state/index.ts:146` contain a smaller duplicate useState inference implementation. It currently has the same fallback behavior for non-array-literal initializers.
- `src/extract/engine/ts/caveats.ts:88` exposes `modelSlackCaveat`, which matches the issue's requirement to report cases that cannot be represented exactly or statically.
- `docs/_specs/02-extraction.md:73` says `Array<T>` and `ReadonlyArray<T>` map to `lengthCat` by default. The fix should update this spec to explicitly cover finite lazy array initializer initial values and caveats for unprovable lengths.

## 4. Exact file paths and relevant symbols

- `src/extract/engine/ts/domains.ts`
  - `DomainInferenceResult`
  - `DomainInferenceContext`
  - `inferUseStateDomainDetailed`
  - `domainInferenceWarnings`
  - `initialValueForUseState`
  - `firstValue`
  - `initialValueFromExpression`
  - `literalValue`
  - `propertyName`
- `src/extract/engine/ts/caveats.ts`
  - `modelSlackCaveat`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - current useState var discovery block around the `inferUseStateDomainDetailed` and `initialValueForUseState` calls
- `src/extract/engine/ts/components.ts`
  - `hookStateReturn`
- `src/extract/sources/use-state/index.ts`
  - `discoverUseState`
  - local `inferUseStateDomain`
  - local `initialValueForUseState`
- `test/extract/numeric-domain-resolver.test.ts`
  - existing focused tests for exported domain inference helpers
- `test/extraction/extraction.test.ts`
  - `describe("useState inventory", ...)`
  - `extractUseStateVars`
- `test/sources/use-state/use-state-source.test.ts`
  - standalone `useStateSource()` plugin tests
- `src/cli/features/extract/command.test.ts`
  - CLI extraction tests for emitted app model behavior, if a CLI-level regression is warranted
- `docs/_specs/02-extraction.md`
  - `P2 — Domain inference`
- `docs/_issues/coffee-dx-lazy-array-initializer-collapses-to-empty.md`
  - close/update after implementation if this repo tracks issue status in-place

## 5. Existing patterns to follow

- Keep domain inference centralized in `src/extract/engine/ts/domains.ts` where possible. The CLI-facing path already uses this module.
- Return structured caveats through `DomainInferenceResult.caveats`, then surface them through `domainInferenceWarnings`, matching numeric inference.
- Use `modelSlackCaveat` for finite-abstraction imprecision or static-analysis limits that are not unextractable handlers.
- Prefer small AST helpers over ad hoc string matching. Use TypeScript AST predicates such as `ts.isArrowFunction`, `ts.isCallExpression`, `ts.isPropertyAccessExpression`, `ts.isObjectLiteralExpression`, `ts.isIdentifier`, and `ts.isNumericLiteral`.
- Follow the current `lengthCat` abstraction convention: only the abstract initial value changes, not the domain.
- Follow existing test style in `test/extraction/extraction.test.ts`: create small inline TSX fixtures and assert `result.vars`.

## 6. Atomic implementation steps

1. Add a small static initializer evaluator in `src/extract/engine/ts/domains.ts`.
   - Create an internal result type such as:
     ```ts
     type StaticInitialResult =
       | { value: Value; caveats: ExtractionCaveat[] }
       | { value: undefined; caveats: ExtractionCaveat[] };
     ```
   - It should be deliberately narrow and side-effect-free.
   - It should accept at least `(expression, domain, context)` or equivalent so it can include `varId` and source anchors in caveats.

2. Teach `initialValueForUseState` to unwrap lazy initializer callbacks.
   - Recognize `useState(() => expr)`.
   - Recognize `useState(function () { return expr; })`.
   - For block-bodied callbacks, only handle a single direct `return expr`; otherwise do not guess.
   - Do not execute or inspect the factory callback passed to `Array.from`; only inspect the declared/static length.

3. Support direct and lazy `Array.from({ length: N }, factory?)`.
   - Recognize a call expression whose callee is `Array.from`.
   - Recognize first argument object literals with a `length` property.
   - Resolve `length` when it is:
     - numeric literal, e.g. `{ length: 3 }`
     - identifier bound to a top-level or in-scope `const` numeric literal, e.g. `const LANE_COUNT = 3`
     - identifier bound to a numeric-literal enum-like value only if already trivial via current AST scope; do not add type-checker dependency
   - Map `0` to `"0"`, `1` to `"1"`, and `>= 2` to `"many"` when the target domain is `lengthCat`.

4. Support direct and lazy `new Array(N)` only if it falls out naturally from the same helper.
   - This is optional but cheap if the evaluator already has a `staticArrayLength` helper.
   - Keep it narrow: only one numeric length argument or const numeric identifier.
   - If it increases complexity, skip it and leave it out of tests.

5. Emit a caveat for recognized array constructors with non-static length.
   - Example: `useState<Item[]>(() => Array.from({ length: props.count }, makeItem))`.
   - Keep the domain as `{ kind: "lengthCat" }`.
   - Keep the initial value as `firstValue(domain)` because the length is unknown.
   - Add a `modelSlackCaveat` with a clear reason such as `Unprovable array initializer length for local:DripHome.laneSlots`.
   - This likely requires changing `initialValueForUseState` to return both value and caveats, or adding a parallel detailed API.

6. Preserve the existing public API while adding a detailed API.
   - Add `initialValueForUseStateDetailed(call, domain, sourceFile?, varId?)`.
   - Have existing `initialValueForUseState(call, domain)` delegate to the detailed function and return only `.value`.
   - In `extractReactSourceTransitions`, use the detailed function so caveats can be pushed into `warnings` alongside domain inference warnings.
   - In `components.ts`, either keep the simple API or use the detailed API only if there is an available warning sink. Do not introduce hidden global warning state.

7. Share or re-route the standalone `useStateSource` plugin path.
   - Best option: replace the duplicate local inference helpers in `src/extract/sources/use-state/index.ts` with imports from `modality-ts/extract/engine/spi` or `modality-ts/extract/engine` if architecture rules allow.
   - If architecture rules reject that import, duplicate only the thin call to a newly exported SPI-safe helper, not the full evaluator.
   - Stop and report if dependency-cruiser rejects the import direction; do not work around it with deep relative imports across package boundaries.

8. Update documentation.
   - In `docs/_specs/02-extraction.md`, add a sentence to the `Array<T>` / `ReadonlyArray<T>` row or nearby prose:
     - arrays remain `lengthCat` by default;
     - direct array literals and recognized finite lazy array constructors initialize to the matching length category;
     - recognized but unprovable array lengths emit a model-slack caveat.

9. Optionally update the issue doc.
   - If issue docs are treated as status artifacts in this repo, add a short `Resolution plan` or `Fixed by` note after code lands.
   - If issue docs are intended to remain immutable bug reports, leave it unchanged.

## 7. Per-step files to edit

- Step 1: `src/extract/engine/ts/domains.ts`
- Step 2: `src/extract/engine/ts/domains.ts`
- Step 3: `src/extract/engine/ts/domains.ts`
- Step 4: `src/extract/engine/ts/domains.ts`
- Step 5:
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
- Step 6:
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/index.ts` if the new detailed API should be exported for tests or plugins
  - `src/extract/engine/ts/react-source-transitions.ts`
  - `src/extract/engine/ts/components.ts` only if needed
- Step 7:
  - `src/extract/sources/use-state/index.ts`
  - possibly `src/extract/engine/spi/index.ts` if that is the intended stable import surface
- Step 8:
  - `docs/_specs/02-extraction.md`
- Step 9:
  - `docs/_issues/coffee-dx-lazy-array-initializer-collapses-to-empty.md` only if issue status updates are customary

## 8. Acceptance criteria

- `useState<Item[]>(() => Array.from({ length: 0 }, makeItem))` initializes to `"0"`.
- `useState<Item[]>(() => Array.from({ length: 1 }, makeItem))` initializes to `"1"`.
- `useState<Item[]>(() => Array.from({ length: 3 }, makeItem))` initializes to `"many"`.
- `const LANE_COUNT = 3; useState<Item[]>(() => Array.from({ length: LANE_COUNT }, makeItem))` initializes to `"many"`.
- The Coffee DX repro's `local:DripHome.laneSlots` initial state becomes `"many"` while its domain remains `{ kind: "lengthCat" }`.
- A recognized `Array.from({ length: dynamicValue }, makeItem)` initializer does not silently claim `"0"` as exact; it surfaces a `model-slack` caveat in extraction warnings/metadata.
- Existing direct array literal behavior remains unchanged.
- Existing bool, enum, number, option, record, and numeric schema inference tests remain unchanged.
- No checker, replay, router, or async transition semantics change.

## 9. Tests to add or update

- Add focused extraction tests in `test/extraction/extraction.test.ts` under `describe("useState inventory", ...)`:
  - lazy `Array.from({ length: 3 }, ...)` with inline numeric length produces initial `"many"`;
  - lazy `Array.from({ length: LANE_COUNT }, ...)` with `const LANE_COUNT = 3` produces initial `"many"`;
  - lazy `Array.from({ length: 1 }, ...)` produces initial `"1"`;
  - direct `Array.from({ length: 0 }, ...)` or lazy equivalent produces initial `"0"`;
  - dynamic length produces initial `"0"` plus a warning whose caveat kind is `"model-slack"` and whose reason mentions array initializer length.
- Add standalone plugin coverage in `test/sources/use-state/use-state-source.test.ts`:
  - `useStateSource().discover(...)` reports a `lengthCat` state var initialized to `"many"` for a lazy finite `Array.from`.
  - If the plugin API cannot surface warnings, only assert the finite static case there; keep dynamic caveat assertion in `test/extraction/extraction.test.ts`.
- Add helper-level tests in `test/extract/numeric-domain-resolver.test.ts` only if the new detailed initial-value API is exported from `modality-ts/extract/engine`.
- Consider a CLI-level regression in `src/cli/features/extract/command.test.ts` only if there is already a compact fixture pattern for asserting `app.model.ts` initial state. Prefer lower-level extraction tests unless CLI serialization is implicated.

## 10. Verification commands

Run commands from `/Users/hari/proj/modality-ts` and prefix with `rtk`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If the change touches CLI app-model emission, also run:

```bash
rtk pnpm test -- src/cli/features/extract/command.test.ts test/modality/codegen-model.test.ts
```

If Coffee DX is available at `/Users/hari/proj/coffee-dx/apps/web`, verify the original repro after building or linking the local package as appropriate:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality extract app/_drip2/home.tsx --out .modality/probe-drip2.model.json --app-model .modality/probe-drip2.app.model.ts
```

Then inspect `.modality/probe-drip2.app.model.ts` and confirm:

```ts
"local:DripHome.laneSlots": "many"
```

## 11. Risks, ambiguities, and stop conditions

- Stop and report if `src/extract/sources/use-state/index.ts` cannot import the shared helper without violating `rtk pnpm architecture`; do not introduce a hidden dependency-cycle workaround.
- Stop and report if `LANE_COUNT` in Coffee DX is not a local `const` numeric literal or otherwise cannot be resolved without a type checker/project graph. In that case, implement the caveat path and propose a follow-up for project-wide constant resolution.
- Stop and report if the extraction warning/caveat pipeline cannot attach initial-value caveats to model metadata without broader CLI changes. Do not silently drop the caveat requirement.
- Be careful not to treat arbitrary lazy initializer callbacks as pure. Only inspect syntactic return expressions; never evaluate factories or call initializers.
- Be careful with non-integer, negative, `NaN`, or huge lengths. Only accept safe finite non-negative integers. Emit a caveat for anything else.
- Do not widen `lengthCat` semantics. The abstraction has only `"0"`, `"1"`, and `"many"`; preserving that small domain is the point of the fix.
- Do not add a general constant evaluator that starts folding arbitrary expressions. If support for `LANE_COUNT + 1` is desired, make it a separate, reviewed change.
