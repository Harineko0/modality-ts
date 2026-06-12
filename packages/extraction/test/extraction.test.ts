import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkModel } from "../../checker/src/index.js";
import { reachable, type Model } from "@modality/kernel";
import { extractUseStateSkeleton, extractUseStateVars, inferDomainFromTypeNode } from "../src/index.js";

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

  it("extracts exact M0 setter transitions from inline JSX handlers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.saveStatus",
      cls: "user",
      effect: { kind: "assign", var: "local:App.saveStatus", expr: { kind: "lit", value: "posting" } },
      reads: [],
      writes: ["local:App.saveStatus"],
      confidence: "exact"
    });

    const model: Model = {
      schemaVersion: 1,
      id: "extracted-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: { kind: "enum", values: ["/"] }, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: { kind: "enum", values: ["/"] }, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: { kind: "record", fields: { opId: { kind: "enum", values: ["noop"] }, continuation: { kind: "enum", values: ["noop"] }, args: { kind: "record", fields: {} } } }, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        ...result.vars
      ],
      transitions: result.transitions
    };
    const check = checkModel(model, [
      reachable(model, (state) => state["local:App.saveStatus"] === "posting", { name: "postingReachable", reads: ["local:App.saveStatus"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });
});
