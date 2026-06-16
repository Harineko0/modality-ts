# Imported Component Callback Interactions

## 1. Goal

Fix `docs/_issues/coffee-dx-imported-interactions-not-modeled.md` by making extraction model user transitions that enter through imported child components and flow back into parent state setter callbacks.

The concrete target shape is:

- A route/component renders an imported child component.
- The parent passes callbacks such as `onAdd={() => handleAdd(item)}` and `onRemove={() => handleRemove(item.id)}`.
- The child forwards those callbacks into a design-system wrapper, e.g. `<Button onClick={onAdd}>`.
- The wrapper transparently spreads props to a host interactive element, e.g. `<Comp {...props} />` where `Comp` resolves to `"button"` for the modeled call.
- Extraction emits user transitions writing the parent state, including `local:CustomerHome.cart` in the Coffee DX case.

Implement this as a generic component-trigger and handler-summary capability. Do not hard-code Coffee DX, `MenuItemCard`, `Button`, Radix, shadcn, or any one framework.

## 2. Non-goals

- Do not execute application code or inspect runtime component output.
- Do not add Coffee DX as a fixture dependency.
- Do not introduce framework-specific UI-kit allowlists.
- Do not change checker semantics or core `Model` / `Transition` schemas unless a truly necessary abstraction emerges.
- Do not preserve old "deeper component prop drilling is unextractable" behavior for cases that are now statically resolvable; this project does not require backward compatibility.
- Do not attempt full array/object semantic precision for cart updates in this fix. A sound `havoc` write to the modeled cart var is acceptable when the updater body is outside M0, as long as the transition exists and is reported as over-approximate.

## 3. Current-State Findings

- `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts` already builds a project interaction surface across reachable imports. Named imported PascalCase components are promoted to both render and interaction surfaces at lines 884-895.
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts` collects `additionalComponentSources` into the component map before extraction, so imported components included by the CLI can be visible to transition extraction.
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts` handles non-intrinsic component callback props in `transitionsFromComponentPropAttribute` at lines 223-298.
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts` currently resolves a component prop trigger only when the callee itself contains an intrinsic event attribute that references/calls the prop (`componentPropTrigger`, lines 19-66), or when the callee directly spreads props to an element (`transparentComponentPropTrigger`, lines 68-78).
- The Coffee DX shape is one level deeper than this: `CustomerHome -> MenuItemCard -> Button -> host button`. `MenuItemCard` does not contain an intrinsic `onClick`; it contains `<Button onClick={onAdd}>`, and `Button` is transparent.
- `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts` currently asserts deeper prop drilling is unextractable at lines 923-940. That expectation conflicts with the desired capability when the deeper path is statically resolvable.
- List-rendered handler support exists for intrinsic events in `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts` around lines 585-629, but component prop attributes do not reuse the same literal/bounded list binding path.
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/statement-summary.ts` already has argument-aware helper summarization via `helperSummariesFromCall` at lines 560-561, but it requires call arguments to be representable as `BoundExpr`. List item variables passed through component props need to arrive in `HandlerExtractionContext.initialLocals`.
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/locals.ts` still has an older zero-argument `inlinedHelperCall` helper at lines 152-160 used by the later single-call path in `transitionsFromResolvedHandler`; keep it aligned or replace its usage so helper inlining behavior is not split.

## 4. Exact File Paths And Relevant Symbols

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`
  - `componentPropTrigger`
  - `transparentComponentPropTrigger`
  - `componentSpreadsPropsToElement`
  - `forwardsComponentProp`
  - `componentLocalHandlers`
  - `handlerCallsProp`
  - `expressionReferencesProp`
  - `componentPropAliases`
  - `componentPropObjectNames`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromComponentPropAttribute`
  - `transitionsFromResolvedHandler`
  - `HandlerExtractionContext`
  - `transitionsFromLiteralListAttribute`
  - `transitionsFromBoundedListAttribute`
  - `readListItemBinding`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
  - JSX attribute visit branch for non-intrinsic forwardable props
  - JSX intrinsic event branch list handling
  - `literalListRenderedHandlerInfo`
  - `listRenderedHandlerInfo`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/locals.ts`
  - `callSummaryFromHandler`
  - `inlinedHelperCall`
  - `componentScopeLocalsFor`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/statement-summary.ts`
  - `summarizeHandlerStatements`
  - `helperSummariesFromCall`
  - `fallbackSummaries`
- `/Users/hari/proj/modality-ts/src/cli/features/extract/project.ts`
  - `sourceWithReachableImports`
  - `referencedIdentifiers`
  - `resolveImportPath`
  - import promotion block at lines 884-895
- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - `runExtractCommand` integration tests
- `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
  - existing component prop drilling test to replace/update
- `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md`
  - P3 handler discovery currently says deeper prop-drilling is unextractable; update this to describe bounded static component-trigger resolution.

## 5. Existing Patterns To Follow

- Keep extraction conservative: when a path is statically visible and writes are identifiable but expressions are not representable, emit over-approximate `havoc` writes instead of dropping the transition.
- Preserve the `ExtractionWarning` / caveat style already used for unextractable handlers.
- Use existing `ParsedGuard` composition through `combineParsedGuards`, `renderGuardFor`, and `disabledGuardFor`.
- Reuse `HandlerExtractionContext.initialLocals` for list item bindings rather than inventing a separate callback-local mechanism.
- Reuse stable transition ID tagging via `tagStableIdKey`.
- Keep module-boundary logic in `project.ts` framework-neutral and delegated through `NavigationAdapter` hooks where needed.
- Keep tests as synthetic minimal TS/TSX fixtures that exercise the abstraction without depending on Coffee DX.

## 6. Atomic Implementation Steps

1. Add a recursive component callback trigger resolver.

   Replace the one-hop `componentPropTrigger`/`transparentComponentPropTrigger` pairing with a single bounded resolver, for example `resolveComponentPropTrigger(source, component, propName, components, setters, warnings, options?)`.

   Required behavior:

   - Return the effective user event attr, locator, and composed guard for a prop.
   - Detect direct intrinsic paths: `<button onClick={onAdd}>`.
   - Detect local handler paths: `<button onClick={() => props.onAdd()}>`.
   - Detect child component paths: `<Button onClick={onAdd}>` when `Button` can be resolved in the `components` map.
   - Detect transparent spread paths: component prop spread to a host element or a statically host-like element.
   - Compose disabled guards along the resolved path, including the caller component attribute and the final interactive element.
   - Avoid infinite recursion with a visited key such as `${componentName}:${propName}` and a small depth cap, e.g. 5.
   - If multiple statically distinct triggers exist for the same prop, return all of them, not just the first, so a prop wired to two buttons yields two transitions.

2. Make transparent wrapper detection host-aware without UI-kit hardcoding.

   Extend `componentSpreadsPropsToElement` so it distinguishes:

   - Direct host spread: `<button {...props} />`.
   - Statically selected host element: `const Comp = asChild ? Slot.Root : "button"; return <Comp {...props} />`.
   - Unknown component spread: keep conservative and do not treat as host unless there is a statically visible branch to a host interactive element.

   The Coffee DX `Button` should resolve because its default `asChild = false` branch includes `"button"`. Do not special-case `Slot.Root`; only use it as an unknown non-host branch while accepting the statically host branch.

3. Thread list-rendered callback locals into component prop extraction.

   In the non-intrinsic component prop branch in `react-source-transitions.ts`, mirror the list handling already used for intrinsic events:

   - Check `literalListRenderedHandlerInfo(node)` before generic extraction and call `transitionsFromComponentPropAttribute` once per literal value with `HandlerExtractionContext.initialLocals` and a stable value suffix.
   - Check `listRenderedHandlerInfo(node, vars, component)` for bounded lists and generate one transition per index with item binding via `readListItemBinding`.
   - Preserve existing unextractable warnings for lengthCat/unsupported list domains, but name the component prop handler clearly.

   This is important for `items.map((item) => <MenuItemCard onAdd={() => handleAdd(item)} />)`.

4. Update `transitionsFromComponentPropAttribute` to accept handler context and route/context inputs.

   Add parameters needed to match `transitionsFromJsxAttribute` behavior:

   - `routePatterns`
   - `contextBindings`
   - `resetSymbols`
   - `handlerContext`

   Pass these into `transitionsFromResolvedHandler` instead of hard-coded `[]` and `emptyContextBindings()`.

5. Align helper inlining paths.

   Ensure helper calls with arguments use the same argument-aware summarization path everywhere.

   - Prefer `summarizeHandlerStatements` / `helperSummariesFromCall` for helper calls with arguments.
   - Either remove `inlinedHelperCall` usage in `transitionsFromResolvedHandler` or extend it to bind arguments using `valueExpr` and `initialLocals`.
   - If helper arguments are not representable but the helper body visibly writes modeled setters, fall back to `havoc` summaries for those setters instead of returning no transition.

6. Update unextractable-warning suppression for forwarded props.

   Replace the current `forwardsComponentProp` suppression with a resolver-backed check. A handler should be suppressed as "forwarded" only when the resolver can prove the prop reaches a modeled child trigger, or when it is intentionally deferred to a separately extracted component prop transition.

7. Add focused unit coverage for the resolver.

   Update `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`:

   - Replace the current "reports deeper component prop drilling as unextractable" expectation with a positive test for a resolvable multi-hop path:
     - `App -> Button -> Inner -> button`
     - parent passes `onPress={() => setSaveStatus("posting")}`
     - expect a transition writing `local:App.saveStatus`.
   - Add a negative test where a prop is passed into an imported/non-modeled unknown component without transparent host evidence; expect unextractable.

8. Add CLI integration coverage for imported files and wrappers.

   Add a test in `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts` that creates temporary files:

   - `App.tsx` imports `{ MenuItemCard }` from `./MenuItemCard`.
   - `MenuItemCard.tsx` imports `{ Button }` from `./Button`.
   - `Button.tsx` spreads props to a host button through a static `Comp` branch.
   - `App` has `useState<CartItem[]>([])`, maps a literal or bounded list of items, and passes `onAdd={() => handleAdd(item)}`.
   - The helper `handleAdd` calls `setCart(...)` with a block functional updater outside current M0.

   Assertions:

   - The model includes `local:App.cart`.
   - At least one transition writes `local:App.cart`.
   - The transition is user-class and has click label.
   - If the updater remains unrepresentable, the effect may be `havoc` and confidence may be `over-approx`; do not assert exactness.
   - The report does not classify the relevant `onAdd`/`onRemove` path as unextractable.

9. Update module-boundary tests only if needed.

   If the CLI integration test shows imported component source was not included, add/adjust tests in `/Users/hari/proj/modality-ts/test/extraction/next-module-boundaries.test.ts` or a new router-boundary test for `sourceWithReachableImports`.

   Expected current behavior: named PascalCase local imports should already be followed and included.

10. Update specs.

   Edit `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md` P3:

   - Replace "Beyond one level => unextractable" with "bounded static component-trigger resolution".
   - State that unknown dynamic components, unresolved imports, ambiguous component variables, and cycles beyond the cap remain unextractable or over-approximate with warnings.
   - State that wrapper components are supported when their prop spread reaches a statically visible host interactive element.

## 7. Per-Step Files To Edit

1. Recursive resolver:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`

2. Transparent wrapper host detection:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`

3. List locals for component prop attributes:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`

4. Handler context plumbing:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`

5. Helper inlining alignment:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/locals.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/statement-summary.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`

6. Warning suppression:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`

7. Unit tests:
   - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`

8. CLI integration tests:
   - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`

9. Optional module-boundary tests:
   - `/Users/hari/proj/modality-ts/test/extraction/next-module-boundaries.test.ts`
   - Or add `/Users/hari/proj/modality-ts/test/extraction/router-module-boundaries.test.ts` if React Router coverage is cleaner.

10. Specs:
   - `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md`

## 8. Acceptance Criteria

- Extracting a local fixture shaped like `App -> imported MenuItemCard -> imported Button -> host button` emits a user transition writing the parent cart state var.
- A parent callback passed through a list-rendered component prop receives the map item binding when the list is literal or bounded.
- A transparent wrapper with a statically visible host button branch is treated as an event trigger without naming the UI library.
- A truly unresolved/dynamic child component path remains reported as unextractable rather than silently ignored.
- Existing direct intrinsic handler extraction remains unchanged.
- Existing one-hop component prop extraction remains covered.
- The Coffee DX reproduction command should include transitions that write `local:CustomerHome.cart` after applying the implementation.

## 9. Tests To Add Or Update

- Update `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`:
  - Convert the "deeper component prop drilling" test into two tests:
    - resolvable multi-hop component callback path is modeled;
    - unresolved/dynamic deeper prop path remains unextractable.
  - Add a transparent wrapper test:
    - `function Button({ asChild = false, ...props }) { const Comp = asChild ? Slot.Root : "button"; return <Comp {...props} />; }`
    - `function Card({ onAdd }) { return <Button onClick={onAdd} />; }`
    - `App` passes `onAdd={() => setStatus("posting")}`.
  - Add a bounded/literal list component prop test:
    - `items.map(item => <Row onPick={() => pick(item)} />)`.

- Add `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts` coverage:
  - Temp `App.tsx`, `MenuItemCard.tsx`, and `Button.tsx`.
  - Run `runExtractCommand`.
  - Assert `model.transitions.some(t => t.writes.includes("local:App.cart"))`.
  - Assert no relevant unextractable report entry for the modeled callback.

- If module inclusion fails, add a direct `sourceWithReachableImports` test:
  - named local imported PascalCase component is included in `interactionText`;
  - its own local UI wrapper import is included when referenced by JSX.

## 10. Verification Commands

Run commands with `rtk` from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts src/cli/features/extract/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If the implementation changes checker-facing semantics or model generation beyond the extractor path, also run:

```bash
rtk pnpm phase7
```

Optional manual Coffee DX verification after local implementation:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality extract app/_customer/home.tsx --out .modality/probe-customer.model.json --app-model .modality/probe-customer.app.model.ts --report .modality/probe-customer.extraction-report.json
```

Then inspect `.modality/probe-customer.model.json` for transitions whose `writes` include `local:CustomerHome.cart`.

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if `sourceWithReachableImports` does not include imported `MenuItemCard` or `Button` sources in the CLI fixture; that is a module-surface bug and should be fixed before changing transition logic.
- Stop and report if component names collide across files in the merged `components` map. A robust fix may need file-qualified component identities before recursive trigger resolution can be sound.
- Stop and report if transparent wrapper host detection cannot distinguish a statically host default branch from an unknown dynamic component. Do not silently treat arbitrary spread components as host controls.
- Stop and report if list items are neither literal nor backed by a bounded-list domain. The correct outcome is an unextractable/over-approx warning with a refinement hint, not fake item identity.
- Be careful with recursion: cycles like `A -> B -> A` must terminate with a warning or unresolved result.
- Be careful with duplicate triggers: if a prop reaches two buttons, emit distinct transitions with stable IDs rather than deduping away behavior.
- Do not weaken server/client module boundaries. Imported server-only modules must remain excluded from the interaction surface.
- Do not make all non-intrinsic `onX` props automatically clickable. They are clickable only when a statically resolved trigger path reaches a host interactive event.
