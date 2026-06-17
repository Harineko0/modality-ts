# Goal

Fix the extraction/modeling gaps documented in `docs/_issues/meiwa-async-server-action-modeling-gaps.md` by improving generic extractor behavior for:

- async handlers that await modeled effect APIs inside `try/catch/finally` blocks and assign response records afterward;
- finite nested response/status domains, especially string-literal unions inside object records;
- static branch guards from `window.confirm`, disabled/required UI state, and early-return submit handlers;
- common drag/drop state-reset handlers when they are statically visible and can be modeled without Meiwa-specific assumptions;
- duplicate action op-id inflation when an imported action is represented both as a friendly id and as an absolute `ACTION ...#name` id.

The end state should make Meiwa-style properties expressible without bespoke overlays for the listed flows, while preserving the existing async split, snapshot, and transition-id conventions.

# Non-goals

- Do not add Meiwa source files or tenant-specific logic to this repository.
- Do not hard-code names such as `FreeConsultPage`, `DefinitionList`, `requestFreeConsultationJob`, `draggingId`, `overId`, or `lineAccountId`.
- Do not redesign the IR schema or checker state-space algorithm.
- Do not add backward-compatibility shims for older extractor behavior; this package is experimental.
- Do not make unbounded drag/drop permutation modeling. Keep list/order abstractions bounded and aligned with existing `boundedList` and `lengthCat` patterns.
- Do not change generated docs under `docs/build/`.

# Current-State Findings

- `docs/_issues/meiwa-async-server-action-modeling-gaps.md` lists five root gaps: async server action modeling, nested literal domains, `window.confirm` guards, drag/drop handlers, and disabled/early-return submit guards.
- `src/extract/engine/ts/transition/async.ts` owns async handler splitting. `transitionsFromAsyncHandler` currently finds only direct awaited effect statements via `expressionStatementAwait`/`awaitedCall`, then builds `.start`, `.success`, and `.error` transitions.
- `src/extract/engine/ts/transition/async.ts:63-126` finds the first awaited effect in the top-level body or the first `try` block and rejects later awaited modeled effects with `awaited-effect-in-async`.
- `src/extract/engine/ts/transition/async.ts:73-78` extracts pending op args from the awaited call, but `awaitedCallExpressionInStatement` only recognizes `await api.call()` expression statements and `const x = await fetch(...)`, not `const result = await action(...)` for arbitrary effect APIs.
- `src/extract/engine/ts/transition/async.ts:127-190` snapshots reads from success/catch/finally summaries, but response values returned from awaited calls are not bound into continuation locals.
- `src/extract/engine/ts/transition/statement-summary.ts` is the shared straight-line/branch summarizer used by both sync handlers and async continuation segments.
- `src/extract/engine/ts/transition/statement-summary.ts:136-174` exposes `summarizeStatements`/`summarizeAsyncSegment`; any async result binding should flow through this path instead of building Meiwa-specific continuation effects.
- `src/extract/engine/ts/transition/statement-summary.ts:403-455` already models guard-return patterns like `if (draft === "empty") return; setSaved(...)` as an `if` effect, which is the right existing pattern for early-return submit guards.
- `src/extract/engine/ts/transition/guards.ts:137-164` implements `disabled` and `aria-disabled` guards, and `submitButtonDisabledAttribute` at `src/extract/engine/ts/transition/guards.ts:167-200` finds submit-button disabled state for form `onSubmit`.
- `src/extract/engine/ts/transition/guards.ts:226-271` parses identifiers, property reads, boolean negation, and binary guards, but does not model `window.confirm(...)` or equivalent confirm APIs as a branch source.
- `src/extract/engine/ts/react-source-transitions.ts:780-878` emits `no-extractable-effect` when event handlers or component-prop handlers yield no transitions. Reducing false `no-extractable-effect` reports requires the generic handler paths to extract more cases, not suppress diagnostics.
- `src/extract/engine/ts/type-domains.ts:366-407` preserves simple string-literal unions, but object-union and some object/indexed cases fall back to tokens.
- `src/extract/engine/ts/type-domains.ts:422-430` begins semantic object-domain inference; inspect the rest of `domainFromObjectType` before changing it. The likely fix is to preserve finite property domains inside record/object types more consistently, not to special-case `status`.
- Existing tests around the affected areas live in `test/extraction/extraction.test.ts`:
  - async split: `splits simple async handlers into enqueue and resolve transitions` around line 3147;
  - snapshot reads after await: around line 3256;
  - async args: around line 3299;
  - escaped setters after await: around line 3344;
  - sequential awaits: around line 3379;
  - disabled async starts: around line 2304;
  - early-return summaries: around line 4102.
- CLI-level disabled/form guard coverage lives in `src/cli/features/extract/command.test.ts:1260-1355`.
- Next server-action discovery coverage lives in `src/cli/features/extract/next-extract.test.ts`, including `discovers server action effect APIs from action modules` around line 183.

# Exact File Paths and Relevant Symbols

- `docs/_issues/meiwa-async-server-action-modeling-gaps.md`
  - Source issue to close or update after implementation.
- `src/extract/engine/ts/transition/async.ts`
  - `transitionsFromAsyncHandler`
  - `transitionsFromSequentialAwait`
  - `expressionStatementAwait`
  - `awaitedCall`
  - `awaitedCallExpressionInStatement`
  - `effectCallArgs`
  - `containsAwaitedEffect`
  - `pendingIs` / `pendingIsAt`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `StatementSummaryOptions`
  - `summarizeStatements`
  - `summarizeAsyncSegment`
  - `summarizeStatementList`
  - `summarizeGuardedRest`
  - `summarizeIfStatement`
  - `summarizeTryStatement`
  - `helperSummariesFromCall`
- `src/extract/engine/ts/transition/guards.ts`
  - `parseGuardExpression`
  - `parseBinaryGuardExpression`
  - `parseGuardOperand`
  - `disabledGuardFor`
  - `submitButtonDisabledAttribute`
  - `combineParsedGuards`
- `src/extract/engine/ts/type-domains.ts`
  - `inferDomainFromTypeDetailed`
  - `inferDomainFromTypeNodeSemanticDetailed`
  - `inferDomainFromExpressionSemanticDetailed`
  - `domainFromUnionType`
  - `inferUnionMembers`
  - `domainFromObjectType`
  - `tryTaggedUnion`
- `src/extract/engine/ts/domains.ts`
  - `inferUseStateDomainSemanticDetailed`
  - `inferUseStateDomainDetailed`
  - `domainFromTypeLiteralDetailed`
  - `domainFromTypeReferenceDetailed`
  - `initialValueForUseStateDetailed`
- `src/cli/features/extract/command.ts`
  - inspect only if duplicate server-action op ids originate in CLI effect API collection/model assembly.
- `src/cli/features/extract/next-extract.test.ts`
  - Next action op-id regression tests.
- `test/extraction/extraction.test.ts`
  - Core extraction regression tests.
- `src/cli/features/extract/command.test.ts`
  - CLI/form/disabled regression tests.

# Existing Patterns to Follow

- Keep extraction improvements in shared helpers such as `async.ts`, `statement-summary.ts`, `guards.ts`, and domain inference modules rather than patching `react-source-transitions.ts` diagnostics.
- Follow the existing async split model: a user `.start` transition enqueues an op and env `.success`/`.error` transitions dequeue and apply continuation effects.
- Preserve the snapshot convention used in `async.ts`: post-await reads of pre-await state are captured as `snap:<varId>` args and read via `readOpArg`.
- Preserve `applyParsedGuard` semantics: disabled/render guards apply only to user transitions, not env continuations.
- Use `EffectIR` `if` and `seq` effects instead of cloning multiple transitions when modeling static branches inside a handler.
- Prefer over-approximation with explicit `confidence: "over-approx"` only when exact expression/value modeling is not statically available.
- Keep transition ids stable and compositional: `${component}.${attr}.${op}.start`, `${component}.${attr}.${op}.success`, and existing `.seq`/`.if` suffix conventions.
- Add warnings/caveats only when behavior remains materially over-approximated or unsupported; do not merely hide existing warnings.

# Atomic Implementation Steps

## 1. Add Focused Failing Regression Fixtures First

Create minimal TSX snippets that mirror the Meiwa patterns without importing tenant code.

Add tests in `test/extraction/extraction.test.ts` for:

- async `try/catch/finally` with `const result = await api.requestJob({ prompt, lineAccountId })`, then `setJob(result.job)` or `setStatus(result.job.status)`;
- post-await result property reads preserving finite status values such as `"pending" | "processing" | "completed" | "failed"`;
- stale-result protection pattern, for example snapshotting selected account before await and guarding continuation writes with `if (selectedAccountId !== result.accountId) return;`;
- `if (!prompt) return; await api.requestJob(...)` or form/button disabled equivalent suppressing the enqueue when prompt is empty;
- `if (!window.confirm("Delete?")) return; await api.deleteDefinition(...)` gating enqueue behind the accepted branch;
- drag/drop-style handlers that set `draggingId`, set `overId`, and reset both on drop/end.

Add tests in `src/cli/features/extract/next-extract.test.ts` or `src/cli/features/extract/command.test.ts` for:

- server action imports producing one canonical op id per action, not both a friendly id and `ACTION ...#name` for the same imported binding;
- form submit transitions inheriting disabled/required guards for empty-label examples.

Per-step files to edit:

- `test/extraction/extraction.test.ts`
- `src/cli/features/extract/next-extract.test.ts`
- `src/cli/features/extract/command.test.ts`

Stop and ask/report if:

- The test helpers cannot create a TypeScript semantic checker for the domain fixture and the gap only reproduces through full CLI extraction.
- The server-action duplicate id source cannot be reproduced with a minimal fixture.

## 2. Generalize Awaited Effect Detection and Result Binding

Extend `async.ts` so arbitrary modeled effect APIs can be awaited in variable declarations, not only direct expression statements and `fetch`.

Implementation shape:

- Introduce an internal `AwaitedEffect` shape containing:
  - `op: string`;
  - `call: ts.CallExpression`;
  - `statement: ts.Statement`;
  - optional `bindingName` when the statement is `const/let/var name = await effectApi(...)`;
  - optional `bindingDomain` or outcome-domain metadata if available from `asyncOutcomes`.
- Replace `expressionStatementAwait`, `awaitedCall`, and `awaitedCallExpressionInStatement` internals with a single finder that recognizes:
  - `await api.call(...)`;
  - `const x = await api.call(...)`;
  - `const x = await fetch(...)`;
  - keep `Promise.all` handling unchanged unless a test proves it needs result binding too.
- Thread result bindings into success/catch/finally summarization through `summarizeAsyncSegment` or a new option on `summarizeStatements` that seeds continuation locals.
- Bind a result object to `readOpArg`-style expressions or an equivalent stable IR expression for payload fields. If the current IR cannot represent response payloads beyond op args, stop and report before inventing a schema-breaking representation.
- Keep `await-in-loop` behavior unchanged.

Per-step files to edit:

- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/transition/statement-summary.ts` if seeded continuation locals need to be passed into summaries.
- `src/extract/engine/ts/transition/expressions.ts` if property access over a result binding needs generalized support.
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- Async handlers using `const result = await api.action()` produce `.start` and `.success` transitions instead of `awaited-effect-in-block` or `awaited-effect-in-async`.
- The `.start` transition still carries visible call args such as `prompt` and `lineAccountId`.
- The `.success` transition can assign modeled state from `result.job.status` or `result.suggestions` when those values are finite or abstractable.
- Existing async tests around lines 3147-3585 still pass.

Stop and ask/report if:

- Modeling response payloads requires adding a new `ExprIR` kind or changing serialized model schema.
- Multiple awaited result bindings in the same continuation cannot be represented without confusing op-arg keys.

## 3. Preserve Finite Nested Record Domains

Improve semantic domain inference so nested object fields keep finite string-literal unions rather than collapsing to `{ kind: "tokens", count: 1 }`.

Implementation shape:

- Add tests for `useState<Job | null>(null)` and `useState<{ job: { status: "pending" | "processing" | "completed" | "failed" } } | null>(null)`.
- Inspect `domainFromObjectType` in `src/extract/engine/ts/type-domains.ts` and remove premature broad-string collapse only when the field type is actually a finite union or literal apparent type.
- Ensure `Record`/mapped/indexed object types do not collapse finite declared properties merely because an index type exists. Keep broad dictionary-only types as tokens.
- Preserve `option(record(...))` wrapping for nullish state.
- Confirm AST fallback in `src/extract/engine/ts/domains.ts` still handles type literals and aliases.

Per-step files to edit:

- `src/extract/engine/ts/type-domains.ts`
- `src/extract/engine/ts/domains.ts` only if AST fallback is needed for `Record` aliases
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- `local:FreeConsultPage.job.status`-style nested fields infer an enum domain with `pending`, `processing`, `completed`, and `failed` in minimal fixtures.
- Existing broad string fields still infer tokens.
- Recursive/large object safeguards remain in place.

Stop and ask/report if:

- The current model cannot express nested record-field domains for the relevant state shape.
- TypeScript checker output erases the literals before this layer receives them; report the exact type string and fixture.

## 4. Model Early-Return Preconditions as Enqueue Guards

Ensure simple pre-await guard returns restrict async `.start` transitions rather than producing enabled enqueues for impossible submits.

Implementation shape:

- Reuse `summarizeGuardedRest` and `parseGuardExpression` patterns from `statement-summary.ts`.
- In `transitionsFromAsyncHandler`, split pre-await statements into:
  - pure guard-return preconditions;
  - pre-await state effects;
  - the awaited effect statement.
- Convert guard-return conditions before the first awaited effect into a `ParsedGuard` and apply it to the user `.start` transition.
- Keep pre-await setter effects in the `.start` effect sequence.
- Preserve disabled/form guards by composing with `applyParsedGuard` in `handlers.ts`; do not duplicate those guards inside `async.ts`.

Per-step files to edit:

- `src/extract/engine/ts/transition/async.ts`
- `src/extract/engine/ts/transition/statement-summary.ts` if a reusable guard-return extractor belongs there
- `src/extract/engine/ts/transition/guards.ts` if guard parsing needs `trim()`, `.length`, or nullish checks for common empty-label/prompt patterns
- `test/extraction/extraction.test.ts`
- `src/cli/features/extract/command.test.ts`

Acceptance criteria:

- `if (!prompt) return; await api.requestJob()` produces a `.start` guard requiring non-empty/non-blank prompt when the prompt domain supports that distinction.
- `if (label === "") return; await api.createDefinition()` produces a `.start` guard excluding empty label.
- Existing sync early-return test around `test/extraction/extraction.test.ts:4102` still passes.
- Disabled guards still apply only to user transitions, matching `test/extraction/extraction.test.ts:2304`.

Stop and ask/report if:

- Prompt/label domains currently only contain `""`; in that case, first implement or request a domain refinement path for empty vs non-empty text instead of faking guards.

## 5. Add Generic Confirm Branch Guard Modeling

Support common confirm APIs as nondeterministic or branch guards without hard-coding delete flows.

Implementation shape:

- Extend guard parsing or statement summarization to recognize:
  - `window.confirm(...)`;
  - `confirm(...)`;
  - `globalThis.confirm(...)` if easy and consistent with `callName`.
- For patterns like `if (!window.confirm(...)) return; await api.deleteX()`, model the accepted branch as a user-start guard that includes a stable environment/choice predicate only if the IR already has a suitable representation.
- If the IR has no environment-choice variable, prefer producing two user transitions or an `if` effect only if that matches existing nondeterministic modeling conventions. Do not add a fake local state var unless it is a documented system var with tests.
- Ensure delete action enqueue is impossible on the rejected branch.

Per-step files to edit:

- `src/extract/engine/ts/transition/guards.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- `src/extract/engine/ts/transition/async.ts`
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- Confirm-gated async delete no longer reports `no-extractable-effect`.
- The resulting model has a path where delete is enqueued and a path where it is not.
- Properties can assert that delete enqueue happens only on the accepted confirm branch.

Stop and ask/report if:

- There is no existing IR-compatible way to expose the confirm choice to properties. Report the minimal IR addition needed before implementing it.

## 6. Tighten Required/Disabled Submit Guards for Empty Inputs

Handle visible HTML form constraints and submit-button guards that make empty-label submit paths impossible.

Implementation shape:

- Start with static cases already visible to the extractor:
  - submit button `disabled={label === ""}` or `disabled={!label}`;
  - handler `if (label === "") return;`;
  - input `required` tied to the same state variable through `value={label}` and `onChange`/setter patterns, only if this can be mapped reliably.
- Keep this generic by building a helper that derives submit preconditions from form descendants and state bindings, similar to `submitButtonDisabledAttribute`.
- Do not attempt full HTML validation semantics for arbitrary uncontrolled inputs.

Per-step files to edit:

- `src/extract/engine/ts/transition/guards.ts`
- `src/extract/engine/ts/react-source-transitions.ts` only for plumbing form descendant context if needed
- `src/extract/engine/ts/transition/handlers.ts` only for passing additional guard context
- `src/cli/features/extract/command.test.ts`
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- Minimal create/edit/option-label fixtures cannot enqueue create/save/add actions when label is empty.
- Existing disabled guard tests in `src/cli/features/extract/command.test.ts:1260-1355` still pass.
- Unsupported required patterns emit warnings instead of silently claiming exactness.

Stop and ask/report if:

- The extractor cannot relate an input `value` to submit state without broader form binding infrastructure.

## 7. Model Common Drag/Drop State Resets Conservatively

Add generic support for drag/drop handlers only where they are simple state writes or bounded-list reorder abstractions.

Implementation shape:

- First verify whether `onDragStart`, `onDragOver`, `onDrop`, and `onDragEnd` are already included by `isEventAttribute` in `src/extract/engine/ts/transition/ui.ts`. If not, add them there with labels consistent with existing event labels.
- Let existing sequential summary extraction handle direct setters such as `setDraggingId(id)`, `setOverId(id)`, `setDraggingId(null)`, `setOverId(null)`.
- For list reordering, model exact permutation only if the list domain is a `boundedList` with finite max length and both source/target indices are statically indexable. Otherwise use bounded-list havoc with `confidence: "over-approx"` and preserve length/permutation caveats in warnings.
- Do not implement DOM `dataTransfer` semantics.

Per-step files to edit:

- `src/extract/engine/ts/transition/ui.ts`
- `src/extract/engine/ts/transition/handlers.ts`
- `src/extract/engine/ts/transition/statement-summary.ts` only if drag event methods such as `preventDefault()` need to be ignored as no-ops
- `test/extraction/extraction.test.ts`

Acceptance criteria:

- Simple `DefinitionList`-style drag/drop fixtures produce transitions that reset `draggingId` and `overId`.
- Drag/drop tests assert no `no-extractable-effect` warning for direct setter handlers.
- Reorder preservation is either exact for bounded/indexed fixtures or explicitly over-approximated with a warning.

Stop and ask/report if:

- The real Meiwa handler relies on dynamic DOM payloads or arbitrary array splices that cannot be represented by current bounded-list IR.

## 8. Canonicalize Server Action Op IDs

Find and fix the source of duplicate pending op ids where an action import appears both as a friendly op id and as an absolute `ACTION ...#name` id.

Implementation shape:

- Reproduce with a Next fixture importing a server action and awaiting/calling it through the client component.
- Inspect CLI extraction code around effect API discovery/model assembly in `src/cli/features/extract/command.ts` and Next adapter discovery tests in `src/cli/features/extract/next-extract.test.ts`.
- Introduce a canonical op-id mapping at the boundary where effect APIs are collected, so all references to the same imported action symbol use one id.
- Prefer stable friendly ids when unambiguous; use absolute `ACTION ...#name` only to disambiguate collisions.
- Ensure `sys:pending` domains include each canonical op only once.

Per-step files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/features/extract/next-extract.test.ts`
- potentially `src/cli/registry` or Next plugin/adapter files if op ids originate there

Acceptance criteria:

- A server action fixture has one pending op id per imported action.
- Existing Next extraction tests still pass.
- Transition labels/ids and `sys:pending.inner.fields.opId` agree on the canonical id.

Stop and ask/report if:

- Canonicalization requires source-symbol identity that is unavailable without a TypeScript program/checker at that extraction phase.

## 9. Update Issue Documentation

After implementation and verification, update `docs/_issues/meiwa-async-server-action-modeling-gaps.md` to reflect resolved areas and any intentionally deferred gaps.

Implementation shape:

- If all acceptance criteria pass, move or mark the issue according to existing docs issue conventions.
- If drag/drop permutation or confirm choices remain partially modeled, keep the issue open with a smaller residual section.
- Do not edit `docs/build/`.

Per-step files to edit:

- `docs/_issues/meiwa-async-server-action-modeling-gaps.md`
- possibly `docs/_issues/closed/...` if this repo convention is to move closed issues

Stop and ask/report if:

- There is no clear convention for closing issue docs.

# Acceptance Criteria

- `FreeConsultPage`-style async server-action submit handlers are extracted into guarded `.start`, `.success`, and `.error` transitions when the effect API is configured/discovered.
- Awaited server-action result bindings can drive continuation state updates without collapsing finite nested statuses to opaque tokens.
- Stale-result guard patterns prevent continuation writes when the captured account/key no longer matches.
- Empty prompt/label submit transitions are disabled through static disabled/required/early-return guards where visible.
- `window.confirm`-gated delete flows model accepted vs rejected branches enough for properties to assert enqueue only after acceptance.
- Drag/drop handlers with direct modeled setters reset drag state and stop producing `no-extractable-effect`.
- Imported server actions produce canonical pending op ids without friendly/absolute duplicates.
- Existing extraction, checker, architecture, and Next tests continue to pass.

# Tests to Add or Update

- `test/extraction/extraction.test.ts`
  - async server-action variable await in `try/catch/finally`;
  - async result payload property assignment;
  - nested finite record status domain;
  - stale-result guard after await;
  - early-return precondition before awaited effect;
  - confirm-gated delete;
  - simple drag/drop event state reset.
- `src/cli/features/extract/command.test.ts`
  - form submit disabled/required/early-return empty label cases;
  - report does not include false `no-extractable-effect` for fixed fixtures.
- `src/cli/features/extract/next-extract.test.ts`
  - canonical server-action op-id fixture.
- Update any snapshots or report expectations only for intended diagnostic changes.

# Verification Commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
rtk pnpm test -- src/cli/features/extract/next-extract.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
rtk pnpm test
```

If checker semantics or model generation changes affect async continuation behavior, also run:

```bash
rtk pnpm phase7
```

# Risks, Ambiguities, and Stop Conditions

- Response payload modeling may require a first-class representation of async outcome payloads. Stop before changing IR schema unless a minimal schema extension is clearly necessary and tests are updated across validator/export/checker boundaries.
- Empty vs non-empty strings may not be representable when a state domain only contains `""` or a one-token string domain. Prefer a generic domain-refinement path over pretending the guard is exact.
- `window.confirm` choices need to be observable enough for properties. If current IR cannot expose the choice without a new system var or transition class, report the design gap before implementing a hidden approximation.
- Drag/drop reorder semantics can easily become unsound. Exact permutation support should be limited to bounded/indexed cases; otherwise emit over-approximate transitions and warnings.
- Server-action op-id canonicalization may require symbol-level identity. If extraction currently works from text fragments without a TypeScript program, avoid fragile path-string heuristics and report the needed plumbing.
- Do not suppress `unextractable` diagnostics globally. The fix should make specific handlers extractable or leave precise caveats.
- If any current test expects `awaited-effect-in-block` or `no-extractable-effect` for one of the newly supported generic patterns, update that test only after confirming the new model is more precise and still sound.
