# Handlers threaded through custom UI wrappers are unextractable, making safety properties pass vacuously

## Summary

In Supabase Studio, action handlers are routinely passed as props into custom
wrapper components from the shared `ui` package (`ConfirmationModal`, `Dialog`,
`ButtonTooltip`, custom `Button`) and/or invoked through small helper functions,
rather than attached to host elements or calling effects directly inline.
Extraction classifies these handlers as `unextractable` with
`no-extractable-effect`, so the model contains **no edges** that enqueue the
mutations or drive the state machine. Every "double submit cannot happen" /
"cannot submit while pending" safety property then passes **vacuously** — a green
check that verifies nothing.

This is the under-modeling counterpart to
`unextractable-handlers-cause-overapproximation.md` (which covers the
over-approximation/havoc symptom) and a generalization of
`react-hook-form-handle-submit-callbacks-unextractable.md` (which is one
instance). Here the trigger is **prop-threading into custom components**, not
React Hook Form specifically. The RHF case still reproduces in `0.0.34`.

## Reproduction

```bash
cd /Users/hari/proj/supabase/apps/studio

# 1) RestartServerButton: handlers go into ConfirmationModal/ButtonTooltip/DropdownMenuItem
npx modality extract \
  components/interfaces/Settings/General/Infrastructure/RestartServerButton.tsx \
  --effect-api useProjectRestartMutation \
  --effect-api useProjectRestartServicesMutation \
  --report .modality/restart.extraction-report.json
node -e 'const r=require(process.cwd()+"/.modality/restart.extraction-report.json");
console.log("coverage:",JSON.stringify(r.coverage));
console.log(r.handlers.map(h=>h.id+" -> "+h.classification).join("\n"))'

# 2) ResetDbPasswordDialog: handlers go into Dialog/Button
npx modality extract \
  components/interfaces/Settings/Database/DatabaseSettings/ResetDbPasswordDialog.tsx \
  --effect-api useDatabasePasswordResetMutation \
  --report .modality/reset.extraction-report.json
```

Relevant source shape:

```tsx
<ConfirmationModal
  visible={serviceToRestart !== undefined}
  loading={isLoading}
  onConfirm={async () => {
    if (serviceToRestart === 'project') await requestProjectRestart()
    else if (serviceToRestart === 'database') await requestDatabaseRestart()
  }}
  onCancel={() => setServiceToRestart(undefined)}
/>
// requestProjectRestart() -> restartProject({ ref }) (the mutate fn)
```

## Observed

`RestartServerButton` — all 3 handlers unextractable:

```text
coverage: {"exactOrOverlay":0,"handlersTotal":3,"unextractable":3,"percentExactOrOverlay":0}
RestartServerButton.onCancel  -> unextractable   (no-extractable-effect)
RestartServerButton.onClick   -> unextractable   (no-extractable-effect)
RestartServerButton.onConfirm -> unextractable   (no-extractable-effect)
```

Extracted model: `vars 1, transitions 0`. A `modality check` of liveness
witnesses + intended safety invariants then yields:

```text
⚠ confirmModalCanOpen           vacuous-warning  (No reachable witness within bounds)
⚠ projectRestartCanBeEnqueued   vacuous-warning
⚠ databaseRestartCanBeEnqueued  vacuous-warning
✓ cannotEnqueueProjectRestartWhileAnyRestartPending  verified-within-bounds  (vacuous)
✓ cannotEnqueueDatabaseRestartWhileAnyRestartPending verified-within-bounds  (vacuous)
✓ notBothRestartsPendingTogether                     verified                (vacuous)
```

`ResetDbPasswordDialog` — 3/4 handlers unextractable (only the reset `useEffect`
extracts); `dialogCanOpen` and `passwordResetCanBeEnqueued` are vacuous, so
`cannotDoubleSubmitReset` is vacuously verified.

The provided `ApiAuthorization.Valid` example behaves the same:
`approveCanEnterApprovingState` / `declineCanEnterDecliningState` are vacuous, so
`approve/declineOnlyStartsFromIndeterminate` are vacuously
`verified-within-bounds`.

## Expected

- Handlers passed as props into components (e.g. `onConfirm`, `onCancel`,
  `onOpenChange`) and handlers that call a local helper which performs the effect
  should be extractable: at minimum, local `useState` writes and configured
  `--effect-api` mutation calls reachable from the handler body should become user
  transitions, even across one level of helper-function or prop indirection.
- Alternatively, a supported overlay locator to bind a custom component's callback
  prop to a triggerable transition. The overlay merger currently only **replaces**
  extracted transitions; it cannot **add** transitions for unextractable handlers
  (noted in the RHF issue), so there is no clean workaround today.

## Impact

These are exactly the components where state-transition bugs hide — destructive
confirm dialogs, password resets, approve/decline flows. With no extractable
action edges, modality cannot find double-submit, both-pending, failure-reset, or
stale-completion bugs, and worse, it reports the corresponding safety properties
as verified.

## Recommendation for users (until fixed)

Always pair safety `always`/`alwaysStep` properties with `reachable(...)`
liveness witnesses for the triggering states/effects. If the witnesses are
`vacuous-warning`, the safety verdicts are meaningless.

## Environment

- `modality-ts@^0.0.34`
- App: Supabase Studio, Next.js pages router, React 19, shared `ui` (shadcn-based)
  wrapper components.
