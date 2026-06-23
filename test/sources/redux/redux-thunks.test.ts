import { reduxSource } from "modality-ts/extract/plugins/state/redux";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolveReduxImports } from "../../../src/extract/plugins/state/redux/imports.js";
import { discoverReduxStoresDetailed } from "../../../src/extract/plugins/state/redux/store.js";
import { discoverStaticThunks } from "../../../src/extract/plugins/state/redux/thunks.js";
import { discoverReduxWritesDetailed } from "../../../src/extract/plugins/state/redux/writes.js";

describe("Redux thunks", () => {
  it("lowers static thunk dispatches sequentially", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment(state) { state.value += 1; },
          addTwo(state) { state.value += 2; },
        },
      });
      export const { increment, addTwo } = counterSlice.actions;
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export const bumpTwice = () => (dispatch) => {
        dispatch(increment());
        dispatch(addTwo());
      };
    `;
    const file = ts.createSourceFile(
      "thunk.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = resolveReduxImports(file);
    const discovery = discoverReduxStoresDetailed(source, "thunk.ts");
    const thunks = discoverStaticThunks(file, imports, discovery);
    expect(thunks.get("bumpTwice")).toMatchObject({ kind: "seq" });
  });

  it("registers createAsyncThunk lifecycle action effects", () => {
    const source = `
      import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
      const fetchUser = createAsyncThunk('users/fetch', async () => ({ id: 1 }));
      const usersSlice = createSlice({
        name: 'users',
        initialState: { status: 'idle' },
        reducers: {},
        extraReducers: (builder) => {
          builder
            .addCase(fetchUser.pending, (state) => { state.status = 'loading'; })
            .addCase(fetchUser.fulfilled, (state) => { state.status = 'done'; })
            .addCase(fetchUser.rejected, (state) => { state.status = 'error'; });
        },
      });
      export const store = configureStore({ reducer: { users: usersSlice.reducer } });
    `;
    const discovery = discoverReduxStoresDetailed(source, "store.ts");
    discoverReduxWritesDetailed(source, "store.ts");
    expect(discovery.actionEffects.has("users/fetch/pending")).toBe(true);
    expect(discovery.actionEffects.has("users/fetch/fulfilled")).toBe(true);
    expect(discovery.actionEffects.has("users/fetch/rejected")).toBe(true);
  });

  it("warns on arbitrary thunk logic", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: { increment(state) { state.value += 1; } },
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export const weird = () => (dispatch) => {
        for (let i = 0; i < 3; i++) dispatch({ type: 'unknown' });
      };
    `;
    const warnings = reduxSource().safetyWarnings?.({
      sourceText: source,
      fileName: "thunk.ts",
    });
    expect(
      warnings?.some((warning) => warning.message.includes("unmodeled logic")),
    ).toBe(true);
  });
});
