# 260623-05 — Handler helper-call inlining (Gap B of custom-wrapper vacuous-safety)

Fixes the first of two root causes behind
`docs/_issues/custom-wrapper-handlers-unextractable-vacuous-safety.md`.
**Land this plan before `260623-06` (branch-path effects); plan 06 depends on the
statement-list core introduced here.**

## Goal

Make handler effect extraction follow **local helper-function indirection** so
that effect-API calls and `useState` writes reached *through* a locally-declared
helper become user transitions. A handler that calls or `await`s a local helper
which performs the effect must produce the same transitions as if the effect
call were written inline.

Concretely, the following must extract a `useProjectRestartMutation` enqueue
transition family (start + env success/error), identical to writing
`restartProject({ ref })` inline:

```tsx
const requestProjectRestart = () => { restartProject({ ref: projectRef }) }
// ...
<ConfirmationModal onConfirm={async () => { await requestProjectRestart() }} />
```

This is verified broken today: `/tmp` repro `Helper.tsx` / `AwaitHelper.tsx`
(handler awaits/calls a helper wrapping `mutate`) yields a transition with **no
`enqueue`**, whereas `Direct.tsx` (inline `restartProject({ ref })`) yields
`onConfirm.useProjectRestartMutation.start` with an enqueue.

## Non-goals

- Branch-nested effect extraction (effects inside `if`/`else if` bodies). That is
  Gap A, handled in `260623-06`. This plan only makes inlining work; it does not
  add path enumeration. (The RestartServerButton `onConfirm` needs both plans to
  fully extract; this plan is validated with branch-free fixtures.)
- Overlay add-transition support and checker vacuity guards (explicitly out of
  scope per the issue triage).
- Inlining helpers that are not locally declared in the component/module scope
  (imported helpers, methods on objects, dynamically-assigned callbacks).
- Backward compatibility shims — none required (experimental tool).

## Current-state findings

- Handler resolution entry point:
  `src/extract/lang/ts/driver/transition/handler-resolution.ts`
  → `transitionsFromResolvedHandler(...)`. It dispatches, in order, to:
  `transitionsFromAsyncHandler` (async.ts), the callback-effect path
  (`callback-effects.ts` via `statementHasCallbackEffect` /
  `transitionsFromCallbackEffectHandler`), then conditional/sequential/setter
  builders (`handler-sequential.ts`), then `inlinedHelperCall` only for the
  trailing-call-summary path.
- `inlinedHelperCall` (`transition/locals.ts:152`) and `helperSummariesFromCall`
  (`statement-driver.ts:282`) **already** inline a single helper call, but only
  on the call-summary / statement-summary paths — **not** on the async or
  callback-effect detection paths. So `await helper()` / `helper()` where the
  helper wraps a `mutate` is never recognized as an effect.
- The async detector (`async.ts`) and callback detector (`callback-effects.ts`)
  identify effects by inspecting the **callee name** of the awaited/called
  expression against `effectApis` + `effectOpAliases`. A local helper name is not
  in `effectApis`, so detection returns nothing and the handler falls through to
  the setter/sequential path, which summarizes the `await helper()` statement as
  an opaque/identity effect (no enqueue, empty writes).
- Local helpers are already collected: `componentLocalHandlers(component)`
  (`transition/component-props.ts:442`) gathers `const x = <arrow|fn>` bindings,
  and the `handlers` map threaded into `transitionsFromResolvedHandler` already
  contains them.
- `transitionsFromAsyncHandler` and the callback-effect handler both require a
  real `ExtractableHandler` whose `.body` is a `ts.Block`; they call
  `lineAndColumn(source, expression)` on it. They cannot be fed a synthesized
  block (synthetic nodes have `pos/end = -1`; `getStart` throws). This forces the
  refactor in Step 1 (operate on a statement list + a real anchor node) instead
  of synthesizing a wrapper handler.
- Effect recognition for a bare callback-style `mutate(args)` (no `await`, no
  options object) is handled by the callback-effect path
  (`statementHasCallbackEffect`), proven by `Direct.tsx` producing an enqueue.

## Atomic implementation steps

### Step 1 — Extract a statement-list core for async + callback effect extraction

Refactor so effect extraction does not require a real handler wrapper.

1. In `transition/async.ts`, split `transitionsFromAsyncHandler(source, fileName,
   attr, expression, ...)` into:
   - `transitionsFromAsyncStatements(source, fileName, attr, anchor:
     ts.Node, statements: readonly ts.Statement[], setters, component,
     effectApis, asyncOutcomes, locator, adapter, routePatterns, warnings,
     effectOpAliases)` — contains the existing body, but uses `anchor` wherever it
     previously used `expression` for `lineAndColumn`/source anchors, and takes
     `statements` instead of reading `expression.body.statements`.
   - Keep `transitionsFromAsyncHandler` as a thin wrapper: guard
     `ts.isBlock(expression.body)`, then call the new fn with
     `anchor = expression`, `statements = expression.body.statements`.
2. In `transition/callback-effects.ts`, do the analogous split: introduce
   `transitionsFromCallbackEffectStatements(source, fileName, attr, anchor,
   statements, setters, component, effectApis, locator, warnings,
   effectOpAliases)` and make `transitionsFromCallbackEffectHandler` delegate to
   it with the handler block's statements and `anchor = handler`.
3. No behavior change in this step. Existing tests must stay green
   (`pnpm test test/extract/react-hook-form.test.ts`, `pnpm test:e2e` callbacks).

### Step 2 — Implement helper-call flattening over a statement list

Create `src/extract/lang/ts/driver/transition/helper-inline.ts`:

```ts
export interface HelperInlineOptions {
  handlers: Map<string, ExtractableHandler>;
  setters: Map<string, SetterBinding>;
  maxDepth?: number; // default 4
}
export interface FlattenedStatements {
  statements: ts.Statement[];   // real AST nodes spliced from helper bodies
  inlinedHelpers: string[];     // names inlined, for diagnostics
}
export function flattenHandlerHelpers(
  statements: readonly ts.Statement[],
  options: HelperInlineOptions,
  visited?: Set<string>,
  depth?: number,
): FlattenedStatements;
```

Rules (operate on the statement list, preserving order; **reuse real helper-body
AST nodes — never synthesize call/effect nodes**, to keep `lineAndColumn`
working):

- For each statement, detect a **bare helper-invocation statement**: an
  `ExpressionStatement` whose expression is `call`, `await call`, or
  `void call`, where `call.expression` is an identifier present in
  `options.handlers` (a local helper) and **not** present in `setters`.
- Only inline when the helper is a **zero-argument** helper whose body is a
  `ts.Block` (the supabase shape). Fixed-argument helpers are deferred (see
  Risks): if `call.arguments.length > 0`, do **not** inline and leave the
  statement as-is (a later plan can add parameter substitution via locals).
- Replace the invocation statement with the helper block's statements
  (`helper.body.statements`), recursively flattened with `depth + 1` and a
  `visited` set keyed by helper identifier to break cycles. If `depth` exceeds
  `maxDepth` or the helper is already in `visited`, leave the original statement
  unchanged.
- A trailing `return <expr>;` inside an inlined helper body is dropped if `<expr>`
  is `void`/undefined-returning (e.g. `return toast.error(...)`); otherwise the
  helper is not a void action and is left un-inlined (do not attempt to thread a
  return value in this plan).
- Non-invocation statements (including `if`, loops, `try`) pass through
  unchanged in this plan — branch bodies are NOT descended into here (that is
  plan 06's path enumeration, which calls `flattenHandlerHelpers` per path).

Add unit coverage in a new `test/extract/handler-helper-inline.test.ts` that
parses small sources and asserts the flattened statement kinds (e.g. a helper
body's `restartProject({ ref })` ExpressionStatement appears in place of
`await requestProjectRestart()`).

### Step 3 — Wire flattening into the handler resolver

In `transitionsFromResolvedHandler`
(`transition/handler-resolution.ts`):

1. Immediately after computing `summaryOptions` and before the async dispatch,
   when `ts.isBlock(handler.body)`, compute
   `const flat = flattenHandlerHelpers(handler.body.statements, { handlers,
   setters })`.
2. If `flat.inlinedHelpers.length > 0`, run the new statement-list cores from
   Step 1 against `flat.statements` with `anchor = node` (the JSX attribute, a
   real node):
   - `transitionsFromAsyncStatements(...)` — for awaited effects surfaced by
     inlining (async helper whose body awaits an effect API).
   - the callback-effect statement core — for bare `mutate(args)` surfaced by
     inlining (the supabase `restartProject({ ref })` case).
   Prefer async results when non-empty, else callback results, mirroring the
   existing precedence in `transitionsFromResolvedHandler`.
3. Apply `disabledGuard` via `applyParsedGuard` to the produced transitions, as
   the existing branches do.
4. If inlining produced transitions, return them. Otherwise fall through to the
   existing (non-inlined) logic unchanged. This guarantees pure additive
   behavior: handlers that already extract are untouched (no helper inlined ⇒
   `inlinedHelpers` empty ⇒ original code path).
5. Ensure early-return guards inside the inlined helper body (e.g.
   `if (!canRestartProject) return toast.error(...)`) are handled: the async
   core already calls `peelPreAwaitGuards`; the callback core already calls its
   guard peeler. Confirm via test that the guard becomes a pre-guard / is
   dropped as a no-effect early-exit rather than blocking extraction. If the
   callback core does not peel a leading `if (...) return;`, add that peel using
   the existing `parseGuardExpression` helper (mirror `peelPreAwaitGuards`).

## Tests to add or update

- `test/extract/handler-helper-inline.test.ts` (new):
  - Unit: `flattenHandlerHelpers` splices a zero-arg helper body in place of
    `await helper()` and `helper()`; leaves fixed-arg helper calls untouched;
    breaks recursion on a self-referential helper; respects `maxDepth`.
- `test/extract/handler-effect-indirection.test.ts` (new), driven by
  `extractReactSourceTransitions(source, { effectApis: new Set([...]) })`
  (pattern from `test/extract/react-hook-form.test.ts`):
  - `onConfirm={async () => { await requestProjectRestart() }}` with
    `requestProjectRestart = () => { restartProject({ ref }) }` and
    `{ mutate: restartProject } = useProjectRestartMutation()` ⇒ a transition
    with an `enqueue` op `useProjectRestartMutation` exists, plus paired
    env `*.success` (and `*.error` if outcome configured).
  - `onClick={() => { req() }}` (callback indirection, no await) ⇒ enqueue.
  - Helper that performs a `setState` write ⇒ the corresponding `assign`
    transition appears.
  - Negative: an imported (non-local) helper call ⇒ unchanged (still
    `no-extractable-effect`), confirming we only inline local helpers.
- Keep `test/extract/react-hook-form.test.ts` green (regression guard).

## Verification

```bash
pnpm test test/extract/handler-helper-inline.test.ts \
          test/extract/handler-effect-indirection.test.ts \
          test/extract/react-hook-form.test.ts
pnpm architecture        # no new illegal cross-layer imports
pnpm phase7              # checker/extraction semantics parity
pnpm fix                 # biome lint + format
pnpm test                # fast tier stays green & < ~30s
```

Manual repro against the temp fixtures used during triage (regenerate if absent):

```bash
# Helper-wrapped mutate must now enqueue (was missing before this plan)
node dist/cli/cli.js extract /tmp/modtest/Helper.tsx \
  --effect-api useProjectRestartMutation --out /tmp/modtest/Helper.model.json
node -e 'const m=require("/tmp/modtest/Helper.model.json");
  console.log(m.transitions.some(t=>JSON.stringify(t.effect).includes("\"enqueue\"")
    && JSON.stringify(t.effect).includes("useProjectRestartMutation")))'  # expect: true
```

## Acceptance criteria

- `flattenHandlerHelpers` inlines local zero-arg helper invocation statements,
  recursing with cycle + depth guards, leaving all other statements unchanged.
- A handler that calls/`await`s a local helper performing an effect-API
  `mutate`/awaited call produces the same enqueue transition family as the inline
  form; `/tmp/modtest/Helper.tsx` and `AwaitHelper.tsx` extract an
  `useProjectRestartMutation` enqueue.
- Helper-reached `useState` writes produce the corresponding `assign`
  transitions.
- No regression: handlers that already extracted (no local helper inlined) are
  byte-for-byte unchanged in output; all prior tests pass.
- `pnpm architecture`, `pnpm phase7`, `pnpm fix`, `pnpm test` all pass.

## Risks, ambiguities, and stop conditions

- **Synthetic-node positions.** Do NOT build wrapper handlers/blocks with
  `ts.factory`; splice real helper-body nodes and pass the JSX attribute as the
  anchor. If any extractor still needs a real `.body`, refactor it to take a
  statement list (Step 1) rather than synthesizing one. **Stop and reassess** if
  a downstream consumer cannot be refactored off a real `ExtractableHandler`.
- **Fixed-arg helpers.** Deferred deliberately. `requestDatabaseRestart` in
  supabase is zero-arg, so the issue's primary case is covered. If a target needs
  argument substitution, extend Step 2 using the existing `valueExpr`
  arg-binding approach from `helperSummariesFromCall` (locals threading), not
  AST rewriting. Note this as a follow-up, do not expand scope here.
- **Double extraction.** Guard against emitting both an inlined and a
  non-inlined transition for the same handler: only run the inlined cores when
  `inlinedHelpers.length > 0`, and `return` early on success.
- **Helpers that are also setters/effect APIs.** Exclude any identifier present
  in `setters` or `effectApis` from inlining (it is already handled by the
  effect/setter detectors).
- **Stop condition:** if wiring inlining changes any existing extraction golden
  output (transition ids/effects) for handlers that do not inline a helper,
  treat it as a defect in the gating condition and fix before proceeding.
