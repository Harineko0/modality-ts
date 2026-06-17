# Meiwa async server-action flows need sharper modeling

## Context

While adding `*.props.ts` files under `~/proj/magica/curoco/frontend/tenant-meiwa`, the best-fit pages were:

- `src/app/consult/FreeConsultPage.tsx`
- `src/app/settings/attributes/AttributesSettingsPage/index.tsx`

Both pages lean on Next server actions, promise chains, cancellation flags, and form/DOM events.

## Observed Gaps

`FreeConsultPage` extraction reports:

- `FreeConsultPage.onSubmit` as `unextractable`, reason `awaited-effect-in-block`.
- `local:FreeConsultPage.job.status` as a token rather than the semantic statuses `pending | processing | completed | failed`.
- `local:FreeConsultPage.prompt` as only `""`, so properties for "blank prompt cannot submit" or "non-empty prompt enqueues a request" cannot be expressed ideally.

`AttributesSettingsPage` extraction reports:

- Drag/drop handlers in `DefinitionList` as `unextractable`.
- `DefinitionEditor.useEffect` and `OptionRow.useEffect` as `unextractable`.
- `window.confirm` delete flow as `no-extractable-effect`.
- Several action imports appear both as friendly op ids and absolute `ACTION ...#name` ids, inflating `sys:pending`.

## Ideal Properties Blocked

- Free consult submit should enqueue `requestFreeConsultationJob` only when a line account is selected and prompt is non-empty.
- Completed consultation jobs should hydrate suggestions and stop polling; failed jobs should stop polling and expose an error.
- Stale polling results after line-account switch should not mutate the new account's job/suggestions/history state.
- Attribute drag/drop should reset `draggingId` and `overId` and preserve a permutation of definitions.
- Delete should only enqueue after the confirm branch accepts.
- Empty-label submit paths should be impossible when buttons are disabled or handlers return early.

## Bug-Revealing Properties Added

The Meiwa property files intentionally keep failing properties so future extractor/checker improvements have concrete regression targets:

- `lineAccountChangeClearsConsultState_bug` currently fails on an unrelated input transition, exposing the confusing positive `alwaysStep`/transition-slicing behavior.
- `emptyCreateDefinitionLabelCannotSubmit_bug` currently fails because the create-definition submit transition is modeled as enabled even when `label === ""`.
- `emptyOptionLabelCannotSubmit_bug` currently fails because the option-add submit transition is modeled as enabled even when `label === ""`.
- `emptyDefinitionEditLabelCannotSubmit_bug` currently fails because the definition-label save transition is modeled as enabled even when `labelDraft === ""`.
- `emptyDefinitionsHaveNoSelection_bug` currently fails because `DefinitionList.onClick.selectedDefinitionId.unrepresentable` can havoc a selection even when `definitions === "0"`.

## Suggested Fix Areas

- Model `async` handlers with awaited server actions inside `try/catch/finally` blocks.
- Preserve finite string literal unions inside nested response records instead of collapsing them to tokens.
- Support common DOM APIs used as branch guards, especially `window.confirm`.
- Add first-class drag event modeling or a documented overlay pattern for drag/drop workflows.
- Incorporate simple disabled/required/early-return guards into submit transition guards where they are statically visible.
