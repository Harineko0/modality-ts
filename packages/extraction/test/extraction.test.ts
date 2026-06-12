import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { checkModel } from "../../checker/src/index.js";
import { always, reachable, type Model } from "@modality/kernel";
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
    expect(inferDomainFromTypeNode(typeNode("0 | 1 | 2"))).toEqual({ kind: "boundedInt", min: 0, max: 2 });
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
        return <button data-testid="save-button" onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.saveStatus",
      cls: "user",
      label: { kind: "click", locator: { kind: "testId", value: "save-button" } },
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

  it("falls back to role/name locators for replayable events", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setSaveStatus('posting')}>Save now</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.transitions[0]?.label).toEqual({
      kind: "click",
      locator: { kind: "role", role: "button", name: "Save now" }
    });
  });

  it("resolves simple local handler identifiers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => setSaveStatus('posting');
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.saveStatus",
      effect: { kind: "assign", var: "local:App.saveStatus", expr: { kind: "lit", value: "posting" } },
      confidence: "exact"
    });
  });

  it("extracts simple router navigation handlers", () => {
    const result = extractUseStateSkeleton(
      `
      export function App() {
        return <button onClick={() => router.push('/checkout')}>Checkout</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.navigate._checkout",
      cls: "nav",
      label: { kind: "navigate", mode: "push", to: "/checkout" },
      effect: { kind: "navigate", mode: "push", to: { kind: "lit", value: "/checkout" } },
      reads: ["sys:route", "sys:history"],
      writes: ["sys:route", "sys:history"],
      confidence: "exact"
    });
  });

  it("turns JSX disabled attributes into transition guards", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('posting');
        return <button disabled={saveStatus === 'posting'} onClick={() => setSaveStatus('idle')}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      guard: {
        kind: "not",
        args: [{ kind: "eq", args: [{ kind: "read", var: "local:App.saveStatus" }, { kind: "lit", value: "posting" }] }]
      },
      reads: ["local:App.saveStatus"]
    });

    const model: Model = {
      schemaVersion: 1,
      id: "disabled-guard-skeleton",
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
      always(model, (state) => state["local:App.saveStatus"] !== "idle", { name: "idleNotReachable", reads: ["local:App.saveStatus"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("turns conditional rendering into transition guards", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [canSave, setCanSave] = useState<boolean>(false);
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <>{canSave && <button onClick={() => setSaveStatus('posting')}>Save</button>}</>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      guard: { kind: "read", var: "local:App.canSave" },
      reads: ["local:App.canSave"]
    });

    const model: Model = {
      schemaVersion: 1,
      id: "conditional-render-skeleton",
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
      always(model, (state) => state["local:App.saveStatus"] !== "posting", { name: "postingNotReachable", reads: ["local:App.saveStatus"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("extracts event target value input handlers as exact value-class transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('empty');
        return <input onChange={e => setDraft(e.target.value)} />;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions.map((transition) => [transition.id, transition.label, transition.effect, transition.confidence])).toEqual([
      [
        "App.onChange.draft.empty",
        { kind: "input", valueClass: "empty", locator: { kind: "role", role: "textbox" } },
        { kind: "assign", var: "local:App.draft", expr: { kind: "lit", value: "empty" } },
        "exact"
      ],
      [
        "App.onChange.draft.nonEmpty",
        { kind: "input", valueClass: "nonEmpty", locator: { kind: "role", role: "textbox" } },
        { kind: "assign", var: "local:App.draft", expr: { kind: "lit", value: "nonEmpty" } },
        "exact"
      ]
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "input-extracted-skeleton",
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
      reachable(model, (state) => state["local:App.draft"] === "nonEmpty", { name: "nonEmptyReachable", reads: ["local:App.draft"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts Number(event.target.value) numeric input transforms as exact value-class transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [seats, setSeats] = useState<0 | 1 | 2>(0);
        return <input onChange={e => setSeats(Number(e.target.value))} />;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.vars[0]).toMatchObject({
      id: "local:App.seats",
      domain: { kind: "boundedInt", min: 0, max: 2 },
      initial: 0
    });
    expect(result.transitions.map((transition) => [transition.id, transition.label, transition.effect, transition.confidence])).toEqual([
      ["App.onChange.seats.0", { kind: "input", valueClass: "0", locator: { kind: "role", role: "textbox" } }, { kind: "assign", var: "local:App.seats", expr: { kind: "lit", value: 0 } }, "exact"],
      ["App.onChange.seats.1", { kind: "input", valueClass: "1", locator: { kind: "role", role: "textbox" } }, { kind: "assign", var: "local:App.seats", expr: { kind: "lit", value: 1 } }, "exact"],
      ["App.onChange.seats.2", { kind: "input", valueClass: "2", locator: { kind: "role", role: "textbox" } }, { kind: "assign", var: "local:App.seats", expr: { kind: "lit", value: 2 } }, "exact"]
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "numeric-input-extracted-skeleton",
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
      reachable(model, (state) => state["local:App.seats"] === 2, { name: "twoSeatsReachable", reads: ["local:App.seats"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts simple useEffect setter bodies as internal transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        const [screen, setScreen] = useState<'home' | 'checkout'>('checkout');
        useEffect(() => {
          setScreen('home');
        }, [auth]);
        return <button onClick={() => setAuth('user')}>Login</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions.map((transition) => [transition.id, transition.cls, transition.triggeredBy])).toContainEqual([
      "App.useEffect.screen",
      "internal",
      ["local:App.auth"]
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "effect-extracted-skeleton",
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
      always(model, (state) => state["local:App.screen"] === "home", { name: "effectStabilizesScreen", reads: ["local:App.screen"] })
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("havocs modeled state when a setter escapes to an unanalyzed call", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => callExternal(setSaveStatus)}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.saveStatus.escaped",
      effect: { kind: "havoc", var: "local:App.saveStatus" },
      writes: ["local:App.saveStatus"],
      confidence: "over-approx"
    });
  });

  it("splits simple async handlers into enqueue and resolve transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting' | 'failed'>('idle');
        return <button onClick={async () => {
          setSaveStatus('posting');
          try {
            await api.saveTodo();
            setSaveStatus('idle');
          } catch {
            setSaveStatus('failed');
          }
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.saveTodo"] }
    );
    expect(result.transitions.map((transition) => [transition.id, transition.cls, transition.writes])).toEqual([
      ["App.onClick.api.saveTodo.start", "user", ["local:App.saveStatus", "sys:pending"]],
      ["App.onClick.api.saveTodo.success", "env", ["sys:pending", "local:App.saveStatus"]],
      ["App.onClick.api.saveTodo.error", "env", ["sys:pending", "local:App.saveStatus"]]
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "async-extracted-skeleton",
      bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: { kind: "enum", values: ["/"] }, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: { kind: "enum", values: ["/"] }, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: { kind: "record", fields: { opId: { kind: "enum", values: ["api.saveTodo"] }, continuation: { kind: "enum", values: ["App.onClick.api.saveTodo.cont"] }, args: { kind: "record", fields: {} } } }, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        ...result.vars
      ],
      transitions: result.transitions
    };
    const check = checkModel(model, [
      reachable(model, (state) => state["local:App.saveStatus"] === "posting", { name: "postingReachable", reads: ["local:App.saveStatus"] }),
      reachable(model, (state) => state["local:App.saveStatus"] === "failed", { name: "failedReachable", reads: ["local:App.saveStatus"] })
    ]);
    expect(check.verdicts.map((verdict) => [verdict.property, verdict.status])).toEqual([
      ["postingReachable", "reachable"],
      ["failedReachable", "reachable"]
    ]);
  });

  it("reports unsupported event handlers instead of silently dropping them", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => setSaveStatus(computeStatus());
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" }
    );
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain("Unextractable handler App.onClick");
  });
});
