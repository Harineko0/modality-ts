import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractUseStateVars, inferDomainFromTypeNode } from "../src/index.js";

function typeNode(source: string): ts.TypeNode {
  const file = ts.createSourceFile("fixture.ts", `type T = ${source};`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const alias = file.statements[0];
  if (!ts.isTypeAliasDeclaration(alias)) throw new Error("bad fixture");
  return alias.type;
}

describe("domain inference", () => {
  it("maps finite TypeScript types to finite abstract domains", () => {
    expect(inferDomainFromTypeNode(typeNode("boolean"))).toEqual({ kind: "bool" });
    expect(inferDomainFromTypeNode(typeNode("'idle' | 'posting' | 'failed'"))).toEqual({ kind: "enum", values: ["idle", "posting", "failed"] });
    expect(inferDomainFromTypeNode(typeNode("'user' | null"))).toEqual({ kind: "option", inner: { kind: "enum", values: ["user"] } });
    expect(inferDomainFromTypeNode(typeNode("string[]"))).toEqual({ kind: "lengthCat" });
    expect(inferDomainFromTypeNode(typeNode("{ ok: boolean; status: 'idle' | 'done' }"))).toEqual({
      kind: "record",
      fields: { ok: { kind: "bool" }, status: { kind: "enum", values: ["idle", "done"] } }
    });
  });

  it("detects simple discriminated unions", () => {
    expect(inferDomainFromTypeNode(typeNode("{ kind: 'guest' } | { kind: 'user'; id: string }"))).toEqual({
      kind: "tagged",
      tag: "kind",
      variants: {
        guest: { kind: "record", fields: {} },
        user: { kind: "record", fields: { id: { kind: "tokens", count: 1 } } }
      }
    });
  });
});

describe("useState inventory", () => {
  it("extracts route-local state declarations with stable ids", () => {
    const result = extractUseStateVars(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('empty');
        const [saveStatus] = useState<'idle' | 'posting' | 'failed'>('idle');
        const [items] = useState<string[]>([]);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.vars.map((decl) => [decl.id, decl.domain, decl.initial, decl.scope])).toEqual([
      ["local:App.draft", { kind: "enum", values: ["empty", "nonEmpty"] }, "empty", { kind: "route-local", route: "/" }],
      ["local:App.saveStatus", { kind: "enum", values: ["idle", "posting", "failed"] }, "idle", { kind: "route-local", route: "/" }],
      ["local:App.items", { kind: "lengthCat" }, "0", { kind: "route-local", route: "/" }]
    ]);
  });
});
