# Component Prop Trigger Regression Fixes

## 1. Goal

Fix three regressions introduced by the imported component callback interaction work:

- Component-prop handlers that schedule modeled timers must register timer state vars and include timer fire/environment transitions, matching intrinsic handler extraction.
- Unknown component/element prop spreads must not be treated as real host interactive triggers unless the resolver can statically prove the spread reaches a host interactive element.
- Recursive component-trigger resolution must emit all statically distinct trigger paths, including repeated sibling child components with the same forwarded prop.

Keep the fix generic and framework-neutral. Do not special-case `Slot`, Radix, shadcn, Coffee DX, or any single UI library.

## 2. Non-goals

- Do not redesign the extraction pipeline.
- Do not change checker semantics or public `Model` / `Transition` schemas.
- Do not add runtime rendering, React execution, or DOM simulation.
- Do not broaden arbitrary component props into clickable events.
- Do not preserve the current false-positive behavior for unknown spreads; this project does not require backward compatibility.
- Do not refactor unrelated intrinsic event extraction paths except to share a small helper if it reduces duplicated timer-finalization logic.

## 3. Current-State Findings

- `src/extract/engine/ts/react-source-transitions.ts` creates a `componentPropHandlerContext` with `timerRegistrations`, `envTransitions`, and `timerIndex` for non-intrinsic component prop handlers around lines 499-505.
- The component-prop branch pushes extracted transitions but does not call `registerTimerVars`, does not increment `timerCounter`, and does not append `envTransitions`. The intrinsic branch does all three around lines 691-697.
- A component-prop timer handler such as `<Button onClick={() => setTimeout(() => setStatus("done"), 10)} />` currently emits a transition writing `sys:timer:...` without declaring that timer var and drops the timer fire transition.
- `src/extract/engine/ts/transition/component-props.ts` uses `componentSpreadsPropsToHostElement` first, but then falls back to `componentSpreadsPropsToAnyElement` and pushes `{ attr: propName }`. This treats unknown spreads like `<Slot.Root {...props} />` as concrete click triggers.
- The plan being implemented explicitly required unknown dynamic components and spreads to remain unextractable unless a statically visible host interactive branch exists.
- `resolveComponentPropTriggers` passes a single mutable `visited` set through sibling recursion. After the first child path visits `Inner:onPress`, a second sibling `<Inner onPress={props.onSave} />` is skipped, so multiple statically distinct triggers collapse to one transition.
- Existing tests added in `test/extraction/extraction.test.ts` cover the happy path but do not cover timer finalization, unknown spread rejection, or repeated sibling triggers.

## 4. Exact File Paths And Relevant Symbols

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `componentPropHandlerContext`
  - `registerTimerVars`
  - `timerCounter`
  - `envTransitions`
  - component-prop JSX attribute branch
  - intrinsic JSX event branch timer handling

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`
  - `resolveComponentPropTriggers`
  - `componentSpreadsPropsToHostElement`
  - `componentSpreadsPropsToAnyElement`
  - `transparentComponentPropTrigger`
  - `componentPropDeferredToChildTrigger`
  - `forwardsComponentProp`
  - `jsxHostTagName`
  - `hostTagFromInitializer`

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromComponentPropAttribute`
  - `transitionsFromBoundedListComponentPropAttribute`
  - `transitionsFromResolvedHandler`
  - `HandlerExtractionContext`

- `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`
  - component prop callback tests near the recently added multi-hop tests

- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - imported multi-hop component callback integration test

- `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md`
  - P3 handler discovery / bounded static component-trigger resolution wording, if it currently implies unknown spreads are modeled

## 5. Existing Patterns To Follow

- Use `registerTimerVars(timerRegistrations)` and `timerCounter += timerRegistrations.length` exactly as intrinsic event and effect extraction branches do.
- Include `envTransitions` alongside user transitions when modeled side effects register environment/timer transitions.
- Keep timer IDs stable by preserving the existing `timerCounter` flow.
- Treat extraction conservatively: statically proven host triggers become transitions; unresolved or unknown dynamic paths become warnings/unextractable, not silently modeled events.
- Preserve `ExtractionWarning` / `unextractableHandlerCaveat` style for unsupported handlers.
- Preserve transition stable-ID tagging with `tagStableIdKey` and `withStableTransitionIds`.
- Keep component trigger recursion bounded, but make cycle detection path-local rather than global across siblings.

## 6. Atomic Implementation Steps

1. Add focused failing tests for component-prop timer finalization.

   In `test/extraction/extraction.test.ts`, add a test with:

   - `function Button(props: { onClick: () => void }) { return <button onClick={props.onClick}>Run</button>; }`
   - `App` has `const [status, setStatus] = useState("idle")`.
   - `App` returns `<Button onClick={() => setTimeout(() => setStatus("done"), 10)} />`.
   - Call `extractUseStateSkeleton` with `effectApis: ["setTimeout"]`.

   Assert:

   - `vars` contains a `sys:timer:` var.
   - There is a user transition that schedules the timer and writes the `sys:timer:` var.
   - There is an environment/timer transition that writes `local:App.status`.
   - No transition writes an undeclared var.

2. Finalize component-prop timer extraction in `react-source-transitions.ts`.

   In all component-prop extraction paths that pass `componentPropHandlerContext`:

   - After extraction succeeds, call `registerTimerVars(componentPropHandlerContext.timerRegistrations)`.
   - Increment `timerCounter` by `componentPropHandlerContext.timerRegistrations.length`.
   - Push both extracted transitions and `componentPropHandlerContext.envTransitions`.

   Apply this to:

   - literal list component-prop branch;
   - bounded list component-prop branch;
   - generic component-prop branch.

   Prefer a small local helper inside `extractReactSourceTransitions` if it avoids duplicating this three-line finalization sequence, for example `finalizeHandlerContext(handlerContext)`.

3. Add focused failing tests for unknown spreads.

   In `test/extraction/extraction.test.ts`, add a test with:

   - `const Slot = { Root: (_props: any) => null };`
   - `function Button(props: { onClick?: () => void }) { return <Slot.Root {...props} />; }`
   - `App` passes `<Button onClick={() => setStatus("posting")} />`.

   Assert:

   - no transition writes `local:App.status`;
   - an unextractable handler warning/caveat exists for the relevant handler.

   Also keep the existing positive static-host-branch test: `const Comp = asChild ? Slot.Root : "button"; return <Comp {...props} />` must still model the click because a statically visible `"button"` branch exists.

4. Remove the unknown-spread trigger fallback.

   In `resolveComponentPropTriggers`, delete or neutralize the fallback:

   - `else if (isForwardablePropName(propName) && componentSpreadsPropsToAnyElement(component)) { triggers.push({ attr: propName }); }`

   The resolver should only synthesize a transparent spread trigger when `componentSpreadsPropsToHostElement(component)` proves a host interactive target.

   Keep `componentSpreadsPropsToAnyElement` only if other callers still need it for diagnostics or legacy exported API compatibility. Do not use it to create user transitions.

5. Align warning suppression with the stricter resolver.

   Verify `componentPropDeferredToChildTrigger` and `forwardsComponentProp` use `resolveComponentPropTriggers(...).length > 0` for resolver-backed suppression.

   After removing the fallback, unknown spread paths should no longer suppress unextractable handler warnings.

   If a missing warning appears because `expressionReferencesForwardableProp` still returns true before resolver-backed proof, narrow that early return in `forwardsComponentProp` so it only suppresses direct prop forwarding when a modeled child trigger is actually proven, or when the call site is intentionally handled elsewhere.

6. Add focused failing tests for repeated sibling trigger paths.

   In `test/extraction/extraction.test.ts`, add a test with:

   - `function Inner(props: { onPress?: () => void; id: string }) { return <button data-testid={props.id} onClick={props.onPress} />; }`
   - `function Card(props: { onSave: () => void }) { return <><Inner id="a" onPress={props.onSave} /><Inner id="b" onPress={props.onSave} /></>; }`
   - `App` passes `<Card onSave={() => setStatus("posting")} />`.

   Assert:

   - exactly or at least two user transitions write `local:App.status`;
   - transition IDs are distinct;
   - labels/locators distinguish the two triggers if locator extraction can represent them. If dynamic `data-testid={props.id}` cannot be represented, use two literal host buttons or two child wrappers with literal `data-testid` values.

7. Make recursion visited state path-local.

   In `resolveComponentPropTriggers`, do not share sibling child recursion visits globally.

   Suggested shape:

   - Keep `visited` as the current recursion path.
   - When recursing into a child, pass `new Set(visited)` instead of the same mutable set.
   - Optionally delete `visitKey` before returning, but copying per child is clearer and avoids accidental sibling coupling.

   Preserve cycle protection for paths like `A -> B -> A`.

8. Preserve multiple trigger suffixes and stable IDs.

   After path-local recursion, verify `pathSuffix` remains distinct enough when two sibling triggers use the same child tag.

   If both transitions still collide after `withStableTransitionIds`, update suffix construction to include a sibling occurrence index from the parent scan, not only the child trigger index.

   Keep the suffix deterministic from AST traversal order.

9. Add or update CLI integration coverage only if unit tests miss imported behavior.

   The existing CLI imported multi-hop test should continue to pass.

   Add a CLI test only if one of the fixes depends on import/source merging behavior. Prefer unit tests for these three regressions because they are extractor semantics, not project discovery semantics.

10. Update docs if necessary.

   Inspect `docs/_specs/02-extraction.md`.

   If it says unknown spreads or arbitrary spread wrappers are supported, revise it to say:

   - Transparent wrappers are modeled only when their prop spread reaches a statically visible host interactive element.
   - Unknown dynamic component spreads remain unextractable and should produce a warning/caveat.
   - Multiple statically visible trigger paths for the same component prop are modeled as distinct user transitions.

## 7. Per-Step Files To Edit

1. Timer tests:
   - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`

2. Timer finalization:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`

3. Unknown spread tests:
   - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`

4. Unknown spread resolver fix:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`

5. Warning suppression alignment:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/react-source-transitions.ts`

6. Repeated sibling trigger tests:
   - `/Users/hari/proj/modality-ts/test/extraction/extraction.test.ts`

7. Path-local recursion:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`

8. Stable suffix adjustments if needed:
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/component-props.ts`
   - `/Users/hari/proj/modality-ts/src/extract/engine/ts/transition/handlers.ts`

9. Optional CLI coverage:
   - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`

10. Optional docs:
   - `/Users/hari/proj/modality-ts/docs/_specs/02-extraction.md`

## 8. Acceptance Criteria

- Component-prop handlers that schedule modeled timers produce a valid model:
  - every transition write target is declared in `model.vars`;
  - timer schedule transitions are present;
  - timer fire/environment transitions are present;
  - local state writes from timer callbacks are modeled.
- Unknown spreads such as `<Slot.Root {...props} />` do not produce user click transitions unless a statically visible host interactive branch exists.
- Static host wrapper branches such as `const Comp = asChild ? Slot.Root : "button"; return <Comp {...props} />` remain modeled.
- A prop forwarded to two statically visible sibling triggers emits two distinct user transitions.
- Existing direct intrinsic handler extraction remains unchanged.
- Existing imported multi-hop callback extraction continues to emit transitions writing parent state.
- Relevant unresolved component-prop paths produce unextractable warnings/caveats rather than silent drops.

## 9. Tests To Add Or Update

- Add `test/extraction/extraction.test.ts` test: component-prop timer handler registers timer vars and emits timer fire transition.
- Add `test/extraction/extraction.test.ts` test: unknown spread wrapper remains unextractable.
- Add `test/extraction/extraction.test.ts` test: static host branch wrapper still models the click.
- Add `test/extraction/extraction.test.ts` test: repeated sibling child trigger paths emit distinct transitions.
- Update existing tests only as necessary to assert stricter unknown-spread behavior.
- Keep `src/cli/features/extract/command.test.ts` imported multi-hop test passing.

## 10. Verification Commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts src/cli/features/extract/command.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

If edits affect timer/concurrent semantics beyond finalizing component-prop extraction, also run:

```bash
rtk pnpm phase7
```

Optional one-off probes after implementation:

```bash
rtk pnpm exec tsx -e 'import { extractUseStateSkeleton } from "./src/extract/sources/use-state/transitions.ts"; const r = extractUseStateSkeleton(`import { useState } from "react"; function Button(props:{onClick:()=>void}){ return <button onClick={props.onClick}>Run</button>; } export function App(){ const [status,setStatus]=useState("idle"); return <Button onClick={() => setTimeout(() => setStatus("done"), 10)} />; }`, {route:"/", fileName:"App.tsx", effectApis:["setTimeout"]}); console.log(JSON.stringify({vars:r.vars.map(v=>v.id), transitions:r.transitions.map(t=>({id:t.id,writes:t.writes,effect:t.effect})), warnings:r.warnings.map(w=>w.message)}, null, 2));'
```

```bash
rtk pnpm exec tsx -e 'import { extractUseStateSkeleton } from "./src/extract/sources/use-state/transitions.ts"; const r = extractUseStateSkeleton(`import { useState } from "react"; const Slot = { Root: (_props: any) => null }; function Button(props:{onClick?:()=>void}){ return <Slot.Root {...props} />; } export function App(){ const [status,setStatus]=useState("idle"); return <Button onClick={() => setStatus("posting")} />; }`, {route:"/", fileName:"App.tsx"}); console.log(JSON.stringify({transitions:r.transitions.map(t=>({id:t.id,writes:t.writes})), warnings:r.warnings.map(w=>w.message)}, null, 2));'
```

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if component-prop timer handling cannot reuse the same timer finalization pattern as intrinsic handlers without larger extraction pipeline changes.
- Stop and report if removing the unknown-spread fallback causes existing documented tests to fail in a way that implies prior specs intentionally allowed arbitrary dynamic component spreads. The intended behavior from the imported-callback plan is conservative host-proof-only modeling.
- Stop and report if transition IDs remain unstable or collide after adding path-local recursion and multiple sibling triggers.
- Stop and report if adding env transitions from component-prop extraction duplicates timer fire transitions for nested traversals. The final model should have one timer fire transition per modeled timer registration.
- Stop and report if warnings become noisy for child component internal forwarding attributes that are successfully modeled at the parent call site. Suppress only resolver-proven forwarded paths.
- Be careful with list-rendered component-prop handlers: timer finalization must work for literal and bounded list branches without reusing the same timer var ID for multiple list entries unless that matches existing intrinsic list behavior.
- Do not weaken server/client module boundaries or import reachability rules while fixing these extractor-local regressions.
