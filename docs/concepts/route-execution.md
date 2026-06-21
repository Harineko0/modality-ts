# Route Execution

Route execution models the server-side loop that many React frameworks hide behind navigation or form submission:

1. a loader fetches route data,
2. a server action mutates server-owned state,
3. the framework revalidates affected loaders,
4. the client renders from the refreshed loader data.

`modality-ts` models this loop with a lightweight abstraction. Server functions are not compiled or symbolically executed. Instead, framework adapters describe loaders, actions, resources, and revalidation edges, then a shared template turns that descriptor into ordinary IR variables and transitions.

## What Gets Modeled

Each server resource becomes a finite token variable with `role: cache-entry`. A loader gets:

- `route:loader:<id>:data`
- `route:loader:<id>:status`
- `route:loader:<id>:stale`

An action gets `route:action:<id>:status`, which prevents a second invoke transition while the action is pending.

The generated transitions use the same pending queue and environment resolution model as client-side effect APIs:

- loader fetch enqueues the loader op when its route is current and data is stale,
- loader success chooses an abstract data token, or `null` for gated loaders,
- loader error marks the loader as errored,
- action invoke enqueues the action op,
- action success mutates abstract resources and enqueues revalidation,
- revalidation marks affected loaders stale and enqueues their refetch ops.

## Framework Support

The built-in Next.js mapper recognizes discovered `DATA ...` and `ACTION ...` effect ops, plus `revalidatePath(...)` and `router.refresh()`-style refresh calls. `revalidatePath("/dashboard")` connects an action to loaders for `/dashboard`; refresh connects to all known route loaders in the extracted app.

The built-in React Router mapper recognizes route `loader()` exports as `DATA <route>` ops and route `action()` exports as `ACTION <route>` ops. Actions conservatively revalidate known route loaders, matching the framework's post-action refresh behavior at an abstract level.

The built-in TanStack Router mapper recognizes discovered `LOADER <route>` ops and models their route data lifecycle through the shared template. TanStack route actions are not invented by this layer; they can be added later by mapping a framework-specific mutation primitive into the same descriptor shape.

This is intentionally conservative. Returned server data is represented by abstract tokens, not by executing loader or action bodies. That makes bugs around stale data, missing revalidation, gated data, and double-submit behavior visible without introducing framework-specific IR nodes.
