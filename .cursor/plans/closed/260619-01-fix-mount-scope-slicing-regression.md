# Fix Mount-Scope Slicing Regression

## Goal

Restore property slicing so route-local mount guards do not pull every sibling route-local variable into every slice. A property that reads one mount-local variable should retain that variable and the guard variables needed to interpret its mount scope, but it must not retain unrelated mount-local state only because it shares the same `sys:route` or location-current guard.

This is the first and highest-priority slowdown fix because Coffee `_customer/home` currently slices every property to almost the full model (`21/22` vars and `20/20` transitions), keeping `sys:pending` and wide product domains in every slice.

## Non-goals

- Do not change Rust checker search semantics.
- Do not change extraction output.
- Do not change the public property API.
- Do not remove mount-scope diagnostics; keep reporting why guard variables are retained.
- Do not broaden slicing for opaque or unsupported properties.

## Current-State Findings

- `src/check/slicing/slice-model.ts` uses `addMountGuardVarsForNeededMountLocals()` from both state slices and targeted-step slices.
- The first loop in `addMountGuardVarsForNeededMountLocals()` correctly adds guard reads for already-needed mount-local vars.
- The second loop then scans all mount-local vars and adds any var whose guard reads an already-needed var.
- For route-local scopes, once `sys:route` is needed for one selected variable, the second loop adds every mount-local var guarded by `sys:route`.
- This defeats slicing for route models and indirectly retains `sys:pending`, wide fields, and unrelated transitions.

## Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `sliceModelForProperty`
  - `sliceModelForTargetedStepProperty`
  - `addMountGuardVarsForNeededMountLocals`
  - `recordMountScopeDependency`
  - `finalizeMountScopeDependencies`
  - `finalizeSlicedTransitions`
- `test/check/slicing-parity.test.ts`
  - existing mount guard and unrelated-var slice tests
- `test/kernel/mounted-scope.test.ts`
  - mount-local dependency diagnostics
- `test/checker/checker.test.ts`
  - route-local slicing and pending queue pruning tests around focused noise models
- `src/cli/features/check/command.test.ts`
  - check report slice economics and mount-scope diagnostics

## Existing Patterns to Follow

- Keep slice tests in `test/check/slicing-parity.test.ts` for low-level slicing behavior.
- Keep full checker parity tests in `test/checker/checker.test.ts` when a behavioral invariant matters.
- Keep report shape tests in `src/cli/features/check/command.test.ts`.
- Existing tests assert both retained vars and pruned vars; follow that style.

## Atomic Implementation Steps

1. Add a failing low-level slice fixture.
   - Model:
     - `sys:route` global location-current enum with `"/a"` and `"/b"`.
     - `local:a.flag`, `local:a.noise`, and `local:a.wide` all mount-local with the same `sys:route == "/a"` guard.
     - `sys:pending` global pending queue.
     - one transition writing `local:a.flag`.
     - one transition writing `local:a.noise`.
     - one async transition writing `sys:pending`.
   - Property reads only `local:a.flag`.
   - Assert slice keeps `local:a.flag` and `sys:route`.
   - Assert slice drops `local:a.noise`, `local:a.wide`, and `sys:pending`.
   - Add this in `test/check/slicing-parity.test.ts` or near the existing route-local tests in `test/checker/checker.test.ts`.

2. Replace the reverse sibling expansion in `addMountGuardVarsForNeededMountLocals`.
   - Keep adding guard reads for mount-local vars that are already needed.
   - Do not add every mount-local var whose guard references an already-needed guard var.
   - If there is an existing soundness case that requires adding a mount-local sibling due only to a guard read, encode that case explicitly before changing behavior.

3. Preserve diagnostics for selected mount locals.
   - Continue recording `retainedBecause: ["property-read"]` or similar for seeded mount-local vars.
   - Do not record diagnostics for sibling vars that are no longer retained.

4. Verify pending pruning still works.
   - Existing tests such as `prunes pending queue from state-only property slices unrelated to async` should continue to pass.
   - Add an assertion to the new fixture that `finalizeSlicedTransitions` strips enqueue/dequeue effects when the pending queue is not retained.

5. Add a CLI report regression test only if low-level diagnostics change.
   - If `mountScopeDependencies` output changes for existing tests, update the expected output only when the new output is more precise and still explains retained guard vars.

## Per-Step Files to Edit

- Step 1: `test/check/slicing-parity.test.ts` or `test/checker/checker.test.ts`
- Step 2: `src/check/slicing/slice-model.ts`
- Step 3: `src/check/slicing/slice-model.ts`, `src/cli/features/check/command.test.ts` if needed
- Step 4: `test/checker/checker.test.ts`
- Step 5: `src/cli/features/check/command.test.ts`

## Acceptance Criteria

- A property reading one route-local var keeps only that var plus required guard vars.
- Sibling mount-local vars sharing the same route guard are pruned unless a retained transition reads/writes them.
- `sys:pending` is pruned from route-local property slices that do not observe async step facts and do not depend on async transitions.
- Sliced and unsliced checker verdicts remain equal for existing parity tests.
- Slice diagnostics still explain retained mount guard vars.

## Tests to Add or Update

- Add a focused route-local sibling pruning test.
- Add or update a pending-pruning assertion for the same fixture.
- Run existing tests around:
  - `test/check/slicing-parity.test.ts`
  - `test/kernel/mounted-scope.test.ts`
  - `test/checker/checker.test.ts`
  - `src/cli/features/check/command.test.ts`

## Verification Commands

```bash
rtk pnpm test test/check/slicing-parity.test.ts
rtk pnpm test test/kernel/mounted-scope.test.ts
rtk pnpm test test/checker/checker.test.ts
rtk pnpm test src/cli/features/check/command.test.ts
rtk pnpm typecheck
```

Optional real-app probe after extracting Coffee:

```bash
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js check .modality/models/app/_customer/home.model.json .modality/models/app/_customer/home.props.ts --max-states 1000 -A
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if an existing test depends on guard-read reverse expansion to retain sibling mount-local vars. That would indicate the current algorithm is encoding a soundness assumption that needs a more precise dependency representation.
- Stop and report if sliced verdicts diverge from unsliced verdicts on existing checker parity tests.
- Stop and report if mount-local diagnostics disappear entirely; they are useful for explaining retained route vars.
- Do not paper over parity failures by forcing `mode: "full"`.

