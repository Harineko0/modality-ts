# Goal

Fix `docs/_issues/targeted-step-slicing-enumerates-initial-states.md` by making targeted `alwaysStep` slice construction decide target guard initial enablement without calling full model initial-state generation. Slice construction must remain synchronous and cheap even when full stabilized initial-state enumeration is expensive or non-terminating for practical purposes.

# Non-goals

- Do not change Rust search, Rust initial-state stabilization, or `crates/checker/src/search.rs`.
- Do not change checker verdict semantics outside targeted step slicing.
- Do not broaden targeted slicing to positive targeted `alwaysStep`; those currently stay full-model.
- Do not introduce Coffee DX fixtures or absolute customer app paths into the test suite.
- Do not add compatibility shims for older slicing behavior; this package is experimental.

# Current-state findings

- `src/check/slicing/dependency-graph.ts:1-9` imports `evalStatePredicate`, `StatePredicateEvalError`, and `modelInitialStates`.
- `src/check/slicing/dependency-graph.ts:149-245` implements `computeTargetedStepSliceClosure()`. After seeding target transition execution vars, it loops over `targetTransitionIds` and skips dependency expansion when `targetGuardEnabledAtInitial(...)` returns true.
- `src/check/slicing/dependency-graph.ts:408-420` implements `targetGuardEnabledAtInitial(model, transition)` by calling `modelInitialStates(model).some(...)`. This is the problematic call path: targeted slicing can invoke Rust initial-state generation before search starts.
- `src/check/model-api.ts:4-6` delegates `modelInitialStates()` to `runRustInitialStates()`.
- `src/core/ir/eval.ts:10-76` already provides `evalStatePredicate()` for evaluating serializable `ExprIR` against a plain `ModelState`.
- `src/core/ir/validator.ts:559-567` exports `initialValues(domain, initial)`, which handles the bounded-list special case where an array initial is one list value rather than nondeterministic alternatives.
- `src/check/slicing/slice-model.ts:278-328` keeps negated targeted `alwaysStep` predicates in `targetedStep` mode and positive targeted `alwaysStep` predicates in `full` mode.
- Existing targeted-step regression coverage lives in `test/checker/checker.test.ts:4226-4725`, especially the focused noise model and the tests that expect `prepare` plus `submit` to be retained when `submit` is not initially enabled.
- Lower-level dependency closure coverage lives in `test/check/slicing-dependency-graph.test.ts:114-177`.

# Exact file paths and relevant symbols

- Edit `/Users/hari/proj/modality-ts/src/check/slicing/dependency-graph.ts`
  - `computeTargetedStepSliceClosure`
  - `targetGuardEnabledAtInitial`
  - imports from `modality-ts/core`
  - import from `../model-api.js` to remove
- Add or edit tests under `/Users/hari/proj/modality-ts/test/check/`
  - Preferred new file: `test/check/targeted-step-slicing-initials.test.ts`
  - Alternative additions: `test/check/slicing-dependency-graph.test.ts`
  - Existing integration context: `test/checker/checker.test.ts`
- Existing helper symbols to reuse:
  - `evalStatePredicate`
  - `StatePredicateEvalError`
  - `initialValues`
  - `exprReads`
  - `sliceModelForCheckProperty`
  - `alwaysStep`, `stepTransitionId`, `eq`, `lit`, `readVar` from core property helpers as already used in checker tests

# Existing patterns to follow

- Keep slicing helpers private inside `src/check/slicing/dependency-graph.ts` unless a test requires a public API.
- Prefer conservative closure expansion over exact but expensive analysis. If guard initial status is unknown, treat it like "not definitely enabled" and run dependency closure.
- Preserve deterministic sorting where arrays are exposed. Sets used only internally do not need sorting.
- Tests should construct small inline `Model` objects, matching existing style in `test/check/slicing-dependency-graph.test.ts` and `test/checker/checker.test.ts`.
- Use Vitest `describe`/`it`/`expect` and TypeScript ESM imports.
- Use `rtk`-prefixed commands for verification.

# Atomic implementation steps

1. Replace full initial-state enumeration with declared-initial guard probing.

   In `src/check/slicing/dependency-graph.ts`, remove the import of `modelInitialStates` from `../model-api.js`. Extend the existing `modality-ts/core` imports to include `initialValues` and `Value` if needed.

   Replace `targetGuardEnabledAtInitial(model, transition)` with a helper that takes the dependency graph:

   - Collect guard reads with `exprReads(transition.guard)`.
   - For each read var, look up the `StateVarDecl` in `graph.varsById`.
   - Convert `decl.initial` to declared initial alternatives with `initialValues(decl.domain, decl.initial)`.
   - Evaluate the guard against only the Cartesian product of those read vars' declared initial alternatives.
   - Return true only if at least one declared-initial assignment makes the guard true.
   - Return false when a read var is missing, evaluation throws `StatePredicateEvalError`, or the declared-initial product is too large.

   Use a small explicit cap, for example `const MAX_DECLARED_INITIAL_GUARD_STATES = 1024`, so this helper cannot become a smaller version of full initial enumeration. This cap should apply to the product of guard-read initial alternatives, not to all model vars.

2. Wire the new helper into targeted closure.

   In `computeTargetedStepSliceClosure()`, change the check at `src/check/slicing/dependency-graph.ts:180-184` to call the new graph-based helper. Keep the behavior:

   - missing transition: continue
   - definitely initially enabled target guard: continue
   - false or unknown initial guard status: analyze the guard and run `reachVarsThroughTransitions(...)`

   Do not change the later enabled-transition handling, internal-transition handling, pending queue pruning, or mount guard expansion.

3. Add a regression proving slicing no longer calls `modelInitialStates()`.

   Add `test/check/targeted-step-slicing-initials.test.ts` with a Vitest mock for `../../src/check/model-api.js` before importing slicing code. The mock should make `modelInitialStates` throw a distinctive error such as `"modelInitialStates must not be called during targeted slicing"`.

   In that test file:

   - Construct a model with `draft` initially `"empty"`, a `prepare` transition that writes `"nonEmpty"`, and a targeted `submit` transition guarded on `draft === "nonEmpty"`.
   - Add several unrelated variables/transitions if useful, but keep the model small.
   - Build a negated targeted `alwaysStep` property for `submit`.
   - Call `sliceModelForCheckProperty(model, property)`.
   - Assert no mock error is thrown.
   - Assert the slice remains `mode: "targetedStep"`.
   - Assert transition ids include both `prepare` and `submit`, proving the conservative guard-dependency expansion still happens when the target guard is not initially enabled from declared initials.

4. Add a cheap-positive guard test.

   In the same test file or in `test/check/slicing-dependency-graph.test.ts`, add a model where the target transition guard is definitely true from declared initials, for example `guard: eq(read("draft"), lit("nonEmpty"))` and `draft.initial: "nonEmpty"`.

   Assert the targeted slice includes the target transition but does not pull in an unrelated preparatory writer of `draft`. This guards the optimization side of the helper.

5. Add a bounded product / unknown test if the helper exposes risk.

   If the implementation introduces a product cap, add a small direct test around behavior that can trigger unknown cheaply, or document it through a model with many nondeterministic initial read vars. The assertion should be conservative: target slicing still returns and includes dependency writers rather than hanging or skipping required closure.

   If this makes the test too artificial, skip this step and rely on the mocked `modelInitialStates` regression plus existing parity tests.

6. Run formatting and focused tests.

   Run the commands listed below. Fix only issues directly related to this change.

# Per-step files to edit

- Step 1: `/Users/hari/proj/modality-ts/src/check/slicing/dependency-graph.ts`
- Step 2: `/Users/hari/proj/modality-ts/src/check/slicing/dependency-graph.ts`
- Step 3: `/Users/hari/proj/modality-ts/test/check/targeted-step-slicing-initials.test.ts`
- Step 4: `/Users/hari/proj/modality-ts/test/check/targeted-step-slicing-initials.test.ts` or `/Users/hari/proj/modality-ts/test/check/slicing-dependency-graph.test.ts`
- Step 5: `/Users/hari/proj/modality-ts/test/check/targeted-step-slicing-initials.test.ts` only if the product-cap behavior needs explicit coverage

# Acceptance criteria

- `src/check/slicing/dependency-graph.ts` no longer imports `modelInitialStates`.
- No targeted-step slicing code path calls `modelInitialStates()` or `runRustInitialStates()`.
- Targeted `alwaysStep` slicing returns quickly for models whose full stabilized initial-state generation is expensive.
- If a target guard is definitely enabled by declared initial values, targeted slicing can skip guard dependency expansion as it does today.
- If a target guard is false or unknown from declared initial values, targeted slicing conservatively expands guard dependencies.
- Existing targeted-step pruning remains intact: unrelated pending queue, navigation, and noise transitions are not pulled into focused slices.
- Existing positive targeted `alwaysStep` behavior remains full-model.

# Tests to add or update

- Add `test/check/targeted-step-slicing-initials.test.ts`.
- Include a mock-based regression that fails if `sliceModelForCheckProperty()` calls `modelInitialStates()` while slicing a negated targeted `alwaysStep`.
- Include an assertion that a target guard initially false from declared initials pulls the writer transition needed to make the guard true.
- Include an assertion that a target guard initially true from declared initials does not pull an unrelated writer solely due to guard closure.
- Keep or update existing tests in `test/checker/checker.test.ts:4226-4725`; they should continue passing without expectation changes.

# Verification commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm exec vitest run test/check/targeted-step-slicing-initials.test.ts test/check/slicing-dependency-graph.test.ts
rtk pnpm exec vitest run test/checker/checker.test.ts -t "targeted alwaysStep|targeted choose-step|targeted step"
rtk pnpm typecheck
rtk pnpm fix
rtk pnpm architecture
```

If the Coffee DX checkout is available locally, also rerun the reproduction from the issue and confirm it prints the `autoPrintSwitchTogglesValue` slice instead of stalling:

```bash
rtk proxy pnpm exec tsx -e 'import { readFileSync } from "node:fs"; import { pathToFileURL } from "node:url"; import { performance } from "node:perf_hooks"; import { parseModelArtifact } from "./src/core/index.ts"; import { sliceModelForCheckProperty } from "./src/check/slicing/slice-model.ts"; (async()=>{ const model=parseModelArtifact(readFileSync("/Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json","utf8")); const mod:any=await import(pathToFileURL("/Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts").href); const props=(mod.properties ?? mod.propertiesFor)(model); for (const p of props){ const t=performance.now(); const s=sliceModelForCheckProperty(model,p); console.log(JSON.stringify({property:p.name, ms:Math.round(performance.now()-t), vars:s.model.vars.length, transitions:s.model.transitions.length, mode:s.mode})); } })()'
```

# Risks, ambiguities, and stop conditions

- Stop and report if `initialValues` cannot be imported from `modality-ts/core` without creating a dependency-cycle or architecture violation.
- Stop and report if a test mock of `model-api.js` is unreliable because static imports load `dependency-graph.ts` before the mock; use a new isolated test file with dynamic imports before giving up.
- Be conservative when the helper cannot decide guard status. Returning false and expanding dependencies is acceptable; returning true without proof is not.
- Do not try to reproduce Coffee DX by committing its model or props into this repo.
- Do not hide the issue by increasing search limits or by disabling targeted slicing.
- Do not change `modelInitialStates()` itself; other checker features, such as initial reachable short-circuiting, legitimately use it.
