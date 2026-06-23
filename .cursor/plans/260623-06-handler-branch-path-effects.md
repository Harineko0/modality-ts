# 260623-06 — Handler branch-path effect extraction (Gap A of custom-wrapper vacuous-safety)

Fixes the second of two root causes behind
`docs/_issues/custom-wrapper-handlers-unextractable-vacuous-safety.md`.
**Depends on `260623-05` (helper inlining + statement-list cores). Land 05 first.**

## Goal

Extract effect-API enqueues and `useState` writes that are **nested inside
`if` / `else if` / `else` branches** of a handler, emitting one guarded user
transition (family) per branch path. Combined with plan 05's helper inlining,
this makes the Supabase `RestartServerButton.onConfirm` handler model both
restart mutations:

```tsx
onConfirm={async () => {
  if (serviceToRestart === 'project') {
    await requestProjectRestart()        // -> restartProject({ ref })
  } else if (serviceToRestart === 'database') {
    await requestDatabaseRestart()       // -> restartProjectServices({ ... })
  }
}}
```

Must produce two guarded enqueue transition families:
`useProjectRestartMutation` guarded by `serviceToRestart == 'project'` and
`useProjectRestartServicesMutation` guarded by `serviceToRestart == 'database'`,
each with paired env success/error transitions.

This is verified broken today: `/tmp/modtest/Branch.tsx` (effect-API call inside
`if`/`else if`, **no helper**) yields a transition with `effect.kind === "if"`
and **no `enqueue`** inside — branch-nested effect-API calls are dropped.

## Non-goals

- Helper-call inlining itself (plan 05).
- `switch` statements, ternary-driven effect dispatch, and loops over branches.
  Only `if`/`else if`/`else` chains in this plan.
- Exhaustive path explosion handling beyond a bounded cap with a caveat
  (see Risks).
- Overlay/checker safety nets (out of triage scope).

## Current-state findings

- `transitionsFromResolvedHandler`
  (`src/extract/lang/ts/driver/transition/handler-resolution.ts`) handles
  branches only via `conditionalTransitionFromHandler`
  (`handler-sequential.ts:202`), which: requires the block to be exactly one
  `if` statement, and lowers branches with `singleSetterEffect` **only** — it
  cannot represent effect-API enqueues (which require paired env continuation
  transitions, not a single `EffectIR`). `else if` chains and effect-bearing
  branches fall through to `sequentialTransitionFromHandler`.
- `sequentialTransitionFromHandler` → `summarizeHandlerStatements`
  (`statement-driver.ts`) lowers an `if` to an `if` `EffectIR` whose branches
  contain only synchronous summaries (setter writes). A branch-nested callback
  `mutate(args)` is not recognized there, so the produced `if` effect has empty
  writes / no enqueue (the `/tmp Branch.tsx` symptom).
- The async core (`async.ts`) and callback core (`callback-effects.ts`) only
  scan **top-level** statements (and a top-level `try`), never `if` branches.
  They already correctly model a *linear* statement sequence containing an
  awaited or callback-style effect (proven by `/tmp Direct.tsx`).
- `applyParsedGuard(transitions, parsed)`
  (`transition/guards.ts:13`) ANDs a `ParsedGuard.expr` onto every **user**
  transition's guard (and merges reads), leaving `env` transitions untouched —
  exactly the primitive needed to attach a branch condition to a path's
  start/user transitions while sharing env continuations.
- `parseGuardExpression` / `combineParsedGuards` (guards.ts) already parse
  conditions like `serviceToRestart === 'project'` into `ParsedGuard`.
- Plan 05 introduces `transitionsFromAsyncStatements` /
  `transitionsFromCallbackEffectStatements` (statement-list cores taking a real
  anchor node) and `flattenHandlerHelpers`. This plan builds on both.

## Atomic implementation steps

### Step 1 — Guarded path enumeration

Create `src/extract/lang/ts/driver/transition/branch-paths.ts`:

```ts
export interface GuardedPath {
  guard?: ParsedGuard;                 // accumulated branch conditions
  statements: readonly ts.Statement[]; // linear path, real AST nodes
}
export interface PathEnumOptions {
  setters: Map<string, SetterBinding>;
  initialLocals?: Map<string, BoundExpr>;
  maxPaths?: number; // default 8
}
export function enumerateGuardedPaths(
  statements: readonly ts.Statement[],
  options: PathEnumOptions,
): { paths: GuardedPath[]; truncated: boolean };
```

Behavior:

- Walk the statement list left to right, accumulating a shared prefix of
  non-`if` statements.
- When an `if` chain is encountered as a statement, fork: for each arm
  (`then`, each `else if`, optional final `else`), produce a branch with the
  arm's body statements (a `Block` is flattened to its statements; a single
  statement is wrapped in a one-element list) and the arm's condition parsed via
  `parseGuardExpression`. `else if` conditions accumulate as
  `combineParsedGuards([not(prevConds...), thisCond])`; a final `else` is
  `combineParsedGuards(prevConds.map(not))`. If a chain has no `else`, also emit
  an implicit "no branch taken" path carrying the negation of all conditions and
  the post-`if` statements only.
- Statements **after** the `if` chain are appended to every forked path
  (continuation), then enumeration continues (nested/sequential `if`s multiply
  paths).
- A condition that `parseGuardExpression` cannot represent yields a path with
  `guard = undefined` (havoc-permissive) rather than dropping the path.
- Cap total paths at `maxPaths`; if exceeded, stop forking, return
  `truncated: true`, and the caller emits a caveat (do not silently drop edges).

Unit-test in `test/extract/branch-paths.test.ts`.

### Step 2 — Per-path effect extraction in the resolver

In `transitionsFromResolvedHandler`, add a branch-path stage. Ordering relative
to plan 05's inlining stage:

1. Keep the existing fast paths (async/callback on the raw top-level statements,
   conditional/sequential/setter). These already handle linear bodies and simple
   single-`if` setter conditionals; do not disturb them.
2. Add a new stage that runs **only when** the handler block contains a branch
   that encloses an effect (guard with a small predicate
   `branchEnclosesEffect(statements, effectApis, setters, handlers)` — true if
   any `if`-branch body, after `flattenHandlerHelpers`, contains an awaited or
   callback-style effect-API call or a setter write). This predicate prevents
   the new stage from altering handlers that the existing paths already cover.
3. For each `GuardedPath` from `enumerateGuardedPaths(handler.body.statements,
   ...)`:
   a. `flattenHandlerHelpers(path.statements, { handlers, setters })` (plan 05).
   b. Run `transitionsFromAsyncStatements(...)`; if empty, run
      `transitionsFromCallbackEffectStatements(...)`; if empty, summarize setter
      writes for the path (reuse `summarizeStatements` → build an assign/seq
      user transition, mirroring `sequentialTransitionFromHandler`).
   c. `applyParsedGuard(pathTransitions, combineParsedGuards([disabledGuard,
      path.guard]))` to attach the branch condition (and the JSX `disabled`
      guard) to the path's user transitions. Env continuation transitions are
      returned untouched by `applyParsedGuard`.
4. **Union and dedupe** across paths by transition `id`: paths that reach the
   same effect op share `*.success` / `*.error` env transitions (same id) — keep
   one copy. Distinct branch enqueues get distinct ids already because the op
   differs; when two branches enqueue the **same** op under different guards,
   disambiguate the start transition id with the path index (e.g.
   `${base}.start#0` / `#1`) so both guarded starts survive, while the shared env
   continuation keeps the canonical id.
5. If the branch-path stage produced transitions, return them (with the
   truncation caveat if any). Otherwise fall through to existing behavior.

### Step 3 — Caveat for truncated / unrepresentable branch paths

- Reuse `unextractableHandlerCaveat` infrastructure (`driver/caveats.ts`) to add
  a `branch-paths-truncated` reason when `enumerateGuardedPaths` returns
  `truncated: true`, anchored at the handler. The handler still emits the paths
  it did enumerate (partial model), but the caveat records the imprecision so the
  extraction report does not look clean. Mirror the existing warning+caveat shape
  used in `react-source-jsx-handlers.ts`.

## Tests to add or update

- `test/extract/branch-paths.test.ts` (new): `enumerateGuardedPaths` over
  single `if`, `if/else`, `if/else if/else`, nested `if`, and a chain exceeding
  `maxPaths` (asserts `truncated`).
- `test/extract/handler-branch-effects.test.ts` (new), via
  `extractReactSourceTransitions`:
  - `onConfirm={async () => { if (k==='a') restartA({...}) else if (k==='b')
    restartB({...}) }}` (no helper) ⇒ two enqueue families, guarded by
    `k=='a'` / `k=='b'` respectively.
  - Same with `await helperA()` / `await helperB()` (composition with plan 05)
    ⇒ identical result.
  - Branch with `setState` writes only ⇒ guarded assign transitions per arm
    (replaces/supersedes the `conditionalTransitionFromHandler` single-if case;
    confirm ids/guards are still correct or update the golden expectation).
  - `maxPaths` exceeded ⇒ partial transitions + `branch-paths-truncated` caveat.
- `test/extract/react-hook-form.test.ts` and any existing conditional-handler
  golden tests must stay green or be updated intentionally (note the diff in the
  PR description).

## Verification

```bash
pnpm test test/extract/branch-paths.test.ts \
          test/extract/handler-branch-effects.test.ts \
          test/extract/handler-effect-indirection.test.ts \
          test/extract/react-hook-form.test.ts
pnpm architecture
pnpm phase7
pnpm fix
pnpm test
```

End-to-end against the real issue repro (Supabase Studio present at
`/Users/hari/proj/supabase/apps/studio`):

```bash
cd /Users/hari/proj/supabase/apps/studio
node /Users/hari/proj/modality-ts/dist/cli/cli.js extract \
  components/interfaces/Settings/General/Infrastructure/RestartServerButton.tsx \
  --effect-api useProjectRestartMutation \
  --effect-api useProjectRestartServicesMutation \
  --out /tmp/restart.model.json
node -e 'const m=require("/tmp/restart.model.json");
  const ops=new Set();
  for(const t of m.transitions){const s=JSON.stringify(t.effect);
    if(s.includes("\"enqueue\"")){for(const o of ["useProjectRestartMutation","useProjectRestartServicesMutation"]) if(s.includes(o)) ops.add(o);}}
  console.log("enqueued ops:", [...ops]);'   # expect BOTH ops present
```

Also re-run the issue's `ResetDbPasswordDialog` and `ApiAuthorization.Valid`
repros and confirm their `*CanBeEnqueued` reachability witnesses are **no longer
vacuous** (rebuild `dist` with `pnpm build` first if running the built CLI).

## Acceptance criteria

- `enumerateGuardedPaths` expands `if`/`else if`/`else` chains (incl. nested) into
  guarded linear paths with correct accumulated conditions and a bounded
  `maxPaths` cap.
- Effect-API calls and `useState` writes nested in branches become guarded user
  transitions; `/tmp/modtest/Branch.tsx` extracts an enqueue.
- `RestartServerButton.onConfirm` extraction yields enqueue transition families
  for **both** `useProjectRestartMutation` and `useProjectRestartServicesMutation`,
  each guarded by the corresponding `serviceToRestart` value.
- After plans 05+06, the issue's safety properties
  (`cannotEnqueueProjectRestartWhileAnyRestartPending`, etc.) are evaluated
  against a model that contains the enqueue edges, and the paired liveness
  witnesses (`projectRestartCanBeEnqueued`, `databaseRestartCanBeEnqueued`) are
  reachable (non-vacuous).
- Truncated enumeration surfaces a `branch-paths-truncated` caveat rather than
  silently dropping edges.
- `pnpm architecture`, `pnpm phase7`, `pnpm fix`, `pnpm test` all pass; no
  unintended changes to non-branch handler output.

## Risks, ambiguities, and stop conditions

- **Path explosion.** Nested/sequential `if`s multiply paths; the `maxPaths` cap
  + caveat bounds blow-up. If a real target needs more than the cap, prefer
  raising the cap with a guard over removing it. **Stop** if enumeration causes
  extraction runtime to regress materially on `pnpm test:e2e` (watch the
  Supabase example timings).
- **Shared env continuations.** Two branches enqueuing the same op must share one
  `*.success`/`*.error` env transition while keeping distinct guarded starts.
  Get the id-dedupe rule (Step 2.4) right; a duplicate env id will be rejected by
  model validation. Add a focused test for same-op-two-branches.
- **Interaction with `conditionalTransitionFromHandler`.** The new stage may
  supersede the old single-`if` setter conditional. Decide explicitly: either
  route single-`if` setter-only handlers through the new path enumeration
  (preferred — one mechanism) and delete `conditionalTransitionFromHandler`, or
  keep the old fast path and gate the new stage to effect-bearing branches only.
  Pick one; do not leave two overlapping mechanisms that can both fire for the
  same handler. Per project principles (fundamental over stopgap), prefer
  unifying on path enumeration if golden tests can be updated cleanly.
- **Guard representability.** Conditions that don't parse become `undefined`
  (unguarded) paths — acceptable over-approximation; ensure that does not
  silently merge two arms into one transition with `true` guard when they enqueue
  the same op (would mask a double-submit). Prefer distinct guarded starts even
  when a guard is `undefined`.
- **Stop condition:** if attaching branch guards via `applyParsedGuard` mutates
  env transitions or drops reads, fix `applyParsedGuard` usage (env transitions
  must remain shared/untouched) before continuing.
