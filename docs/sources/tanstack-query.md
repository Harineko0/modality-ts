---
id: tanstack-query
title: TanStack Query
sidebar_label: TanStack Query
---

TanStack Query (`@tanstack/react-query` v5) is a first-class state source. Query cache
entries and mutation lifecycles are modeled as hand-written
[library templates](../architecture/ir.md#library-templates) instantiated per static
`queryKey` / mutation site, with QueryClient cache APIs lowering to structured writes.

## What is discovered

- **Query hooks** — `useQuery`, `useSuspenseQuery`, `useInfiniteQuery`,
  `useSuspenseInfiniteQuery` (bounded page-window for infinite queries).
- **Mutation hooks** — `useMutation` with `mutate` / `mutateAsync` / `reset` write
  channels.
- **Aggregate hooks** — `useIsFetching`, `useIsMutating`, `useMutationState` for static
  filters.
- **QueryClient APIs** — `invalidateQueries`, `setQueryData`, `setQueriesData`,
  `removeQueries`, `resetQueries`, `refetchQueries`, `cancelQueries`, `fetchQuery`,
  `prefetchQuery`, `ensureQueryData`.
- **Options helpers** — `queryOptions`, `infiniteQueryOptions`, `mutationOptions`, and
  local `const options = queryOptions({...})` bindings when statically visible.

## Per-query cache vars

For each modeled `queryKey` the template defines:

| Var | Domain | Role |
| --- | --- | --- |
| `tanstack-query:<key>:data` | `option P` | cached payload |
| `tanstack-query:<key>:status` | `pending \| success \| error` | query status |
| `tanstack-query:<key>:fetchStatus` | `idle \| fetching \| paused` | in-flight state |
| `tanstack-query:<key>:stale` | `bool` | stale flag |
| `tanstack-query:<key>:invalidated` | `bool` | invalidation guard |
| `tanstack-query:<key>:failureCount` | `0 \| 1 \| max` | bounded retries |

`tanstackQueryView(state, keyId)` projects hook-facing booleans (`isLoading`,
`isFetching`, `isStale`, `loadedSome`, …) without duplicating every derived field as a
state var.

## Query key classification

| Key shape | Result |
| --- | --- |
| string / numeric literals | exact key |
| tuple `['todos', id]` | key with identifier segments → bounded window or caveat |
| object literals | canonicalized (property-order independent) |
| `queryOptions({...})` / local options binding | resolved when static |
| dynamic / predicate filters | `model-slack` caveat + sound over-approximation |

## Harness observation

Replay/conformance wraps components in a fresh `QueryClient` + `QueryClientProvider`.
The harness reads:

- `queryClient.getQueryData` / `getQueryState` for query vars
- `queryClient.getMutationCache()` for mutation vars
- `initialState` fallback when handles are unavailable

## Non-goals (v1)

Persistence, hydration/dehydration, broadcast, streamed queries, legacy `react-query`
v3/v4, and executing user `queryFn` / `mutationFn` bodies. Predicate filters and dynamic
updaters are caveated; matched cache data may be `havoc`'d rather than silently dropped.
