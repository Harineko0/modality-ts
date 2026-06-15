# Rust Checker Property Reporting

## Goal

Replace executable TypeScript property predicates with serializable property IR that Rust evaluates directly, then emit verdicts, traces, diagnostics, vacuity warnings, and report-compatible results from Rust-owned checker data.

## Non-goals

- Do not support arbitrary JavaScript property predicates.
- Do not evaluate property callbacks in Node during search.
- Do not add framework-specific property constructs.
- Do not compare Rust and TypeScript verdicts.
- Do not preserve compatibility with old `.props.ts` function modules.

## Current-state findings

- `src/core/props/index.ts` currently stores JS functions in `Property`.
- Read inference currently uses function source inspection and recording proxies.
- `src/check/properties/observe.ts` evaluates `always`, `reachable`, and `alwaysStep` predicates during search.
- `src/check/properties/finalize.ts`, `leads-to.ts`, and `reachable-from.ts` finalize graph-dependent properties.
- `src/cli/features/check/command.ts` loads property modules through dynamic import.

## Exact file paths and relevant symbols

- `src/core/ir/types.ts`: add predicate and property artifact IR.
- `src/core/props/index.ts`: property builders.
- `src/core/artifacts/index.ts`: parse property artifacts.
- `src/cli/features/check/command.ts`: property loading.
- `crates/checker/src/property.rs`: property compilation/evaluation.
- `crates/checker/src/step.rs`: step fact extraction.
- `crates/checker/src/trace.rs`: trace reconstruction.
- `crates/checker/src/report.rs`: `CheckResult` serialization.
- `tools/phase7-differential.ts`: TLC differential runner that must exercise the Rust checker.

## Existing patterns to follow

- Keep property kinds: `always`, `reachable`, `alwaysStep`, `reachableFrom`, `leadsToWithin`.
- Reuse `ExprIR` for state predicates where possible.
- Model step predicates over transition metadata and step facts, not framework events.
- Keep CLI report creation in TypeScript if it only wraps the Rust `CheckResult` with trust-ledger data.

## Atomic implementation steps

1. Add serializable predicate and property IR types.

   Files to edit:
   - `src/core/ir/types.ts`
   - `src/core/props/index.ts`

   Implementation:
   - Define `StatePredicateIR` as an alias or wrapper around `ExprIR` returning boolean.
   - Define `StepPredicateIR` with operations for transition ID/class, label kind, enqueue, resolve, navigation, navigated target, op ID, continuation, and op args.
   - Define serializable property variants for `always`, `reachable`, `alwaysStep`, `reachableFrom`, and `leadsToWithin`.
   - Include `name`, `reads`, `enabledTransitions`, and `includeUnmounted` as data fields.
   - Remove function predicate fields from the exported property type.

2. Rewrite property builders around IR.

   Files to edit:
   - `src/core/props/index.ts`

   Implementation:
   - Replace `always(model, predicateFn, options)` style builders with builders that accept predicate IR.
   - Provide small helpers for common predicate IR construction, such as `read`, `lit`, `eq`, `neq`, `and`, `or`, `not`, and `enabled`.
   - Make `reads` explicit or derive it by walking predicate IR; do not inspect function source.
   - Make `enabled(model, transitionId)` return predicate IR, not a callback.
   - Delete recording proxy and source-string inference code.

3. Change CLI property loading to artifact loading.

   Files to edit:
   - `src/core/artifacts/index.ts`
   - `src/cli/features/check/command.ts`

   Implementation:
   - Add a parser for property artifact JSON with schema version and property array.
   - Allow imported modules only if they export serializable property objects, not functions.
   - Reject function-valued properties with a clear migration error.
   - Pass serialized properties directly into `checkModel`.
   - Keep multi-property-file merging deterministic by file order then property order.

4. Compile and evaluate properties in Rust.

   Files to edit:
   - `crates/checker/src/property.rs`
   - `crates/checker/src/expr.rs`
   - `crates/checker/src/step.rs`

   Implementation:
   - Compile property var reads and enabled-transition references to dense indexes.
   - Evaluate state predicates through the existing Rust expression evaluator.
   - Evaluate step predicates through a `StepFacts` struct built from `(pre, transition, post)`.
   - Implement `includeUnmounted` and route-local read checks before predicate evaluation.
   - Return property errors with property names attached.

5. Implement online property monitors.

   Files to edit:
   - `crates/checker/src/property.rs`
   - `crates/checker/src/search.rs`

   Implementation:
   - For each newly discovered stabilized state, evaluate unresolved `always` and `reachable` properties.
   - For every generated edge, including edges to visited states, evaluate unresolved `alwaysStep` properties before visited dedupe.
   - Store the first violating/reachable witness using state IDs and edge metadata.
   - Preserve BFS minimality by only recording the first witness in deterministic search order.
   - Do not continue evaluating a property after its verdict is final.

6. Implement graph-dependent finalizers.

   Files to edit:
   - `crates/checker/src/property.rs`
   - `crates/checker/src/graph.rs`

   Implementation:
   - For `reachableFrom`, compute backward reachability from goal states over recorded reverse edges.
   - Emit a non-replayable violation for the first deterministic `when` state not in the backward set.
   - For `leadsToWithin`, collect trigger edges during online search using step predicate IR.
   - For each distinct trigger post-state, run bounded universal search under the scheduler constraint.
   - Memoize bounded response on `(state_id or canonical bytes, remaining_budget)`.

7. Implement trace reconstruction and result serialization.

   Files to edit:
   - `crates/checker/src/trace.rs`
   - `crates/checker/src/report.rs`
   - `src/cli/features/check/command.ts`

   Implementation:
   - Reconstruct traces by walking parent records from witness state to an initial state.
   - Materialize trace steps with transition ID, label, source anchors, pre/post JSON states, and diffs matching core trace types.
   - For edge witnesses, append the violating edge after the trace to `pre`.
   - Serialize `CheckResult` with verdicts, stats, vacuity warnings, bound hits, and diagnostics.
   - Keep TypeScript `createCheckReport` responsible only for trust-ledger assembly around the Rust result.

8. Remove JavaScript property observation/finalization.

   Files to edit:
   - `src/check/properties/*`
   - `src/check/traces/*`
   - `src/check/engine/check-model.ts`

   Implementation:
   - Delete modules whose only purpose is running JS predicates or finalizing TS graph data.
   - Update tests and imports to use property IR and Rust results.
   - Keep TypeScript core trace/report type definitions as schemas only.
   - Do not leave compatibility adapters for old function predicates.

9. Convert the TLC differential runner to Rust-backed checking.

   Files to edit:
   - `tools/phase7-differential.ts`
   - `src/cli/features/export/command.test.ts`

   Implementation:
   - Keep the runner comparing Modality checker results against TLC reachable/generated counts, but ensure the Modality side calls the Rust-backed `checkModel`.
   - Rewrite any inline properties in the runner to serializable property IR.
   - Remove assumptions that property modules contain executable TypeScript predicates.
   - Ensure generated random corpus checks build property artifacts compatible with Rust property evaluation.
   - Keep TLC export behavior unchanged; only the in-repo checker side moves to Rust.
   - Add failure messages that name the Rust checker result and TLC result clearly, without adding a Rust-vs-TypeScript comparison.

## Acceptance criteria

- `modality check` accepts serializable property artifacts.
- Rust evaluates all property kinds without JavaScript callbacks.
- Reports include verdicts, traces, diagnostics, vacuity warnings, and bound hits.
- Step predicates can observe enqueue, resolve, navigation, transition, and op-arg facts.
- Old function predicates are rejected rather than executed.
- `tools/phase7-differential.ts` compares TLC against the Rust-backed checker path.

## Tests to add or update

- Unit tests for property IR builders and read inference by IR walking.
- Rust tests for every property kind.
- CLI tests for JSON property artifacts and rejection of function-valued properties.
- Checker hand-model tests rewritten to property IR.
- Phase 7 differential tests updated so generated checker properties are serializable property IR.

## Verification commands

- `rtk cargo test -p modality-checker`
- `rtk pnpm test -- test/checker/checker.test.ts`
- `rtk pnpm test -- src/cli/features/check/command.test.ts`
- `rtk pnpm test -- test/modality/cli.test.ts`
- `rtk pnpm phase7`

## Risks, ambiguities, and stop conditions

- Stop and report if a current property cannot be represented without adding a new generic predicate IR operator.
- Stop and report if trace JSON requires fields not present in core trace/report schemas.
- Do not keep JS callbacks as an escape hatch; extend property IR instead.
