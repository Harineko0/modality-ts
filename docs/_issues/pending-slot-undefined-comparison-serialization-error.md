# Comparing a `pending` slot to the `undefined` literal produces an opaque serialization error

## Summary

A natural way to express "any operation is in flight" is to compare a `pending`
slot to `undefined`, e.g. `neq(pending.at('0', 'opId'), undefined)`. This
serializes to something `check` rejects with a low-level Rust enum error
(`data did not match any variant of untagged enum StepPredicateSpec`) instead of a
helpful validation message. There is also no obvious ergonomic predicate for
"slot is empty/occupied", forcing users to enumerate every possible `opId`.

## Reproduction

```bash
cd /Users/hari/proj/supabase/apps/studio
```

`RestartServerButton.props.ts`:

```ts
import { alwaysStep, neq, stepEnqueued } from 'modality-ts/properties'
import { pending } from 'modality-ts/vars'

const restartProjectOp = 'useProjectRestartMutation'

alwaysStep('cannotEnqueueProjectRestartWhileAnyRestartPending', {
  negate: true,
  step: stepEnqueued(restartProjectOp),
  pre: neq(pending.at('0', 'opId'), undefined), // "slot 0 occupied"
})
```

```bash
npx modality check
```

## Observed

```text
invalid request JSON: data did not match any variant of untagged enum
StepPredicateSpec at line 1 column 5951
```

The message exposes the internal request JSON column offset and names no property,
predicate, or file. Replacing the `undefined` comparison with an explicit op-id
equality works:

```ts
pre: eq(pending.at('0', 'opId'), restartProjectOp) // OK
```

## Expected

- Either support comparing a list-slot field to `undefined`/absent (meaning the
  slot is empty), or reject it at the JS property-builder layer with a clear
  message naming the property and the unsupported operand.
- Provide an ergonomic predicate for slot occupancy (e.g. `pendingEmpty()`,
  `pendingHas(opId)`, or `pending.length` comparisons) so "no operation in flight"
  / "any operation in flight" does not require enumerating every `opId`.
- Surface the offending property/file in the diagnostic rather than a raw serde
  enum mismatch with a byte offset.

## Impact

"No double submit" / "cannot start X while anything is pending" properties are a
primary modality use case. The intuitive formulation fails with an undebuggable
error, and the working formulation does not generalize when many distinct ops can
occupy a slot.

## Environment

- `modality-ts@^0.0.34`
- App: Supabase Studio (`apps/studio`).
