import { describe, expect, it } from "vitest";
import {
  extractJotaiSkeleton,
  jotaiSource,
} from "modality-ts/extract/sources/jotai";
import { createSemanticProjectForTest } from "../../../src/extract/engine/ts/semantic-project.js";
import { observe, setup } from "../../../src/extract/sources/jotai/harness.js";

describe("Jotai source plugin", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = jotaiSource();
    expect(plugin.id).toBe("jotai");
    expect(plugin.packageNames).toEqual(["jotai"]);
    expect(
      plugin.writeChannels({ sourceText: "", fileName: "state.ts" }),
    ).toEqual([]);
    expect(
      plugin.safetyWarnings?.({ sourceText: "", fileName: "state.ts" }),
    ).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe("jotai>=2");
  });

  it("observes atom values through harness store handles", () => {
    const atom = { debugLabel: "authAtom" };
    const handles = setup({
      atoms: { "atom:authAtom": atom },
      store: { get: (candidate) => (candidate === atom ? "user" : "guest") },
    });

    expect(observe("atom:authAtom", handles)).toEqual({ value: "user" });
    expect(jotaiSource().harness.observe("atom:authAtom", handles)).toEqual({
      value: "user",
    });
  });

  it("falls back to initial model state for atom observation", () => {
    expect(
      observe(
        "atom:authAtom",
        setup({ initialState: { "atom:authAtom": "guest" } }),
      ),
    ).toEqual({ value: "guest" });
    expect(observe("atom:missing", setup({}))).toBe("unobservable");
  });

  it("discovers primitive atom declarations as global state vars", () => {
    const source = `
      import { atom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export const countAtom = atom(0);
    `;
    expect(
      jotaiSource().discover({
        sourceText: source,
        fileName: "state.ts",
        route: "/",
      }),
    ).toEqual([
      {
        id: "atom:authAtom",
        kind: "jotai/atom",
        var: {
          id: "atom:authAtom",
          domain: { kind: "enum", values: ["guest", "user"] },
          origin: { file: "state.ts", line: 3, column: 20 },
          scope: { kind: "global" },
          initial: "guest",
        },
        origin: { file: "state.ts", line: 3, column: 20 },
        metadata: {
          atomName: "authAtom",
          configKind: "primitive",
          creator: "atom",
        },
      },
      {
        id: "atom:countAtom",
        kind: "jotai/atom",
        var: {
          id: "atom:countAtom",
          domain: { kind: "boundedInt", min: 0, max: 0 },
          origin: { file: "state.ts", line: 4, column: 20 },
          scope: { kind: "global" },
          initial: 0,
        },
        origin: { file: "state.ts", line: 4, column: 20 },
        metadata: {
          atomName: "countAtom",
          configKind: "primitive",
          creator: "atom",
        },
      },
    ]);
  });

  it("discovers object and tagged atom domains", () => {
    const source = `
      import { atom } from 'jotai';
      const authAtom = atom<{ kind: 'guest' } | { kind: 'user'; name: 'Ada' }>({ kind: 'guest' });
      const draftAtom = atom({ text: '', dirty: false });
    `;
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls[0]?.var?.domain).toEqual({
      kind: "tagged",
      tag: "kind",
      variants: {
        guest: { kind: "record", fields: {} },
        user: {
          kind: "record",
          fields: { name: { kind: "enum", values: ["Ada"] } },
        },
      },
    });
    expect(decls[0]?.var?.initial).toEqual({ kind: "guest" });
    expect(decls[1]?.var?.domain).toEqual({
      kind: "record",
      fields: {
        text: { kind: "enum", values: [""] },
        dirty: { kind: "bool" },
      },
    });
    expect(decls[1]?.var?.initial).toEqual({ text: "", dirty: false });
  });

  it("discovers useAtom and useSetAtom write channels", () => {
    const source = `
      import { useAtom, useSetAtom } from 'jotai';
      const [auth, setAuth] = useAtom(authAtom);
      const setCount = useSetAtom(countAtom);
    `;
    expect(
      jotaiSource().writeChannels({ sourceText: source, fileName: "App.tsx" }),
    ).toEqual([
      {
        id: "atom:authAtom.read",
        varId: "atom:authAtom",
        symbolName: "auth",
        source: { file: "App.tsx", line: 3, column: 13 },
      },
      {
        id: "atom:authAtom.setter",
        varId: "atom:authAtom",
        symbolName: "setAuth",
        source: { file: "App.tsx", line: 3, column: 13 },
      },
      {
        id: "atom:countAtom.setter",
        varId: "atom:countAtom",
        symbolName: "setCount",
        source: { file: "App.tsx", line: 4, column: 13 },
      },
    ]);
  });

  it("discovers getDefaultStore().set write channels", () => {
    const source = `
      import { getDefaultStore } from 'jotai';
      const store = getDefaultStore();
      store.set(authAtom, 'user');
    `;
    expect(
      jotaiSource().writeChannels({ sourceText: source, fileName: "state.ts" }),
    ).toEqual([
      {
        id: "atom:authAtom.store-set",
        varId: "atom:authAtom",
        symbolName: "store.set:authAtom",
        source: { file: "state.ts", line: 4, column: 7 },
      },
    ]);
  });

  it("reports getDefaultStore imports as global taint caveats", () => {
    const source = `
      import { getDefaultStore as getStore } from 'jotai';
      const store = getStore();
    `;
    expect(
      jotaiSource().safetyWarnings?.({
        sourceText: source,
        fileName: "state.ts",
      }),
    ).toEqual([
      {
        message: "Global taint jotai:getDefaultStore",
        source: { file: "state.ts", line: 2, column: 16 },
        caveat: {
          kind: "global-taint",
          id: "jotai:getDefaultStore",
          reason: "Global taint jotai:getDefaultStore",
          source: { file: "state.ts", line: 2, column: 16 },
          severity: "unsound-risk",
        },
        confidence: "over-approx",
        producer: { kind: "state-source", id: "jotai" },
      },
    ]);
  });

  it("extracts async Jotai writes through the shared transition adapter", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useSetAtom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const setAuth = useSetAtom(authAtom);
        return <button onClick={async () => {
          await api.login();
          setAuth('user');
        }}>Login</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.login"] },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api.login.success",
        cls: "env",
        effect: expect.objectContaining({
          kind: "seq",
          effects: expect.arrayContaining([
            {
              kind: "assign",
              var: "atom:authAtom",
              expr: { kind: "lit", value: "user" },
            },
          ]),
        }),
        writes: ["sys:pending", "atom:authAtom"],
      }),
    );
  });

  it("havocs Jotai writes inside loops through the shared transition adapter", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useSetAtom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const setAuth = useSetAtom(authAtom);
        return <button onClick={() => {
          for (const item of items) setAuth(item.ok ? 'user' : 'guest');
        }}>Sync</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.authAtom.loop",
        effect: { kind: "havoc", var: "atom:authAtom" },
        writes: ["atom:authAtom"],
        confidence: "over-approx",
      }),
    );
  });

  it("extracts guard-return Jotai handlers with shared statement summarization", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useAtom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const [auth, setAuth] = useAtom(authAtom);
        return <button onClick={() => {
          if (auth === 'guest') return;
          setAuth('user');
        }}>Login</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.authAtom.seq",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "readPre", var: "atom:authAtom" },
            { kind: "lit", value: "guest" },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: IR conditional field name
        then: { kind: "seq", effects: [] },
        else: {
          kind: "assign",
          var: "atom:authAtom",
          expr: { kind: "lit", value: "user" },
        },
      },
      reads: ["atom:authAtom"],
      writes: ["atom:authAtom"],
      confidence: "exact",
    });
  });

  it("unwraps TypeScript expression wrappers on Jotai setter arguments", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useSetAtom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export function App() {
        const setAuth = useSetAtom(authAtom);
        return <button onClick={() => {
          setAuth(('user' as const) satisfies 'guest' | 'user');
        }}>Login</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.authAtom",
        effect: {
          kind: "assign",
          var: "atom:authAtom",
          expr: { kind: "lit", value: "user" },
        },
        writes: ["atom:authAtom"],
        confidence: "exact",
      }),
    );
  });

  it("discovers aliased jotai imports", () => {
    const source = `
      import { atom as jotaiAtom, useAtom as useJ } from 'jotai';
      export const authAtom = jotaiAtom('guest');
      const [auth, setAuth] = useJ(authAtom);
    `;
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls[0]?.id).toBe("atom:authAtom");
    expect(
      jotaiSource().writeChannels({ sourceText: source, fileName: "App.tsx" }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbolName: "auth", varId: "atom:authAtom" }),
        expect.objectContaining({
          symbolName: "setAuth",
          varId: "atom:authAtom",
        }),
      ]),
    );
  });

  it("discovers atomWithStorage from jotai/utils", () => {
    const source = `
      import { atomWithStorage } from 'jotai/utils';
      export const themeAtom = atomWithStorage('theme', 'light');
    `;
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls[0]).toMatchObject({
      id: "atom:themeAtom",
      var: {
        id: "atom:themeAtom",
        initial: "light",
        domain: { kind: "enum", values: ["light"] },
      },
      metadata: {
        atomName: "themeAtom",
        configKind: "storage",
        storageKey: "theme",
      },
    });
  });

  it("warns on dynamic atom family params", () => {
    const source = `
      import { atom, atomFamily } from 'jotai/utils';
      const countAtom = atom(0);
      const todoFamily = atomFamily((id: string) => atom(id));
      const dynamic = todoFamily(routeId);
    `;
    const warnings = jotaiSource().safetyWarnings?.({
      sourceText: source,
      fileName: "state.ts",
    });
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining("dynamic atom family param"),
        }),
      ]),
    );
  });

  it("discovers static atom family instances", () => {
    const source = `
      import { atom } from 'jotai';
      import { atomFamily } from 'jotai-family';
      const itemFamily = atomFamily((id: 'a' | 'b') => atom(id));
      const itemA = itemFamily('a');
    `;
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls).toContainEqual(
      expect.objectContaining({
        id: 'atom-family:itemFamily:"a"',
        kind: "jotai/atom-family",
      }),
    );
  });

  it("extracts write-only derived atom increments through useSetAtom", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useSetAtom } from 'jotai';
      export const countAtom = atom(0);
      const incAtom = atom(null, (get, set) => set(countAtom, get(countAtom) + 1));
      export function App() {
        const inc = useSetAtom(incAtom);
        return <button onClick={() => inc()}>Inc</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        writes: ["atom:countAtom"],
        confidence: "exact",
      }),
    );
  });

  it("discovers Provider store-qualified useAtom channels", () => {
    const source = `
      import { Provider, useAtom, createStore } from 'jotai';
      const myStore = createStore();
      function Button() {
        const [count, setCount] = useAtom(countAtom);
        return null;
      }
      export function App() {
        return <Provider store={myStore}><Button /></Provider>;
      }
    `;
    const channels = jotaiSource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(channels).toContainEqual(
      expect.objectContaining({
        varId: "atom:countAtom@store:myStore",
        symbolName: "setCount",
      }),
    );
  });

  it("hydrates atom initial values from useHydrateAtoms", () => {
    const source = `
      import { atom } from 'jotai';
      import { useHydrateAtoms } from 'jotai/utils';
      export const countAtom = atom(0);
      export function App() {
        useHydrateAtoms([[countAtom, 42]]);
        return null;
      }
    `;
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    expect(decls[0]?.var?.initial).toBe(42);
  });

  it("extracts useResetAtom as initial-value assignment", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useResetAtom } from 'jotai';
      import { atomWithReset } from 'jotai/utils';
      export const countAtom = atomWithReset(0);
      export function App() {
        const reset = useResetAtom(countAtom);
        return <button onClick={() => reset()}>Reset</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        effect: {
          kind: "assign",
          var: "atom:countAtom",
          expr: { kind: "lit", value: 0 },
        },
        writes: ["atom:countAtom"],
      }),
    );
  });

  it("extracts RESET setter argument for resettable atoms", () => {
    const result = extractJotaiSkeleton(
      `
      import { atom, useAtom } from 'jotai';
      import { atomWithReset, RESET } from 'jotai/utils';
      export const countAtom = atomWithReset(0);
      export function App() {
        const [, setCount] = useAtom(countAtom);
        return <button onClick={() => setCount(RESET)}>Reset</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        effect: {
          kind: "assign",
          var: "atom:countAtom",
          expr: { kind: "lit", value: 0 },
        },
      }),
    );
  });

  it("discovers loadable wrapper domains", () => {
    const source = `
      import { atom } from 'jotai';
      import { loadable } from 'jotai/utils';
      const userAtom = atom(async () => 'user');
      const loadableUser = loadable(userAtom);
    `;
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName: "state.ts",
      route: "/",
    });
    expect(decls.at(-1)?.var?.domain).toEqual({
      kind: "tagged",
      tag: "state",
      variants: {
        loading: { kind: "record", fields: {} },
        hasData: {
          kind: "record",
          fields: { data: { kind: "tokens", count: 1 } },
        },
        hasError: {
          kind: "record",
          fields: { error: { kind: "tokens", count: 1 } },
        },
      },
    });
  });

  it("preserves enum and boundedInt domains for primitive atoms under semantic context", () => {
    const fileName = "/project/state.ts";
    const source = `
      import { atom } from 'jotai';
      export const statusAtom = atom("idle");
      export const countAtom = atom(0);
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
    };
    const decls = jotaiSource().discover({
      sourceText: source,
      fileName,
      route: "/",
      types,
    });
    const status = decls.find((decl) => decl.id === "atom:statusAtom");
    expect(status?.var).toMatchObject({
      domain: { kind: "enum", values: ["idle"] },
      initial: "idle",
    });
    const count = decls.find((decl) => decl.id === "atom:countAtom");
    expect(count?.var).toMatchObject({
      domain: { kind: "boundedInt", min: 0, max: 0 },
      initial: 0,
    });
  });

  it("duplicates imported atoms for provider store scopes via related fragments", () => {
    const stateFile = "/project/state.ts";
    const appFile = "/project/App.tsx";
    const stateText = `
      import { atom } from 'jotai';
      export const countAtom = atom(0);
    `;
    const appText = `
      import { Provider, createStore, useAtom } from 'jotai';
      import { countAtom } from './state';
      const myStore = createStore();
      function Button() {
        const [, setCount] = useAtom(countAtom);
        return <button onClick={() => setCount(1)}>Inc</button>;
      }
      export function App() {
        return <Provider store={myStore}><Button /></Provider>;
      }
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: stateFile, text: stateText },
      { path: appFile, text: appText },
    ]);
    const sourceFile = semanticProject.getSourceFile(appFile);
    expect(sourceFile).toBeDefined();
    const types = {
      program: semanticProject.program,
      checker: semanticProject.checker,
      sourceFile,
      getSourceFile: (name: string) => semanticProject.getSourceFile(name),
    };
    const decls = jotaiSource().discover({
      sourceText: appText,
      fileName: appFile,
      route: "/",
      types,
      relatedFragments: [
        { sourceText: stateText, fileName: stateFile },
        { sourceText: appText, fileName: appFile },
      ],
    });
    expect(
      decls.some((decl) => decl.id === "atom:countAtom@store:myStore"),
    ).toBe(true);
  });
});
