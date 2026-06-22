import { reduxSource } from "modality-ts/extract/sources/redux";
import { describe, expect, it } from "vitest";
import { discoverReduxWritesDetailed } from "../../../src/extract/sources/redux/writes.js";

describe("Redux selector reads", () => {
  it("maps useSelector inline selectors to read channels", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useSelector } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: { increment(state) { state.value += 1; } },
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const value = useSelector((state) => state.counter.value);
        return <span>{value}</span>;
      }
    `;
    const channels = reduxSource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(channels).toContainEqual(
      expect.objectContaining({
        varId: "redux:store.counter.value",
        symbolName: "value",
      }),
    );
  });

  it("resolves typed useAppSelector aliases", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useSelector } from 'react-redux';
      const useAppSelector = useSelector.withTypes<{ counter: { value: number } }>();
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {},
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const value = useAppSelector((s) => s.counter.value);
        return value;
      }
    `;
    const channels = reduxSource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(
      channels.some(
        (channel) =>
          channel.varId === "redux:store.counter.value" &&
          channel.symbolName === "value",
      ),
    ).toBe(true);
  });

  it("resolves exported selector functions", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useSelector } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0, label: 'idle' },
        reducers: {},
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export const selectCount = (state: { counter: { value: number } }) => state.counter.value;
      export function App() {
        const value = useSelector(selectCount);
        return value;
      }
    `;
    const channels = reduxSource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(
      channels.some((channel) => channel.varId === "redux:store.counter.value"),
    ).toBe(true);
  });

  it("maps object-return selectors to field reads", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      import { useSelector } from 'react-redux';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0, label: 'idle' },
        reducers: {},
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const { value, label } = useSelector((s) => ({
          value: s.counter.value,
          label: s.counter.label,
        }));
        return value + label;
      }
    `;
    const channels = reduxSource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(
      channels.some((channel) => channel.varId === "redux:store.counter.value"),
    ).toBe(true);
  });

  it("resolves store.getState reads", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {},
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      const value = store.getState().counter.value;
    `;
    const channels = reduxSource().writeChannels({
      sourceText: source,
      fileName: "store.ts",
    });
    expect(
      channels.some(
        (channel) =>
          channel.varId === "redux:store.counter.value" &&
          channel.symbolName === "value",
      ),
    ).toBe(true);
  });

  it("supports simple connect mapStateToProps and warns on factories", () => {
    const source = `
      import { connect } from 'react-redux';
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {},
      });
      export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      const mapState = (state) => ({ value: state.counter.value });
      export const Connected = connect(mapState)(() => null);
      export const Factory = connect(() => mapState)(() => null);
    `;
    const discovery = discoverReduxWritesDetailed(source, "App.tsx");
    expect(
      discovery.channels.some((channel) => channel.symbolName === "value"),
    ).toBe(true);
    const warnings = discoverReduxWritesDetailed(source, "App.tsx").warnings;
    expect(
      warnings?.some((warning) =>
        warning.message.includes("connect mapStateToProps factory"),
      ),
    ).toBe(true);
  });
});
