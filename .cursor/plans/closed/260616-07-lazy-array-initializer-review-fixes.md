# Fix lazy array initializer review findings

## 1. Goal

Fix the two review findings from the lazy array initializer implementation:

1. Recognized array constructors with dynamic, statically unprovable lengths must emit a structured `model-slack` caveat instead of silently falling back to the first `lengthCat` value.
2. Custom-hook state inlining must use the same detailed initializer inference context as direct component `useState` extraction, so static const lengths such as `LANE_COUNT = 3` initialize to `"many"` when the hook is inlined.

The intended behavior is:

```ts
useState<Item[]>(() => Array.from({ length: props.count }, makeItem));
```

keeps `initial: "0"` because the length is not statically known, but reports a `model-slack` caveat.

```ts
const LANE_COUNT = 3;
function useItems() {
  const [items, setItems] = useState<Item[]>(() =>
    Array.from({ length: LANE_COUNT }, makeItem),
  );
  return [items, setItems] as const;
}
export function App() {
  const [items, setItems] = useItems();
  return null;
}
```

extracts `local:App.items` with `domain: { kind: "lengthCat" }` and `initial: "many"`.

## 2. Non-goals

- Do not add element-sensitive list modeling.
- Do not change `lengthCat` semantics or checker behavior.
- Do not execute lazy initializer callbacks, `Array.from` mapper callbacks, or user factories.
- Do not implement broad JavaScript constant folding.
- Do not change generated model format or public IR types.
- Do not refactor unrelated transition extraction, router extraction, async extraction, or numeric domain inference.
- Do not preserve backward compatibility for the silent fallback behavior; this is an experimental tool and the caveat is required.

## 3. Current-state findings

- `src/extract/engine/ts/domains.ts` already recognizes `Array.from({ length: N }, ...)` and `new Array(N)` in `resolveArrayConstructorLength`.
- `src/extract/engine/ts/domains.ts:474` has `resolveStaticNumeric`, which returns:
  - finite results for numeric literals;
  - finite or unprovable results for identifiers when `context.sourceFile` is available;
  - `undefined` for other expressions, including common dynamic expressions such as `props.count`, `count + 1`, and `getCount()`.
- `src/extract/engine/ts/domains.ts:410` treats `undefined` from `resolveArrayConstructorLength` as "not recognized", so dynamic `Array.from({ length: props.count })` silently falls through to `firstValue(domain)` with no caveat.
- Verified source-level repro:
  ```ts
  useState<Item[]>(() => Array.from({ length: props.count }, makeItem))
  ```
  currently extracts `initial: "0"` and `warnings: []`.
- `src/extract/engine/ts/components.ts:320` still calls `inferUseStateDomain(stateCall)` and `initialValueForUseState(stateCall, domain)` in `hookStateReturn`.
- Because `hookStateReturn` does not pass `sourceFile` or `varId`, identifier-based length resolution cannot see top-level or in-scope const numeric bindings.
- Verified source-level repro: a custom hook with `const LANE_COUNT = 3` and lazy `Array.from({ length: LANE_COUNT }, ...)` is inlined into `local:App.items` with `initial: "0"` and no warning.
- The direct component path in `src/extract/engine/ts/react-source-transitions.ts` already calls `inferUseStateDomainDetailed` and `initialValueForUseStateDetailed`, pushes `domainInferenceWarnings(initialResult, anchor)`, and should be used as the pattern for custom-hook inlining.

## 4. Exact file paths and relevant symbols

- `src/extract/engine/ts/domains.ts`
  - `initialValueForUseStateDetailed`
  - `evaluateInitialExpression`
  - `staticArrayLength`
  - `resolveArrayConstructorLength`
  - `resolveStaticNumeric`
  - `ArrayLengthResolution`
  - `modelSlackCaveat`
  - `sourceAnchorFromExpression`
- `src/extract/engine/ts/components.ts`
  - `inlineCustomHookState`
  - `hookStateReturn`
  - `HookStateReturn`
  - imports from `./domains.js`
- `src/extract/engine/ts/react-source-transitions.ts`
  - call to `inlineCustomHookState`
  - direct component `useState` extraction block
  - `warnings`
  - `domainInferenceWarnings`
- `src/extract/engine/ts/types.ts`
  - `HookStateReturn`
  - `ExtractionWarning`
- `test/extraction/extraction.test.ts`
  - `describe("useState inventory", ...)`
  - custom hook coverage around `inlines simple custom hooks at the component call site`
- `test/extract/numeric-domain-resolver.test.ts`
  - focused helper-level tests for `initialValueForUseStateDetailed`
- `test/sources/use-state/use-state-source.test.ts`
  - standalone plugin coverage, if shared helper behavior needs an additional source-plugin assertion

## 5. Existing patterns to follow

- Keep initializer evaluation centralized in `src/extract/engine/ts/domains.ts`.
- Continue using structured caveats through `InitialValueResult.caveats`, then convert them to extraction warnings via `domainInferenceWarnings`.
- Follow the direct component `useState` path in `react-source-transitions.ts`: compute `anchor`, infer domain with source and `varId`, compute initial value with source and `varId`, then push warnings.
- Keep AST handling narrow and syntactic. Use TypeScript AST predicates, not string matching over source text.
- Treat recognized array constructors differently from unrecognized expressions:
  - Unrecognized expression: no new caveat, existing fallback behavior.
  - Recognized array constructor with unprovable length: `model-slack` caveat.
- Do not make `resolveStaticNumeric` responsible for deciding whether the enclosing array constructor was recognized. That distinction belongs in `resolveArrayConstructorLength` or a small helper around it.
- Avoid hidden global warning state. Pass warnings explicitly through return values or function parameters.

## 6. Atomic implementation steps

1. Make recognized dynamic length expressions return `unprovable`.
   - In `src/extract/engine/ts/domains.ts`, adjust `resolveArrayConstructorLength` so that once an array constructor is recognized and a `length` expression is present, unsupported or dynamic length syntax produces `{ kind: "unprovable" }`.
   - For `Array.from`, this applies when:
     - the call is `Array.from`;
     - first argument is an object literal;
     - the object literal has a `length` property assignment;
     - `resolveStaticNumeric(lengthProperty.initializer, context)` cannot produce a finite value.
   - For `new Array(N)`, this applies when:
     - the expression is `new Array(...)`;
     - exactly one length argument is present;
     - that argument cannot be statically resolved.
   - Keep returning `undefined` for expressions that are not recognized array constructors, malformed `Array.from` calls, missing `length`, or `new Array()` with no length argument.

2. Preserve finite static behavior.
   - Ensure numeric literals still map as:
     - `0` -> `"0"`
     - `1` -> `"1"`
     - `>= 2` -> `"many"`
   - Ensure const numeric identifiers still resolve through `resolveConstNumericIdentifier`.
   - Ensure unsafe numeric values, negative values, non-integers, and invalid identifiers still produce `unprovable` when they appear inside a recognized array length.

3. Thread detailed initializer context through custom-hook inlining.
   - Change `hookStateReturn` in `src/extract/engine/ts/components.ts` to accept context needed for detailed inference:
     - `source: ts.SourceFile`
     - `fileName: string`
     - destination `varId` or enough state to compute it
     - `typeAliases`
     - optional warning sink or return-field for warnings
   - Prefer returning a richer summary from `hookStateReturn`, for example:
     ```ts
     interface HookStateReturn {
       domain: AbstractDomain;
       initial: Value;
       warnings?: ExtractionWarning[];
     }
     ```
     if that type already exists in `types.ts`, update it there.
   - Use `inferUseStateDomainDetailed(stateCall, typeAliases, source, varId)` and `initialValueForUseStateDetailed(stateCall, domain, source, varId)`.
   - Convert both result caveat lists with `domainInferenceWarnings(..., anchor)`.
   - Do not introduce global warning state.

4. Push custom-hook warnings to the main warning list.
   - Update `inlineCustomHookState` to surface any warnings returned by `hookStateReturn`.
   - The warnings should be pushed into the `warnings` array owned by `extractReactSourceTransitions`.
   - If changing the function signature is the smallest clean path, add a `warnings: ExtractionWarning[]` parameter to `inlineCustomHookState` and update the single call site in `react-source-transitions.ts`.
   - Use the component call-site variable declaration anchor for warning line/column when converting caveats, unless a more precise hook-local anchor is already readily available.

5. Update tests for dynamic length caveats.
   - Add a test where the length is a property access:
     ```ts
     export function App(props: { count: number }) {
       const [items] = useState<Item[]>(() =>
         Array.from({ length: props.count }, makeItem),
       );
       return null;
     }
     ```
   - Assert:
     - `initial` is `"0"`;
     - warnings include a caveat with `kind: "model-slack"`;
     - the reason contains `array initializer length`.
   - Keep the existing identifier dynamic test if present, because `count` and `props.count` exercise different AST branches.

6. Update tests for custom-hook static const length.
   - Add an extraction test where a custom hook wraps the `useState<Item[]>(() => Array.from({ length: LANE_COUNT }, makeItem))` call and a component inlines it.
   - Assert the inlined component state var has:
     - id `local:App.items`;
     - domain `{ kind: "lengthCat" }`;
     - initial `"many"`;
     - no warnings for the finite static case.

7. Update tests for custom-hook dynamic length caveat.
   - Add a custom-hook test with an unprovable length such as a hook parameter:
     ```ts
     function useItems(count: number) {
       const [items, setItems] = useState<Item[]>(() =>
         Array.from({ length: count }, makeItem),
       );
       return [items, setItems] as const;
     }
     export function App({ count }: { count: number }) {
       const [items, setItems] = useItems(count);
       return null;
     }
     ```
   - Assert `local:App.items.initial` remains `"0"` and warnings include a `model-slack` caveat.
   - If the current custom-hook inliner does not model hook arguments, do not broaden it. The initializer length can still be recognized as unprovable.

8. Consider helper-level tests only if they clarify the regression.
   - In `test/extract/numeric-domain-resolver.test.ts`, add a focused `initialValueForUseStateDetailed` case for `props.count` or `getCount()` only if extraction-level coverage is not precise enough.
   - Avoid overloading numeric-domain tests with component/custom-hook behavior.

9. Run formatting after implementation.
   - Use `rtk pnpm fix`.
   - Do not manually reformat unrelated files.

## 7. Per-step files to edit

- Step 1:
  - `src/extract/engine/ts/domains.ts`
- Step 2:
  - `src/extract/engine/ts/domains.ts`
  - existing tests in `test/extraction/extraction.test.ts`
  - existing tests in `test/extract/numeric-domain-resolver.test.ts`
- Step 3:
  - `src/extract/engine/ts/components.ts`
  - `src/extract/engine/ts/types.ts` if `HookStateReturn` needs a warnings field
- Step 4:
  - `src/extract/engine/ts/components.ts`
  - `src/extract/engine/ts/react-source-transitions.ts`
- Step 5:
  - `test/extraction/extraction.test.ts`
- Step 6:
  - `test/extraction/extraction.test.ts`
- Step 7:
  - `test/extraction/extraction.test.ts`
- Step 8:
  - `test/extract/numeric-domain-resolver.test.ts` only if useful
- Step 9:
  - formatting may touch files edited above only

## 8. Acceptance criteria

- `useState<Item[]>(() => Array.from({ length: props.count }, makeItem))` extracts with:
  - domain `{ kind: "lengthCat" }`;
  - initial `"0"`;
  - a `model-slack` caveat warning whose reason mentions `array initializer length`.
- `useState<Item[]>(() => Array.from({ length: count + 1 }, makeItem))` and `useState<Item[]>(() => Array.from({ length: getCount() }, makeItem))` are treated as recognized but unprovable if covered by tests or helper behavior.
- Malformed or unrelated initializers remain unchanged and do not gain noisy caveats.
- Direct static cases still pass:
  - `{ length: 0 }` -> `"0"`
  - `{ length: 1 }` -> `"1"`
  - `{ length: 3 }` -> `"many"`
  - `{ length: LANE_COUNT }` with `const LANE_COUNT = 3` -> `"many"`
- Custom-hook inlining with `const LANE_COUNT = 3` extracts the component-local inlined var with initial `"many"`.
- Custom-hook inlining with an unprovable recognized length emits a `model-slack` warning.
- Existing direct array literal behavior remains unchanged.
- Existing bool, enum, number, option, record, numeric schema inference, source plugin discovery, checker, replay, router, and async transition behavior remains unchanged.

## 9. Tests to add or update

- In `test/extraction/extraction.test.ts` under `describe("useState inventory", ...)`:
  - Add or extend the dynamic lazy array initializer test to cover `props.count`, not only a bare identifier.
  - Add custom-hook finite const coverage:
    ```ts
    const LANE_COUNT = 3;
    function useItems() {
      const [items, setItems] = useState<Item[]>(() =>
        Array.from({ length: LANE_COUNT }, makeItem),
      );
      return [items, setItems] as const;
    }
    export function App() {
      const [items, setItems] = useItems();
      return null;
    }
    ```
  - Add custom-hook unprovable length coverage and assert `model-slack`.
- In `test/extract/numeric-domain-resolver.test.ts`:
  - Optional focused helper test for `initialValueForUseStateDetailed` with property-access length, asserting `result.caveats[0]?.kind === "model-slack"`.
- In `test/sources/use-state/use-state-source.test.ts`:
  - No required change unless the source plugin has a separate regression from the shared helper behavior. If adding coverage, keep it to a simple finite static or dynamic caveat case that the plugin API can actually expose.

## 10. Verification commands

Run from `/Users/hari/proj/modality-ts-worktrees/lazy-array-initializer` and prefix commands with `rtk`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

After `rtk pnpm fix`, re-run:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts test/sources/use-state/use-state-source.test.ts test/extract/numeric-domain-resolver.test.ts
rtk pnpm typecheck
rtk pnpm architecture
```

If CLI metadata emission is touched, also run:

```bash
rtk pnpm test -- src/cli/features/extract/command.test.ts
```

## 11. Risks, ambiguities, and stop conditions

- Stop and report if `inlineCustomHookState` cannot receive or return warnings without broad changes to the extraction traversal.
- Stop and report if passing `typeAliases` or `sourceFile` into custom-hook summarization creates dependency cycles or architecture violations.
- Stop and report if custom hooks from `additionalComponentSources` require a different source file than the main extraction source for correct line/column anchors. Do not invent misleading source anchors.
- Be careful not to emit caveats for every unknown `useState` initializer. Only recognized array constructors with a present but unprovable length should produce the new `model-slack` caveat.
- Be careful with `Array.from(someIterable)` and `Array.from({})`; these are not the specific finite-length constructor shape and should not gain the same caveat unless a length property is present.
- Be careful with `new Array(a, b)`: that creates an array with elements, not a length. Do not treat it as a length constructor. Either leave it unrecognized or handle only the one-argument form.
- Do not change checker semantics or widen `lengthCat`.
- Do not add general constant folding for expressions like `LANE_COUNT + 1`; if desired, report it as a follow-up.
