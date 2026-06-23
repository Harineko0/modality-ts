---
id: react-hook-form
title: React Hook Form
sidebar_label: React Hook Form
---

`react-hook-form` is supported via a dedicated **handler-wrapper adapter**. The adapter
unwraps `form.handleSubmit(cb)` and `handleSubmit(cb)` so that the inner callback body is
treated as an ordinary extractable handler — enabling local state writes and configured
mutation effect APIs to be extracted just as if the handler were assigned directly.

## What is handled

- `const form = useForm(); form.handleSubmit(cb)` — recognized via `form` binding.
- `const { handleSubmit } = useForm(); handleSubmit(cb)` — recognized via destructuring.
- Aliased renames (`const { handleSubmit: onSubmit } = useForm()`) — followed.
- Guard peeling: leading `if (state !== "value") return` statements become per-transition
  guards on all extracted transitions.
- Callback-style mutation calls inside the handler body (see below).

## Callback-style mutations

React Hook Form handlers often call mutation helpers **without `await`**, passing a
callbacks object instead:

```ts
approveRequest(
  { id, slug },
  { onError: () => setApprovalState("indeterminate") },
);
```

The extractor models these as a three-transition lifecycle — the same shape as
`await`-based async:

| Transition | Class | What happens |
| --- | --- | --- |
| `<comp>.<attr>.<op>.start` | `user` | state writes before the call + `enqueue(op)` |
| `<comp>.<attr>.<op>.success` | `env` | guarded on `pending`, runs `onSuccess` body |
| `<comp>.<attr>.<op>.error` | `env` | guarded on `pending`, runs `onError` body |

Both `onSuccess` and `onError` may be concise arrow bodies (`() => setState(v)`) or block
arrows (`() => { setState(v); doMore(); }`).

## Activation

The adapter registers automatically when `react-hook-form` appears in the app's
`package.json` dependencies. It can be disabled with:

```bash
modality extract ... --disable-plugin react-hook-form
```

## Usage example

```ts
const [approvalState, setApprovalState] = useState<ApprovalState>("indeterminate");
const form = useForm();

const onApprove = form.handleSubmit((values) => {
  if (approvalState !== "indeterminate") return;
  setApprovalState("approving");
  approveRequest(
    { id, slug: values.selectedOrgSlug },
    { onError: () => setApprovalState("indeterminate") },
  );
});
```

With `--effect-api approveRequest`, this extracts:

- **user** `onApprove.approveRequest.start` — guard: `approvalState = indeterminate`; writes `approvalState = approving`, enqueues `approveRequest`.
- **env** `onApprove.approveRequest.error` — writes `approvalState = indeterminate`, dequeues.

## External child component support

Handlers passed as props to **external** (non-locally-defined) child components are now
extracted using the prop name as the event attribute. Previously, the system required the
child component to be locally defined so it could trace how the prop was forwarded to a
DOM event. With the react-hook-form adapter, the handler body is analyzed directly when
the child component is not available.

## Entry point

```ts
import { reactHookFormSource } from "modality-ts/extract/plugins/framework/react-hook-form";
```

This is a `HandlerWrapperProvider` — it implements the
`modality-ts/extract/engine/spi` contract's `handler-wrapper` kind rather than the
`StateSourcePlugin` state-source kind, because it contributes no state variables of its
own.
