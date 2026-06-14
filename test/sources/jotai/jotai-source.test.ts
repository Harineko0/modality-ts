import { describe, expect, it } from "vitest";
import {
  extractJotaiSkeleton,
  jotaiSource,
} from "modality-ts/extract/sources/jotai";
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
        metadata: { atomName: "authAtom" },
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
        metadata: { atomName: "countAtom" },
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
            { kind: "read", var: "atom:authAtom" },
            { kind: "lit", value: "guest" },
          ],
        },
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
});
