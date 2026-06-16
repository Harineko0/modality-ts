import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { inferDomainFromTypeNode } from "modality-ts/extract/engine";
import { useStateSource } from "modality-ts/extract/sources/use-state";
import {
  observe,
  setup,
} from "../../../src/extract/sources/use-state/harness.js";

function typeNode(source: string): ts.TypeNode {
  const file = ts.createSourceFile(
    "fixture.ts",
    `type T = ${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const alias = file.statements[0];
  if (!ts.isTypeAliasDeclaration(alias)) throw new Error("bad fixture");
  return alias.type;
}

describe("useState source plugin", () => {
  it("maps finite TypeScript types to finite abstract domains", () => {
    expect(inferDomainFromTypeNode(typeNode("boolean"))).toEqual({
      kind: "bool",
    });
    expect(
      inferDomainFromTypeNode(typeNode("'idle' | 'posting' | 'failed'")),
    ).toEqual({ kind: "enum", values: ["idle", "posting", "failed"] });
    expect(inferDomainFromTypeNode(typeNode("0 | 1 | 2"))).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 2,
    });
    expect(inferDomainFromTypeNode(typeNode("0 | 2"))).toEqual({
      kind: "intSet",
      values: [0, 2],
    });
    expect(inferDomainFromTypeNode(typeNode("'user' | null"))).toEqual({
      kind: "option",
      inner: { kind: "enum", values: ["user"] },
    });
    expect(inferDomainFromTypeNode(typeNode("string[]"))).toEqual({
      kind: "lengthCat",
    });
    expect(
      inferDomainFromTypeNode(
        typeNode("{ ok: boolean; status: 'idle' | 'done' }"),
      ),
    ).toEqual({
      kind: "record",
      fields: {
        ok: { kind: "bool" },
        status: { kind: "enum", values: ["idle", "done"] },
      },
    });
  });

  it("detects simple discriminated unions", () => {
    expect(
      inferDomainFromTypeNode(
        typeNode("{ kind: 'guest' } | { kind: 'user'; id: string }"),
      ),
    ).toEqual({
      kind: "tagged",
      tag: "kind",
      variants: {
        guest: { kind: "record", fields: {} },
        user: { kind: "record", fields: { id: { kind: "tokens", count: 1 } } },
      },
    });
  });

  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = useStateSource();
    expect(plugin.id).toBe("use-state");
    expect(plugin.packageNames).toEqual(["react"]);
    expect(
      plugin.harness.observe("local:App.state", plugin.harness.setup({})),
    ).toBe("unobservable");
  });

  it("observes useState values through explicit probe projections", () => {
    const handles = setup({ probes: { "local:App.status": () => "posting" } });
    expect(observe("local:App.status", handles)).toEqual({ value: "posting" });
    expect(
      useStateSource().harness.observe("local:App.status", handles),
    ).toEqual({ value: "posting" });
  });

  it("falls back to initial model state for probe-transform-style values", () => {
    expect(
      observe(
        "local:App.status",
        setup({ initialState: { "local:App.status": "idle" } }),
      ),
    ).toEqual({ value: "idle" });
    expect(observe("local:Missing.status", setup({}))).toBe("unobservable");
  });

  it("discovers route-local useState declarations", () => {
    const plugin = useStateSource();
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'posting'>('idle');
        const [auth, setAuth] = useState<{ kind: 'guest' } | { kind: 'user'; id: string }>({ kind: 'guest' });
        return null;
      }
    `;
    expect(
      plugin
        .discover({ sourceText, fileName: "App.tsx", route: "/todos" })
        .map((decl) => ({
          id: decl.id,
          kind: decl.kind,
          var: decl.var,
          metadata: decl.metadata,
        })),
    ).toEqual([
      {
        id: "local:App.status",
        kind: "useState",
        var: {
          id: "local:App.status",
          domain: { kind: "enum", values: ["idle", "posting"] },
          origin: { file: "App.tsx", line: 4, column: 15 },
          scope: { kind: "route-local", route: "/todos" },
          initial: "idle",
        },
        metadata: {
          component: "App",
          stateName: "status",
          setterName: "setStatus",
        },
      },
      {
        id: "local:App.auth",
        kind: "useState",
        var: {
          id: "local:App.auth",
          domain: {
            kind: "tagged",
            tag: "kind",
            variants: {
              guest: { kind: "record", fields: {} },
              user: {
                kind: "record",
                fields: { id: { kind: "tokens", count: 1 } },
              },
            },
          },
          origin: { file: "App.tsx", line: 5, column: 15 },
          scope: { kind: "route-local", route: "/todos" },
          initial: { kind: "guest" },
        },
        metadata: {
          component: "App",
          stateName: "auth",
          setterName: "setAuth",
        },
      },
    ]);
  });

  it("initializes lengthCat from lazy finite Array.from in plugin discovery", () => {
    const plugin = useStateSource();
    const sourceText = `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      export function App() {
        const [items] = useState<Item[]>(() =>
          Array.from({ length: 3 }, makeItem),
        );
        return null;
      }
    `;
    const decl = plugin
      .discover({ sourceText, fileName: "App.tsx", route: "/" })
      .find((entry) => entry.id === "local:App.items");
    expect(decl?.var).toEqual(
      expect.objectContaining({
        domain: { kind: "lengthCat" },
        initial: "many",
      }),
    );
  });

  it("reports setter write channels for discovered useState variables", () => {
    const plugin = useStateSource();
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'posting'>('idle');
        return null;
      }
    `;
    expect(plugin.writeChannels({ sourceText, fileName: "App.tsx" })).toEqual([
      {
        id: "local:App.status.setter",
        varId: "local:App.status",
        symbolName: "setStatus",
        source: { file: "App.tsx", line: 4, column: 15 },
      },
    ]);
  });
});
