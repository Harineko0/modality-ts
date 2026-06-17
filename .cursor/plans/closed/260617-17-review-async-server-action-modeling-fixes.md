# Goal

Fix the three P1 review issues introduced by `.cursor/plans/260617-15-meiwa-async-server-action-modeling-gaps.md` in `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps`:

- awaited async result bindings must not silently read missing `outcome:<op>` pending args as `null` when `asyncOutcomes` is absent;
- confirm-gated async starts must expose and enforce the accepted confirm branch, and declined paths must not be marked exact if they are only an approximation;
- imported server action aliases must be scoped to the source module/symbol that owns the binding, not globally keyed only by local name.

The end state should make the current Meiwa modeling improvements sound enough for properties to assert async payload behavior, confirm acceptance before enqueue, and server-action identity across multiple client files with colliding import names.

# Non-goals

- Do not rework unrelated items from the original Meiwa plan such as drag/drop, required inputs, nested domain inference, or stale-result guards unless a test must be strengthened to guard one of these three regressions.
- Do not suppress checker `readOpArg` fallback behavior globally as the primary fix. Missing async outcome payloads should be prevented or modeled correctly at extraction time.
- Do not add Meiwa-specific names or tenant-specific logic.
- Do not redesign the full model schema unless the existing IR cannot represent an observable confirm choice or async payload fallback; stop and report first.
- Do not preserve backward compatibility with the reviewed behavior. This package is experimental.
- Do not edit generated artifacts, `dist/`, `docs/build/`, `node_modules`, or temporary replay output directories.

# Current-State Findings

- `src/extract/engine/ts/transition/async.ts` now recognizes variable await bindings through `AwaitedEffect.bindingName` and seeds continuation locals via `outcomeLocalsForAwaitedEffect`.
- `outcomeLocalsForAwaitedEffect` binds configured success outcomes as literals, but when `asyncOutcomes[awaited.op]?.success` is absent it binds the result local to `{ kind: "readOpArg", key: "outcome:<op>" }`.
- `effectCallArgs` only adds call arguments and snapshot reads to the enqueue args. There is no `outcome:<op>` arg added to `.start` enqueue args for normal awaited calls.
- `crates/checker/src/expr.rs` evaluates missing `readOpArg` keys as `Value::Null`, so `result.job` or `result.job.status` becomes `null` instead of an unknown/over-approx payload.
- `src/extract/engine/ts/transition/expressions.ts` appends property path segments to `readOpArg` keys, for example `result.job.status` becomes `outcome:<op>:job:status`. Any fallback scheme must account for nested property reads, not just the top-level `outcome:<op>` key.
- Current tests in `test/extraction/extraction.test.ts` cover awaited result bindings only with configured `asyncOutcomes`; they do not fail when `asyncOutcomes` is absent.
- `peelPreAwaitGuards` in `src/extract/engine/ts/transition/async.ts` recognizes `if (!window.confirm(...)) return` and emits a `.declined` user transition with `guard: true`, empty effects, and `confidence: "exact"`.
- The corresponding `.start` transition also gets `guard: true` when confirm is the only peeled pre-await guard. This creates nondeterministic accepted and declined paths, but the accepted choice is not observable in guards/effects, so properties cannot assert "enqueue only after accepted confirm".
- Current confirm coverage in `test/extraction/extraction.test.ts` only asserts that `.start` and `.declined` transitions exist and no `no-extractable-effect` warning appears. It does not assert an accepted guard, rejected guard, choice state, or confidence.
- `src/cli/features/extract/project.ts` builds `effectOpAliases` with `aliases.set(binding.local, canonical)`. The map is later consumed by `src/extract/engine/ts/transition/async.ts` through `canonicalEffectOp(rawOp, effectOpAliases)`.
- Because the alias map is keyed only by local identifier text, two client files importing different actions as the same local name collide. A non-imported `await save()` in another file can also be canonicalized as a server action.
- Current Next coverage in `src/cli/features/extract/next-extract.test.ts` verifies that a single imported `save` action avoids a friendly duplicate, but does not cover two modules with colliding local import names or unrelated local functions.
- `src/extract/engine/ts/transition/async.ts` has no source-file parameter in `canonicalEffectOp`, `awaitedEffect`, `statementHasAwaitedEffect`, or `containsAwaitedEffect`, so source-scoped aliasing will require plumbing context into async extraction.

# Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/engine/ts/transition/async.ts`
  - `AwaitedEffect`
  - `transitionsFromAsyncHandler`
  - `transitionsFromSequentialAwait`
  - `peelPreAwaitGuards`
  - `isConfirmDeclinedIf`
  - `extractConfirmCall`
  - `outcomeLocalsForAwaitedEffect`
  - `statementHasAwaitedEffect`
  - `containsAwaitedEffect`
  - `awaitedEffect`
  - `canonicalEffectOp`
  - `effectCallArgs`
  - `pendingIs`
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/engine/ts/transition/expressions.ts`
  - `modeledReadExpr`
  - `valueExpr`
  - property access handling for local `readOpArg` bindings
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/engine/ts/transition/effects.ts`
  - `effectWriteVars`
  - existing `havoc` confidence patterns, if async result fallback needs to mark writes over-approximate
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/engine/ts/types.ts`
  - `BoundExpr`
  - `ExtractionWarning`
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/core/ir/types.ts`
  - `ExprIR`
  - `EffectIR`
  - `Transition`
  - `StateVarDecl`
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/core/ir/validator.ts`
  - only if a new system variable or expression/effect kind is required
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/crates/checker/src/expr.rs`
  - `ExprIR::ReadOpArg` fallback behavior, for tests and understanding only unless a schema-level decision is made
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/cli/features/extract/project.ts`
  - `discoverServerActionImportAliases`
  - `effectOpAliases`
  - `effectApis`
  - `EffectApiProvenanceEntry`
  - `ModuleRecord`
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/engine/pipeline/index.ts`
  - extraction option plumbing for `effectOpAliases`
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/sources/shared/react-transition-extract.ts`
  - source-to-engine plumbing for effect aliases, if present
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/sources/use-state/transitions.ts`
  - handler extraction call sites for `transitionsFromAsyncHandler`, if present
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/extract/engine/ts/react-source-transitions.ts`
  - top-level TS extractor option plumbing and model variable assembly, if confirm choice needs a system var
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/test/extraction/extraction.test.ts`
  - async result binding and confirm-gated delete regression tests
- `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps/src/cli/features/extract/next-extract.test.ts`
  - server action alias collision regression tests

# Existing Patterns to Follow

- Keep async split semantics: user `.start` enqueues an op; env `.success` and `.error` dequeue and apply continuation effects.
- Keep snapshot semantics: post-await reads of pre-await state are captured as `snap:<varId>` enqueue args and read via `readOpArg`.
- Prefer extractor-side modeling over checker fallback changes. The checker fallback to `null` may still be used for invalid or manual models, but generated models should avoid missing keys.
- Use existing `EffectIR` constructs first: `seq`, `if`, `assign`, `havoc`, `choose`, and `enqueue`. Add a new IR concept only if no existing construct can make confirm choice observable or async payload fallback sound.
- Use `confidence: "over-approx"` whenever a path or value is intentionally approximate, especially for confirm branches without observable choice or async result writes without exact outcomes.
- Keep transition ids stable except where adding a new confirm-choice system variable or action alias scope requires deterministic disambiguation.
- Avoid global string heuristics for server actions. Scope alias decisions to the source file containing the awaited call or to an import binding resolved from that source file.
- Add tests that fail on the reviewed unsound behavior, not only tests that assert transitions exist.

# Atomic Implementation Steps

## 1. Strengthen Regression Tests Before Fixing Code

Add focused failing tests for the exact review issues.

In `test/extraction/extraction.test.ts`:

- Add an async handler fixture with `const result = await api.requestJob(); setJob(result.job);` and no `asyncOutcomes`.
- Assert that the generated `.success` transition does not contain any `readOpArg` key beginning with `outcome:api.requestJob` unless the corresponding `.start` enqueue args include exactly the same key.
- Assert that the model does not assign literal `null` to the target state as the fallback for `result.job`.
- Add a variant with `setStatus(result.job.status)` to catch nested appended keys such as `outcome:api.requestJob:job:status`.
- Strengthen the existing confirm-gated async delete test to assert that accepted and declined paths are distinguishable by guard or state, and that `.start` is not guarded by bare `{ kind: "lit", value: true }` when confirm is the only pre-await branch source.
- Assert `.declined.confidence` is not `"exact"` unless the declined branch has an exact observable guard.

In `src/cli/features/extract/next-extract.test.ts`:

- Add a Next fixture with two client modules, each importing a different server action as the same local name, for example `import { save as save } from "./account-actions"` and `import { save as save } from "./profile-actions"`.
- Assert each transition uses the canonical action from its own import source.
- Add a third client module with an unrelated local `async function save() {}` and `await save()`; assert it is not treated as either imported server action.

Per-step files to edit:

- `test/extraction/extraction.test.ts`
- `src/cli/features/extract/next-extract.test.ts`

Stop and ask/report if:

- The current test helpers cannot inspect enqueue args or transition effects deeply enough to detect missing `outcome:<op>` keys.
- A minimal Next fixture cannot route multiple client modules through extraction; report which CLI/project helper prevents the fixture.

## 2. Fix Missing Async Outcome Fallback Without Silent `null`

Replace the current fallback in `outcomeLocalsForAwaitedEffect` with a sound representation.

Implementation requirements:

- Never bind an awaited result local to `readOpArg("outcome:<op>")` unless the enqueue args for the same pending op contain the matching key or matching nested payload key.
- Prefer this order of solutions:
  - If `asyncOutcomes[op].success` is configured, keep the current literal binding.
  - If the awaited result is only used as a whole value or nested property and the target setter domain is finite, model affected continuation writes as over-approximate `havoc` on the written state var instead of assigning `null`.
  - If the extractor can infer a finite payload domain from the setter target domain and property path, enqueue a deterministic outcome arg using a finite representative or choice-compatible expression only if this remains valid under the current IR and validator.
  - If none of the above is sound for a result-dependent continuation, emit an extraction warning/caveat and omit or over-approximate the unsafe continuation write. Do not generate a model that reads a missing op arg.
- Account for nested property reads. `modeledReadExpr` currently turns `result.job.status` into a different key than `result`, so any key-existence check must inspect the final expression tree after summarization or preserve metadata on the result local.
- Keep configured `asyncOutcomes` behavior exact and unchanged.
- Keep snapshot `readOpArg("snap:<varId>")` behavior unchanged.

Recommended implementation shape:

- Extend `BoundExpr` or add an internal async-only metadata shape to distinguish "unconfigured async outcome binding" from normal `readOpArg` locals.
- Thread that metadata through `valueExpr`/`modeledReadExpr` enough to identify setter assignments derived from unconfigured async outcomes.
- In `summarizeAsyncSegment` or immediately after success summaries are built in `transitionsFromAsyncHandler`, replace unsafe assignments derived from an unconfigured outcome with `havoc` of the same target var and mark the transition `over-approx`.
- Alternatively, if adding metadata to `BoundExpr` is too invasive, add a post-processing pass in `async.ts` that scans success/catch/finally effects for `readOpArg` keys beginning with `outcome:${op}` and either verifies enqueue args contain those keys or rewrites affected assignments to `havoc`.
- Add a local helper such as `rewriteMissingOutcomeReads(effect, op, availableArgKeys)` in `async.ts`; keep it private and unit-tested through extraction tests.

Per-step files to edit:

- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/transition/expressions.ts` if preserving source metadata through property reads is cleaner than effect post-processing
- `src/extract/engine/ts/types.ts` only if adding `BoundExpr` metadata
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- With configured `asyncOutcomes`, existing tests still produce literal payload assignments such as `{ status: "pending" }` or `"processing"`.
- Without configured `asyncOutcomes`, no generated transition contains `readOpArg` keys for `outcome:<op>` that are absent from the matching enqueue args.
- Without configured `asyncOutcomes`, result-dependent state writes are either over-approximated with `havoc` and `confidence: "over-approx"`, or the handler is reported as unsupported with a precise warning. They must not assign `null` due to missing op args.
- Snapshot reads `snap:<varId>` still work and remain exact where they were exact before.

Stop and ask/report if:

- The only sound solution requires a new first-class async outcome payload domain in `EffectIR.enqueue` or `ExprIR`; report the minimal schema addition and the affected validator/checker/export surfaces before changing them.
- Rewriting result-dependent writes would hide user-visible effects without a warning.

## 3. Expose and Enforce Confirm Acceptance

Replace the current confirm peeling that creates two unguarded user paths with an observable branch model.

Implementation requirements:

- For `if (!window.confirm(...)) return; await api.deleteDefinition(...)`, the `.start` enqueue path must require the accepted confirm branch.
- The declined path must represent rejected confirm and must not enqueue.
- Properties must be able to refer to the accepted/rejected choice through an existing or newly introduced stable expression/state mechanism.
- Do not mark confirm-modeled paths `confidence: "exact"` unless both accepted and rejected branches are actually modeled exactly.

Recommended implementation shape:

- First look for an existing system-variable pattern for browser/environment choices in `src/extract/engine/ts/react-source-transitions.ts` and `environment-callbacks.ts`.
- If an existing variable pattern fits, introduce a confirm choice state var with a deterministic id derived from component, attribute, op, and source location, for example `sys:confirm:<component>.<attr>.<op>`.
- Give the variable a finite enum or bool domain, for example `{ kind: "enum", values: ["accepted", "declined"] }` or `{ kind: "bool" }`, with an initial value that does not accidentally enable accepted-only properties before a confirm event. If no safe initial value exists, stop and report.
- On the accepted `.start` transition, either:
  - set the confirm choice to accepted and guard on the accepted value in the same transition if same-step assertions can observe it; or
  - split into explicit accepted and declined user transitions where the accepted transition writes accepted and enqueues, while declined writes declined and does not enqueue.
- Ensure the start transition guard/effect combination makes "enqueue only after accepted confirm" expressible in step properties. A bare `guard: true` plus hidden nondeterminism is not sufficient.
- Keep `extractConfirmCall` generic for `confirm`, `window.confirm`, and `globalThis.confirm`.
- Add caveats/warnings only if the confirm text or browser modal side effects remain approximate.

Per-step files to edit:

- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/react-source-transitions.ts` if new system vars must be registered in the model
- `src/core/ir/types.ts` and `src/core/ir/validator.ts` only if no existing state/effect representation can expose the choice
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- Confirm-gated async delete emits one path that enqueues only for accepted confirm and one path that does not enqueue for declined confirm.
- The accepted branch is observable through a guard/read/write that property authors can assert against.
- `.start.guard` is not simply `{ kind: "lit", value: true }` for confirm-gated starts unless an equivalent accepted-choice effect is present and documented by the test.
- `.declined.confidence` is `"over-approx"` unless the implementation creates exact accepted/declined choice semantics.
- Existing non-confirm pre-await guard tests still pass.

Stop and ask/report if:

- There is no way in current step predicates to observe a state write from the same transition strongly enough to express "enqueue only after accepted confirm".
- Adding a confirm system var requires broad serialization, checker, export, and replay changes beyond a small, isolated schema extension.

## 4. Scope Server Action Alias Canonicalization by Source File

Replace global local-name aliasing with a source-aware alias structure.

Implementation requirements:

- The canonicalization of `await save()` must depend on the source file containing the awaited call and that file's import bindings.
- A local `save` function without an import binding must not be canonicalized as a server action.
- Two files importing different server actions under the same local name must both work in the same extraction run.
- Keep `effectApis` as the set of canonical operation ids for pending op domains.

Recommended implementation shape:

- Replace `Map<string, string>` for `effectOpAliases` with a source-scoped representation, for example:
  - `Map<string, Map<string, string>>`, keyed by normalized source file path then local binding name; or
  - a small interface such as `EffectOpAliases` with `canonicalFor(fileName, localName)`.
- Build the scoped map in `discoverServerActionImportAliases` using each non-server client `ModuleRecord.path` as the outer key and `binding.local` as the inner key.
- Normalize paths consistently with `resolve(...).split("\\").join("/")` for both construction and lookup.
- Thread the current `fileName`/source path into async helpers that currently call `canonicalEffectOp`:
  - `transitionsFromAsyncHandler`
  - `transitionsFromSequentialAwait`
  - `statementHasAwaitedEffect`
  - `containsAwaitedEffect`
  - `awaitedEffect`
  - `awaitedOp`
  - any Promise.all awaited-op helpers in `async.ts`
- Update `canonicalEffectOp` to take the source file or scoped alias view, and only canonicalize non-fetch call names when the alias exists for that exact source file.
- Keep fetch op canonicalization independent of server-action aliases.
- Update pipeline and shared extraction option types to use the new alias representation.

Per-step files to edit:

- `src/cli/features/extract/project.ts`
- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/extract/sources/shared/react-transition-extract.ts`
- `src/extract/sources/use-state/transitions.ts`
- `src/extract/engine/ts/react-source-transitions.ts`
- `src/cli/features/extract/next-extract.test.ts`

Acceptance criteria:

- A multi-file Next fixture with colliding local `save` imports produces separate canonical `ACTION ...#save` op ids for the correct source modules.
- An unrelated local `await save()` in a file with no matching server-action import is not extracted as either server action.
- `sys:pending.inner.fields.opId.values` contains canonical action ids and no friendly local-name duplicates.
- Existing single-action canonicalization test still passes.

Stop and ask/report if:

- Any extraction layer has already discarded source file identity before awaited-call detection. Report the exact call path that needs source plumbing rather than reintroducing fragile global string aliases.
- Scoped aliasing requires a TypeScript checker symbol lookup that is unavailable in the project extraction phase.

## 5. Tighten Diagnostics and Confidence

Review warnings and confidence values after the three fixes.

Implementation requirements:

- Async result fallback to `havoc` or unsupported warning must set the affected transition confidence to `"over-approx"` or produce a precise caveat.
- Confirm branches must not claim `"exact"` when the implementation is nondeterministic or only approximates modal behavior.
- Server action alias collision fixes should not add warnings for valid import collisions.
- Do not globally suppress `no-extractable-effect`, `awaited-effect-in-async`, or unhandled rejection warnings.

Per-step files to edit:

- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/caveats.ts` or related caveat helpers only if a new precise warning kind is needed
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- Tests assert the relevant confidence values for async outcome fallback and confirm declined/accepted branches.
- Existing warning snapshots or message assertions change only where the model is intentionally more precise or intentionally marked over-approximate.

Stop and ask/report if:

- Marking confidence accurately requires tracking effect provenance through `seq`/`if` in a way that would affect broad transition extraction.

# Acceptance Criteria

- Generated async models never read missing `outcome:<op>` op args. There is no path where absent `asyncOutcomes` silently models `result.job` as `null`.
- Configured `asyncOutcomes` still bind awaited result locals exactly and preserve existing literal continuation assignments.
- Unconfigured awaited result payloads are modeled by a documented over-approximation or rejected with a precise warning, not by implicit `null`.
- Confirm-gated async starts expose an accepted branch in model state/guards/effects and enqueue only on that accepted branch.
- Declined confirm paths are distinguishable, do not enqueue, and have confidence consistent with the implementation.
- Server action imports are canonicalized per source file/import binding. Same local names in different files do not collide, and unrelated locals are not treated as server actions.
- Existing extraction, Next, typecheck, architecture, and checker tests continue to pass.

# Tests to Add or Update

- `test/extraction/extraction.test.ts`
  - unconfigured awaited result binding assigned to state;
  - unconfigured nested result property assigned to state;
  - configured `asyncOutcomes` result binding remains exact;
  - confirm-gated async delete exposes accepted choice and rejected choice;
  - confirm declined confidence is over-approximate unless exact branch state is implemented.
- `src/cli/features/extract/next-extract.test.ts`
  - two client files import different server actions under the same local name;
  - unrelated local function with the same local name is not canonicalized;
  - pending op id domain contains canonical action ids without friendly duplicates.
- Add or update smaller unit tests only if there are existing focused tests for `canonicalEffectOp`, `awaitedEffect`, or expression result binding helpers.

# Verification Commands

Run from `/Users/hari/proj/modality-ts-worktrees/meiwa-async-server-action-modeling-gaps`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- src/cli/features/extract/next-extract.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm test
```

If changing checker behavior, serialized IR, or property observability for confirm choices, also run:

```bash
rtk pnpm phase7
```

Before finishing, run formatting/linting:

```bash
rtk pnpm fix
```

# Risks, Ambiguities, and Stop Conditions

- Async result payloads may need first-class outcome domains on pending ops to be both precise and sound. Stop before adding a schema-level change unless the existing `havoc` or warning approach cannot satisfy tests.
- A `havoc` fallback for result-dependent writes is sound but less precise. It must be clearly marked `over-approx` and should only target writes actually derived from the unknown awaited result.
- Confirm branch observability may require a new system variable. Stop if this expands into broad validator/checker/export/replay work; report the minimal design instead.
- Same-transition property assertions may not observe writes in the way needed for accepted confirm semantics. Verify against existing step predicate semantics before relying on a choice write alone.
- Source-scoped aliases require consistent normalized paths across project discovery and TS extraction. Stop if any layer receives virtual filenames or synthetic snippets that cannot be matched to project module paths.
- Do not use global local-name alias maps, path suffix matching, or last-writer-wins behavior as a shortcut.
- The worktree is already dirty. Preserve existing user/Cursor changes and only edit files required for these review fixes.
