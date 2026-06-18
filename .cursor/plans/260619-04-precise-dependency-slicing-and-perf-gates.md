# Precise Dependency Slicing and Perf Gates

## Goal

Replace ad hoc closure rules with a precise dependency graph for property slicing, then add perf/conformance gates that prevent route-local, pending-queue, and wide-domain regressions from returning.

This follows the immediate mount-scope fix and pending-domain narrowing. It is the longer-term algorithmic cleanup: slicing should be graph reachability over typed dependency edges, not repeated scans that accidentally conflate guard dependencies with semantic state dependencies.

## Non-goals

- Do not implement full LTL, Buchi automata, Tarjan, or Kosaraju for checker liveness in this plan.
- Do not rewrite the Rust search engine.
- Do not remove existing property kinds.
- Do not make all hard cases fall back to full slices.
- Do not add flaky wall-clock-only tests.

## Current-State Findings

- `src/check/slicing/slice-model.ts` computes dependency closure with repeated scans over all transitions and vars.
- Mount guard handling is embedded directly in that closure.
- Pending queue dependencies are partly represented separately, but pending queue var retention is still determined through generic read/write closure and step-fact helpers.
- Diagnostics are useful but mostly generated after slicing rather than from a first-class dependency graph.
- Existing tests already cover many focused cases, but there is no real-app-like state-space economy fixture for the exact slowdown pattern.

## Exact File Paths and Relevant Symbols

- `src/check/slicing/slice-model.ts`
  - `collectPropertyDependencyRequest`
  - `sliceModelForProperty`
  - `sliceModelForTargetedStepProperty`
  - `collectPendingQueueDependencies`
  - `finalizeSlicedTransitions`
  - `addMountGuardVarsForNeededMountLocals`
- `src/check/slicing/contributors.ts`
  - `compareModelEconomics`
- `src/check/check-model.ts`
  - `checkModelSliced`
  - slice grouping key
  - slice summaries
- `src/check/types.ts`
  - `SliceSummary`
  - `MountScopeDependency`
  - `PendingQueueDependency`
- `test/check/slicing-parity.test.ts`
- `test/checker/checker.test.ts`
- `src/cli/features/check/command.test.ts`
- `test/conformance/fixtures/`
- `test/conformance/matrix.json`

## Existing Patterns to Follow

- Keep low-level slice tests separate from CLI report tests.
- Use deterministic arrays and sorted IDs for diagnostics.
- Existing conformance fixtures use small app directories plus `fixture.json`.
- Existing checker tests compare sliced and unsliced verdicts for parity-sensitive cases.

## Atomic Implementation Steps

1. Design an internal dependency graph representation.
   - Nodes:
     - state var IDs,
     - transition IDs,
     - mount guard facts,
     - pending queue role facts,
     - step fact requirements.
   - Edge kinds:
     - `property-read`
     - `transition-writes-var`
     - `transition-reads-var`
     - `transition-effect-read`
     - `mount-guard-read`
     - `enabled-transition`
     - `targeted-step`
     - `pending-step-fact`
   - Keep this internal to `src/check/slicing`.

2. Build graph indexes once per model.
   - Pre-index transitions by written var, read var, ID, class, and `triggeredBy`.
   - Pre-index mount-local vars by ID and mount guard reads.
   - Pre-index pending queue role vars.
   - Use the indexes from both state and targeted-step slicing.

3. Reimplement state property closure using graph reachability.
   - Seed with property state reads and enabled transition dependencies.
   - Add mount guard reads only for retained mount-local vars.
   - Add transitions that write retained vars.
   - Add transition reads/effect reads.
   - Avoid reverse sibling expansion from guard vars to all mount locals.

4. Reimplement targeted-step closure using the same graph.
   - Seed with target transition IDs, pre/post reads, enabled transition IDs, and step facts.
   - Keep target transitions even if they do not write a retained property var.
   - Add internal triggered transitions only when their trigger and writes are relevant to retained execution vars.

5. Make pending queue slicing explicit.
   - Retain pending queue vars only when:
     - the property reads them,
     - a retained transition reads them as part of a retained dependency,
     - a step fact observes op/resolved/args/continuation,
     - a retained transition's semantics requires enqueue/dequeue to preserve the property.
   - Otherwise strip enqueue/dequeue effects as today.

6. Preserve and improve diagnostics.
   - Derive `mountScopeDependencies` and `pendingQueueDependencies` from graph edge reasons.
   - Keep existing report fields stable unless tests show a clearer deterministic replacement.

7. Add state-space economy fixtures.
   - Add a small synthetic checker fixture mirroring Coffee `_customer/home`:
     - many route-local siblings guarded by `sys:route`,
     - wide product domain,
     - pending queue,
     - a property over one local var.
   - Assert slice summary prunes wide sibling vars and pending queue.
   - Assert retained/pruned bit counts show meaningful reduction.

8. Add performance gate without relying on wall-clock.
   - Prefer structural budgets:
     - max retained vars,
     - max retained transitions,
     - `sys:pending` absent where unrelated,
     - pruned top contributor includes the wide var.
   - Add optional canary budget if existing canary infrastructure supports it.

## Per-Step Files to Edit

- Step 1: new `src/check/slicing/dependency-graph.ts` or equivalent internal helper
- Step 2: `src/check/slicing/dependency-graph.ts`, `src/check/slicing/slice-model.ts`
- Step 3: `src/check/slicing/slice-model.ts`
- Step 4: `src/check/slicing/slice-model.ts`
- Step 5: `src/check/slicing/slice-model.ts`
- Step 6: `src/check/types.ts`, `src/check/check-model.ts`, `src/cli/features/check/command.test.ts` if diagnostics shape changes
- Step 7: `test/checker/checker.test.ts` or `test/check/slicing-parity.test.ts`
- Step 8: `test/conformance/fixtures/`, `test/conformance/matrix.json`, or `tools/shared-gates/*` only if existing infrastructure fits

## Acceptance Criteria

- Existing sliced/unsliced parity tests pass.
- Route-local sibling vars do not enter a slice only because they share a mount guard variable.
- Pending queues are retained only for explicit async dependencies.
- Wide unrelated product domains are reported as pruned contributors in slice economics.
- Slice grouping in `checkModelSliced` still groups properties with identical sliced models deterministically.
- No new broad full-slice fallback is introduced for supported property kinds.

## Tests to Add or Update

- Add dependency graph unit tests if a new helper is introduced.
- Add route-local wide-sibling fixture.
- Add pending queue explicit-retention tests for:
  - unrelated state property,
  - targeted step with opId/resolved,
  - op arg observation,
  - custom pending queue role ID.
- Add or update CLI slice economics report test for pruned wide vars.

## Verification Commands

```bash
rtk pnpm test test/check/slicing-parity.test.ts
rtk pnpm test test/checker/checker.test.ts
rtk pnpm test src/cli/features/check/command.test.ts
rtk pnpm test test/conformance/matrix.test.ts
rtk pnpm architecture
rtk pnpm typecheck
```

Optional full semantic regression:

```bash
rtk pnpm phase7
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if graph-based slicing changes verdicts versus unsliced checks for existing parity fixtures.
- Stop and report if a property kind has unclear dependency semantics; keep its current behavior rather than guessing.
- Stop and report if pending queue stripping can hide a transition whose enqueue/dequeue order is observable by the property.
- Do not add wall-clock assertions that will be flaky in CI.
- Do not mix extraction summarization changes into this checker slicing plan.

