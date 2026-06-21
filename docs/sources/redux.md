---
id: redux
title: Redux
sidebar_label: Redux
---

Redux is a first-class state source for Redux Toolkit stores, React-Redux reads and
writes, static thunks, and RTK Query cache templates. Store slice fields become state
variables (`redux:<store>.<slice>.<field>`); dispatches lower through statically
discovered reducer cases.

## What is discovered

- **Stores** — `configureStore`, `createStore`, and `legacy_createStore` with object
  reducer maps, `combineReducers`, and slice reducers.
- **Slices** — `createSlice` / `createReducer` case reducers, including Immer-style
  draft mutations and immutable returns.
- **Reads** — `useSelector`, typed hook aliases, exported selectors, `store.getState()`,
  and simple `connect(mapStateToProps)` mappings.
- **Writes** — `dispatch` of known actions, destructured `slice.actions`, `createAction`,
  bound action creators, static thunks, and `createAsyncThunk` lifecycle cases.
- **RTK Query** — `createApi` endpoints generate `redux-query:` template vars and
  lifecycle transitions.

## Caveats

- Multiple stores, custom middleware, sagas, listeners, and persistence are caveated.
- Dynamic dispatch, selectors, and connect mapper factories are over-approximated.
- RTK Query dynamic keys and tag functions emit model-slack caveats.

## Package entry

`modality-ts/extract/sources/redux` with harness at `./harness`. The plugin id is
`redux` and activates when `@reduxjs/toolkit`, `react-redux`, or `redux` is a
dependency.
