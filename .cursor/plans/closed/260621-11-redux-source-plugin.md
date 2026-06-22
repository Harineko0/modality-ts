# Redux Support Plan

## 1. Goal

Add first-class Redux support as a built-in `StateSourcePlugin`, so
`modality extract`, `check`, `replay`, and `conform` can model Redux-backed
React state transitions from modern Redux Toolkit apps and conventional
React-Redux usage.

Support the common official Redux surface end-to-end:

- Store setup through Redux Toolkit `configureStore`, plus classic
  `createStore` / `legacy_createStore` when it is statically analyzable.
- Reducer composition through `reducer: { slice: reducer }`, `combineReducers`,
  `createSlice`, `createReducer`, hand-written reducer functions, and action
  creators from `createSlice.actions` / `createAction`.
- React integration through `<Provider store={store}>`, `useSelector`,
  `useDispatch`, `connect` for simple `mapStateToProps` / `mapDispatchToProps`,
  typed hooks such as `useAppSelector` / `useAppDispatch`, and direct
  `store.getState()` / `store.dispatch(...)` reads and writes.
- Dispatch lowering for plain action objects, action creators,
  `dispatch(sliceAction(payload))`, `dispatch(createAction(payload))`, and
  reducer-driven state updates.
- Basic thunk support, including `createAsyncThunk` lifecycle actions and
  statically modelable thunk functions that dispatch known actions around
  configured effect APIs.
- RTK Query support through Redux Toolkit `createApi` when apps use Redux's
  official data-fetching layer rather than TanStack Query or SWR.
- Replay/conformance observation through a real Redux store handle, with
  optional Provider wrapping for generated replay tests.

Official Redux documentation checked:

- https://redux.js.org/tutorials/quick-start
- https://redux.js.org/tutorials/typescript-quick-start
- https://redux.js.org/style-guide/
- https://redux.js.org/usage/configuring-your-store
- https://redux.js.org/usage/writing-logic-thunks
- https://redux.js.org/api/createstore
- https://redux.js.org/usage/nextjs
- https://redux.js.org/usage/writing-tests
- https://redux-toolkit.js.org/api/configureStore
- https://redux-toolkit.js.org/api/createSlice
- https://redux-toolkit.js.org/api/createReducer
- https://redux-toolkit.js.org/api/createAsyncThunk
- https://redux-toolkit.js.org/rtk-query/api/createApi
- https://redux-toolkit.js.org/rtk-query/overview

Relevant official-doc findings for the implementation:

- The documented modern path is Redux Toolkit plus React-Redux:
  `configureStore`, `<Provider store={store}>`, `createSlice`, `useSelector`,
  and `useDispatch`.
- Redux Toolkit reducers commonly use Immer-style draft mutation inside
  `createSlice` / `createReducer`, so reducer lowering must handle draft
  assignment and compound updates rather than only immutable returns.
- TypeScript apps commonly export pre-typed hooks via
  `useDispatch.withTypes<AppDispatch>()` and `useSelector.withTypes<RootState>()`;
  the adapter must resolve aliases and local wrappers, not only direct imports
  from `react-redux`.
- Official Redux style guidance says Redux state/actions should be serializable
  and a standard app should have one Redux store. Use those as modeling
  assumptions and emit caveats for multiple stores, non-serializable state, or
  dynamically selected Provider stores.
- Core `createStore` is documented as deprecated but still working
  indefinitely. Support it where static, but design around Redux Toolkit first.
- Thunks receive `dispatch` and `getState`, may run arbitrary sync or async
  logic, and require thunk middleware. Treat arbitrary thunk bodies like other
  effectful handlers: summarize only the static subset and caveat/havoc rather
  than silently dropping writes.
- Next.js App Router guidance requires per-request store creation and says RSCs
  should not read or write the Redux store. The adapter should warn on global
  store patterns in Next App Router server surfaces and rely on existing module
  role adapters for client/server boundaries.
- Redux-connected component testing guidance prefers integration tests with a
  real store and Provider wrapper, with a fresh store per test. Mirror this in
  replay/conformance harness setup.
- RTK Query `createApi` defines endpoints and generated React hooks for
  fetching/caching. Its cache should be modeled as a bounded library template,
  similar to TanStack Query/SWR, rather than as arbitrary reducer internals.

## 2. Non-goals

- Do not execute application reducers, thunks, middleware, selectors, or
  `queryFn` / `mutationFn` code at extraction time.
- Do not add runtime dependencies to `package.json`.
- Do not change the core IR, checker schema, trace format, or
  `StateSourcePlugin` SPI unless a stop condition below is reached and accepted.
- Do not model arbitrary custom middleware, enhancers, Redux DevTools, listener
  middleware, saga, observable, persistence, rehydration, or cross-tab
  synchronization in the first pass. Detect and caveat them.
- Do not model non-serializable state/action values exactly. Emit model-slack
  caveats and fall back to finite token abstractions.
- Do not support every possible `connect` overload before hooks work. Support
  simple object/function mappings and caveat dynamic `mergeProps` /
  factory-returning mappers.
- Do not refactor existing Jotai, SWR, Zustand, TanStack Query, router, Next, or
  checker code except for shared helper extraction that is strictly necessary
  and covered by tests.
- Do not treat classic `createStore` as the primary design center. It should be
  supported because official docs say it continues to work, but Redux Toolkit
  should drive the abstraction.

## 3. Current-state findings

- There is currently no Redux source support. `package.json` has no
  `./extract/sources/redux` export, `src/cli/registry/index.ts` has no Redux
  built-in, `test/conformance/matrix.json` has no Redux target, and `rtk find`
  found no existing `redux`, `useSelector`, `useDispatch`, or store support in
  `src/`, `test/`, `examples/`, or `docs/`.
- The plugin contract is `StateSourcePlugin` in
  `src/extract/engine/spi/index.ts`. It already provides the hooks Redux needs:
  `discover`, `domainHints`, `writeChannels`, `safetyWarnings`, optional
  `extract`, `summarizeWrite`, optional `template`, harness observation, and
  conformance metadata.
- Built-in source registration is centralized in
  `src/cli/registry/index.ts`. Current state-source built-ins are
  `use-state`, `jotai`, `swr`, `zustand`, and `tanstack-query`, gated by
  `packageNames`, dependency detection, and `disabledPlugins`.
- `package.json` exports each source main entry and harness entry separately.
  Redux should add `./extract/sources/redux` and
  `./extract/sources/redux/harness`.
- The closest store-shaped precedent is
  `src/extract/sources/zustand/`: it resolves imports semantically, discovers
  store fields/actions, lowers Immer-style draft writes, summarizes imperative
  writes, exposes a skeleton extractor, and observes a real store handle.
- The closest cache-template precedent is
  `src/extract/sources/tanstack-query/`: it models query/mutation lifecycle
  vars and transitions, QueryClient writes, aggregate hooks, harness
  observation, docs, exports, and conformance.
- The extraction spec already treats missing writes as the key soundness risk.
  Redux dispatch/reducer lowering must preserve the E1 invariant: if a dispatch
  may write Redux state but cannot be summarized, it must become a caveated
  over-approximation or an explicit unextractable, never a no-op.
- Existing docs list supported state sources in
  `docs/architecture/state-sources.md`, `docs/architecture/extraction-pipeline.md`,
  `docs/reference/package-entry-points.md`, `docs/sources/`, and
  `docs/sidebars.js`. Redux docs should be added consistently.

## 4. Existing patterns to follow

- Add a new source slice under `src/extract/sources/redux/`; keep Redux behavior
  out of the generic extraction engine except for narrow shared helpers that
  are justified by reuse.
- Mirror Zustand for store/reducer discovery, semantic import resolution,
  Immer-style lowering, direct store observation, and focused source tests.
- Mirror TanStack Query and SWR for RTK Query template vars/transitions and
  cache observation.
- Use deterministic var ids. Prefer `redux:<storeName>.<path>` for store state
  fields, `redux-query:<apiName>:<endpoint>:<keyId>:<field>` for RTK Query
  cache vars, and `redux-mutation:<apiName>:<endpoint>:<siteId>:<field>` for
  mutation lifecycle vars.
- Reuse existing domain inference helpers from `src/extract/engine/ts/domains.ts`
  and `src/extract/sources/zustand/domains.ts` rather than inventing Redux-only
  type inference.
- Reuse or extract a small shared draft-mutation lowering helper from Zustand's
  `effects.ts` only if Redux and Zustand tests both prove it stays source
  neutral.
- Keep reducer lowering pure and static. A reducer case should become an
  `EffectIR` over known Redux vars. Unknown reducer paths become caveated
  `havoc` over affected slice vars.
- Keep support additive. Existing source plugin ids, docs links, and conformance
  statuses should only change where Redux is being inserted.

## 5. Atomic implementation steps

1. Create the source package skeleton.
   - Add `src/extract/sources/redux/`.
   - Add `imports.ts`, `ids.ts`, `types.ts`, `domains.ts`, `store.ts`,
     `slices.ts`, `reducers.ts`, `selectors.ts`, `dispatch.ts`, `thunks.ts`,
     `rtk-query.ts`, `template.ts`, `writes.ts`, `harness.ts`, `plugin.ts`,
     `transitions.ts`, and `index.ts`.
   - Export `reduxSource`, `default`, var-id/view helpers, and
     `extractReduxSkeleton` from `index.ts`.
   - Keep harness-only runtime wiring in `harness.ts`.

2. Implement import and symbol resolution.
   - Resolve imports from `react-redux`: `Provider`, `useSelector`,
     `useDispatch`, `useStore`, `connect`, `shallowEqual`, and hook
     `.withTypes(...)` wrappers.
   - Resolve imports from `@reduxjs/toolkit`: `configureStore`, `createSlice`,
     `createReducer`, `createAction`, `createAsyncThunk`, `combineSlices`,
     `createListenerMiddleware`, `createEntityAdapter`, and
     `createSerializableStateInvariantMiddleware`.
   - Resolve imports from `redux`: `combineReducers`, `createStore`,
     `legacy_createStore`, `bindActionCreators`, `applyMiddleware`, and
     `compose`.
   - Resolve imports from `@reduxjs/toolkit/query` and
     `@reduxjs/toolkit/query/react`: `createApi`, `fetchBaseQuery`, generated
     hooks, and API object endpoint access.
   - Use `collectSemanticNamedImports` with semantic context and keep syntax
     fallbacks for direct imports. Recognize local barrels/re-exports the same
     way SWR/Zustand/TanStack Query tests do.

3. Discover Redux stores.
   - In `store.ts`, discover `configureStore({ reducer, preloadedState,
     middleware, enhancers })`, `createStore(reducer, preloadedState, enhancer)`,
     and `legacy_createStore(...)`.
   - Resolve root reducer shapes:
     - object literal maps in `configureStore({ reducer: { todos:
       todosReducer } })`;
     - local `const rootReducer = combineReducers({ ... })`;
     - default/named imports of slice reducers when semantic resolution can
       find the declaration;
     - reducer function identifiers declared in the same semantic project.
   - Record store metadata: store name, source, reducer tree, preloaded state,
     middleware/enhancer caveats, Provider usage if statically visible, and
     store scope.
   - If multiple stores are found, model each with store-qualified ids and emit
     a warning that standard Redux expects one app store. Do not merge stores.
   - In Next App Router server/RSC surfaces, emit a caveat for global store
     singletons and skip server-only store reads/writes unless a client module
     uses them.

4. Discover state vars and domains.
   - For each reducer tree leaf, create vars for extractable state fields.
     Use root-level `redux:<storeName>.<slice>` for scalar/array/token slices
     and `redux:<storeName>.<slice>.<field>` for object fields.
   - Infer domains from slice `initialState`, reducer default parameters,
     `preloadedState`, reducer return literals, and semantic state types.
   - For `createSlice({ name, initialState, reducers })`, use `name` as
     metadata and the reducer-tree key as the var-id path. Do not assume slice
     name equals store key.
   - Support object, tagged union, enum, boolean, bounded integer, literal union,
     option, array `lengthCat`, and token domains through existing helpers.
   - Emit caveats for spreads or computed fields that hide state shape. Use
     field pruning where existing extraction already prunes record fields.

5. Lower `createSlice` and `createReducer` case reducers.
   - In `slices.ts` / `reducers.ts`, parse:
     - object-form `reducers: { increment(state) { ... } }`;
     - `reducers: (create) => ({ ... })` only when trivially static;
     - `extraReducers: (builder) => builder.addCase(...).addMatcher(...)`;
     - `createReducer(initialState, builder => builder.addCase(...))`.
   - Lower Immer draft mutations:
     - `state.field = literal/read/expression`;
     - nested `state.profile.name = "x"` as `updateField`;
     - `+=`, `-=`, `++`, `--` over bounded numeric fields;
     - object return forms such as `return { ...state, field: value }`;
     - array/container mutations as caveated over-approximations unless the
       current IR can express them.
   - Lower immutable return reducers:
     - `return { ...state, field: value }`;
     - `return initialState`;
     - scalar `return action.payload` for scalar slice state.
   - Support `PayloadAction<T>` by mapping `action.payload` to a finite payload
     domain inferred from action creator calls, explicit type args, or fallback
     tokens.
   - Emit `unsupported`/caveated effects for reducers that call external
     functions, use random/time, mutate non-state globals, or depend on
     non-M0 expressions.

6. Lower classic reducers and action creators.
   - Support switch reducers over `action.type` with string literal cases.
   - Support if/else reducers checking `action.type === "..."`.
   - Support `createAction<T>("type")` and action creators with `prepare`
     callbacks only when the prepared payload/meta/error are static or
     finite-domain.
   - Support direct action objects `{ type: "todos/add", payload: ... }`.
   - Normalize action type identity for:
     - `slice.actions.add`;
     - destructured exports from `counterSlice.actions`;
     - `increment.type`;
     - string literals passed to `createAction`;
     - `createAsyncThunk` lifecycle action creators.

7. Discover selector read channels.
   - Map `useSelector(state => state.slice.field)` and typed hook aliases such
     as `useAppSelector(...)` to Redux var read channels.
   - Map destructured selector result bindings when the selector returns a
     static object of field reads.
   - Map direct `store.getState().slice.field` and `useStore().getState()`
     reads.
   - Support exported selector functions such as
     `export const selectCount = (state: RootState) => state.counter.value`
     when used by `useSelector(selectCount)`.
   - Support simple `connect(mapStateToProps, ...)` read mappings. Caveat
     factory mappers, dynamic selectors, and memoized selectors whose body
     cannot be reduced to state field reads.
   - Treat selector calls as reads only. Do not execute selectors.

8. Discover dispatch write channels.
   - Map direct `const dispatch = useDispatch()` and typed aliases from
     `useAppDispatch()`.
   - Map `store.dispatch`, `useStore().dispatch`, and simple
     `mapDispatchToProps`/`bindActionCreators` outputs.
   - Register write channels for bound action creators, action props, and local
     dispatch wrappers so JSX handlers can resolve `onClick={increment}` and
     `onClick={() => dispatch(increment())}`.
   - Implement `summarizeWrite` for `dispatch(...)` calls. The summary should
     look up the dispatched action, run the statically lowered reducer effects
     for matching cases, and return a sequence over affected Redux vars.
   - If the dispatched action is dynamic but the target store/slice is known,
     return a caveated havoc over the possibly affected slice vars.
   - If a handler might dispatch but the target store cannot be determined,
     emit an unextractable warning per E1.

9. Model thunks and async lifecycles.
   - Detect thunk middleware through `configureStore` defaults and explicit
     `redux-thunk`/middleware configuration. Because `configureStore` includes
     useful defaults, treat thunk dispatch as enabled by default for RTK stores.
   - Support static thunk functions that only:
     - call `dispatch(knownAction(...))`;
     - read `getState().slice.field`;
     - await configured effect APIs;
     - branch on M0-expressible conditions.
   - Split supported async thunk bodies using the existing async effect API
     model where possible.
   - Support `createAsyncThunk(typePrefix, payloadCreator)` by generating
     pending/fulfilled/rejected action types and lowering matching
     `extraReducers` cases. Do not execute `payloadCreator`; model success/error
     outcomes from the declared return type and existing effect API abstractions.
   - Caveat arbitrary thunk logic, extra arguments, nested dispatch loops, and
     dynamic action factories. If known reducer writes may occur, over-approx
     the affected vars.

10. Model RTK Query as a Redux source template.
    - In `rtk-query.ts`, discover `createApi({ reducerPath, baseQuery,
      endpoints })`, query endpoints, mutation endpoints, generated hooks, and
      API reducer registration in `configureStore`.
    - Reuse TanStack Query/SWR key canonicalization ideas, but keep Redux var id
      prefixes separate from TanStack Query.
    - Create query vars for endpoint/key status, fetch status, data, error,
      invalidated/stale state, and bounded retries where necessary.
    - Create mutation vars for status, variables, data, and error.
    - Model generated hooks:
      - `useGetThingQuery(arg)`;
      - `api.endpoints.getThing.useQuery(arg)`;
      - `useLazyGetThingQuery`;
      - `useUpdateThingMutation`.
    - Model API utility dispatches where static:
      - `api.util.invalidateTags`;
      - `api.util.updateQueryData`;
      - `api.util.upsertQueryData`;
      - `api.util.resetApiState`;
      - endpoint `.initiate(...)`.
    - Support tag invalidation only for static `providesTags` /
      `invalidatesTags`. Caveat dynamic tag functions unless trivially static.
    - If RTK Query modeling grows beyond a single source slice, stop and split a
      follow-up `redux-rtk-query-template` plan rather than mixing incomplete
      cache semantics into core Redux store support.

11. Integrate with shared React transition extraction.
    - In `transitions.ts`, expose `extractReduxSkeleton` analogous to Zustand
      and TanStack Query skeleton extractors.
    - Feed discovered Redux vars, selector read channels, dispatch write
      channels, and `reduxSource()` into `extractSharedReactTransitions`.
    - Ensure JSX handlers, effects, component prop forwarding, guards, and
      async splitting can see Redux reads/writes through existing plugin hooks.
    - Keep Redux-specific logic in `summarizeWrite` and plugin-local
      discovery. Do not special-case Redux in generic JSX handler extraction
      unless a stop condition proves the SPI is insufficient.

12. Add harness observation and replay wiring.
    - In `harness.ts`, accept:
      - `store?: { getState(): unknown; dispatch?: Function }`;
      - `stores?: Record<string, { getState(): unknown; dispatch?: Function }>`;
      - `initialState?: ModelState`.
    - Observe Redux vars by reading the configured store's `getState()` with
      the var-id path. Fall back to `initialState`, then `"unobservable"`.
    - Expose a Provider wrapper helper or harness metadata so generated replay
      tests can wrap components in `<Provider store={store}>`.
    - Ensure tests use a fresh store per run, matching official Redux testing
      guidance.
    - For RTK Query vars, observe through Redux store state under `reducerPath`
      where possible. If a real API cache shape is too version-specific, use a
      documented harness adapter that maps endpoint/query ids to observed
      values.

13. Register and export the plugin.
    - Update `src/cli/registry/index.ts` to import and include `reduxSource()`
      in built-in state sources.
    - Set `id: "redux"`, `version: "0.1.0"`, and package names that auto-enable
      when apps depend on Redux. Prefer
      `["@reduxjs/toolkit", "react-redux", "redux"]`.
    - Ensure the plugin activates when any package name is present, while tests
      cover the expected real app combinations:
      `@reduxjs/toolkit + react-redux`, `redux + react-redux`, and
      `@reduxjs/toolkit/query/react` through `@reduxjs/toolkit`.
    - Respect `disabledPlugins: ["redux"]`.
    - Add package exports for `./extract/sources/redux` and
      `./extract/sources/redux/harness`.
    - Update architecture/export tests that enumerate state-source packages.

14. Update specs, docs, and conformance.
    - Update `docs/_specs/02-extraction.md` P1/P5 known state sources to include
      Redux stores, React-Redux reads/writes, thunks, and RTK Query.
    - Update `docs/architecture/state-sources.md`,
      `docs/architecture/extraction-pipeline.md`,
      `docs/architecture/conformance-and-replay.md`, and
      `docs/reference/package-entry-points.md`.
    - Add `docs/sources/redux.md` and insert it in `docs/sidebars.js` near
      Zustand/TanStack Query.
    - Update `docs/intro/index.md` or other compatibility tables if they list
      supported libraries.
    - Add Redux to `test/conformance/matrix.json` as a state-source target with
      focused fixtures for slice dispatch, thunk lifecycle, selector reads, and
      RTK Query if included in this plan.

## 6. Tests to add or update

- Add `test/sources/redux/redux-source.test.ts`.
  - Plugin shape, empty-source behavior, package names, and conformance
    metadata.
  - Registry auto-enables Redux for `@reduxjs/toolkit + react-redux`,
    `redux + react-redux`, and disables with `disabledPlugins: ["redux"]`.
  - Import alias and local barrel resolution for `configureStore`,
    `createSlice`, `useSelector`, and `useDispatch`.
  - `configureStore({ reducer: { counter: counterReducer } })` discovers
    `redux:store.counter.value` with correct domain and initial value.
  - Multiple stores get store-qualified ids and warnings.

- Add `test/sources/redux/redux-reducers.test.ts`.
  - `createSlice` case reducers lower Immer assignment, nested assignment,
    `+=`, `-=`, `++`, `--`, scalar returns, and object spread returns.
  - `extraReducers(builder.addCase(...))` lowers known action cases.
  - `createReducer` builder notation lowers known cases.
  - Classic switch reducers lower string-literal action types.
  - Unsupported reducers produce caveats/havoc, not silent no-ops.
  - Payload domains infer from `PayloadAction<T>`, action creator calls, and
    fallback tokens.

- Add `test/sources/redux/redux-selectors.test.ts`.
  - `useSelector(state => state.counter.value)` creates read channels.
  - Typed `useAppSelector` and exported selector functions resolve.
  - Object-return selectors map single/multiple field reads.
  - `store.getState()` reads resolve.
  - Simple `connect(mapStateToProps)` resolves, while dynamic mapper factories
    warn.

- Add `test/sources/redux/redux-dispatch.test.ts`.
  - `dispatch(increment())` writes the expected vars.
  - Destructured `slice.actions`, exported action creators, `createAction`, and
    direct action objects resolve to the correct reducer cases.
  - `bindActionCreators` and simple `mapDispatchToProps` produce write
    channels.
  - Dynamic dispatch produces caveated over-approximation over affected slice
    vars.
  - JSX handler extraction through `extractReduxSkeleton` emits user
    transitions with Redux reads/writes.

- Add `test/sources/redux/redux-thunks.test.ts`.
  - Static thunk dispatches lower sequential reducer effects.
  - `getState()` reads inside thunks contribute reads.
  - `createAsyncThunk` pending/fulfilled/rejected action cases lower through
    `extraReducers`.
  - Awaited effect APIs split into pending and resolve transitions where the
    existing async model supports it.
  - Arbitrary thunk logic emits caveats or unextractable warnings.

- Add `test/sources/redux/redux-rtk-query.test.ts` if RTK Query is included in
  the first implementation.
  - `createApi` query endpoint discovery creates query template vars.
  - Generated `useXQuery` hooks and endpoint `.useQuery` calls map to cache
    vars.
  - Generated mutation hooks create mutation lifecycle vars.
  - Static tag invalidation and `api.util.updateQueryData` lower to cache
    effects.
  - Dynamic tags/functions are caveated.

- Add `test/sources/redux/redux-harness.test.ts`.
  - Harness observes nested Redux state through a real store-like handle.
  - Multiple named stores observe correctly.
  - Initial-state fallback and `"unobservable"` behavior match existing source
    harnesses.
  - Provider wrapper metadata/helper can be consumed without leaking state
    across tests.

- Update existing tests.
  - `src/cli/registry/index.test.ts` for built-in ids and dependency gating.
  - `test/modality/registry.test.ts` if expected source plugin lists are fixed.
  - `test/extraction/architecture.test.ts` for package export coverage.
  - `src/cli/features/extract/command.report.test.ts` for plugin provenance if
    it asserts full built-in rows.
  - `test/conformance/matrix.test.ts` for the new Redux target and fixtures.

## 7. Verification

Run focused checks while developing:

```bash
rtk pnpm vitest run test/sources/redux/redux-source.test.ts
rtk pnpm vitest run test/sources/redux/redux-reducers.test.ts
rtk pnpm vitest run test/sources/redux/redux-selectors.test.ts
rtk pnpm vitest run test/sources/redux/redux-dispatch.test.ts
rtk pnpm vitest run test/sources/redux/redux-thunks.test.ts
rtk pnpm vitest run test/sources/redux/redux-harness.test.ts
rtk pnpm vitest run src/cli/registry/index.test.ts test/modality/registry.test.ts test/extraction/architecture.test.ts
```

If RTK Query is implemented in the same pass:

```bash
rtk pnpm vitest run test/sources/redux/redux-rtk-query.test.ts
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

If `rtk pnpm test` is slow during iteration because it builds Rust, run the
targeted Vitest commands first, then run full validation once the source slice
is complete.

## 8. Acceptance criteria

- Apps depending on Redux packages automatically register the `redux` source
  plugin unless disabled.
- The package exports `modality-ts/extract/sources/redux` and
  `modality-ts/extract/sources/redux/harness`.
- Redux Toolkit `configureStore` plus `createSlice` discovers finite state vars
  with stable ids, domains, initial values, and source metadata.
- React-Redux hook reads and typed hook aliases map selectors to Redux var
  reads.
- Dispatches of known Redux Toolkit actions, `createAction` actions, classic
  action objects, and bound action creators lower to reducer effects.
- Immer-style reducers and immutable-return reducers both produce correct
  `EffectIR` for the supported expression subset.
- Unknown reducer/dispatch/thunk behavior is caveated or over-approximated and
  never silently dropped.
- Basic thunks and `createAsyncThunk` lifecycle actions are modeled enough to
  expose pending/success/error UI transitions.
- Simple `connect` usage is supported or explicitly caveated where dynamic.
- RTK Query support is either implemented with lifecycle template tests, or the
  implementation stops before claiming full RTK Query support and records a
  follow-up plan.
- Replay/conformance can observe Redux state through a fresh real store handle
  and Provider wrapper.
- Existing Jotai, SWR, Zustand, TanStack Query, React Router, Next, and
  TanStack Router tests do not regress.
- Docs/specs list Redux as a supported state source and accurately describe
  caveats.

## 9. Risks, ambiguities, and stop conditions

- Stop and report if reducer-effect lowering needs a new IR operation for
  "havoc this record field/subtree" and existing `havoc`, `updateField`, or
  token abstractions cannot express sound over-approximation.
- Stop and report if `StateSourcePlugin.summarizeWrite` cannot access enough
  discovered reducer metadata to summarize `dispatch(...)` without global
  mutable plugin state. Prefer a plugin-local `extract` pass or a narrow SPI
  extension over hidden caches.
- Stop and report if generated replay tests cannot wrap Redux components with
  `<Provider store={store}>` using the current harness/provider codegen shape.
  Do not hand-code Redux-only replay behavior in unrelated modules without a
  small design note.
- Stop and split a follow-up plan if RTK Query support makes the Redux adapter
  too large to land safely with core store/dispatch support. The core Redux
  adapter should not claim RTK Query acceptance until template and harness tests
  pass.
- Treat arbitrary middleware, enhancers, sagas, observables, listener
  middleware, persistence, and rehydration as caveated. Stop if a target app's
  correctness depends on one of those exact semantics.
- Treat non-serializable state/actions as model slack. Stop if user properties
  require exact modeling of functions, class instances, Maps/Sets, Promises, or
  Symbols in Redux state.
- Treat dynamic Provider store selection, runtime reducer injection, dynamic
  `replaceReducer`, and code-split reducers as caveated unless the static
  reducer map is discoverable. Stop if the app relies on them heavily enough
  that a bounded static approximation would be misleading.
- Do not execute selectors or reducers to "just see what happens". If static
  lowering fails, report the unsupported construct and over-approximate affected
  vars.
- Keep implementation additive. If Redux support requires unrelated refactors in
  existing source plugins, stop and report the coupling point before editing
  those systems.
