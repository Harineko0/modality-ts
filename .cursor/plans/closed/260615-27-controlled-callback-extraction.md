# Goal

Teach the TS/React extractor to model controlled component callback props exactly enough for common boolean open/checked callbacks. This fixes tinyurl false positives and vacuity around patterns such as:

```tsx
<Popover open={open} onOpenChange={handleOpenChange}>
<Dialog open={createOpen} onOpenChange={setCreateOpen}>
```

For the analytics case, `handleOpenChange(false)` must model:

- `open = false`
- `pickedDim = null`
- `query = ""`

It must not havoc `open`, `pickedDim`, and `query`.

For the tags case, `onOpenChange={setCreateOpen}` must produce reachable open/close transitions for `createOpen`.

# Non-goals

- Do not change route scoping or config in this plan.
- Do not change checker mounted property semantics in this plan.
- Do not attempt to fully model every Radix or arbitrary component callback shape.
- Do not model callbacks with complex object event payloads.
- Do not keep broad `havoc` fallback for the boolean callback patterns covered here.

# Current-state findings

- `src/extract/engine/ts/transition/component-props.ts`
  - `transparentComponentPropTrigger()` treats components that spread props as transparent and returns `{ attr: propName }`.
  - This allows `Popover`/`Dialog` wrapper props to be considered, but it does not provide event argument values.
- `src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromComponentPropAttribute()` resolves component prop handlers.
  - It calls `transitionsFromResolvedHandler()` only when `handlerExpression()` returns a handler.
  - Direct setter props like `onOpenChange={setCreateOpen}` are not modeled as event-value setter transitions.
  - `sequentialTransitionFromHandler()` summarizes multi-statement handlers, but currently does not bind handler parameters to event values.
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `summarizeHandlerStatements()` already accepts `StatementSummaryOptions.initialLocals`.
  - `summarizeIfStatement()` can parse conditions using locals.
- `src/extract/engine/ts/transition/expressions.ts`
  - `valueExpr()` can read identifiers from `locals`.
  - `booleanExpr()` and `parseGuardExpression()` can handle identifier locals.
- `src/extract/engine/ts/input-transitions.ts`
  - Existing pattern for generating multiple event-value transitions for input-like events.
- Tinyurl generated report shows `AnalyticsFilterButton.onOpenChange.open_pickedDim_query.seq.*` as `confidence: "over-approx"` with `havoc` writes.
- Tinyurl tags model has no transition writing `local:Tags.createOpen`, making `tagCreateDialogCanOpen` vacuous.

# Exact file paths and relevant symbols

- `src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromComponentPropAttribute()`
  - `transitionsFromResolvedHandler()`
  - `sequentialTransitionFromHandler()`
  - `conditionalTransitionFromHandler()`
  - `stateNameForVar()`
- `src/extract/engine/ts/transition/component-props.ts`
  - `componentPropTrigger()`
  - `transparentComponentPropTrigger()`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `summarizeHandlerStatements()`
  - `StatementSummaryOptions`
  - `effectFromSummaries()`
  - `effectWriteVars()`
- `src/extract/engine/ts/transition/expressions.ts`
  - `readBinding()`
  - `valueExpr()`
- `src/extract/engine/ts/input-transitions.ts`
  - `inputTransitions()`
- `src/extract/engine/ts/transition/ui.ts`
  - `labelForEvent()`
- Tests:
  - `test/extraction/extraction.test.ts`
  - `src/cli/features/extract/command.test.ts`

# Existing patterns to follow

- Generate one transition per event value for finite event payloads, similar to `inputTransitions()`.
- Keep extraction confidence `"exact"` when every setter write is represented by concrete IR.
- Keep fallback havoc behavior for unsupported callback payloads outside this plan.
- Use stable transition IDs through existing `tagStableIdKey()` wrapping.
- Keep statement summarization in `statement-summary.ts`; do not add ad hoc AST interpretation in the CLI layer.

# Atomic implementation steps

1. Define known boolean controlled callback props.

   Files to edit:
   - `src/extract/engine/ts/transition/handlers.ts`

   Implementation:
   - Add a helper such as `booleanControlledCallbackValues(attr: string): boolean[]`.
   - Return `[true, false]` for:
     - `onOpenChange`
     - `onCheckedChange`
   - Keep the helper local unless tests show it belongs in `ui.ts`.

2. Model direct setter callback props.

   Files to edit:
   - `src/extract/engine/ts/transition/handlers.ts`

   Implementation:
   - In `transitionsFromComponentPropAttribute()`, after obtaining the JSX expression:
     - If the expression is an identifier bound to a `SetterBinding`;
     - and the prop attr is a known boolean controlled callback;
     - and the setter domain is `bool`;
     - then return two exact transitions:
       - one assigning `true`
       - one assigning `false`
   - Use the trigger attr/locator from `componentPropTrigger()` or `transparentComponentPropTrigger()`.
   - Include the disabled/render guard already computed for the component prop.
   - Transition IDs should be deterministic, for example:
     - `Tags.onOpenChange.createOpen.true`
     - `Tags.onOpenChange.createOpen.false`
   - Reads should include only guard reads.
   - Writes should include the setter var.

3. Bind handler parameters for known boolean callback props.

   Files to edit:
   - `src/extract/engine/ts/transition/handlers.ts`

   Implementation:
   - Add a helper that, for a handler with a first identifier parameter and known boolean callback attr, returns two local bindings:
     - parameter name -> `{ expr: { kind: "lit", value: true }, reads: [] }`
     - parameter name -> `{ expr: { kind: "lit", value: false }, reads: [] }`
   - Generate one extracted transition per binding.
   - Apply this before generic summary fallback so the exact path wins over havoc.

4. Thread initial locals into sequential handler summarization.

   Files to edit:
   - `src/extract/engine/ts/transition/handlers.ts`

   Implementation:
   - Extend `sequentialTransitionFromHandler()` to accept optional `initialLocals`.
   - Pass those locals to `summarizeHandlerStatements(handler, setters, { handlers, resetSymbols, initialLocals })`.
   - Include a value suffix in generated transition IDs if needed to keep true/false transitions distinct.
   - Ensure `setOpen(next); if (!next) { ... }` summarizes to an exact `seq`/`if` effect with no `havoc`.

5. Thread initial locals into simple setter and conditional handler paths if needed.

   Files to edit:
   - `src/extract/engine/ts/transition/handlers.ts`

   Implementation:
   - If tests show `conditionalTransitionFromHandler()` or the final single-setter path runs before sequential summarization for a boolean callback, pass the same local binding into those paths.
   - Keep the change minimal: prefer making boolean callback extraction call one shared helper that invokes existing paths with `initialLocals`.

6. Add exact extraction tests for named handler open change.

   Files to edit:
   - `test/extraction/extraction.test.ts`

   Test fixture:
   ```tsx
   function Popover(props: { open: boolean; onOpenChange: (next: boolean) => void; children?: React.ReactNode }) {
     return <div {...props} />;
   }
   export function App() {
     const [open, setOpen] = useState(false);
     const [pickedDim, setPickedDim] = useState<"browser" | null>(null);
     const [query, setQuery] = useState("");
     function handleOpenChange(next: boolean) {
       setOpen(next);
       if (!next) {
         setPickedDim(null);
         setQuery("");
       }
     }
     return <Popover open={open} onOpenChange={handleOpenChange} />;
   }
   ```
   Assertions:
   - The model contains exact transitions for `onOpenChange` true and false.
   - No `onOpenChange` transition for those vars has `confidence: "over-approx"`.
   - The false transition writes `open`, `pickedDim`, and `query`.
   - The false transition assigns `open=false`, `pickedDim=null`, `query=""` either directly or through an `if` whose condition is a literal/derived literal.

7. Add direct setter callback test.

   Files to edit:
   - `test/extraction/extraction.test.ts`

   Test fixture:
   ```tsx
   function Dialog(props: { open: boolean; onOpenChange: (next: boolean) => void; children?: React.ReactNode }) {
     return <div {...props} />;
   }
   export function App() {
     const [createOpen, setCreateOpen] = useState(false);
     return <Dialog open={createOpen} onOpenChange={setCreateOpen} />;
   }
   ```
   Assertions:
   - The model contains one transition assigning `local:App.createOpen` to `true`.
   - The model contains one transition assigning it to `false`.
   - Both are `confidence: "exact"`.
   - A `reachable` property for `createOpen === true` is reachable.

8. Add CLI report regression coverage.

   Files to edit:
   - `src/cli/features/extract/command.test.ts`

   Implementation:
   - Add a focused extraction report test proving the named handler open-change fixture has no `overApproxTransitions` for the `onOpenChange` writes.
   - Keep this test small; extraction-level tests in `test/extraction/extraction.test.ts` should carry most structural assertions.

# Per-step files to edit

- Step 1:
  - `src/extract/engine/ts/transition/handlers.ts`
- Step 2:
  - `src/extract/engine/ts/transition/handlers.ts`
- Step 3:
  - `src/extract/engine/ts/transition/handlers.ts`
- Step 4:
  - `src/extract/engine/ts/transition/handlers.ts`
- Step 5:
  - `src/extract/engine/ts/transition/handlers.ts`
- Step 6:
  - `test/extraction/extraction.test.ts`
- Step 7:
  - `test/extraction/extraction.test.ts`
- Step 8:
  - `src/cli/features/extract/command.test.ts`

# Acceptance criteria

- `onOpenChange={setCreateOpen}` over a boolean `useState` creates exact true and false transitions.
- A reachable property for `createOpen === true` is no longer vacuous in the direct setter fixture.
- `onOpenChange={handleOpenChange}` with `handleOpenChange(next)` binds `next` to true/false event values.
- The false event for the analytics-shaped handler clears dependent state exactly.
- Covered boolean callback transitions are not reported as `over-approx`.
- Unsupported callback payloads still fall back to existing unextractable/havoc behavior.
- Existing input, async, navigation, and loop extraction tests continue to pass.

# Tests to add or update

- `test/extraction/extraction.test.ts`
  - Add named-handler `onOpenChange` exact sequential/conditional extraction test.
  - Add direct-setter `onOpenChange` exact true/false extraction test.
  - Add reachable check for direct setter open state.
- `src/cli/features/extract/command.test.ts`
  - Add report-level assertion that covered `onOpenChange` callback transitions do not appear in `trustLedger.overApproxTransitions`.
- Update existing snapshots or expectations only where transition IDs include the new true/false suffix.

# Verification commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

Manual tinyurl check after all three related plans land:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk pnpm exec modality check app/routes/analytics.props.mjs
rtk pnpm exec modality check app/routes/tags.props.mjs
```

# Risks, ambiguities, and stop conditions

- Stop and report if `handlerExpression()` cannot resolve direct setter identifiers and there is no simple setter lookup available from the current `setters` map.
- Stop and report if the callback prop is known boolean but the handler first parameter is not an identifier. Do not implement destructured or rest parameter support in this plan.
- Stop and report if a known boolean callback is used with a non-boolean setter domain. Do not coerce non-boolean domains.
- Risk: generated true/false transition IDs may affect existing snapshots. Keep IDs deterministic and update only tests directly affected by this feature.
- Risk: wrapper components that do not actually spread props may still be treated as transparent only through existing logic. Do not broaden transparency detection in this plan.
- Risk: the exact false transition may contain an `if` with a literal condition rather than a fully simplified sequence. That is acceptable if runtime evaluation is exact and no `havoc` remains.
