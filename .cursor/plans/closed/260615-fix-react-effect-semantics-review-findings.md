# 260615 - Fix React Effect Semantics Review Findings

Plan for Cursor Composer 2. This is a focused follow-up to
`.cursor/plans/260615-react-effect-semantics-extraction-gaps.md` after review of the
implemented result. Keep the fix minimal and behavior-driven: repair the modeled semantics
that are currently disconnected or over-applied, and add tests that fail on the current
implementation.

## 1. Goal

Fix three review findings in the React extraction implementation:

1. **Timers are unschedulable.** `setTimeout` / `setInterval` currently produce guarded
   `env` fire transitions and timer vars, but no user/effect transition assigns the timer
   state to `"scheduled"`, so the fire transition is unreachable from the initial `"idle"`
   state.
2. **Suspense gating is global and can deadlock.** The extractor records every Suspense
   boundary in a single array and then gates every transition in the file by the last
   boundary. This gates unrelated transitions and also gates Suspense's own suspend/resolve
   transitions, so the boundary can be stuck in `"suspended"`.
3. **`startTransition` is detached from the event that invokes it.** Calls inside event
   handlers are emitted as always-enabled `internal` transitions, so the deferred commit can
   start without the user event that called `startTransition`.

## 2. Non-goals

- Do not rework the checker `readPre` / `readOpArg` implementation unless a new failing
  test proves it is directly involved.
- Do not redesign structured caveats or report shapes.
- Do not broaden Suspense to full React fiber/lane behavior; only correct boundary scoping,
  initial reachability, and self-transition gating.
- Do not add alias analysis for timers or transition callbacks. If a handle or callback
  cannot be statically bound by existing local binding patterns, emit the existing
  unextractable/model-slack caveat path.

## 3. Current-state findings

- **Timer schedule effects are never used.**
  `src/extract/engine/ts/transition/timers.ts` creates
  `TimerRegistration.scheduleEffect` and even exports `timerScheduleTransition`
  (`timers.ts:139-217`), but the only caller of `transitionsFromTimerCall` in
  `src/extract/engine/ts/react-source-transitions.ts:390-407` pushes only the returned
  `env` fire transition. `timerScheduleTransition` has no callers. Result: the timer var
  starts `"idle"`, the fire transition is guarded on `"scheduled"`, and no reachable
  transition schedules it.
- **Clear calls are emitted as standalone internal transitions.**
  `transitionFromTimerClear` (`timers.ts:164-185`) is added during generic AST traversal
  (`react-source-transitions.ts:408-417`), not sequenced into the handler/effect that calls
  `clearTimeout` / `clearInterval`. This can allow cancellation independent of the user
  event and does not preserve handler order such as `setTimeout(...); clearTimeout(h);`.
- **Suspense boundary state is tracked stacklessly.**
  `suspenseBoundaries.push(boundaryId)` happens when visiting a Suspense node
  (`react-source-transitions.ts:351-360`), but there is no corresponding pop and no
  per-transition boundary association.
- **Every transition is gated by the last boundary.**
  After traversal, `react-source-transitions.ts:713-718` maps all transitions through
  `gateTransitionForBoundary(..., suspenseBoundaries.at(-1))`. This gates unrelated events,
  static navigation, timer fires, and the Suspense boundary's own resolve transitions by
  the last boundary in the file.
- **Suspense self-transitions are gated incorrectly.**
  `transitionsFromSuspendingUse` creates a suspend transition and a resolve transition
  (`suspense.ts:76-120`). The final global gate then adds `boundary == ready` to both.
  If the boundary is initially `"suspended"` as currently declared at
  `react-source-transitions.ts:359`, the suspend transition cannot enqueue, and the resolve
  transition cannot run.
- **`startTransition` is always-enabled and not tied to user input.**
  `transitionsFromStartTransitionCall` emits an `internal` start transition with guard
  `true` (`concurrent.ts:155-180`), and `react-source-transitions.ts:630-645` adds it for
  every `startTransition(...)` call expression encountered during AST traversal. When the
  call is inside `onClick`, the user click no longer controls when the transition begins.
- Existing targeted tests pass, but they are shape-only:
  `test/extract/timers-cancellation.test.ts`, `test/extract/suspense.test.ts`, and
  `test/extract/concurrent.test.ts` do not assert reachability, event class/labels, or
  absence of global over-gating.

## 4. Exact file paths and relevant symbols

- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - `visit`
  - `suspenseBoundaries`
  - `transitionBindings`
  - final `gateTransitionForBoundary` mapping
- `src/extract/engine/ts/transition/timers.ts`
  - `TimerRegistration`
  - `transitionsFromTimerCall`
  - `transitionFromTimerClear`
  - `timerScheduleTransition`
  - `handlerSchedulesModeledTimer`
- `src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromResolvedHandler`
  - `sequentialTransitionFromHandler`
  - `summarizeHandlerStatements`
  - `effectFromSummaries`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `summarizeStatement`
  - `summarizeStatements`
  - wrapper handling for `startTransition` / `flushSync`
- `src/extract/engine/ts/transition/concurrent.ts`
  - `TransitionBinding`
  - `transitionsFromStartTransitionCall`
- `src/extract/engine/ts/transition/suspense.ts`
  - `gateTransitionForBoundary`
  - `transitionsFromSuspendingUse`
  - `suspenseStateVarDecl`
- Tests:
  - `test/extract/timers-cancellation.test.ts`
  - `test/extract/suspense.test.ts`
  - `test/extract/concurrent.test.ts`

## 5. Existing patterns to follow

- For handler sequencing, follow `sequentialTransitionFromHandler` in
  `transition/handlers.ts`: build a single user transition whose `effect` is a `seq`, and
  derive `reads` / `writes` from the final effect.
- For expression/statement summarization, extend `statement-summary.ts` rather than adding
  a second top-level AST scan that creates detached transitions.
- For guards, use `andGuard` / `applyParsedGuard` from `transition/guards.ts`.
- For stable ids, keep using existing component/attribute/state-derived ids and
  `withStableTransitionIds` / `tagStableIdKey`.
- For Suspense boundary gating, attach boundary context at the point the transition is
  created, not as a final global pass.

## 6. Atomic implementation steps

### Step 1 - Sequence timer schedule/clear into handler summaries

1. Extend statement summarization so `setTimeout` / `setInterval` calls with extractable
   callbacks produce a statement summary for the schedule effect.
   - The summary effect should assign the matching `sys:timer:*` var to `"scheduled"`.
   - The existing `env` fire transition should remain separate and guarded on
     `"scheduled"`.
   - Reads should include any reads needed to identify the callback summary; writes should
     include the timer var.
2. Track timer handles within the handler/effect local scope so:
   - `const h = setTimeout(...)` binds `h` to the timer var.
   - `clearTimeout(h)` / `clearInterval(h)` becomes a statement summary assigning that same
     timer var to `"idle"`.
   - The clear summary is sequenced where the call appears.
3. Remove or stop using the top-level standalone `transitionFromTimerClear` AST emission for
   handler bodies. A clear call should not become an always-enabled internal transition.
4. Keep effect cleanup cancellation, but model it inside the cleanup transition emitted from
   `transitionsFromUseEffect`, not as a detached internal transition.

### Step 2 - Add timer reachability tests

1. Update `test/extract/timers-cancellation.test.ts` to assert the handler transition has a
   `seq` effect containing both schedule and clear in source order for:
   - `setTimeout(...);`
   - `const h = setTimeout(...); clearTimeout(h);`
   - `const h = setInterval(...); clearInterval(h);`
2. Add a checker-level or extraction-level reachability assertion:
   - schedule-only timer can reach a state where the timer var is `"scheduled"`, then fire.
   - schedule-then-clear handler leaves timer var `"idle"`, and the fire guard is disabled
     from that post-state.

### Step 3 - Replace global Suspense gating with scoped boundary context

1. Replace the append-only `suspenseBoundaries` behavior with a scoped traversal context.
   A simple approach:
   - Add a `boundaryStack` or pass `activeBoundary` as a parameter to `visit`.
   - When visiting a `<Suspense>` element, create the boundary id, visit children with that
     boundary active, then return to the previous boundary after children are visited.
2. Gate only transitions created while `activeBoundary` is set and only for subtree
   interactions that should require `ready`.
3. Do **not** gate:
   - Suspense suspend transitions that enqueue/mark the boundary suspended.
   - Suspense resolve transitions that mark the boundary ready.
   - Transitions outside the boundary.
   - Static navigation or other global transitions unless they originate in the boundary
     subtree.
4. Set the Suspense var initial state based on modeled evidence:
   - `"suspended"` only for lazy/on-mount suspending content.
   - `"ready"` for a plain boundary with ordinary children.
   If this cannot be determined confidently, prefer `"ready"` plus a model-slack caveat over
   making all child interactions unreachable.

### Step 4 - Add Suspense reachability and scoping tests

1. Update `test/extract/suspense.test.ts` to include:
   - A button outside `<Suspense>` and a button inside `<Suspense>`; assert only the inside
     transition is gated by the boundary.
   - A `use(promise)` or lazy child case; assert the resolve transition guard is only
     `pendingIs(op)` and is not conjuncted with `boundary == ready`.
   - Plain `<Suspense><Child /></Suspense>` starts `ready` or otherwise has a reachable path
     to `ready` before child interactions are expected to run.
2. Add a regression assertion that no final global pass gates all transitions by the last
   boundary.

### Step 5 - Tie `startTransition` to the invoking handler

1. Move `startTransition(fn)` modeling into statement summarization for handler bodies.
   The statement summary should sequence:
   - `assign isPending := true`
   - `enqueue(op="transition:<Comp>#n", continuation="...commit", args={})`
2. Keep the resolve `env` transition for the deferred commit, but emit it because the handler
   summary referenced the transition binding, not because a generic AST scan found a call
   expression.
3. Delete or disable the generic top-level emission at
   `react-source-transitions.ts:630-645` for calls that are inside event handlers. If
   module-level/manual `startTransition` support is desired, it must be explicitly scoped
   and tested; otherwise leave it unmodeled with a caveat.
4. Ensure the user transition has the event label (`onClick`, `onSubmit`, etc.) and not an
   `internal` label when the source code invokes `startTransition` from an event handler.
5. Preserve `flushSync(fn)` behavior from `statement-summary.ts`: direct reads inside
   `flushSync` compile against current/accumulator state rather than `readPre`.

### Step 6 - Add concurrent event-binding tests

1. Update `test/extract/concurrent.test.ts`:
   - Assert the `startTransition` scheduling transition has `cls: "user"` and label kind
     matching the event (`onClick`).
   - Assert there is no always-enabled `internal` start transition for an event-handler
     `startTransition` call.
   - Assert the env resolve transition is guarded by the pending op and applies the
     callback effects plus `isPending := false`.
2. Add one negative case where a non-analyzable transition callback does not silently create
   an always-enabled internal transition.

## 7. Per-step files to edit

- Step 1: `src/extract/engine/ts/transition/timers.ts`,
  `src/extract/engine/ts/transition/statement-summary.ts`,
  `src/extract/engine/ts/transition/handlers.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`,
  optionally `src/extract/engine/ts/types.ts` if summary state needs timer bindings.
- Step 2: `test/extract/timers-cancellation.test.ts`.
- Step 3: `src/extract/engine/ts/react-source-transitions.ts`,
  `src/extract/engine/ts/transition/suspense.ts`.
- Step 4: `test/extract/suspense.test.ts`.
- Step 5: `src/extract/engine/ts/transition/concurrent.ts`,
  `src/extract/engine/ts/transition/statement-summary.ts`,
  `src/extract/engine/ts/transition/handlers.ts`,
  `src/extract/engine/ts/react-source-transitions.ts`.
- Step 6: `test/extract/concurrent.test.ts`.

## 8. Acceptance criteria

1. A handler containing `setTimeout(() => setX(...), n)` produces a user transition that
   assigns the timer var to `"scheduled"` and an env transition that can fire only while
   scheduled.
2. A handler containing `const h = setTimeout(...); clearTimeout(h);` produces one user
   transition that sequences schedule then clear, leaving the timer `"idle"` after the
   handler.
3. `clearTimeout` / `clearInterval` inside handlers or effect cleanups do not produce
   standalone always-enabled internal transitions.
4. A transition outside a Suspense boundary is not gated by `sys:suspense:*`.
5. Suspense suspend/resolve transitions are not gated by `boundary == ready` in a way that
   prevents a suspended boundary from resolving.
6. Plain Suspense boundaries without a lazy/suspending child do not make child interactions
   initially unreachable.
7. `startTransition` invoked from `onClick` produces a user transition with the click label
   that sets `isPending` and enqueues the deferred commit.
8. The deferred commit remains an env resolve transition guarded by the pending op and sets
   `isPending` back to false.
9. No always-enabled internal start transition is emitted for event-handler
   `startTransition`.

## 9. Tests to add or update

- `test/extract/timers-cancellation.test.ts`
  - Add source-order assertions on the user handler `seq`.
  - Add reachability/fire-disabled assertions.
- `test/extract/suspense.test.ts`
  - Add inside/outside boundary scoping.
  - Add self-transition resolve guard regression.
  - Add plain-boundary initial reachability.
- `test/extract/concurrent.test.ts`
  - Add event-label/class assertions for transition scheduling.
  - Add absence assertion for detached internal start transitions.
  - Add env resolve shape assertions.

If existing tests rely on the current detached transition ids, update them to assert semantic
shape rather than broad substring matches.

## 10. Verification commands

```bash
rtk pnpm test test/extract/timers-cancellation.test.ts test/extract/suspense.test.ts test/extract/concurrent.test.ts
rtk pnpm typecheck
rtk pnpm test
rtk cargo test -p checker
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
```

Run the targeted test command after each step. Run the full verification set before handing
off.

## 11. Risks, ambiguities, and stop conditions

- **STOP if handler sequencing cannot preserve timer handle identity without broad alias
  analysis.** Report the unsupported binding form and add a caveat path; do not guess.
- **STOP if Suspense boundary scoping requires cross-file component inlining beyond existing
  component discovery.** Keep the fix to currently discovered components and document the
  unsupported case.
- **STOP if converting `startTransition` into statement summaries causes duplicate writes
  with existing fallback/havoc summaries.** A handler should be summarized once, not both as
  a precise transition and a fallback.
- Do not keep both old and new paths for the same semantic event. Detached top-level
  transitions for timer clear or transition start should be removed once the sequenced path
  exists.
- Watch state-space growth: newly reachable timers and pending transition ops can increase
  states. If example checks hit bounds, report with the specific transition/var responsible.
