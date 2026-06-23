import { reduxSource } from "modality-ts/extract/plugins/state/redux";
import type * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { createBuiltinModalityRegistry } from "../../../src/cli/registry/index.js";
import { createSemanticProjectForTest } from "../../../src/extract/engine/ts/semantic-project.js";
import { observe, setup } from "../../../src/extract/plugins/state/redux/harness.js";
import { discoverReduxStoresDetailed } from "../../../src/extract/plugins/state/redux/store.js";

describe("Redux source plugin", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = reduxSource();
    expect(plugin.id).toBe("redux");
    expect(plugin.packageNames).toEqual([
      "@reduxjs/toolkit",
      "react-redux",
      "redux",
    ]);
    expect(
      plugin.discover({ sourceText: "", fileName: "store.ts", route: "/" }),
    ).toEqual([]);
    expect(
      plugin.writeChannels({ sourceText: "", fileName: "App.tsx" }),
    ).toEqual([]);
    expect(
      plugin.safetyWarnings?.({ sourceText: "", fileName: "App.tsx" }),
    ).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe(
      "@reduxjs/toolkit>=2,react-redux>=9,redux>=5",
    );
  });

  it("registers when @reduxjs/toolkit and react-redux are dependencies", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {
        "@reduxjs/toolkit": "^2.0.0",
        "react-redux": "^9.0.0",
        react: "^18.0.0",
      },
    });
    expect(registry.statePluginIds).toContain("redux");
  });

  it("registers when redux and react-redux are dependencies", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {
        redux: "^5.0.0",
        "react-redux": "^9.0.0",
        react: "^18.0.0",
      },
    });
    expect(registry.statePluginIds).toContain("redux");
  });

  it("is absent when redux is disabled", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {
        "@reduxjs/toolkit": "^2.0.0",
        "react-redux": "^9.0.0",
      },
      disabledPlugins: ["redux"],
    });
    expect(registry.statePluginIds).not.toContain("redux");
  });

  it("is absent when no redux packages are dependencies", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { react: "^18.0.0" },
    });
    expect(registry.statePluginIds).not.toContain("redux");
  });

  it("observes store values through harness handles", () => {
    const handles = setup({
      stores: {
        store: {
          getState: () => ({ counter: { value: 3 } }),
        },
      },
    });
    expect(observe("redux:store.counter.value", handles)).toEqual({
      value: 3,
    });
    expect(
      reduxSource().harness.observe("redux:store.counter.value", handles),
    ).toEqual({
      value: 3,
    });
  });

  it("falls back to initial model state for observation", () => {
    expect(
      observe(
        "redux:store.counter.value",
        setup({ initialState: { "redux:store.counter.value": 0 } }),
      ),
    ).toEqual({ value: 0 });
    expect(observe("redux:missing.field", setup({}))).toBe("unobservable");
  });

  it("discovers configureStore slice fields with stable ids", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment(state) { state.value += 1; },
        },
      });
      export const store = configureStore({
        reducer: { counter: counterSlice.reducer },
      });
    `;
    const decls = reduxSource().discover({
      sourceText: source,
      fileName: "store.ts",
      route: "/",
    });
    const counterValue = decls.find(
      (decl) => decl.id === "redux:store.counter.value",
    );
    expect(counterValue?.var).toMatchObject({
      initial: 0,
      domain: { kind: "boundedInt", min: 0, max: 0 },
    });
  });

  it("resolves local barrel aliases for configureStore and hooks", () => {
    const source = `
      import { configureStore as setupStore, createSlice as makeSlice } from '@reduxjs/toolkit';
      import { useSelector as useAppSelector, useDispatch as useAppDispatch } from 'react-redux';
      const counterSlice = makeSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: { increment(state) { state.value += 1; } },
      });
      export const store = setupStore({ reducer: { counter: counterSlice.reducer } });
      export function App() {
        const value = useAppSelector((s) => s.counter.value);
        const dispatch = useAppDispatch();
        return <button onClick={() => dispatch(counterSlice.actions.increment())}>{value}</button>;
      }
    `;
    const decls = reduxSource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    expect(decls.some((decl) => decl.id === "redux:store.counter.value")).toBe(
      true,
    );
    const channels = reduxSource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(channels.some((channel) => channel.symbolName === "value")).toBe(
      true,
    );
    expect(channels.some((channel) => channel.symbolName === "increment")).toBe(
      true,
    );
  });

  it("models multiple stores with store-qualified ids and warnings", () => {
    const source = `
      import { configureStore, createSlice } from '@reduxjs/toolkit';
      const aSlice = createSlice({ name: 'a', initialState: { x: 0 }, reducers: {} });
      const bSlice = createSlice({ name: 'b', initialState: { y: 1 }, reducers: {} });
      export const storeA = configureStore({ reducer: { a: aSlice.reducer } });
      export const storeB = configureStore({ reducer: { b: bSlice.reducer } });
    `;
    const discovery = discoverReduxStoresDetailed(source, "store.ts");
    expect(discovery.storeNames).toEqual(new Set(["storeA", "storeB"]));
    expect(discovery.decls.map((decl) => decl.id).sort()).toEqual([
      "redux:storeA.a.x",
      "redux:storeB.b.y",
    ]);
    const warnings = reduxSource().safetyWarnings?.({
      sourceText: source,
      fileName: "store.ts",
    });
    expect(
      warnings?.some((warning) => warning.message.includes("Multiple")),
    ).toBe(true);
  });

  it("uses semantic import resolution when a project is available", () => {
    const files = {
      "store.ts": `
        import { configureStore, createSlice } from '@reduxjs/toolkit';
        export const counterSlice = createSlice({
          name: 'counter',
          initialState: { value: 0 },
          reducers: { increment(state) { state.value += 1; } },
        });
        export const store = configureStore({ reducer: { counter: counterSlice.reducer } });
      `,
    };
    const project = createSemanticProjectForTest([
      { path: "store.ts", text: files["store.ts"] },
    ]);
    const sourceFile = project.getSourceFile("store.ts");
    const types = {
      program: project.program,
      checker: project.checker,
      sourceFile,
      getSourceFile: (name: string) => project.getSourceFile(name),
      canonicalFileName: (name: string) => project.canonicalFileName(name),
      resolveModuleName: (specifier: string, containingFile: string) =>
        project.resolveModuleName(specifier, containingFile),
      symbolAt: (node: ts.Node) => project.symbolAt(node),
      aliasedSymbolAt: (node: ts.Node) => project.aliasedSymbolAt(node),
      symbolKey: (symbol: ts.Symbol) => project.symbolKey(symbol),
      localSymbolKey: (node: ts.Node) => project.localSymbolKey(node),
    };
    const decls = reduxSource().discover({
      sourceText: files["store.ts"],
      fileName: "store.ts",
      route: "/",
      types,
    });
    expect(decls.some((decl) => decl.id === "redux:store.counter.value")).toBe(
      true,
    );
  });
});
