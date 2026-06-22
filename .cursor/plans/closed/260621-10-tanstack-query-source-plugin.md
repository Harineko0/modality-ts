# TanStack Query Support Plan

## 1. Goal

Add first-class TanStack Query support as a built-in `StateSourcePlugin` for
`@tanstack/react-query` v5, so `modality extract`, `check`, `replay`, and
`conform` can model server-state behavior from React Query hooks and QueryClient
cache APIs.

Support the common React Query surface end-to-end:

- Query hooks: `useQuery`, `useSuspenseQuery`, `useInfiniteQuery`,
  `useSuspenseInfiniteQuery`, `useQueries`, and `useSuspenseQueries`.
- Mutation hooks: `useMutation`, `useIsMutating`, and `useMutationState`.
- Fetching indicators: `useIsFetching`.
- QueryClient APIs used from handlers/effects: `invalidateQueries`,
  `refetchQueries`, `cancelQueries`, `removeQueries`, `resetQueries`,
  `setQueryData`, `setQueriesData`, `fetchQuery`, `prefetchQuery`,
  `ensureQueryData`, plus the infinite-query equivalents where keys are static.
- Query options helpers: `queryOptions`, `infiniteQueryOptions`,
  `mutationOptions`, and local wrappers that return static options objects.
- Replay/conformance harness support through a fresh `QueryClient` and
  `QueryClientProvider`, with direct observation of query and mutation cache
  state.

Official TanStack Query documentation checked:

- https://tanstack.com/query/latest/docs/framework/react/reference/useQuery
- https://tanstack.com/query/latest/docs/framework/react/reference/useMutation
- https://tanstack.com/query/latest/docs/framework/react/reference/useIsFetching
- https://tanstack.com/query/latest/docs/framework/react/reference/QueryClientProvider
- https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
- https://tanstack.com/query/latest/docs/framework/react/guides/query-functions
- https://tanstack.com/query/latest/docs/framework/react/guides/dependent-queries
- https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults
- https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation
- https://tanstack.com/query/latest/docs/framework/react/guides/filters
- https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations
- https://tanstack.com/query/latest/docs/framework/react/guides/testing
- https://tanstack.com/query/latest/docs/reference/QueryClient

Relevant official-doc findings for the implementation:

- Query identity is based on top-level array `queryKey` values that must be
  JSON-serializable and unique to the data.
- `useQuery` exposes both `status` (`pending | error | success`) and
  `fetchStatus` (`fetching | paused | idle`), with booleans such as
  `isLoading`, `isFetching`, `isRefetching`, and `isStale` derived from those
  states.
- Query functions must return a promise that resolves to non-`undefined` data or
  throws/rejects to enter the error state.
- `enabled` controls dependent queries and can prevent automatic execution.
- Defaults matter: cached query data is stale by default, inactive cache data is
  garbage-collected after `gcTime`, stale queries refetch on mount, focus, and
  reconnect, and failed queries retry by default on the client.
- `invalidateQueries` marks matching queries stale and background-refetches
  active matching queries.
- Query filters support `queryKey`, `exact`, `type`, `stale`, `fetchStatus`, and
  `predicate`; mutation filters support `mutationKey`, `status`, and
  `predicate`-style matching.
- `useMutation` has a separate mutation lifecycle with `status`, `variables`,
  `data`, `error`, `failureCount`, `mutate`, `mutateAsync`, `reset`, and
  callbacks such as `onMutate`, `onSuccess`, `onError`, and `onSettled`.
- The recommended test wrapper creates an isolated `QueryClient` and
  `QueryClientProvider` per test or clears the client between tests.

## 2. Non-goals

- Do not execute or symbolically interpret arbitrary `queryFn` or `mutationFn`
  bodies. Model their success/error outcomes from their declared/semantic return
  types.
- Do not implement a normalized cache. TanStack Query intentionally uses query
  keys plus invalidation/refetch/update APIs instead.
- Do not model exact wall-clock time. Model stale/refetch/gc/retry behavior as
  bounded environment transitions.
- Do not support legacy `react-query` v3/v4 in this plan. `packageNames` should
  be `["@tanstack/react-query"]`; stop and report if current examples require
  the old package.
- Do not add runtime dependencies to `package.json`.
- Do not change the core IR, checker schema, trace format, or the
  `StateSourcePlugin` SPI unless a stop condition below is reached and accepted.
- Do not model experimental plugins such as persistence, broadcast, streamed
  queries, or server hydration in the first implementation. Detect and caveat
  them rather than silently pretending they are ordinary cache behavior.
- Do not alter existing Jotai, SWR, Zustand, use-state, router, Next, or
  TanStack Router behavior except for shared tests/golden expectations that must
  list the new built-in source.

## 3. Current-state findings

- The source-plugin contract is `StateSourcePlugin` in
  `src/extract/engine/spi/index.ts`. It already supports discovery, domain
  hints, write channels, safety warnings, optional source extraction, write
  summarization, library templates, harness observation, witnesses, and
  conformance version metadata.
- Built-in state source registration is centralized in
  `src/cli/registry/index.ts`. Current built-ins are `useStateSource()`,
  `jotaiSource()`, `swrSource()`, and `zustandSource()`, gated by
  `packageNames` and `disabledPlugins`.
- `package.json` exports each source main entry and harness entry separately,
  for example `./extract/sources/swr` and `./extract/sources/swr/harness`.
  TanStack Query should add the same two exports.
- SWR is the closest library-template precedent:
  `src/extract/sources/swr/{discover,template,writes,harness,plugin,index}.ts`
  discovers key sites, infers payload domains, creates cache lifecycle vars and
  transitions, maps destructured hook reads to write/read channels, and observes
  a harness cache `Map`.
- Zustand is the closest imperative-write precedent:
  `src/extract/sources/zustand/` resolves imports semantically, discovers
  state/action metadata, summarizes direct cache/store writes, exposes a
  standalone skeleton extractor, and has focused source tests under
  `test/sources/zustand/`.
- The generic extraction pipeline calls plugin `discover`, `writeChannels`,
  `safetyWarnings`, `template`, `extract`, and `summarizeWrite` hooks. Template
  vars and transitions are merged into the model automatically.
- The architecture docs already identify TanStack Query as a projected future
  state source that should fit the public plugin contract, with a template
  effort heavier than SWR because of mutation lifecycle and retries.

## 4. Existing patterns to follow

- Add a new source slice under `src/extract/sources/tanstack-query/`; do not
  scatter TanStack Query behavior across the extraction engine.
- Mirror SWR for query cache templates and harness observation, but avoid
  copying SWR's simpler state machine where TanStack Query has separate
  `status`, `fetchStatus`, stale, invalidated, and retry behavior.
- Mirror Zustand for semantic import resolution, `summarizeWrite`, direct method
  call lowering, and focused tests that import the public package entry.
- Use deterministic, stable var ids. Prefer a prefix such as
  `tanstack-query:<safeKeyId>:<field>` and `tanstack-mutation:<safeMutationId>:<field>`.
- Represent React Query booleans as view helpers over canonical vars instead of
  storing every derived boolean as a state var.
- Use structured caveats for dynamic query keys, unsupported predicates,
  unbounded key spaces, persistence/hydration plugins, and function-valued
  options.
- Keep conformance honest: the hand-written template is trusted code, so it
  needs probes against real `@tanstack/react-query` v5 behavior.

## 5. Atomic implementation steps

1. Create the source package skeleton.
   - Add `src/extract/sources/tanstack-query/`.
   - Add `imports.ts`, `ids.ts`, `types.ts`, `domains.ts`, `discover.ts`,
     `filters.ts`, `template.ts`, `writes.ts`, `transitions.ts`, `harness.ts`,
     `plugin.ts`, and `index.ts`.
   - Export `tanstackQuerySource`, `default`, template/view helpers, and an
     optional `extractTanstackQuerySkeleton` from `index.ts`.
   - Keep the main entry static-analysis-only. Keep harness code in
     `harness.ts`.

2. Implement import and symbol resolution.
   - In `imports.ts`, resolve local names imported from
     `@tanstack/react-query` for:
     `useQuery`, `useSuspenseQuery`, `useInfiniteQuery`,
     `useSuspenseInfiniteQuery`, `useQueries`, `useSuspenseQueries`,
     `useMutation`, `useIsFetching`, `useIsMutating`, `useMutationState`,
     `useQueryClient`, `QueryClient`, `QueryClientProvider`,
     `queryOptions`, `infiniteQueryOptions`, and `mutationOptions`.
   - Use `collectSemanticNamedImports` when a semantic type context is present;
     keep a syntax fallback for direct imports.
   - Reject local shadows of imported names, matching existing semantic import
     behavior.

3. Parse query and mutation options.
   - In `discover.ts`, support inline object options:
     `useQuery({ queryKey, queryFn, enabled, staleTime, gcTime, retry,
     refetchOnMount, refetchOnWindowFocus, refetchOnReconnect,
     refetchInterval, initialData, placeholderData, select, subscribed })`.
   - Resolve `queryOptions({...})`, `infiniteQueryOptions({...})`,
     `mutationOptions({...})`, and local `const options = queryOptions({...})`
     when statically local.
   - For wrappers/custom hooks, use existing custom-hook inlining/project summary
     patterns where available. If a wrapper cannot be resolved, emit a
     `model-slack` caveat that names the call site.
   - Detect `queryClient` values from `useQueryClient()` and local
     `new QueryClient(...)` bindings for method-call summarization.

4. Canonicalize query keys and filters.
   - Implement `queryKeyFromExpression` for static arrays containing strings,
     numbers, booleans, nulls, object literals with literal fields, and simple
     identifiers.
   - Produce both a stable display key and a safe id. The id must be independent
     of object literal property order where possible, matching TanStack's stable
     hash behavior.
   - For dynamic identifiers with finite domains, create a bounded key window
     similar to SWR's key-window template.
   - For unbounded or non-serializable keys, do not invent a single exact cache
     key. Emit an over-approx caveat and model a bounded summary entry.
   - Implement `filters.ts` for static `QueryFilters` and `MutationFilters`:
     `queryKey`, `exact`, `type`, `stale`, `fetchStatus`, and
     `mutationKey` where statically knowable. Treat `predicate` as unsupported
     with a caveat unless it is a trivial static matcher.

5. Infer query and mutation domains.
   - In `domains.ts`, infer query payload domain from, in order:
     explicit `useQuery<TData>`/`queryOptions<TData>` type arguments,
     semantic `queryFn` return type, `initialData`, then fallback tokens.
   - Apply `select` to the hook view only when it is a statically modelable
     projection. The docs say `select` affects returned data but not cached
     data, so do not mutate the cache payload domain because of `select`.
   - Infer infinite query page data as a bounded page-window domain:
     `empty | onePage | manyPages`, with payload tokens per page where useful.
   - Infer mutation `data` from `mutationFn` return type and `variables` from
     call sites or explicit type arguments. Fall back to token domains.
   - Preserve numeric reductions/caveats when the existing type-domain helpers
     expose them.

6. Build the query template.
   - In `template.ts`, create vars per modeled query key:
     - `data`: option of payload domain.
     - `status`: enum `pending | success | error`.
     - `fetchStatus`: enum `idle | fetching | paused`.
     - `stale`: bool.
     - `invalidated`: bool if needed as a separate guard from `stale`.
     - `failureCount`: bounded enum such as `0 | 1 | max` when retry is enabled.
     - `active`: bool only if component subscription/mount activity must be
       represented independently of route-local scope.
   - Initial state:
     - No cached data: `data = null`, `status = pending`, `fetchStatus = idle`
       unless automatic fetch is modeled on mount.
     - `initialData`: initialize `data`, `status = success`, and `stale = true`
       unless `staleTime` makes it fresh.
     - `placeholderData`: expose through the hook view, not the cache var.
   - Add `tanstackQueryView(state, key)` returning derived fields:
     `data`, `error`, `status`, `fetchStatus`, `isPending`, `isSuccess`,
     `isError`, `isFetching`, `isLoading`, `isRefetching`, `isStale`,
     `isPaused`, `loadedEmpty`, and `loadedSome`.
   - Do not create separate vars for every derived boolean unless a later
     extraction rule proves it is required for handler guards.

7. Add query lifecycle transitions.
   - Model automatic fetch on mount/key-change when `enabled !== false` and the
     query is stale or missing data.
   - Model success and error resolve transitions as environment transitions,
     using the inferred payload domain for success outcomes.
   - Model retries as bounded environment/library transitions when `retry` is
     truthy or numeric. Use a small default bound and caveat exact retry counts
     beyond the bound.
   - Model `refetchOnWindowFocus`, `refetchOnReconnect`, and
     `refetchInterval` as environment/library transitions only when enabled by
     options/defaults. Since defaults enable focus/reconnect for stale queries,
     include them unless static options disable them.
   - Model `staleTime` and `gcTime` as abstract stale/gc environment events,
     not real timers. `staleTime: "static"` and `Infinity` should suppress
     automatic stale transitions unless invalidated where docs allow.
   - Model `networkMode` paused states enough to expose `fetchStatus = paused`;
     if exact online/offline management is not locally represented, emit a
     caveat and keep paused as an environment choice.

8. Add query client write summarization.
   - In `writes.ts`, discover `queryClient` bindings from `useQueryClient()` and
     local `new QueryClient(...)`.
   - Register write channels for relevant method calls:
     - `invalidateQueries(filters)` marks matched queries stale and starts a
       background refetch for active matches.
     - `setQueryData(queryKey, updaterOrData)` updates data synchronously and
       sets status success when representable.
     - `setQueriesData(filters, updaterOrData)` applies `setQueryData` to
       existing matched queries only.
     - `removeQueries(filters)` resets/removes inactive matched cache entries.
     - `resetQueries(filters)` resets matched queries to initial state and
       refetches active matches.
     - `refetchQueries(filters)` starts fetches for matched queries.
     - `cancelQueries(filters)` clears in-flight fetch state for matched queries
       without changing last successful data.
     - `fetchQuery`, `prefetchQuery`, and `ensureQueryData` enqueue/fetch the
       key and update cache on success/error.
   - Implement `summarizeWrite` for JSX-handler and effect-call paths using the
     existing `CallSite` mechanism.
   - For unsupported filter predicates or dynamic updater functions, return an
     over-approx/havoc effect over matched query data vars if the IR supports
     it; otherwise emit an unsupported warning and stop/report if this would
     silently drop a cache write.

9. Model hook read channels and aggregate hooks.
   - Map destructured `useQuery` fields (`data`, `status`, `error`,
     `fetchStatus`, `isFetching`, `isPending`, `isLoading`, `isSuccess`,
     `isError`, `isStale`, `refetch`) to query template vars or view-derived
     read channels.
   - Map object-return access (`const q = useQuery(...); q.data`) when the
     local binding is statically visible.
   - Map `refetch` as a write channel that starts the query fetch transition.
   - For `useIsFetching(filters)`, emit a bounded aggregate observer var
     `tanstack-query:<filterId>:isFetching` with domain `0 | 1 | many`, updated
     by matching query fetch transitions, or document and implement an
     equivalent derived read helper if the current property/read machinery can
     consume derived helpers.
   - For `useIsMutating(filters)` and `useMutationState`, use the same aggregate
     pattern over mutation vars.

10. Model mutations.
    - Discover each `useMutation` call as a mutation template with vars:
      `status: idle | pending | success | error`, `data`, `error`, `variables`,
      `failureCount`, and optional `submittedAt` abstraction if needed.
    - Register `mutate`, `mutateAsync`, and `reset` write channels from
      destructuring or object access.
    - `mutate(variables)` starts a pending mutation and records abstract
      variables.
    - Success/error environment transitions resolve the mutation.
    - `reset()` returns the mutation to idle and clears error/data according to
      documented behavior.
    - `onMutate`, `onSuccess`, `onError`, and `onSettled` should be scanned for
      statically modelable QueryClient cache writes such as `setQueryData` and
      `invalidateQueries`. Apply those effects in lifecycle order.
    - Optimistic updates from `onMutate` are in scope only when they lower to
      existing QueryClient write summaries. Rollback via `onError` is in scope
      only when it is statically represented by QueryClient calls.
    - Mutation scopes/serialization and offline paused mutations should be
      bounded and caveated if exact modeling would require an unbounded queue.

11. Add harness observation.
    - In `harness.ts`, create `setup(ctx)` that accepts an optional
      `queryClient` or creates a new `QueryClient` for replay/conformance.
    - Provide a wrapper factory or hooks metadata so generated replay tests can
      wrap components in `<QueryClientProvider client={queryClient}>`.
    - `observe(varId, handles)` should read from:
      - `queryClient.getQueryState(queryKey)` for `status`, `fetchStatus`,
        stale/fetching, and failure state.
      - `queryClient.getQueryData(queryKey)` for data vars.
      - `queryClient.getMutationCache()` for mutation vars and aggregate
        mutation state.
      - `ctx.initialState` as a fallback, matching SWR/Zustand harnesses.
    - Add witness factories for token payloads only if the existing replay
      witness infrastructure needs concrete query data values.

12. Register and export the plugin.
    - Update `src/cli/registry/index.ts` to import and include
      `tanstackQuerySource()` in the built-in source list.
    - Set `id: "tanstack-query"`, `version: "0.1.0"`,
      `packageNames: ["@tanstack/react-query"]`, and
      `conformance.testedVersions = "@tanstack/react-query>=5"`.
    - Respect `disabledPlugins: ["tanstack-query"]`.
    - Add package exports:
      - `./extract/sources/tanstack-query`
      - `./extract/sources/tanstack-query/harness`
    - Update architecture tests that assert source export coverage or built-in
      source ids.

13. Update docs and specs.
    - Update `docs/architecture/state-sources.md` to add TanStack Query to the
      source table with discovery, write channels, template, and harness
      observation.
    - Update `docs/architecture/extraction-pipeline.md` to mention TanStack
      Query query/mutation hooks and QueryClient cache APIs.
    - Update `docs/architecture/conformance-and-replay.md` to describe
      QueryClient-based observation.
    - Update `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`, and
      `docs/_specs/05-architecture.md` where they still describe TanStack Query
      as future work.
    - Add `docs/sources/tanstack-query.md` if the docs source tree has pages for
      Jotai/SWR/Zustand.
    - Update `docs/sidebars.js` to add `sources/tanstack-query` under the
      "State Sources" category near SWR/Zustand, keeping the sidebar ordering
      coherent with the source docs.
    - Update `docs/intro/index.md` so the "Good fits" list and
      "Library & framework compatibility" table mark TanStack Query as supported
      and link to `../sources/tanstack-query.md`, rather than leaving it as
      `❌ 🔜`.

14. Add conformance and examples coverage.
    - Add focused tests under `test/sources/tanstack-query/`.
    - Add at least one conformance fixture using `@tanstack/react-query` v5 with
      a fresh QueryClient wrapper.
    - If examples are expected to exercise every built-in source, add a compact
      example app or extend an existing example with a static query and mutation.
      Keep this step separate from the source-plugin implementation if it grows.

## 6. Tests to add or update

- Add `test/sources/tanstack-query/tanstack-query-source.test.ts`.
  - Plugin shape, empty source behavior, `packageNames`, and
    `conformance.testedVersions`.
  - Static import resolution and semantic alias/re-export resolution.
  - `useQuery({ queryKey: ["todos"], queryFn })` discovery creates expected
    source decl metadata and template vars.
  - Query key canonicalization handles object property order, simple arrays,
    finite identifier windows, and dynamic-key caveats.
  - Payload domain inference works from `useQuery<TData>`, `queryFn` return
    type, `initialData`, and fallback tokens.
  - `enabled: false` suppresses automatic fetch until a modeled refetch or
    invalidation path triggers where appropriate.
  - `initialData` and `placeholderData` differ: initial data enters cache;
    placeholder data only affects hook view.
  - `select` affects returned view only when statically modelable and does not
    mutate cache vars.
  - Focus/reconnect/interval refetch transitions respect static option disables.
  - Error resolve keeps or clears data according to the selected template
    decision; assert the behavior is documented in the test name.

- Add `test/sources/tanstack-query/tanstack-query-writes.test.ts`.
  - `queryClient.invalidateQueries({ queryKey: ["todos"] })` marks matching
    queries stale and starts active background refetch.
  - Prefix matching vs `exact: true` matching.
  - `setQueryData(["todos"], value)` updates the data var and success status.
  - `setQueriesData` only updates existing matched query vars.
  - `removeQueries`, `resetQueries`, `refetchQueries`, and `cancelQueries`
    produce deterministic effects or explicit warnings.
  - Dynamic filter predicates produce caveats, not silent no-ops.

- Add `test/sources/tanstack-query/tanstack-query-mutations.test.ts`.
  - `useMutation` discovery emits mutation vars.
  - `mutate`/`mutateAsync` write channels start pending transitions.
  - Success/error resolve transitions update `status`, `data`, `error`, and
    `failureCount`.
  - `reset` returns to idle.
  - `onSuccess` invalidation and `onMutate` optimistic `setQueryData` lower to
    cache effects when static.
  - Unsupported rollback functions are caveated.

- Add `test/sources/tanstack-query/tanstack-query-harness.test.ts`.
  - Harness observes query data/status/fetchStatus from a real `QueryClient`.
  - Harness observes mutation status from `MutationCache`.
  - Initial-state fallback and `"unobservable"` behavior match other harnesses.
  - Isolated QueryClient setup prevents cross-test leakage.

- Update registry/export tests.
  - `src/cli/registry/index.test.ts` or `test/modality/registry.test.ts`:
    dependency gating includes `"tanstack-query"` for
    `@tanstack/react-query` and excludes it when disabled.
  - `test/extraction/architecture.test.ts`: package exports include the new
    source and harness entries.

- Add or update docs/spec tests if docs links or generated docs tables are
  validated.

- Add conformance fixture coverage.
  - Static query success/error.
  - Mutation invalidates a matching query.
  - `useIsFetching` aggregate indicator.
  - Dependent query with `enabled: !!id`.

## 7. Verification

Run focused checks while developing:

```bash
rtk pnpm vitest run test/sources/tanstack-query/tanstack-query-source.test.ts
rtk pnpm vitest run test/sources/tanstack-query/tanstack-query-writes.test.ts
rtk pnpm vitest run test/sources/tanstack-query/tanstack-query-mutations.test.ts
rtk pnpm vitest run test/sources/tanstack-query/tanstack-query-harness.test.ts
rtk pnpm vitest run src/cli/registry/index.test.ts test/modality/registry.test.ts test/extraction/architecture.test.ts
```

Run full validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm ci:conformance
rtk pnpm phase7
rtk pnpm fix
```

If `rtk pnpm test` is too slow during iteration because it builds Rust, use the
targeted Vitest commands first, then run the full command once the slice is
complete.

## 8. Acceptance criteria

- Apps depending on `@tanstack/react-query` automatically register the
  `tanstack-query` source plugin unless disabled.
- The package exports `modality-ts/extract/sources/tanstack-query` and
  `modality-ts/extract/sources/tanstack-query/harness`.
- Static `useQuery` calls produce finite query cache vars, lifecycle
  transitions, and hook view helpers.
- Static `useInfiniteQuery` calls are modeled with bounded page-window state and
  explicit caveats for skipped pages.
- Query keys are canonicalized deterministically, including object literal key
  ordering, and unbounded keys are caveated.
- Query status/fetchStatus/stale behavior matches the documented v5 model at
  the abstraction level of this repository.
- `invalidateQueries`, `setQueryData`, `setQueriesData`, `removeQueries`,
  `resetQueries`, `refetchQueries`, `cancelQueries`, `fetchQuery`,
  `prefetchQuery`, and `ensureQueryData` produce model effects for static keys
  and filters.
- `useMutation` produces finite mutation vars and transitions for
  mutate/success/error/reset, including static callback-driven invalidation or
  cache updates.
- `useIsFetching`, `useIsMutating`, and `useMutationState` are observable in the
  model for static filters.
- Replay/conformance can observe query and mutation state through a fresh
  `QueryClient` and `QueryClientProvider` wrapper.
- Existing Jotai, SWR, Zustand, React Router, Next, and TanStack Router tests do
  not regress.
- Docs/specs no longer describe TanStack Query as merely future work.
- `docs/sidebars.js` exposes the TanStack Query source page in the State Sources
  sidebar, and `docs/intro/index.md` lists TanStack Query as supported with the
  correct source-doc link.

## 9. Risks, ambiguities, and stop conditions

- Stop and report if exact support for QueryClient updates requires a new IR
  operation for "assign any abstract value in this domain" and no existing
  `havoc`/token/fresh-token effect is appropriate. Do not silently drop
  updater functions.
- Stop and report if aggregate hooks (`useIsFetching`, `useIsMutating`,
  `useMutationState`) cannot be represented without derived vars or a property
  evaluator change. Implement the minimal aggregate-var approach only if it
  fits the current pipeline.
- Stop and report if the generic `StateSourcePlugin.template` hook cannot see
  enough global query declarations to implement prefix filter matching. Prefer a
  plugin-local `extract` pass over changing the SPI.
- Stop and report if static wrapper/custom-hook resolution requires broad
  custom-hook inlining changes outside the source slice.
- Stop and report if current tests or examples use legacy `react-query` rather
  than `@tanstack/react-query`; decide separately whether to support legacy
  package names.
- Treat `predicate` filters, function-valued `enabled`/`staleTime`/`retry`, and
  dynamic `queryKeyHashFn` as caveated unless trivially static. Do not execute
  user functions during extraction.
- Treat persistence, hydration/dehydration, broadcast, streamed queries, and
  server rendering as unsupported/caveated in this plan. If a representative app
  depends on those semantics for UI correctness, split a follow-up plan.
- For retries and offline paused mutations, use bounded abstractions. Stop if a
  required property depends on exact unbounded retry counts or mutation queue
  ordering.
- Do not change checker/core schemas from this task. If a necessary TanStack
  Query behavior cannot be expressed in current IR, write a follow-up IR plan
  instead of squeezing it into stringly effects.
- Keep the implementation additive. If adding the plugin forces unrelated
  refactors in SWR/Zustand/use-state/router code, stop and report the coupling
  point before editing those systems.
