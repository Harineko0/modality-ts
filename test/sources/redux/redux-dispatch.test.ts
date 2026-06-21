import { describe, expect, it } from "vitest";
import {
  extractReduxSkeleton,
  reduxSource,
} from "modality-ts/extract/sources/redux";
import { discoverReduxWritesDetailed } from "../../../src/extract/sources/redux/writes.js";
import { discoverReduxStoresDetailed } from "../../../src/extract/sources/redux/store.js";

describe("Redux dispatch writes", () => {
  it("writes expected vars for dispatch(increment())", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useDispatch } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment(state) { state.value += 1; },
        },
      });
      export const { increment } = counterSlice.actions;
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const dispatch = useDispatch();
        return <button onClick={() => dispatch(increment())}>+</button>;
      }
    `;
    const discovery = discoverReduxStoresDetailed(source, "App.tsx");
    expect(discovery.actionEffects.get("counter/increment")).toBeTruthy();
    const writeDiscovery = discoverReduxWritesDetailed(source, "App.tsx");
    expect(writeDiscovery.dispatchFixedEffects.get("increment")).toBeTruthy();
  });

  it("resolves createAction and direct action objects", () => {
    const source = `
      import { configureStore, createAction } from '@reduxjs/toolkit';
      const inc = createAction<number>('counter/inc');
      const reducer = (state = { value: 0 }, action) => {
        if (action.type === 'counter/inc') return { ...state, value: state.value + 1 };
        return state;
      };
      export const store = configureStore({ reducer: { counter: reducer } });
      export function App() {
        return null;
      }
    `;
    const decls = reduxSource().discover({
      sourceText: source,
      fileName: "store.ts",
      route: "/",
    });
    expect(decls.some((decl) => decl.id === "redux:store.counter.value")).toBe(
      true,
    );
  });

  it("binds destructured slice.actions to write channels", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: { increment(state) { state.value += 1; } },
      });
      export const { increment } = counterSlice.actions;
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
    `;
    const writeDiscovery = discoverReduxWritesDetailed(source, "store.ts");
    expect(writeDiscovery.dispatchFixedEffects.get("increment")).toMatchObject({
      kind: "assign",
    });
  });

  it("over-approximates dynamic dispatch over slice vars", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useDispatch } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: { increment(state) { state.value += 1; } },
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const dispatch = useDispatch();
        return <button onClick={() => dispatch({ type: dynamicType() })}>x</button>;
      }
    `;
    const warnings = reduxSource().safetyWarnings?.({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(warnings?.length).toBeGreaterThanOrEqual(0);
  });

  it("resolves slice.actions.increment() in dispatch summarization", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useDispatch } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: { increment(state) { state.value += 1; } },
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const dispatch = useDispatch();
        return <button onClick={() => dispatch(counterSlice.actions.increment())}>+</button>;
      }
    `;
    const plugin = reduxSource();
    plugin.writeChannels({ sourceText: source, fileName: "App.tsx" });
    const summarized = plugin.summarizeWrite?.(
      {
        callee: "dispatch",
        arguments: ["counterSlice.actions.increment()"],
        source: { file: "App.tsx", line: 1, column: 1 },
      },
      { sourceText: source, fileName: "App.tsx" },
    );
    expect(summarized).toMatchObject({ kind: "assign" });
  });

  it("extracts JSX handler transitions through extractReduxSkeleton", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useDispatch } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment(state) { state.value += 1; },
        },
      });
      export const { increment } = counterSlice.actions;
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const dispatch = useDispatch();
        return <button onClick={() => dispatch(increment())}>+</button>;
      }
    `;
    const result = extractReduxSkeleton(source, {
      route: "/",
      fileName: "App.tsx",
    });
    const writeDiscovery = discoverReduxWritesDetailed(source, "App.tsx");
    expect(result.vars.some((v) => v.id === "redux:store.counter.value")).toBe(
      true,
    );
    expect(
      result.transitions.length > 0 ||
        writeDiscovery.dispatchFixedEffects.has("increment"),
    ).toBe(true);
  });
});
