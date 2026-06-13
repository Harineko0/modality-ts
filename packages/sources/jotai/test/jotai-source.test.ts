import { describe, expect, it } from "vitest";
import { discoverJotaiAtoms, discoverJotaiSafetyWarnings, discoverJotaiWriteChannels, jotaiSource } from "../src/index.js";
import { observe, setup } from "../src/harness.js";

describe("Jotai source plugin", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = jotaiSource();
    expect(plugin.id).toBe("jotai");
    expect(plugin.packageNames).toEqual(["jotai"]);
    expect(plugin.writeChannels({ sourceText: "", fileName: "state.ts" })).toEqual([]);
    expect(plugin.safetyWarnings?.({ sourceText: "", fileName: "state.ts" })).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe("jotai>=2");
  });

  it("observes atom values through harness store handles", () => {
    const atom = { debugLabel: "authAtom" };
    const handles = setup({
      atoms: { "atom:authAtom": atom },
      store: { get: (candidate) => candidate === atom ? "user" : "guest" }
    });

    expect(observe("atom:authAtom", handles)).toEqual({ value: "user" });
    expect(jotaiSource().harness.observe("atom:authAtom", handles)).toEqual({ value: "user" });
  });

  it("falls back to initial model state for atom observation", () => {
    expect(observe("atom:authAtom", setup({ initialState: { "atom:authAtom": "guest" } }))).toEqual({ value: "guest" });
    expect(observe("atom:missing", setup({}))).toBe("unobservable");
  });

  it("discovers primitive atom declarations as global state vars", () => {
    const source = `
      import { atom } from 'jotai';
      export const authAtom = atom<'guest' | 'user'>('guest');
      export const countAtom = atom(0);
    `;
    expect(discoverJotaiAtoms(source, "state.ts")).toEqual([
      {
        id: "atom:authAtom",
        kind: "jotai/atom",
        var: {
          id: "atom:authAtom",
          domain: { kind: "enum", values: ["guest", "user"] },
          origin: { file: "state.ts", line: 3, column: 20 },
          scope: { kind: "global" },
          initial: "guest"
        },
        origin: { file: "state.ts", line: 3, column: 20 },
        metadata: { atomName: "authAtom" }
      },
      {
        id: "atom:countAtom",
        kind: "jotai/atom",
        var: {
          id: "atom:countAtom",
          domain: { kind: "boundedInt", min: 0, max: 0 },
          origin: { file: "state.ts", line: 4, column: 20 },
          scope: { kind: "global" },
          initial: 0
        },
        origin: { file: "state.ts", line: 4, column: 20 },
        metadata: { atomName: "countAtom" }
      }
    ]);
  });

  it("discovers object and tagged atom domains", () => {
    const source = `
      import { atom } from 'jotai';
      const authAtom = atom<{ kind: 'guest' } | { kind: 'user'; name: 'Ada' }>({ kind: 'guest' });
      const draftAtom = atom({ text: '', dirty: false });
    `;
    const decls = discoverJotaiAtoms(source, "state.ts");
    expect(decls[0]?.var?.domain).toEqual({
      kind: "tagged",
      tag: "kind",
      variants: {
        guest: { kind: "record", fields: {} },
        user: { kind: "record", fields: { name: { kind: "enum", values: ["Ada"] } } }
      }
    });
    expect(decls[0]?.var?.initial).toEqual({ kind: "guest" });
    expect(decls[1]?.var?.domain).toEqual({
      kind: "record",
      fields: {
        text: { kind: "enum", values: [""] },
        dirty: { kind: "bool" }
      }
    });
    expect(decls[1]?.var?.initial).toEqual({ text: "", dirty: false });
  });

  it("discovers useAtom and useSetAtom write channels", () => {
    const source = `
      import { useAtom, useSetAtom } from 'jotai';
      const [auth, setAuth] = useAtom(authAtom);
      const setCount = useSetAtom(countAtom);
    `;
    expect(discoverJotaiWriteChannels(source, "App.tsx")).toEqual([
      {
        id: "atom:authAtom.setter",
        varId: "atom:authAtom",
        symbolName: "setAuth",
        source: { file: "App.tsx", line: 3, column: 13 }
      },
      {
        id: "atom:countAtom.setter",
        varId: "atom:countAtom",
        symbolName: "setCount",
        source: { file: "App.tsx", line: 4, column: 13 }
      }
    ]);
  });

  it("discovers getDefaultStore().set write channels", () => {
    const source = `
      import { getDefaultStore } from 'jotai';
      const store = getDefaultStore();
      store.set(authAtom, 'user');
    `;
    expect(discoverJotaiWriteChannels(source, "state.ts")).toEqual([
      {
        id: "atom:authAtom.store-set",
        varId: "atom:authAtom",
        symbolName: "store.set:authAtom",
        source: { file: "state.ts", line: 4, column: 7 }
      }
    ]);
  });

  it("reports getDefaultStore imports as global taint caveats", () => {
    const source = `
      import { getDefaultStore as getStore } from 'jotai';
      const store = getStore();
    `;
    expect(discoverJotaiSafetyWarnings(source, "state.ts")).toEqual([
      {
        message: "Global taint jotai:getDefaultStore",
        source: { file: "state.ts", line: 2, column: 16 }
      }
    ]);
  });
});
