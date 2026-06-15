# Rust Checker Review Fixes

## Goal

Fix the review findings from the Rust checker rewrite so the branch builds, rejects malformed property IR, preserves deterministic BFS parent selection under parallel duplicate discovery, and keeps exposed CLI/check options wired through the Rust checker.

## Non-goals

- Do not reintroduce the old TypeScript checker.
- Do not add `--engine` selection or Rust-vs-TypeScript comparison paths.
- Do not add benchmark infrastructure.
- Do not loosen property IR validation to preserve old function predicates.

## Current-state findings

- `rtk pnpm build` fails with `src/core/ir/eval.ts(7,53): error TS2366`.
- `src/core/artifacts/index.ts` accepts any flat step predicate object; misspelled keys can deserialize in Rust as an empty predicate and match every edge.
- `crates/checker/src/visited.rs` uses `local_seq` from an `AtomicU64` as the last duplicate-discovery tiebreaker; with different parents and identical transition IDs, parent choice can depend on Rayon scheduling.
- `src/check/native.ts` drops `options.memoryGuard`, and `crates/checker/src/model.rs` has no corresponding Rust option even though CLI still exposes `--memory-guard-mb`.

## Exact file paths and relevant symbols

- `src/core/ir/eval.ts`: `evalStatePredicate`, `evalExpr`.
- `src/core/ir/types.ts`: `ExprIR`, `StepPredicateFlat`, `StepPredicateComposite`.
- `src/core/artifacts/index.ts`: `assertSerializableProperty`, `assertSerializableStepPredicate`.
- `crates/checker/src/model.rs`: `StepPredicateIR`, `StepPredicateSpec`, `CheckOptionsIR`.
- `crates/checker/src/visited.rs`: `MergeCandidate`, `sort_merge_candidates`.
- `crates/checker/src/search.rs`: `expand_chunk`, `explore_depth_parallel`, `check_search_limits`.
- `src/check/native.ts`: `runRustCheck`.
- `src/cli/features/check/command.ts`: `resolveCheckSearchLimits`.

## Existing patterns to follow

- Keep property predicates serializable and Rust-owned.
- Keep BFS traces deterministic and shortest-depth.
- Reject malformed artifacts early with actionable messages.
- Keep public check options honest: if an option is exposed, the Rust checker must implement it or the TypeScript API must remove it.

## Atomic implementation steps

1. Make core IR evaluation exhaustive and semantically correct.

   Files to edit:
   - `src/core/ir/eval.ts`
   - `src/core/ir/types.ts`
   - `test/runtime/runtime.test.ts`
   - `test/kernel/kernel.test.ts`

   Implementation:
   - Add explicit handling for every `ExprIR.kind`, including `readPre`, `readOpArg`, and `transitionEnabled`.
   - For plain state-predicate evaluation, reject step-only expressions (`readPre`, `readOpArg`) with a clear error instead of returning misleading values.
   - Implement `tagIs` against record/tag values rather than returning `false`.
   - Add an exhaustive `default` branch assigning `expr` to `never` so future `ExprIR` additions fail locally with a precise error.
   - Add tests covering `tagIs`, `transitionEnabled` rejection or behavior, and step-only expression rejection in plain state predicates.

2. Strictly validate property and step predicate artifacts.

   Files to edit:
   - `src/core/artifacts/index.ts`
   - `src/core/ir/types.ts`
   - `crates/checker/src/model.rs`
   - `src/cli/features/check/command.test.ts`

   Implementation:
   - In `assertSerializableStepPredicate`, validate flat predicates by allowing only known keys from `StepPredicateFlat`.
   - Reject empty flat predicates unless they are intentionally represented by a documented helper such as `stepAny()`.
   - Validate field value types: strings for transition/op fields, boolean for `navigated`, one- or two-string tuple for `resolved`, and JSON object for `opArgs`.
   - Validate composite predicates by allowing only `pre`, `step`, `post`, and `negate`, and recursively validating `pre`/`post` expressions.
   - Add `#[serde(deny_unknown_fields)]` to Rust `StepPredicateIR` and `StepPredicateComposite` so native deserialization also rejects misspellings.
   - Add CLI/artifact tests proving `transitionID` or any unknown step predicate key fails instead of matching every edge.

3. Make parallel duplicate discovery deterministic by global BFS order.

   Files to edit:
   - `crates/checker/src/visited.rs`
   - `crates/checker/src/search.rs`
   - `crates/checker/src/frontier.rs`

   Implementation:
   - Replace scheduler-dependent `local_seq` with a deterministic discovery key derived from BFS order: parent frontier position, transition sorted index, raw-post branch index, stabilization branch index, and post canonical bytes.
   - Store the parent frontier position in worker expansion input rather than deriving order from `StateId`.
   - Update `MergeCandidate` to include this deterministic key and compare duplicates by `(post_canon, parent_frontier_position, transition_id, branch indexes)`.
   - Remove `AtomicU64` from duplicate tiebreaking.
   - Keep sharding for scalability, but ensure each shard's ordering is deterministic and duplicate parent choice does not depend on worker completion order.
   - Add a Rust test where two different frontier parents with the same transition ID discover the same post state, and assert the lower frontier-position parent always wins.

4. Wire memory guard through the Rust checker or remove it from the public contract.

   Files to edit:
   - `src/check/native.ts`
   - `src/check/types.ts`
   - `src/cli/features/check/command.ts`
   - `crates/checker/src/model.rs`
   - `crates/checker/src/search.rs`
   - `src/cli/features/check/command.test.ts`

   Implementation:
   - Prefer keeping the existing public option: serialize `options.memoryGuard?.maxHeapUsedBytes` from `runRustCheck`.
   - Add `memoryGuardBytes` to `CheckOptionsIR`.
   - Implement memory-limit checks at deterministic layer boundaries in Rust using process RSS or allocator statistics available from the native process.
   - Emit diagnostics in the existing shape: `{ reason, memoryGuardBytes }`.
   - Add a test that `--memory-guard-mb` or `searchLimits.memoryGuardBytes` reaches the Rust checker and can produce a memoryGuard diagnostic on a tiny configured threshold.
   - If robust native memory measurement is not available, remove `memoryGuard` from `CheckOptions`, CLI parsing, human output, and tests in the same change rather than silently ignoring it.

## Acceptance criteria

- `rtk pnpm build` succeeds.
- Malformed flat and composite step predicates are rejected by TypeScript artifact validation and Rust deserialization.
- Parallel BFS duplicate discovery is deterministic for same-transition duplicate posts from different parents.
- Exposed memory guard behavior is either fully implemented in Rust or fully removed from TypeScript/CLI.
- No TypeScript checker fallback is added.

## Tests to add or update

- TypeScript tests for exhaustive IR eval behavior.
- CLI/artifact tests for malformed step predicates.
- Rust unit tests for duplicate discovery from different parents under the same transition.
- CLI test for memory guard propagation or removal.

## Verification commands

- `rtk cargo test -p modality-checker`
- `rtk pnpm build`
- `rtk pnpm test -- test/checker/checker.test.ts`
- `rtk pnpm test -- src/cli/features/check/command.test.ts`
- `rtk pnpm phase7`

## Risks, ambiguities, and stop conditions

- Stop and report if native memory measurement is too platform-dependent; remove the public memory guard instead of pretending it works.
- Stop and report if a valid existing property artifact relies on an empty flat step predicate; make `stepAny()` explicit in the schema before accepting it.
- Do not solve deterministic duplicate discovery by disabling parallelism.
