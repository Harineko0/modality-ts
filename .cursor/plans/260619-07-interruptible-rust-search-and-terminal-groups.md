# Interruptible Rust Search and Terminal Groups

## Goal

Make checker limits and terminal verdicts effective during search. A bad slice should not spend tens of seconds expanding a whole frontier before honoring `--max-states`, `--max-frontier`, or `--max-edges`, and a slice group should stop once all properties in that group have decisive verdicts.

## Non-goals

- Do not rewrite the Rust checker from scratch.
- Do not change model semantics, transition ordering, or trace determinism more than necessary.
- Do not remove diagnostics for storage, hot path, or dominant vars.
- Do not make wall-clock timeout the primary correctness mechanism.

## Current-State Findings

- `crates/checker/src/search.rs` checks limits before and after each depth.
- Inside `explore_depth_parallel()`, each worker calls `expand_chunk()` and generates all edges/candidates for its frontier chunk before limits are checked.
- `expand_chunk()` applies effects, stabilizes, canonicalizes, and buffers all generated edges/candidates.
- This means small limits cannot interrupt a huge one-depth expansion.
- `observe_states()` and `observe_edge()` add verdicts as soon as reachable/always/alwaysStep results are known.
- The main loop does not stop when all properties already have terminal verdicts.
- `checkModelSliced()` runs each slice group through Rust even if some properties are trivially decidable before search.

## Exact File Paths and Relevant Symbols

- `crates/checker/src/search.rs`
  - `check_model_compiled`
  - `explore_depth_parallel`
  - `expand_chunk`
  - `check_search_limits`
  - `apply_search_limit_verdicts`
- `crates/checker/src/property.rs`
  - `observe_states`
  - `observe_edge`
  - `finalize_properties`
  - property terminal statuses
- `crates/checker/src/graph.rs`
  - `GraphRecording`
- `crates/checker/src/report.rs`
  - `build_check_result`
- `src/check/check-model.ts`
  - `checkModelSliced`
  - slice group execution
- `test/checker/checker.test.ts`
- `src/cli/features/check/command.test.ts`

## Existing Patterns to Follow

- Rust tests already live in `crates/checker/src/*` modules.
- JS/TS checker tests call `checkModel()` and inspect diagnostics.
- Search limit diagnostics already report `limits`, `search`, and `storage`.
- Preserve deterministic trace generation and stable sorting where possible.

## Atomic Implementation Steps

1. Add a failing limit-interruption test.
   - Build a model with a small frontier but a huge number of post states from one transition (`havoc` or product/wide domain).
   - Run with `maxEdges` or `maxStates` low.
   - Assert the checker returns quickly with an error verdict and `diagnostics.limits`.
   - Prefer structural assertions over wall-clock; if measuring elapsed time, keep a very generous bound and mark it as a regression smoke test.

2. Add a terminal-verdict test.
   - Model where all properties are reachable/violated at the initial state or first edge.
   - Assert search stops before exploring to `maxDepth`.
   - Inspect `stats.depth`, `states`, or `edges`.

3. Track terminal property completion in Rust.
   - Add helper such as `all_properties_terminal(properties, verdicts)`.
   - Terminal examples:
     - `reachable` with witness,
     - `always` violation,
     - `alwaysStep` violation,
     - `error`.
   - Non-terminal examples:
     - `always` with no violation yet,
     - `reachable` without witness,
     - `reachableFrom` and `leadsToWithin` before finalization.

4. Break the main search loop when all properties are terminal.
   - After initial `observe_states()`.
   - After `observe_edge()` during expansion if all edge-observed properties are terminal.
   - After each depth’s `observe_states()`.
   - Ensure `finalize_properties()` is still called for non-terminal properties when no limit is hit.

5. Make expansion limit-aware.
   - Thread a lightweight budget into `expand_chunk()` or replace full buffering with a bounded generation path.
   - Check edge and candidate budgets while generating posts, not only after all workers return.
   - In parallel mode, use per-worker soft budgets and a shared atomic stop flag, or chunk-level budgets that guarantee bounded overshoot.
   - Return partial edges/candidates plus `limit_hit` deterministically.

6. Preserve deterministic order.
   - Continue sorting generated edges/candidates before recording/inserting where possible.
   - If a limit stops generation early, document and test deterministic behavior for the same worker count/input.

7. Surface better diagnostics.
   - Include whether the limit was hit during generation, edge recording, or candidate merge.
   - Preserve existing `maxStates`, `maxEdges`, `maxFrontier`, `reason` fields.

## Per-Step Files to Edit

- Step 1: `test/checker/checker.test.ts` and/or Rust unit tests in `crates/checker/src/search.rs`
- Step 2: `test/checker/checker.test.ts`
- Step 3: `crates/checker/src/property.rs` or `crates/checker/src/search.rs`
- Step 4: `crates/checker/src/search.rs`
- Step 5: `crates/checker/src/search.rs`
- Step 6: `crates/checker/src/search.rs`, `crates/checker/src/visited.rs` if needed
- Step 7: `crates/checker/src/search.rs`, `src/check/types.ts` if diagnostics typing must expand

## Acceptance Criteria

- `--max-states`, `--max-frontier`, and `--max-edges` interrupt pathological expansion promptly.
- Checks stop when every property in the current Rust request has a terminal verdict.
- Existing checker verdicts and traces remain deterministic for non-limited runs.
- Search-limit diagnostics remain present and become more informative.
- Coffee `_customer/home` under tight limits returns diagnostics instead of hanging.

## Tests to Add or Update

- Limit-interruption test for one wide transition.
- Terminal all-properties test.
- Existing search-limit CLI report test updates if diagnostics gain new fields.
- Existing checker corpus/parity tests.

## Verification Commands

```bash
rtk cargo test --manifest-path crates/checker/Cargo.toml
rtk pnpm test test/checker/checker.test.ts
rtk pnpm test src/cli/features/check/command.test.ts
rtk pnpm build
```

Optional Coffee probe after build:

```bash
rtk proxy /usr/bin/time -p node dist/cli/cli.js check /Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json /Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts --max-states 1000 --max-frontier 1000 --max-edges 10000 -A
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if deterministic trace ordering becomes unstable under non-limited runs.
- Stop and report if Rayon parallelism makes hard budget guarantees too complex; implement a conservative soft-budget with bounded overshoot and document it.
- Stop and report if terminal verdict detection would incorrectly stop properties that require finalization (`reachableFrom`, `leadsToWithin`, unviolated `always`).
- Do not use process-level timeout as a substitute for interruptible search.

