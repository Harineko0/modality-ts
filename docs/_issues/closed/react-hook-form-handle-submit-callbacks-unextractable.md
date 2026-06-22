# React Hook Form `handleSubmit` Callbacks Are Unextractable

## Summary

Callbacks passed to `react-hook-form`'s `form.handleSubmit(...)` were not
extracted as user transitions, even though they contain simple local `useState`
writes and mutation calls. Safety properties over pending operations passed
vacuously because the relevant submit transitions were absent from the model.

## Reproduction Context

Target app: Supabase Studio (repo: ~/proj/supabase/)

Target component:

```text
apps/studio/components/interfaces/ApiAuthorization/ApiAuthorization.Valid.tsx
```

Relevant source shape:

```ts
const [approvalState, setApprovalState] =
  useState<ApprovalState>("indeterminate")

const onApproveRequest = form.handleSubmit((values) => {
  if (approvalState !== "indeterminate") {
    return
  }
  setApprovalState("approving")
  approveRequest(
    { id: auth_id, slug: values.selectedOrgSlug },
    { onError: () => setApprovalState("indeterminate") }
  )
})

const onDeclineRequest = form.handleSubmit((values) => {
  if (approvalState !== "indeterminate") {
    return
  }
  setApprovalState("declining")
  declineRequest(
    { id: auth_id, slug: values.selectedOrgSlug },
    { onError: () => setApprovalState("indeterminate") }
  )
})
```

Those callbacks are passed to child buttons:

```tsx
<ApiAuthorizationMainView
  approvalState={approvalState}
  onApprove={onApproveRequest}
  onDecline={onDeclineRequest}
/>
```

Command shape:

```bash
modality extract apps/studio/components/interfaces/ApiAuthorization/ApiAuthorization.Valid.tsx \
  --props apps/studio/components/interfaces/ApiAuthorization/ApiAuthorization.Valid.props.ts \
  --effect-api useApiAuthorizationApproveMutation \
  --effect-api useApiAuthorizationDeclineMutation

modality check apps/studio/.modality/api-authorization-valid.model.json \
  apps/studio/components/interfaces/ApiAuthorization/ApiAuthorization.Valid.props.ts
```

## Observed

The extraction report classified the relevant handlers as unextractable:

```text
ApiAuthorizationValidScreen.onApprove: no-extractable-effect
ApiAuthorizationValidScreen.onDecline: no-extractable-effect
```

The extracted model contained only one unrelated navigation transition from an
error screen. It did not contain user transitions that assign:

```text
approvalState = "approving"
approvalState = "declining"
```

As a result, reachability properties for those states returned:

```text
approveCanEnterApprovingState vacuous-warning
  No reachable witness within bounds

declineCanEnterDecliningState vacuous-warning
  No reachable witness within bounds
```

## Expected

`form.handleSubmit((values) => { ... })` should be treated as a submit/action
wrapper whose callback body is extractable. At minimum, simple local state writes
inside the callback should become user transitions, and configured mutation
effect APIs should enqueue pending operations.

## Impact

React Hook Form is common in production React apps. If `handleSubmit` wrappers are
opaque, modality-ts cannot model many form flows where state-transition bugs are
especially likely: double submit guards, loading states, mutation failure resets,
and stale async completion handling.

## Notes

The component's local state domain could be refined with an overlay, but the
installed overlay merger only allows replacing extracted transitions, not adding
missing transitions for unextractable handlers. That means this gap could not be
worked around cleanly through an overlay in this run.
