# Numeric `lessThan` / `lt` is rejected inside an `alwaysStep` `pre` predicate

## Summary

Using the numeric helper `lessThan(...)` (lowered to expression kind `lt`) inside
the `pre` of an `alwaysStep` property is rejected by `check` with
`has unsupported expression kind lt`. Numeric comparisons are documented helpers
(`lessThan`, `greaterThan`, etc.) and work elsewhere, but they cannot be used to
gate a step predicate's pre-state, which blocks a common class of guard
properties ("action X must not fire while a numeric score/count is below N").

## Reproduction

```bash
cd /Users/hari/proj/supabase/apps/studio
```

`ResetDbPasswordDialog.props.ts`:

```ts
import { alwaysStep, lessThan, stepEnqueued, variable } from 'modality-ts/properties'

const passwordStrengthScore = variable('local:ResetDbPasswordDialog.passwordStrengthScore')
const resetOp = 'useDatabasePasswordResetMutation'

// "a reset must never be enqueued while strength is below the minimum (4)"
alwaysStep('cannotSubmitWeakPassword', {
  negate: true,
  step: stepEnqueued(resetOp),
  pre: lessThan(passwordStrengthScore, 4),
})
```

```bash
npx modality check
```

## Observed

```text
ResetDbPasswordDialog.props.ts[2].predicate.pre has unsupported expression kind lt
```

The error occurs regardless of the variable's domain (reproduced both with the
collapsed `boundedInt 0..0` extraction and after an overlay widened it to
`boundedInt -1..4`). The whole props file errors out, so sibling properties in the
same file are not checked either.

## Expected

Numeric comparison expressions (`lt`, `lte`, `gt`, `gte`) should be supported in
`alwaysStep` `pre`/`post` predicates, the same as in `always`/`reachable`
predicates. If a specific lowering cannot support them, the diagnostic should name
the property and suggest a supported reformulation rather than emitting a generic
"unsupported expression kind" and failing the entire file.

## Impact

Numeric guard invariants — "cannot submit while strength < minimum", "cannot
checkout while quantity < 1", "cannot advance while progress < 100" — are a core
state-transition bug class and cannot currently be expressed as step
preconditions.

## Environment

- `modality-ts@^0.0.34`
- App: Supabase Studio (`apps/studio`).
