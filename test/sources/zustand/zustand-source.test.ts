import { describe, expect, it } from "vitest";
import {
  extractZustandSkeleton,
  zustandSource,
} from "modality-ts/extract/sources/zustand";
import { createBuiltinModalityRegistry } from "../../../src/cli/registry/index.js";
import { createSemanticProjectForTest } from "../../../src/extract/engine/ts/semantic-project.js";
import {
  observe,
  setup,
} from "../../../src/extract/sources/zustand/harness.js";
import { discoverZustandWritesDetailed } from "../../../src/extract/sources/zustand/writes.js";
import { discoverZustandStoresDetailed } from "../../../src/extract/sources/zustand/discover.js";
import { lowerActionBody } from "../../../src/extract/sources/zustand/effects.js";
import * as ts from "typescript";

describe("Zustand source plugin", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = zustandSource();
    expect(plugin.id).toBe("zustand");
    expect(plugin.packageNames).toEqual(["zustand"]);
    expect(
      plugin.discover({ sourceText: "", fileName: "state.ts", route: "/" }),
    ).toEqual([]);
    expect(
      plugin.writeChannels({ sourceText: "", fileName: "state.ts" }),
    ).toEqual([]);
    expect(
      plugin.safetyWarnings?.({ sourceText: "", fileName: "state.ts" }),
    ).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe("zustand>=4");
  });

  it("registers when zustand is a dependency", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { zustand: "^4.0.0", react: "^18.0.0" },
    });
    expect(registry.sourcePluginIds).toContain("zustand");
  });

  it("is absent when zustand is not a dependency", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { react: "^18.0.0" },
    });
    expect(registry.sourcePluginIds).not.toContain("zustand");
  });

  it("observes store values through harness handles", () => {
    const handles = setup({
      stores: {
        useGate: {
          getState: () => ({ open: true, status: "idle" }),
        },
      },
    });
    expect(observe("zustand:useGate.open", handles)).toEqual({
      value: true,
    });
    expect(
      zustandSource().harness.observe("zustand:useGate.open", handles),
    ).toEqual({
      value: true,
    });
  });

  it("falls back to initial model state for observation", () => {
    expect(
      observe(
        "zustand:useGate.open",
        setup({ initialState: { "zustand:useGate.open": false } }),
      ),
    ).toEqual({ value: false });
    expect(observe("zustand:missing.field", setup({}))).toBe("unobservable");
  });

  it("discovers primitive state fields with correct varId, initial, and domain", () => {
    const source = `
      import { create } from 'zustand';
      export const useCounter = create(() => ({
        count: 0,
        label: 'idle',
        active: false,
        status: 'idle' as 'idle' | 'done',
      }));
    `;
    const decls = zustandSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls.map((decl) => decl.id).sort()).toEqual([
      "zustand:useCounter.active",
      "zustand:useCounter.count",
      "zustand:useCounter.label",
      "zustand:useCounter.status",
    ]);
    const count = decls.find((decl) => decl.id === "zustand:useCounter.count");
    expect(count?.var).toMatchObject({
      initial: 0,
      domain: { kind: "boundedInt", min: 0, max: 0 },
    });
    const status = decls.find(
      (decl) => decl.id === "zustand:useCounter.status",
    );
    expect(status?.var?.domain).toEqual({
      kind: "enum",
      values: ["idle"],
    });
  });

  it("discovers numeric literal unions and bounded aliases", () => {
    const source = `
      import { create } from 'zustand';
      type Bounded<N extends number, M extends number> = number;
      type Uint8 = number;
      export const useNums = create<{ parity: 0 | 2; bounded: Bounded<0, 3>; byte: Uint8 }>()((set) => ({
        parity: 0,
        bounded: 1,
        byte: 0,
      }));
    `;
    const decls = zustandSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    const parity = decls.find((decl) => decl.id === "zustand:useNums.parity");
    expect(parity?.var?.domain).toEqual({ kind: "intSet", values: [0, 2] });
    const bounded = decls.find((decl) => decl.id === "zustand:useNums.bounded");
    expect(bounded?.var?.domain).toMatchObject({
      kind: "boundedInt",
      min: 0,
      max: 3,
    });
  });

  it("excludes actions from discovered state vars", () => {
    const source = `
      import { create } from 'zustand';
      export const useGate = create<{open:boolean; status:'idle'|'done'; openIt:()=>void; finish:()=>void}>()((set)=>({
        open: false,
        status: 'idle',
        openIt: () => set({ open: true }),
        finish: () => set((s) => ({ status: 'done' })),
      }));
    `;
    const decls = zustandSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls.map((decl) => decl.id).sort()).toEqual([
      "zustand:useGate.open",
      "zustand:useGate.status",
    ]);
  });

  it("discovers direct create, curried create, and createStore forms", () => {
    const source = `
      import { create } from 'zustand';
      import { createStore } from 'zustand/vanilla';
      export const useA = create((set) => ({ x: 1 }));
      export const useB = create<{ y: number }>()((set) => ({ y: 2 }));
      export const storeC = createStore((set) => ({ z: 3 }));
    `;
    const decls = zustandSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls.map((decl) => decl.id).sort()).toEqual([
      "zustand:storeC.z",
      "zustand:useA.x",
      "zustand:useB.y",
    ]);
  });

  it("extracts gate store onClick handler with assign open = lit(true)", () => {
    const result = extractZustandSkeleton(
      `
      import { create } from 'zustand';
      export const useGate = create<{open:boolean; status:'idle'|'done'; openIt:()=>void; finish:()=>void}>()((set)=>({
        open: false,
        status: 'idle',
        openIt: () => set({ open: true }),
        finish: () => set((s) => ({ status: 'done' })),
      }));
      export function App() {
        const openIt = useGate((s) => s.openIt);
        return <button onClick={openIt}>Open</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        cls: "user",
        effect: {
          kind: "assign",
          var: "zustand:useGate.open",
          expr: { kind: "lit", value: true },
        },
        writes: ["zustand:useGate.open"],
      }),
    );
  });

  it("keeps same-named actions scoped to their store when bound through selectors", () => {
    const result = extractZustandSkeleton(
      `
      import { create } from 'zustand';
      export const useA = create((set) => ({
        count: 0,
        inc: () => set({ count: 1 }),
      }));
      export const useB = create((set) => ({
        count: 0,
        inc: () => set({ count: 2 }),
      }));
      export function App() {
        const incA = useA((s) => s.inc);
        const incB = useB((s) => s.inc);
        return <>
          <button onClick={incA}>A</button>
          <button onClick={incB}>B</button>
        </>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        effect: {
          kind: "assign",
          var: "zustand:useA.count",
          expr: { kind: "lit", value: 1 },
        },
        writes: ["zustand:useA.count"],
      }),
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        effect: {
          kind: "assign",
          var: "zustand:useB.count",
          expr: { kind: "lit", value: 2 },
        },
        writes: ["zustand:useB.count"],
      }),
    );
  });

  it("discovers selector read channels", () => {
    const source = `
      import { create } from 'zustand';
      export const useGate = create((set) => ({ open: false, openIt: () => set({ open: true }) }));
      const open = useGate((s) => s.open);
    `;
    expect(
      zustandSource().writeChannels({
        sourceText: source,
        fileName: "App.tsx",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "zustand:useGate.open.read",
          varId: "zustand:useGate.open",
          symbolName: "open",
        }),
      ]),
    );
  });

  it("discovers useStore.getState read channels", () => {
    const source = `
      import { create } from 'zustand';
      export const useGate = create((set) => ({ open: false }));
      const open = useGate.getState().open;
    `;
    expect(
      zustandSource().writeChannels({
        sourceText: source,
        fileName: "App.tsx",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "zustand:useGate.open.getState-read",
          varId: "zustand:useGate.open",
          symbolName: "open",
        }),
      ]),
    );
  });

  it("lowers set(s => ({count: s.count + 1})) to add arithmetic", () => {
    const source = `
      import { create } from 'zustand';
      export const useCounter = create((set) => ({
        count: 0,
        inc: () => set((s) => ({ count: s.count + 1 })),
      }));
    `;
    const discovery = discoverZustandWritesDetailed(source, "state.ts");
    expect(discovery.setterFixedEffects.get("inc")).toEqual({
      kind: "assign",
      var: "zustand:useCounter.count",
      expr: {
        kind: "add",
        args: [
          { kind: "read", var: "zustand:useCounter.count" },
          { kind: "lit", value: 1 },
        ],
      },
    });
  });

  it("drops non-representable count * 2 updates with warning", () => {
    const source = `
      import { create } from 'zustand';
      export const useCounter = create((set) => ({
        count: 0,
        dbl: () => set((s) => ({ count: s.count * 2 })),
      }));
    `;
    const discovery = discoverZustandWritesDetailed(source, "state.ts");
    expect(discovery.setterFixedEffects.has("dbl")).toBe(false);
    expect(
      discovery.warnings.some((warning) =>
        warning.message.includes("Zustand non-representable update for count"),
      ),
    ).toBe(true);
  });

  it("unwraps persist middleware and emits SSR warning", () => {
    const source = `
      import { create } from 'zustand';
      import { persist } from 'zustand/middleware';
      export const useTheme = create(persist((set) => ({ color: 'light' }), { name: 'theme' }));
    `;
    const decls = zustandSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "zustand:useTheme.color",
          metadata: expect.objectContaining({ storageKind: "localStorage" }),
        }),
      ]),
    );
    expect(
      zustandSource().safetyWarnings?.({
        sourceText: source,
        fileName: "state.ts",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("SSR-unsafe unguarded localStorage"),
          caveat: expect.objectContaining({
            kind: "model-slack",
            id: "zustand:useTheme.color.localStorage",
          }),
        }),
      ]),
    );
  });

  it("unwraps combine, redux, subscribeWithSelector, and devtools middleware", () => {
    const combineSource = `
      import { create } from 'zustand';
      import { combine } from 'zustand/middleware';
      export const useA = create(combine({ x: 1 }, (set) => ({ inc: () => set({ x: 2 }) })));
    `;
    expect(
      zustandSource()
        .discover({
          sourceText: combineSource,
          fileName: "state.ts",
          route: "/",
        })
        .map((decl) => decl.id),
    ).toContain("zustand:useA.x");

    const reduxSource = `
      import { create } from 'zustand';
      import { redux } from 'zustand/middleware';
      const reducer = (state, action) => state;
      export const useB = create(redux(reducer, { y: 0 }));
    `;
    expect(
      zustandSource()
        .discover({ sourceText: reduxSource, fileName: "state.ts", route: "/" })
        .map((decl) => decl.id),
    ).toContain("zustand:useB.y");

    const nestedSource = `
      import { create } from 'zustand';
      import { devtools, persist } from 'zustand/middleware';
      export const useC = create(devtools(persist((set) => ({ z: false }), { name: 'c' })));
    `;
    expect(
      zustandSource()
        .discover({
          sourceText: nestedSource,
          fileName: "state.ts",
          route: "/",
        })
        .map((decl) => decl.id),
    ).toContain("zustand:useC.z");
  });

  it("lowers immer draft mutations", () => {
    const source = `
      import { create } from 'zustand';
      import { immer } from 'zustand/middleware/immer';
      export const useStore = create(immer((set) => ({
        open: false,
        profile: { name: 'a' },
        count: 0,
        list: [] as number[],
        openIt: () => set((s) => { s.open = true }),
        rename: () => set((s) => { s.profile.name = 'b' }),
        inc: () => set((s) => { s.count += 1 }),
        bump: () => set((s) => { s.count++ }),
        dec: () => set((s) => { s.count -= 1 }),
        shrink: () => set((s) => { s.count-- }),
        dbl: () => set((s) => { s.count *= 2 }),
        pushItem: () => set((s) => { s.list.push(1) }),
      })));
    `;
    const discovery = discoverZustandStoresDetailed(source, "state.ts");
    expect(discovery.storeImmer.get("useStore")).toBe(true);

    const writes = discoverZustandWritesDetailed(source, "state.ts");
    expect(writes.setterFixedEffects.get("openIt")).toEqual({
      kind: "assign",
      var: "zustand:useStore.open",
      expr: { kind: "lit", value: true },
    });
    expect(writes.setterFixedEffects.get("rename")).toEqual({
      kind: "assign",
      var: "zustand:useStore.profile",
      expr: {
        kind: "updateField",
        target: { kind: "read", var: "zustand:useStore.profile" },
        path: ["name"],
        value: { kind: "lit", value: "b" },
      },
    });
    expect(writes.setterFixedEffects.get("inc")).toEqual({
      kind: "assign",
      var: "zustand:useStore.count",
      expr: {
        kind: "add",
        args: [
          { kind: "read", var: "zustand:useStore.count" },
          { kind: "lit", value: 1 },
        ],
      },
    });
    expect(writes.setterFixedEffects.get("bump")).toEqual(
      writes.setterFixedEffects.get("inc"),
    );
    expect(writes.setterFixedEffects.get("dec")).toEqual({
      kind: "assign",
      var: "zustand:useStore.count",
      expr: {
        kind: "sub",
        args: [
          { kind: "read", var: "zustand:useStore.count" },
          { kind: "lit", value: 1 },
        ],
      },
    });
    expect(writes.setterFixedEffects.get("shrink")).toEqual(
      writes.setterFixedEffects.get("dec"),
    );
    expect(writes.setterFixedEffects.has("dbl")).toBe(false);
    expect(
      writes.warnings.some((warning) =>
        warning.message.includes("Zustand non-representable update for count"),
      ),
    ).toBe(true);
    expect(writes.setterFixedEffects.has("pushItem")).toBe(false);
    expect(
      writes.warnings.some((warning) =>
        warning.message.includes(
          "Zustand immer container mutation not precisely modeled for list",
        ),
      ),
    ).toBe(true);
  });

  it("keeps immer semantics through nested devtools(immer(...))", () => {
    const source = `
      import { create } from 'zustand';
      import { devtools } from 'zustand/middleware';
      import { immer } from 'zustand/middleware/immer';
      export const useStore = create(devtools(immer((set) => ({
        open: false,
        openIt: () => set((s) => { s.open = true }),
      }))));
    `;
    const discovery = discoverZustandStoresDetailed(source, "state.ts");
    expect(discovery.storeImmer.get("useStore")).toBe(true);
    const writes = discoverZustandWritesDetailed(source, "state.ts");
    expect(writes.setterFixedEffects.get("openIt")).toEqual({
      kind: "assign",
      var: "zustand:useStore.open",
      expr: { kind: "lit", value: true },
    });
  });

  it("uses return-form lowering when immer callback returns an object", () => {
    const fn = parseArrow(`(set) => set((s) => ({ count: s.count + 1 }))`);
    const effect = lowerActionBody(fn, {
      storeName: "useCounter",
      fieldVarIds: new Map([["count", "zustand:useCounter.count"]]),
      fieldInitials: new Map([["count", 0]]),
      immer: true,
    });
    expect(effect).toEqual({
      kind: "assign",
      var: "zustand:useCounter.count",
      expr: {
        kind: "add",
        args: [
          { kind: "read", var: "zustand:useCounter.count" },
          { kind: "lit", value: 1 },
        ],
      },
    });
  });

  it("preserves enum and boundedInt domains for initializer-only fields under semantic context", () => {
    const fileName = "/project/state.ts";
    const source = `
      import { create } from 'zustand';
      export const useGate = create(() => ({
        label: "idle",
        count: 0,
      }));
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: fileName, text: source },
    ]);
    const sourceFile = semanticProject.getSourceFile(fileName);
    expect(sourceFile).toBeDefined();
    const types = {
      program: semanticProject.program,
      checker: semanticProject.checker,
      sourceFile,
      getSourceFile: (name: string) => semanticProject.getSourceFile(name),
      canonicalFileName: (name: string) =>
        semanticProject.canonicalFileName(name),
      resolveModuleName: (specifier: string, containingFile: string) =>
        semanticProject.resolveModuleName(specifier, containingFile),
      symbolAt: (node: ts.Node) => semanticProject.symbolAt(node),
      aliasedSymbolAt: (node: ts.Node) => semanticProject.aliasedSymbolAt(node),
      symbolKey: (symbol: ts.Symbol) => semanticProject.symbolKey(symbol),
      localSymbolKey: (node: ts.Node) => semanticProject.localSymbolKey(node),
    };
    const decls = zustandSource().discover({
      sourceText: source,
      fileName,
      route: "/",
      types,
    });
    const label = decls.find((decl) => decl.id === "zustand:useGate.label");
    expect(label?.var).toMatchObject({
      domain: { kind: "enum", values: ["idle"] },
      initial: "idle",
    });
    const count = decls.find((decl) => decl.id === "zustand:useGate.count");
    expect(count?.var).toMatchObject({
      domain: { kind: "boundedInt", min: 0, max: 0 },
      initial: 0,
    });
  });

  it("recognizes store creators through import aliases and local barrels", () => {
    const barrelPath = "/project/zustand.ts";
    const statePath = "/project/state.ts";
    const barrelText = `export { create } from "zustand";`;
    const source = `import { create as makeStore } from "./zustand.js";
export const useCounter = makeStore(() => ({ count: 0 }));`;
    const semanticProject = createSemanticProjectForTest([
      { path: barrelPath, text: barrelText },
      { path: statePath, text: source },
    ]);
    const types = {
      program: semanticProject.program,
      checker: semanticProject.checker,
      sourceFile: semanticProject.getSourceFile(statePath),
      getSourceFile: (name: string) => semanticProject.getSourceFile(name),
      canonicalFileName: (name: string) =>
        semanticProject.canonicalFileName(name),
      resolveModuleName: (specifier: string, containingFile: string) =>
        semanticProject.resolveModuleName(specifier, containingFile),
      aliasedSymbolAt: (node: ts.Node) => semanticProject.aliasedSymbolAt(node),
      symbolKey: (symbol: ts.Symbol) => semanticProject.symbolKey(symbol),
      localSymbolKey: (node: ts.Node) => semanticProject.localSymbolKey(node),
    };
    const decls = zustandSource().discover({
      sourceText: source,
      fileName: statePath,
      route: "/",
      types,
    });
    expect(decls.some((decl) => decl.id === "zustand:useCounter.count")).toBe(
      true,
    );
  });

  it("keeps syntax-only zustand import fallback without semantic context", () => {
    const source = `
      import { create } from 'zustand';
      export const useCounter = create(() => ({ count: 0 }));
    `;
    expect(
      zustandSource().discover({
        sourceText: source,
        fileName: "state.ts",
        route: "/",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "zustand:useCounter.count" }),
      ]),
    );
  });
});

function parseArrow(body: string): ts.ArrowFunction {
  const source = ts.createSourceFile(
    "tmp.ts",
    `const fn = ${body};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const stmt = source.statements[0];
  if (!stmt || !ts.isVariableStatement(stmt)) {
    throw new Error("expected variable statement");
  }
  const decl = stmt.declarationList.declarations[0];
  if (!decl?.initializer || !ts.isArrowFunction(decl.initializer)) {
    throw new Error("expected arrow function");
  }
  return decl.initializer;
}
