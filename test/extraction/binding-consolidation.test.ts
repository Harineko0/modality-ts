import type { StateVarDecl } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { runPluginDiscoveryPhase } from "../../src/extract/engine/pipeline/index.js";
import { decodeSetterBinding } from "../../src/extract/engine/ts/context.js";
import { jotaiSource } from "../../src/extract/plugins/state/jotai/plugin.js";
import { swrSource } from "../../src/extract/plugins/state/swr/plugin.js";
import { useStateSource } from "../../src/extract/plugins/state/use-state/index.js";

function legacySetterBindingFromDecl(decl: StateVarDecl) {
  const localMatch = /^local:([^.]+)\.(.+)$/.exec(decl.id);
  const atomMatch = /^atom:(.+)$/.exec(decl.id);
  const familyMatch = /^atom-family:([^:]+):/.exec(decl.id);
  const swrMatch = /^swr:(.+):data$/.exec(decl.id);
  return {
    varId: decl.id,
    component: localMatch?.[1] ?? "Anonymous",
    stateName:
      localMatch?.[2] ??
      familyMatch?.[1] ??
      atomMatch?.[1]?.replace(/@store:.+$/, "") ??
      swrMatch?.[1] ??
      decl.id,
    domain: decl.domain,
    initial: decl.initial,
  };
}

const statePlugins = [useStateSource(), jotaiSource(), swrSource()];

describe("binding consolidation", () => {
  const sourceText = `
    import { useState } from 'react';
    import { atom, useAtom } from 'jotai';
    import useSWR from 'swr';

    const countAtom = atom(0);

    export function App() {
      const [status, setStatus] = useState<'idle' | 'done'>('idle');
      const [count, setCount] = useAtom(countAtom);
      const { data: todos } = useSWR('/api/todos');
      return null;
    }
  `;

  it("produces identical setter bindings via plugin decode dispatch", () => {
    const discovery = runPluginDiscoveryPhase({
      sourceText,
      fileName: "App.tsx",
      route: "/",
      statePlugins,
    });
    const allVars = [
      ...discovery.stateVars,
      ...discovery.templateFragments.flatMap((fragment) => fragment.vars),
    ];
    const varIds = ["local:App.status", "atom:countAtom", "swr:api_todos:data"];
    for (const varId of varIds) {
      const decl = allVars.find((candidate) => candidate.id === varId);
      expect(decl, `missing ${varId}`).toBeDefined();
      expect(decodeSetterBinding(decl!, statePlugins)).toEqual(
        legacySetterBindingFromDecl(decl!),
      );
    }
  });

  it("keeps source plugin var-id shapes disjoint", () => {
    const decls: StateVarDecl[] = [
      { id: "local:App.count", domain: { kind: "int" } },
      { id: "atom:countAtom", domain: { kind: "int" } },
      { id: 'atom-family:item:"a"', domain: { kind: "tokens", count: 1 } },
      { id: "swr:api:data", domain: { kind: "lengthCat" } },
    ];
    for (const decl of decls) {
      const claimants = statePlugins.filter((plugin) =>
        Boolean(plugin.decodeBinding?.(decl)),
      );
      expect(claimants).toHaveLength(1);
    }
  });
});
