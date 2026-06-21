# Spec 08 — Route Execution Templates

Route execution is modeled as a provider-supplied descriptor plus a framework-agnostic template builder.

The SPI exposes `RouteExecutionProvider`, which returns:

- resources: abstract server-persisted state,
- loaders: route-bound data producers and the resources they read,
- actions: server mutations and the loaders they revalidate.

The shared builder emits only existing IR constructs: state variables, `enqueue`, `dequeue`, `havoc`, assignments, and `resolve`/`internal` labels. It does not add checker semantics or new IR node kinds.

Required lifecycle:

1. loader fetch enqueues a loader op while the route is current and the loader is stale,
2. loader resolve chooses abstract data or records an error,
3. action invoke enqueues the action op and marks the action pending,
4. action success mutates resource tokens and enqueues a revalidation continuation,
5. revalidation marks affected loaders stale and enqueues loader refetch ops.

Framework adapters are responsible only for mapping framework-specific facts into the descriptor. Next.js maps `DATA ...` ops to loaders, `ACTION ...` ops to actions, and `revalidatePath`/refresh calls to loader revalidation edges. React Router maps route `loader()`/`action()` exports to `DATA <route>`/`ACTION <route>` and conservatively revalidates known loaders after actions. TanStack Router maps discovered `LOADER <route>` ops to route loaders.
