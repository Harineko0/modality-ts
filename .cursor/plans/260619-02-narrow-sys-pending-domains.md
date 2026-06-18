# Narrow sys:pending Domains

## Goal

Shrink `sys:pending` domains to concrete async operations and continuations that can actually be enqueued by the extracted model. This reduces checker state space and makes pending-queue slicing more effective.

## Non-goals

- Do not change the `EffectIR` enqueue/dequeue schema.
- Do not remove support for manually configured effect APIs.
- Do not change Rust pending queue semantics.
- Do not introduce framework-specific pending logic; keep the pending queue synthesis generic.

## Current-State Findings

- `src/cli/features/extract/system-vars.ts` synthesizes `sys:pending`.
- `pendingVars()` seeds `opValues` with every `effectApi`.
- It also adds synthetic continuations for every effect API:
  - `App.onClick.${canonical}.cont`
  - `App.onSubmit.${canonical}.cont`
  - `App.onChange.${canonical}.cont`
- Concrete enqueues already carry precise `op` and `continuation` values.
- In Coffee `_customer/home`, the pending domain included unrelated router continuations and operations even though only one concrete order submission enqueue mattered for the target.

## Exact File Paths and Relevant Symbols

- `src/cli/features/extract/system-vars.ts`
  - `synthesizeSystemVars`
  - `pendingVars`
  - `enqueueOps`
  - `pendingArgDomain`
  - `mergeArgDomains`
- `src/cli/features/extract/command.ts`
  - call to `synthesizeSystemVars`
  - construction of `effectApis`
- `src/cli/features/extract/command.run.test.ts`
  - configured bounds and pending queue assumptions
- `src/cli/features/extract/command.run.plugins.test.ts`
  - effect API pending tests
- `src/cli/features/extract/command.run.domains.test.ts`
  - router/action pending domain tests
- `src/cli/features/extract/next-extract.test.ts`
  - Next async pending tests

## Existing Patterns to Follow

- Tests inspect `sys:pending.domain.inner.fields.opId.values` and `.continuation.values`.
- Existing extraction tests build small source snippets and call `runExtractCommand`.
- Keep deterministic sorting for enum values.
- Keep `noop` fallback when no pending operations exist.

## Atomic Implementation Steps

1. Add failing tests for concrete continuation narrowing.
   - Use a fixture with `effectApis: ["api.save"]` but only one concrete enqueue.
   - Assert `opId.values` contains the concrete canonical op.
   - Assert `continuation.values` contains only the concrete enqueue continuation.
   - Assert default `App.onClick.*`, `App.onSubmit.*`, and `App.onChange.*` continuations are absent when concrete enqueues exist.

2. Change `pendingVars()` to prefer concrete enqueues.
   - Build `enqueues` first.
   - If `enqueues.length > 0`, derive `opValues`, `continuationValues`, and `argFields` from concrete enqueues only.
   - If `enqueues.length === 0`, preserve the existing fallback behavior for configured effect APIs or `noop`.

3. Preserve configured effect API discovery without bloating pending items.
   - Keep `effectApis` available for extraction/reporting.
   - Do not automatically add effect API ops to `sys:pending` when no transition enqueues them, except in the explicit fallback case.

4. Update tests that intentionally expected synthetic continuations.
   - If a test expects `App.onClick.api.submitOrder.cont`, rewrite the source fixture so it actually creates that concrete enqueue, or update the expectation to the concrete continuation emitted by extraction.
   - Do not delete coverage for effect API argument typing; assert the arg domain from the concrete enqueue instead.

5. Verify model validation still accepts pending queue domains.
   - Ensure `opId` and `continuation` remain enum domains.
   - Ensure `maxLen` still matches `bounds.maxPending`.

## Per-Step Files to Edit

- Step 1: `src/cli/features/extract/command.run.plugins.test.ts`, possibly `src/cli/features/extract/command.run.domains.test.ts`
- Step 2: `src/cli/features/extract/system-vars.ts`
- Step 3: `src/cli/features/extract/command.ts` only if call-site data must be clarified
- Step 4: existing pending-domain tests listed above
- Step 5: `test/kernel/kernel.test.ts` only if validation expectations need a new edge case

## Acceptance Criteria

- `sys:pending` contains only concrete enqueue continuations when concrete enqueues exist.
- Concrete async operations still produce resolve transitions that can dequeue pending items.
- Tests for SWR, router, Next, and custom effect APIs still pass.
- Pending queue state-space contribution decreases in extraction reports for real apps where default continuations were previously included.

## Tests to Add or Update

- Add a test proving synthetic continuations are absent when concrete enqueues exist.
- Add or update a test proving fallback `noop` or configured effect API behavior when no enqueues exist.
- Keep tests for argument domain inference from enqueued args.

## Verification Commands

```bash
rtk pnpm test src/cli/features/extract/command.run.plugins.test.ts
rtk pnpm test src/cli/features/extract/command.run.domains.test.ts
rtk pnpm test src/cli/features/extract/next-extract.test.ts
rtk pnpm test src/cli/features/extract/command.run.test.ts
rtk pnpm typecheck
```

Optional real-app probe:

```bash
rtk proxy node /Users/hari/proj/modality-ts/dist/cli/cli.js extract app/_customer/home.tsx --out /tmp/customer.model.json --app-model /tmp/customer.props.ts
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if any adapter depends on configured effect APIs creating pending op values without a concrete enqueue transition. That adapter should emit an explicit enqueue or expose a generic pending fallback intentionally.
- Stop and report if resolve transitions can reference an op not present in the pending queue domain after narrowing.
- Do not fix failures by reintroducing all default continuations globally.

