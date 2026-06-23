import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { storeVarId } from "../../../src/extract/plugins/state/redux/ids.js";
import { resolveReduxImports } from "../../../src/extract/plugins/state/redux/imports.js";
import { lowerReducerCase } from "../../../src/extract/plugins/state/redux/reducers.js";
import {
  collectSliceDefinitions,
  lowerSliceActionEffects,
} from "../../../src/extract/plugins/state/redux/slices.js";

function parseArrow(body: string): ts.ArrowFunction {
  const source = ts.createSourceFile(
    "case.ts",
    `const fn = ${body};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = source.statements[0];
  if (!ts.isVariableStatement(statement)) throw new Error("expected variable");
  const decl = statement.declarationList.declarations[0];
  if (!decl?.initializer || !ts.isArrowFunction(decl.initializer)) {
    throw new Error("expected arrow");
  }
  return decl.initializer;
}

describe("Redux reducer lowering", () => {
  const fieldVarIds = new Map([
    ["value", storeVarId("store", "counter.value")],
  ]);
  const fieldInitials = new Map([["value", 0]]);
  const baseCtx = {
    storeName: "store",
    sliceKey: "counter",
    fieldVarIds,
    fieldInitials,
    immer: true,
  };

  it("lowers immer assignment", () => {
    const effect = lowerReducerCase(
      parseArrow("(state) => { state.value = 1; }"),
      baseCtx,
    );
    expect(effect).toEqual({
      kind: "assign",
      var: "redux:store.counter.value",
      expr: { kind: "lit", value: 1 },
    });
  });

  it("lowers nested immer assignment", () => {
    const nestedVarIds = new Map([
      ["profile", storeVarId("store", "user.profile")],
    ]);
    const effect = lowerReducerCase(
      parseArrow("(state) => { state.profile.name = 'x'; }"),
      {
        ...baseCtx,
        sliceKey: "user",
        fieldVarIds: nestedVarIds,
      },
    );
    expect(effect).toMatchObject({
      kind: "assign",
      var: "redux:store.user.profile",
      expr: {
        kind: "updateField",
        path: ["name"],
        value: { kind: "lit", value: "x" },
      },
    });
  });

  it("lowers +=, -=, ++, and --", () => {
    expect(
      lowerReducerCase(parseArrow("(state) => { state.value += 2; }"), baseCtx),
    ).toMatchObject({
      kind: "assign",
      expr: { kind: "add" },
    });
    expect(
      lowerReducerCase(parseArrow("(state) => { state.value -= 1; }"), baseCtx),
    ).toMatchObject({
      kind: "assign",
      expr: { kind: "sub" },
    });
    expect(
      lowerReducerCase(parseArrow("(state) => { state.value++; }"), baseCtx),
    ).toMatchObject({
      kind: "assign",
      expr: { kind: "add" },
    });
    expect(
      lowerReducerCase(parseArrow("(state) => { --state.value; }"), baseCtx),
    ).toMatchObject({
      kind: "assign",
      expr: { kind: "sub" },
    });
  });

  it("lowers immutable object spread returns", () => {
    const effect = lowerReducerCase(
      parseArrow("(state) => ({ ...state, value: 5 })"),
      { ...baseCtx, immer: false },
    );
    expect(effect).toEqual({
      kind: "assign",
      var: "redux:store.counter.value",
      expr: { kind: "lit", value: 5 },
    });
  });

  it("lowers scalar payload returns", () => {
    const effect = lowerReducerCase(
      parseArrow("(state, action) => action.payload"),
      baseCtx,
    );
    expect(effect).toMatchObject({
      kind: "assign",
      expr: { kind: "freshToken", domainOf: "redux:action.payload" },
    });
  });

  it("lowers createSlice reducers and extraReducers cases", () => {
    const source = `
      import { createSlice } from '@reduxjs/toolkit';
      const counterSlice = createSlice({
        name: 'counter',
        initialState: { value: 0 },
        reducers: {
          increment(state) { state.value += 1; },
        },
        extraReducers: (builder) => {
          builder.addCase('counter/reset', (state) => { state.value = 0; });
        },
      });
    `;
    const file = ts.createSourceFile(
      "slice.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = resolveReduxImports(file);
    const slices = collectSliceDefinitions(file, imports);
    const slice = slices.get("counterSlice");
    expect(slice).toBeTruthy();
    const effects = lowerSliceActionEffects(
      slice!,
      "store",
      "counter",
      fieldVarIds,
      fieldInitials,
    );
    expect(effects.get("counter/increment")).toMatchObject({
      kind: "assign",
      expr: { kind: "add" },
    });
    expect(effects.get("counter/reset")).toMatchObject({
      kind: "assign",
      expr: { kind: "lit", value: 0 },
    });
  });

  it("lowers classic if reducers", () => {
    const effect = lowerReducerCase(
      parseArrow(`(state, action) => {
        if (action.type === 'inc') {
          return { value: 1 };
        }
      }`),
      { ...baseCtx, immer: false },
    );
    expect(effect).toEqual({
      kind: "assign",
      var: "redux:store.counter.value",
      expr: { kind: "lit", value: 1 },
    });
  });

  it("emits havoc for unsupported reducers instead of no-ops", () => {
    const effect = lowerReducerCase(
      parseArrow("(state) => { external(); }"),
      baseCtx,
    );
    expect(effect).toBe("unsupported");
    const source = `
      import { createSlice } from '@reduxjs/toolkit';
      const badSlice = createSlice({
        name: 'bad',
        initialState: { value: 0 },
        reducers: {
          broken(state) { external(); },
        },
      });
    `;
    const file = ts.createSourceFile(
      "bad.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = resolveReduxImports(file);
    const slices = collectSliceDefinitions(file, imports);
    const slice = slices.get("badSlice")!;
    const effects = lowerSliceActionEffects(
      slice,
      "store",
      "bad",
      fieldVarIds,
      fieldInitials,
    );
    expect(effects.get("bad/broken")).toMatchObject({ kind: "havoc" });
  });
});
