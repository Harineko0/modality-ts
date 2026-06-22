# Generated `*.modals.ts` member handles fail to resolve in properties (`Could not resolve generated modal member`)

## Summary

The documented way to reference state in a `*.props.ts` is to import the generated
handle object from the sibling `*.modals.ts` and use a member (e.g. `App.step`).
Doing exactly that fails at extract/check time with `Could not resolve generated
modal member ... to a modeled state variable or transition`, even though the
member wraps a valid `variable("local:...")` id that exists in the model. Using a
raw `variable("local:...")` for the same id resolves fine.

## Reproduction

```bash
cd /Users/hari/proj/supabase/apps/studio
npx modality generate \
  components/interfaces/Settings/General/Infrastructure/RestartServerButton.tsx
```

Generated `RestartServerButton.modals.ts`:

```ts
import { variable, type Variable } from 'modality-ts/core'

export const RestartServerButton = {
  serviceToRestart: variable('local:RestartServerButton.serviceToRestart') as Variable<
    { readonly kind: 'enum'; readonly values: readonly ['database', 'project'] },
    'local:RestartServerButton.serviceToRestart'
  >,
}
```

`RestartServerButton.props.ts` using the generated member (per docs):

```ts
import { neq, reachable } from 'modality-ts/properties'

import { RestartServerButton } from './RestartServerButton.modals'

reachable('confirmModalCanOpen', neq(RestartServerButton.serviceToRestart, 'none'))
```

```bash
npx modality extract   # (discovery) or explicit
```

## Observed

```text
RestartServerButton.props.ts: Could not resolve generated modal member
"RestartServerButton.serviceToRestart" to a modeled state variable or transition.
Regenerate the component var module or use var(...) / s(Component).field instead.
```

Switching to the raw id resolves with no other change:

```ts
import { neq, reachable, variable } from 'modality-ts/properties'

const serviceToRestart = variable('local:RestartServerButton.serviceToRestart')
reachable('confirmModalCanOpen', neq(serviceToRestart, 'none')) // OK
```

(The provided `ApiAuthorization.Valid.props.ts` example also avoids the generated
member and uses raw `variable('local:ApiAuthorizationValidScreen.approvalState')`,
suggesting the author hit the same wall.)

## Expected

A freshly `generate`d modal member should resolve in properties without
modification — it is the documented, type-safe path. Either the loader should
resolve generated members to their wrapped var id, or the error should explain the
actual precondition (e.g. regenerate after extract, or the var is route-scoped and
unresolved) rather than pointing to `var(...)` / `s(Component).field` as the only
fix.

## Impact

The recommended, type-checked authoring path (import handles from `*.modals.ts`)
does not work out of the box, pushing users to stringly-typed raw `variable(...)`
ids that lose the generated types and are easy to typo.

## Environment

- `modality-ts@^0.0.34`
- App: Supabase Studio (`apps/studio`).
