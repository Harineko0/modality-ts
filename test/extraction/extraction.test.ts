import { checkModel } from "modality-ts/check";
import { routeMountScope } from "../../src/extract/engine/ts/routes.js";
import { always, reachable } from "../helpers/property-builders.js";
import {
  and,
  eq,
  lit,
  type EffectIR,
  type Model,
  neq,
  readVar,
} from "modality-ts/core";
import type {
  NavigationAdapter,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { describe, expect, it } from "vitest";
import { reactRouterAdapter } from "../../src/extract/sources/router/index.js";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";
import {
  extractUseStateSkeleton,
  extractUseStateVars,
} from "../../src/extract/sources/use-state/transitions.js";

const routerExtraction = { routerPlugin: reactRouterAdapter() };

function collectReadOpArgKeys(effect: EffectIR): string[] {
  const keys: string[] = [];
  const visitExpr = (expr: import("modality-ts/core").ExprIR): void => {
    if (expr.kind === "readOpArg") keys.push(expr.key);
    if ("args" in expr && Array.isArray(expr.args))
      expr.args.forEach(visitExpr);
    if ("left" in expr) visitExpr(expr.left);
    if ("right" in expr) visitExpr(expr.right);
  };
  const visit = (candidate: EffectIR): void => {
    if (candidate.kind === "assign") visitExpr(candidate.expr);
    if (candidate.kind === "seq") candidate.effects.forEach(visit);
    if (candidate.kind === "if") {
      visit(candidate.then);
      visit(candidate.else);
    }
    if (candidate.kind === "enqueue") {
      for (const expr of Object.values(candidate.args)) visitExpr(expr);
    }
  };
  visit(effect);
  return keys;
}

function enqueueArgKeysForOp(
  transitions: readonly Model["transitions"][number][],
  op: string,
): Set<string> {
  const keys = new Set<string>();
  const start = transitions.find(
    (transition) => transition.id === `App.onClick.${op}.start`,
  );
  if (!start || start.effect.kind !== "seq") return keys;
  for (const effect of start.effect.effects) {
    if (effect.kind === "enqueue" && effect.op === op) {
      for (const key of Object.keys(effect.args)) keys.add(key);
    }
  }
  return keys;
}
const analyticsInventory = {
  routes: [
    { pattern: "/", kind: "index" as const, file: "home.tsx" },
    { pattern: "/analytics", kind: "page" as const, file: "Analytics.tsx" },
  ],
};

describe("useState inventory", () => {
  it("extracts mount-local state declarations with stable ids", () => {
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.vars.map((decl) => [
        decl.id,
        decl.domain,
        decl.initial,
        decl.scope,
      ]),
    ).toEqual([
      [
        "local:App.draft",
        { kind: "enum", values: ["empty", "nonEmpty"] },
        "empty",
        routeMountScope("/"),
      ],
      [
        "local:App.saveStatus",
        { kind: "enum", values: ["idle", "posting", "failed"] },
        "idle",
        routeMountScope("/"),
      ],
      ["local:App.items", { kind: "lengthCat" }, "0", routeMountScope("/")],
    ]);
  });

  it("infers option domains for nullable multi-literal unions", () => {
    const result = extractUseStateVars(
      `
      import { useState } from 'react';
      export function App() {
        const [role, setRole] = useState<'guest' | 'admin' | null>(null);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.vars.find((decl) => decl.id === "local:App.role")?.domain,
    ).toEqual({
      kind: "option",
      inner: { kind: "enum", values: ["guest", "admin"] },
    });
  });

  it("initializes lengthCat from lazy finite Array.from initializers", () => {
    const manyResult = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      export function App() {
        const [items] = useState<Item[]>(() =>
          Array.from({ length: 3 }, makeItem),
        );
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(manyResult.warnings).toEqual([]);
    expect(
      manyResult.vars.find((decl) => decl.id === "local:App.items"),
    ).toEqual(
      expect.objectContaining({
        domain: { kind: "lengthCat" },
        initial: "many",
      }),
    );

    const constResult = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const LANE_COUNT = 3;
      const makeItem = () => ({ id: 'x' });
      export function App() {
        const [items] = useState<Item[]>(() =>
          Array.from({ length: LANE_COUNT }, makeItem),
        );
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(constResult.warnings).toEqual([]);
    expect(
      constResult.vars.find((decl) => decl.id === "local:App.items")?.initial,
    ).toBe("many");

    const oneResult = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      export function App() {
        const [items] = useState<Item[]>(() =>
          Array.from({ length: 1 }, makeItem),
        );
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      oneResult.vars.find((decl) => decl.id === "local:App.items")?.initial,
    ).toBe("1");

    const zeroResult = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      export function App() {
        const [items] = useState<Item[]>(
          Array.from({ length: 0 }, makeItem),
        );
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      zeroResult.vars.find((decl) => decl.id === "local:App.items")?.initial,
    ).toBe("0");
  });

  it("emits model-slack for unprovable lazy array initializer lengths", () => {
    const result = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      export function App({ count }: { count: number }) {
        const [items] = useState<Item[]>(() =>
          Array.from({ length: count }, makeItem),
        );
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.vars.find((decl) => decl.id === "local:App.items")?.initial,
    ).toBe("0");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caveat: expect.objectContaining({
            kind: "model-slack",
            reason: expect.stringContaining("array initializer length"),
          }),
        }),
      ]),
    );

    const propsResult = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      export function App(props: { count: number }) {
        const [items] = useState<Item[]>(() =>
          Array.from({ length: props.count }, makeItem),
        );
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      propsResult.vars.find((decl) => decl.id === "local:App.items")?.initial,
    ).toBe("0");
    expect(propsResult.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caveat: expect.objectContaining({
            kind: "model-slack",
            reason: expect.stringContaining("array initializer length"),
          }),
        }),
      ]),
    );
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      cls: "user",
      label: {
        kind: "click",
        locator: { kind: "testId", value: "save-button" },
      },
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      reads: [],
      writes: ["local:App.saveStatus"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "extracted-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.saveStatus"), lit("posting")), {
        name: "postingReachable",
        reads: ["local:App.saveStatus"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts optional-chain nullish reads in M0 setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [user, setUser] = useState<{ role: 'guest' | 'admin' } | null>({ role: 'guest' });
        const [role, setRole] = useState<'guest' | 'admin' | null>(null);
        return <button onClick={() => setRole(user?.role ?? null)}>Copy</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.Copy",
      ),
    ).toMatchObject({
      effect: {
        kind: "assign",
        var: "local:App.role",
        expr: {
          kind: "cond",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "read", var: "local:App.user" },
                { kind: "lit", value: null },
              ],
            },
            { kind: "lit", value: null },
            { kind: "read", var: "local:App.user", path: ["role"] },
          ],
        },
      },
      reads: ["local:App.user"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "optional-chain-extracted-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.role"), lit("guest")), {
        name: "roleCopied",
        reads: ["local:App.role"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("expands static JSX maps and inlines props for Link navigation", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      import { BarChart3, LinkIcon, TagIcon } from 'icons';
      const NAV_GROUPS = [
        { items: [{ to: "/links", label: "Links", icon: LinkIcon }] },
        { items: [{ to: "/analytics", label: "Analytics", icon: BarChart3 }] },
        { items: [{ to: "/tags", label: "Tags", icon: TagIcon }] }
      ] as const;
      function SidebarLink({ item }: { item: { to: string; label: string; icon: unknown } }) {
        return <Link to={item.to}>{item.label}</Link>;
      }
      export function App() {
        return <nav>{NAV_GROUPS.map((group) => group.items.map((item) => <SidebarLink key={item.to} item={item} />))}</nav>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/links", "/analytics", "/tags"],
        ...routerExtraction,
      },
    );
    expect(
      result.transitions
        .filter((transition) => transition.cls === "nav")
        .map((transition) => transition.effect.kind),
    ).toEqual(expect.arrayContaining(["if", "if", "if"]));
  });

  it("normalizes query-string Link targets to route patterns", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      export function App({ id }: { id: string }) {
        return <Link to={\`/analytics?linkId=\${id}\`}>Analytics</Link>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/analytics"],
        ...routerExtraction,
      },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.Link.navigate._analytics",
      ),
    ).toMatchObject({
      cls: "nav",
      effect: expect.objectContaining({ kind: "if" }),
    });
  });

  it("guards page-component Link navigation by the mounted route", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      export function Analytics() {
        return <Link to="/analytics">Clear</Link>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/analytics"],
        ...routerExtraction,
        inventory: analyticsInventory,
      },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "Analytics.Link.navigate._analytics",
      ),
    ).toMatchObject({
      cls: "nav",
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:route" },
          { kind: "lit", value: "/analytics" },
        ],
      },
      reads: ["sys:route", "sys:history"],
    });
  });

  it("models conditional Link targets as nondeterministic branch transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      export function App({ admin }: { admin: boolean }) {
        return <Link to={admin ? "/admin" : "/links"}>Go</Link>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/admin", "/links"],
        ...routerExtraction,
      },
    );
    const nav = result.transitions.filter(
      (transition) => transition.cls === "nav",
    );
    expect(nav.map((transition) => transition.effect.kind)).toEqual(
      expect.arrayContaining(["if", "if"]),
    );
    expect(
      nav.every((transition) => transition.confidence === "over-approx"),
    ).toBe(true);
  });

  it("normalizes template Link targets to matching dynamic routes", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      export function PageEditor({ page }: { page: { slug: string } }) {
        return <Link to={\`/wiki/\${page.slug}\`}>Back</Link>;
      }
      `,
      {
        route: "/wiki/:slug/edit",
        fileName: "PageEditor.tsx",
        routePatterns: ["/", "/wiki/new", "/wiki/:slug", "/wiki/:slug/edit"],
        ...routerExtraction,
      },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "PageEditor.Link.navigate._wiki_slug",
      ),
    ).toMatchObject({
      cls: "nav",
      effect: expect.objectContaining({ kind: "if" }),
    });
    expect(
      result.transitions.some(
        (transition) => transition.id === "PageEditor.Link.navigate._wiki_new",
      ),
    ).toBe(false);
  });

  it("extracts literal-list handlers that call parameterized helper callbacks", () => {
    const result = extractUseStateSkeleton(
      `
      import { useCallback, useState } from 'react';
      export function PageEditor() {
        const [activeLang, setActiveLangLocal] = useState<"ja" | "en">("ja");
        const setActiveLang = useCallback((lang: "ja" | "en") => {
          setActiveLangLocal(lang);
          console.log(lang);
        }, []);
        return (
          <div>
            {(["ja", "en"] as const).map((lang) => (
              <button key={lang} type="button" onClick={() => setActiveLang(lang)}>
                {lang}
              </button>
            ))}
          </div>
        );
      }
      `,
      {
        route: "/wiki/:slug/edit",
        fileName: "PageEditor.tsx",
      },
    );
    const transitions = result.transitions.filter((transition) =>
      transition.id.startsWith("PageEditor.onClick.activeLang.seq."),
    );
    expect(transitions.map((transition) => transition.effect)).toEqual(
      expect.arrayContaining([
        {
          kind: "assign",
          var: "local:PageEditor.activeLang",
          expr: { kind: "lit", value: "ja" },
        },
        {
          kind: "assign",
          var: "local:PageEditor.activeLang",
          expr: { kind: "lit", value: "en" },
        },
      ]),
    );
  });

  it("over-approximates unmodeled Link targets across known route patterns", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      export function App({ target }: { target: string }) {
        return <Link to={target}>Go</Link>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/analytics", "/tags"],
        ...routerExtraction,
      },
    );
    const nav = result.transitions.filter(
      (transition) => transition.cls === "nav",
    );
    expect(nav.map((transition) => transition.effect.kind)).toEqual(
      expect.arrayContaining(["if", "if", "if"]),
    );
    expect(
      nav.every((transition) => transition.confidence === "over-approx"),
    ).toBe(true);
  });

  it("summarizes handlers from externally supplied state vars and write channels", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        stateVars: [
          {
            id: "local:App.saveStatus",
            domain: { kind: "enum", values: ["idle", "posting"] },
            origin: { file: "App.tsx", line: 4, column: 15 },
            scope: routeMountScope("/"),
            initial: "idle",
          },
        ],
        writeChannels: [
          {
            id: "local:App.saveStatus.setter",
            varId: "local:App.saveStatus",
            symbolName: "setSaveStatus",
            source: { file: "App.tsx", line: 4, column: 15 },
          },
        ],
      },
    );
    expect(result.vars).toHaveLength(1);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      writes: ["local:App.saveStatus"],
      confidence: "exact",
    });
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions[0]?.label).toEqual({
      kind: "click",
      locator: { kind: "role", role: "button", name: "Save now" },
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save",
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
  });

  it("inlines one-level local helper calls inside JSX handlers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => setSaveStatus('posting');
        return <button onClick={() => save()}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
  });

  it("follows one component boundary from custom event props to intrinsic events", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Button(props: { onPress: () => void }) {
        return <button data-testid="save-button" onClick={() => props.onPress()}>Save</button>;
      }
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <Button onPress={() => setSaveStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save-button",
      label: {
        kind: "click",
        locator: { kind: "testId", value: "save-button" },
      },
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
  });

  it("resolves props.onX references used directly as intrinsic handlers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Button(props: { onPress: () => void }) {
        return <button data-testid="save-button" onClick={props.onPress}>Save</button>;
      }
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <Button onPress={() => setSaveStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save-button",
      label: {
        kind: "click",
        locator: { kind: "testId", value: "save-button" },
      },
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
  });

  it("applies disabled guards from custom component call sites", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Button(props: { onPress: () => void; disabled?: boolean }) {
        return <button onClick={props.onPress}>Save</button>;
      }
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('posting');
        return <Button disabled={saveStatus === 'posting'} onPress={() => setSaveStatus('idle')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      guard: {
        kind: "not",
        args: [
          {
            kind: "eq",
            args: [
              { kind: "read", var: "local:App.saveStatus" },
              { kind: "lit", value: "posting" },
            ],
          },
        ],
      },
      reads: ["local:App.saveStatus"],
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "idle" },
      },
    });
  });

  it("extracts exact onOpenChange transitions for named boolean handlers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Popover(props: { open: boolean; onOpenChange: (next: boolean) => void; children?: React.ReactNode }) {
        return <button type="button" {...props} />;
      }
      export function App() {
        const [open, setOpen] = useState(false);
        const [pickedDim, setPickedDim] = useState<'browser' | null>(null);
        const [query, setQuery] = useState('');
        function handleOpenChange(next: boolean) {
          setOpen(next);
          if (!next) {
            setPickedDim(null);
            setQuery('');
          }
        }
        return <Popover open={open} onOpenChange={handleOpenChange} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    const openChange = result.transitions.filter((transition) =>
      transition.id.includes(".onOpenChange."),
    );
    expect(openChange).toHaveLength(2);
    expect(
      openChange.every((transition) => transition.confidence === "exact"),
    ).toBe(true);
    expect(openChange.map((transition) => transition.id).sort()).toEqual([
      "App.onOpenChange.handleOpenChange.false",
      "App.onOpenChange.handleOpenChange.true",
    ]);
    const falseTransition = openChange.find((transition) =>
      transition.id.endsWith(".false"),
    );
    expect(falseTransition?.writes.sort()).toEqual([
      "local:App.open",
      "local:App.pickedDim",
      "local:App.query",
    ]);
    expect(falseTransition?.effect).toMatchObject({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: "local:App.open",
          expr: { kind: "lit", value: false },
        },
        {
          kind: "if",
          // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
          then: {
            kind: "seq",
            effects: [
              {
                kind: "assign",
                var: "local:App.pickedDim",
                expr: { kind: "lit", value: null },
              },
              {
                kind: "assign",
                var: "local:App.query",
                expr: { kind: "lit", value: "" },
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(falseTransition?.effect)).not.toContain("havoc");
  });

  it("extracts exact onOpenChange true/false transitions for direct boolean setters", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Dialog(props: { open: boolean; onOpenChange: (next: boolean) => void; children?: React.ReactNode }) {
        return <button type="button" {...props} />;
      }
      export function App() {
        const [createOpen, setCreateOpen] = useState(false);
        return <Dialog open={createOpen} onOpenChange={setCreateOpen} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.map((transition) => transition.id).sort(),
    ).toEqual([
      "App.onOpenChange.createOpen.false",
      "App.onOpenChange.createOpen.true",
    ]);
    expect(
      result.transitions.every(
        (transition) => transition.confidence === "exact",
      ),
    ).toBe(true);
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onOpenChange.createOpen.true",
      ),
    ).toMatchObject({
      effect: {
        kind: "assign",
        var: "local:App.createOpen",
        expr: { kind: "lit", value: true },
      },
      writes: ["local:App.createOpen"],
    });
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onOpenChange.createOpen.false",
      ),
    ).toMatchObject({
      effect: {
        kind: "assign",
        var: "local:App.createOpen",
        expr: { kind: "lit", value: false },
      },
      writes: ["local:App.createOpen"],
    });

    const model: Model = {
      schemaVersion: 1,
      id: "direct-setter-open-change",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.createOpen"), lit(true)), {
        name: "createOpenReachable",
        reads: ["local:App.createOpen"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("models resolvable multi-hop component callback paths", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Inner(props: { onActivate: () => void }) {
        return <button onClick={() => props.onActivate()}>Save</button>;
      }
      function Button(props: { onPress: () => void }) {
        return <Inner onActivate={props.onPress} />;
      }
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <Button onPress={() => setSaveStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      cls: "user",
      label: { kind: "click" },
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
  });

  it("reports unresolved deeper component prop paths as unextractable", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function UnknownWidget(_props: { onPress: () => void }) {
        return <div />;
      }
      function Button(props: { onPress: () => void }) {
        return <UnknownWidget onPress={props.onPress} />;
      }
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <Button onPress={() => setSaveStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toEqual([]);
    expect(
      result.warnings.some((warning) =>
        warning.message.includes("Unextractable handler App.onPress"),
      ),
    ).toBe(true);
  });

  it("models transparent wrapper components with static host branches", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      const Slot = { Root: 'span' };
      function Button({ asChild = false, ...props }: { asChild?: boolean; onClick?: () => void }) {
        const Comp = asChild ? Slot.Root : 'button';
        return <Comp {...props} />;
      }
      function Card(props: { onAdd: () => void }) {
        return <Button onClick={props.onAdd} />;
      }
      export function App() {
        const [status, setStatus] = useState<'idle' | 'posting'>('idle');
        return <Card onAdd={() => setStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      cls: "user",
      label: { kind: "click" },
      effect: {
        kind: "assign",
        var: "local:App.status",
        expr: { kind: "lit", value: "posting" },
      },
    });
  });

  it("binds list item locals for component prop handlers in map callbacks", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Row(props: { onPick: () => void }) {
        return <button onClick={props.onPick}>Pick</button>;
      }
      export function App() {
        const [selected, setSelected] = useState<string | null>(null);
        return (
          <>
            {['alpha', 'beta'].map((item) => (
              <Row key={item} onPick={() => setSelected(item)} />
            ))}
          </>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions.length).toBeGreaterThanOrEqual(2);
    expect(
      result.transitions.some(
        (transition) =>
          transition.writes.includes("local:App.selected") &&
          transition.effect.kind === "assign" &&
          transition.effect.expr.kind === "lit" &&
          transition.effect.expr.value === "alpha",
      ),
    ).toBe(true);
    expect(
      result.transitions.some(
        (transition) =>
          transition.writes.includes("local:App.selected") &&
          transition.effect.kind === "assign" &&
          transition.effect.expr.kind === "lit" &&
          transition.effect.expr.value === "beta",
      ),
    ).toBe(true);
  });

  it("registers timer vars and emits timer fire for component-prop timer handlers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Button(props: { onClick: () => void }) {
        return <button onClick={props.onClick}>Run</button>;
      }
      export function App() {
        const [status, setStatus] = useState('idle');
        return <Button onClick={() => setTimeout(() => setStatus('done'), 10)} />;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["setTimeout"] },
    );
    expect(result.warnings).toEqual([]);
    expect(result.vars.some((decl) => decl.id.startsWith("sys:timer:"))).toBe(
      true,
    );
    const userTransition = result.transitions.find((t) => t.cls === "user");
    expect(userTransition?.writes.some((w) => w.startsWith("sys:timer:"))).toBe(
      true,
    );
    const fire = result.transitions.find((t) => t.cls === "env");
    expect(fire?.writes).toContain("local:App.status");
    const declaredVarIds = new Set(result.vars.map((decl) => decl.id));
    for (const transition of result.transitions) {
      for (const write of transition.writes) {
        expect(declaredVarIds.has(write)).toBe(true);
      }
    }
  });

  it("keeps unknown spread wrappers unextractable", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      const Slot = { Root: (_props: any) => null };
      function Button(props: { onClick?: () => void }) {
        return <Slot.Root {...props} />;
      }
      export function App() {
        const [status, setStatus] = useState('idle');
        return <Button onClick={() => setStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.transitions.some((transition) =>
        transition.writes.includes("local:App.status"),
      ),
    ).toBe(false);
    expect(
      result.warnings.some((warning) =>
        warning.message.includes("Unextractable handler App.onClick"),
      ),
    ).toBe(true);
  });

  it("emits distinct transitions for repeated sibling child trigger paths", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Inner(props: { onPress?: () => void; testId: "a" | "b" }) {
        return <button data-testid={props.testId} onClick={props.onPress} />;
      }
      function Card(props: { onSave: () => void }) {
        return (
          <>
            <Inner testId="a" onPress={props.onSave} />
            <Inner testId="b" onPress={props.onSave} />
          </>
        );
      }
      export function App() {
        const [status, setStatus] = useState('idle');
        return <Card onSave={() => setStatus('posting')} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    const statusTransitions = result.transitions.filter(
      (transition) =>
        transition.cls === "user" &&
        transition.writes.includes("local:App.status"),
    );
    expect(statusTransitions.length).toBeGreaterThanOrEqual(2);
    const transitionIds = new Set(statusTransitions.map((t) => t.id));
    expect(transitionIds.size).toBe(statusTransitions.length);
  });

  it("reports stateful components rendered from list maps as unextractable", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function Row({ item }: { item: string }) {
        const [open, setOpen] = useState(false);
        return <button onClick={() => setOpen(true)}>{item}</button>;
      }
      export function App() {
        const items = ['a', 'b'];
        return <>{items.map(item => <Row key={item} item={item} />)}</>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.vars.map((decl) => decl.id)).not.toContain("local:Row.open");
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        "Unextractable stateful list item Row",
        expect.stringMatching(/^Unextractable handler Row\.onClick/),
      ]),
    );
  });

  it("reports handlers rendered from lengthCat list maps as unextractable", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [items] = useState<string[]>([]);
        const [selected, setSelected] = useState<'none' | 'picked'>('none');
        return <>{items.map(item => <button onClick={() => setSelected('picked')}>{item}</button>)}</>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unextractable list-rendered handler App.onClick over lengthCat local:App.items",
    );
  });

  it("extracts boundedList item handlers as indexed transition families", () => {
    const result = extractUseStateSkeleton(
      `
      export function App() {
        const items = [];
        const setSelected = (_value: 'none' | 'a' | 'b') => {};
        return <>{items.map(item => <button onClick={() => setSelected(item.id)}>{item.id}</button>)}</>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        stateVars: [
          {
            id: "local:App.items",
            domain: {
              kind: "boundedList",
              inner: {
                kind: "record",
                fields: { id: { kind: "enum", values: ["a", "b"] } },
              },
              maxLen: 2,
            },
            origin: { file: "App.tsx", line: 3, column: 15 },
            scope: routeMountScope("/"),
            initial: [],
          },
          {
            id: "local:App.selected",
            domain: { kind: "enum", values: ["none", "a", "b"] },
            origin: { file: "App.tsx", line: 4, column: 15 },
            scope: routeMountScope("/"),
            initial: "none",
          },
        ],
        writeChannels: [
          {
            id: "local:App.selected.setter",
            varId: "local:App.selected",
            symbolName: "setSelected",
            source: { file: "App.tsx", line: 4, column: 15 },
          },
        ],
      },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.label,
        transition.guard,
        transition.effect,
        transition.reads,
      ]),
    ).toEqual([
      [
        "App.onClick.selected.0",
        {
          kind: "click",
          locator: {
            kind: "positional",
            base: { kind: "role", role: "button" },
            index: 0,
          },
        },
        {
          kind: "neq",
          args: [
            { kind: "lenCat", arg: { kind: "read", var: "local:App.items" } },
            { kind: "lit", value: "0" },
          ],
        },
        {
          kind: "assign",
          var: "local:App.selected",
          expr: { kind: "read", var: "local:App.items", path: ["0", "id"] },
        },
        ["local:App.items"],
      ],
      [
        "App.onClick.selected.1",
        {
          kind: "click",
          locator: {
            kind: "positional",
            base: { kind: "role", role: "button" },
            index: 1,
          },
        },
        {
          kind: "eq",
          args: [
            { kind: "lenCat", arg: { kind: "read", var: "local:App.items" } },
            { kind: "lit", value: "many" },
          ],
        },
        {
          kind: "assign",
          var: "local:App.selected",
          expr: { kind: "read", var: "local:App.items", path: ["1", "id"] },
        },
        ["local:App.items"],
      ],
    ]);
  });

  it("inlines simple custom hooks at the component call site", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      function useCounter() {
        const [count, setCount] = useState<0 | 1>(0);
        return [count, setCount] as const;
      }
      export function App() {
        const [count, setCount] = useCounter();
        return <button onClick={() => setCount(1)}>{count}</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.vars.map((decl) => decl.id)).not.toContain(
      "local:Anonymous.count",
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.vars.find((decl) => decl.id === "local:App.count"),
    ).toMatchObject({
      domain: { kind: "boundedInt", min: 0, max: 1 },
      initial: 0,
    });
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.count",
      effect: {
        kind: "assign",
        var: "local:App.count",
        expr: { kind: "lit", value: 1 },
      },
      writes: ["local:App.count"],
      confidence: "exact",
    });
  });

  it("inlines custom hook lazy array initializer with static const length", () => {
    const result = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      const LANE_COUNT = 3;
      function useItems() {
        const [items, setItems] = useState<Item[]>(() =>
          Array.from({ length: LANE_COUNT }, makeItem),
        );
        return [items, setItems] as const;
      }
      export function App() {
        const [items, setItems] = useItems();
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.vars.find((decl) => decl.id === "local:App.items")).toEqual(
      expect.objectContaining({
        domain: { kind: "lengthCat" },
        initial: "many",
      }),
    );
  });

  it("emits model-slack when inlining custom hook with unprovable array length", () => {
    const result = extractUseStateVars(
      `
      import { useState } from 'react';
      type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      function useItems(count: number) {
        const [items, setItems] = useState<Item[]>(() =>
          Array.from({ length: count }, makeItem),
        );
        return [items, setItems] as const;
      }
      export function App({ count }: { count: number }) {
        const [items, setItems] = useItems(count);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.vars.find((decl) => decl.id === "local:App.items")?.initial,
    ).toBe("0");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caveat: expect.objectContaining({
            kind: "model-slack",
            reason: expect.stringContaining("array initializer length"),
          }),
        }),
      ]),
    );
  });

  it("extracts functional updater setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [open, setOpen] = useState<boolean>(false);
        return <button onClick={() => setOpen(prev => !prev)}>Toggle</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Toggle",
      effect: {
        kind: "assign",
        var: "local:App.open",
        expr: { kind: "not", args: [{ kind: "read", var: "local:App.open" }] },
      },
      reads: ["local:App.open"],
      writes: ["local:App.open"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "functional-updater-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.open"), lit(true)), {
        name: "openReachable",
        reads: ["local:App.open"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts modeled-state copies in setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('nonEmpty');
        const [saved, setSaved] = useState<'empty' | 'nonEmpty'>('empty');
        return <button onClick={() => setSaved(draft)}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      effect: {
        kind: "assign",
        var: "local:App.saved",
        expr: { kind: "readPre", var: "local:App.draft" },
      },
      reads: ["local:App.draft"],
      writes: ["local:App.saved"],
      confidence: "exact",
    });
  });

  it("substitutes local const bindings before setter calls", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('nonEmpty');
        const [saved, setSaved] = useState<'empty' | 'nonEmpty'>('empty');
        return <button onClick={() => {
          const next = draft;
          setSaved(next);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      effect: {
        kind: "assign",
        var: "local:App.saved",
        expr: { kind: "readPre", var: "local:App.draft" },
      },
      reads: ["local:App.draft"],
      writes: ["local:App.saved"],
      confidence: "exact",
    });
  });

  it("extracts straight-line sequential setter blocks", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('nonEmpty');
        const [saved, setSaved] = useState<'empty' | 'nonEmpty'>('empty');
        return <button onClick={() => {
          const next = draft;
          setSaved(next);
          setDraft('empty');
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save",
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: "local:App.saved",
            expr: { kind: "readPre", var: "local:App.draft" },
          },
          {
            kind: "assign",
            var: "local:App.draft",
            expr: { kind: "lit", value: "empty" },
          },
        ],
      },
      reads: ["local:App.draft"],
      writes: ["local:App.draft", "local:App.saved"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "sequential-setter-skeleton",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(
        model,
        and(
          eq(readVar("local:App.saved"), lit("nonEmpty")),
          eq(readVar("local:App.draft"), lit("empty")),
        ),
        {
          name: "savedThenDraftCleared",
          reads: ["local:App.saved", "local:App.draft"],
        },
      ),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts modeled-state property reads in setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<{ kind: 'guest' | 'user' }>({ kind: 'guest' });
        const [mode, setMode] = useState<'guest' | 'user'>('guest');
        return <button onClick={() => setMode(auth.kind)}>Copy</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Copy",
      effect: {
        kind: "assign",
        var: "local:App.mode",
        expr: { kind: "readPre", var: "local:App.auth", path: ["kind"] },
      },
      reads: ["local:App.auth"],
      writes: ["local:App.mode"],
      confidence: "exact",
    });
  });

  it("extracts object spread field updates in setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<{ kind: 'guest' | 'user'; stale: boolean }>({ kind: 'guest', stale: true });
        return <button onClick={() => setAuth({ ...auth, kind: 'user', stale: false })}>Login</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Login",
      effect: {
        kind: "assign",
        var: "local:App.auth",
        expr: {
          kind: "updateField",
          path: ["stale"],
          value: { kind: "lit", value: false },
          target: {
            kind: "updateField",
            target: { kind: "readPre", var: "local:App.auth" },
            path: ["kind"],
            value: { kind: "lit", value: "user" },
          },
        },
      },
      reads: ["local:App.auth"],
      writes: ["local:App.auth"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "object-spread-update-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(
        model,
        and(
          eq(readVar("local:App.auth", ["kind"]), lit("user")),
          eq(readVar("local:App.auth", ["stale"]), lit(false)),
        ),
        { name: "updatedAuthReachable", reads: ["local:App.auth"] },
      ),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts ternary setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        const [screen, setScreen] = useState<'home' | 'checkout'>('home');
        return <button onClick={() => setScreen(auth === 'user' ? 'checkout' : 'home')}>Checkout</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Checkout",
      effect: {
        kind: "assign",
        var: "local:App.screen",
        expr: {
          kind: "cond",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "readPre", var: "local:App.auth" },
                { kind: "lit", value: "user" },
              ],
            },
            { kind: "lit", value: "checkout" },
            { kind: "lit", value: "home" },
          ],
        },
      },
      reads: ["local:App.auth"],
      writes: ["local:App.screen"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "ternary-setter-skeleton",
      bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: [
        {
          id: "login",
          cls: "user",
          label: { kind: "click", text: "Login" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "local:App.auth",
            expr: { kind: "lit", value: "user" },
          },
          reads: [],
          writes: ["local:App.auth"],
          confidence: "exact",
        },
        ...result.transitions,
      ],
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.screen"), lit("checkout")), {
        name: "checkoutReachable",
        reads: ["local:App.screen"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts boolean connective setter expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [hasDraft, setHasDraft] = useState<boolean>(false);
        const [saving, setSaving] = useState<boolean>(false);
        const [canSubmit, setCanSubmit] = useState<boolean>(false);
        return <button onClick={() => setCanSubmit(hasDraft && !saving)}>Check</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Check",
      effect: {
        kind: "assign",
        var: "local:App.canSubmit",
        expr: {
          kind: "and",
          args: [
            { kind: "readPre", var: "local:App.hasDraft" },
            {
              kind: "not",
              args: [{ kind: "readPre", var: "local:App.saving" }],
            },
          ],
        },
      },
      reads: ["local:App.hasDraft", "local:App.saving"],
      writes: ["local:App.canSubmit"],
      confidence: "exact",
    });
  });

  it("extracts modeled-state property reads in if conditions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<{ kind: 'guest' | 'user' }>({ kind: 'guest' });
        const [screen, setScreen] = useState<'home' | 'checkout'>('home');
        return <button onClick={() => {
          if (auth.kind === 'user') {
            setScreen('checkout');
          }
        }}>Checkout</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Checkout",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "readPre", var: "local:App.auth", path: ["kind"] },
            { kind: "lit", value: "user" },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
        then: {
          kind: "assign",
          var: "local:App.screen",
          expr: { kind: "lit", value: "checkout" },
        },
        else: { kind: "seq", effects: [] },
      },
      reads: ["local:App.auth"],
      writes: ["local:App.screen"],
      confidence: "exact",
    });
  });

  it("extracts simple router navigation handlers", () => {
    const result = extractUseStateSkeleton(
      `
      export function App() {
        return <button onClick={() => router.push('/checkout')}>Checkout</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", ...routerExtraction },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.navigate._checkout",
      cls: "nav",
      label: { kind: "navigate", mode: "push", to: "/checkout" },
      effect: expect.objectContaining({ kind: "if" }),
      reads: ["sys:route", "sys:history"],
      writes: ["sys:route", "sys:history"],
      confidence: "exact",
    });
  });

  it("summarizes M0 if/else handler branches", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        const [screen, setScreen] = useState<'home' | 'checkout'>('home');
        return <button onClick={() => {
          if (auth === 'user') {
            setScreen('checkout');
          } else {
            setScreen('home');
          }
        }}>Checkout</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Checkout",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "readPre", var: "local:App.auth" },
            { kind: "lit", value: "user" },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
        then: {
          kind: "assign",
          var: "local:App.screen",
          expr: { kind: "lit", value: "checkout" },
        },
        else: {
          kind: "assign",
          var: "local:App.screen",
          expr: { kind: "lit", value: "home" },
        },
      },
      reads: ["local:App.auth"],
      writes: ["local:App.screen"],
      confidence: "exact",
    });

    const model: Model = {
      schemaVersion: 1,
      id: "if-handler-extracted-skeleton",
      bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: [
        {
          id: "login",
          cls: "user",
          label: { kind: "click", text: "Login" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "local:App.auth",
            expr: { kind: "lit", value: "user" },
          },
          reads: [],
          writes: ["local:App.auth"],
          confidence: "exact",
        },
        ...result.transitions,
      ],
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.screen"), lit("checkout")), {
        name: "checkoutReachable",
        reads: ["local:App.screen"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      guard: {
        kind: "not",
        args: [
          {
            kind: "eq",
            args: [
              { kind: "read", var: "local:App.saveStatus" },
              { kind: "lit", value: "posting" },
            ],
          },
        ],
      },
      reads: ["local:App.saveStatus"],
    });

    const model: Model = {
      schemaVersion: 1,
      id: "disabled-guard-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      always(model, neq(readVar("local:App.saveStatus"), lit("idle")), {
        name: "idleNotReachable",
        reads: ["local:App.saveStatus"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("applies disabled guards to async user starts but not env continuations", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
        return <button disabled={auth !== 'user'} onClick={async () => {
          setStatus('submitting');
          await api.submitOrder();
          setStatus('done');
        }}>Submit</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.submitOrder"] },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.submitOrder.start",
      ),
    ).toMatchObject({
      cls: "user",
      guard: {
        kind: "not",
        args: [
          {
            kind: "neq",
            args: [
              { kind: "read", var: "local:App.auth" },
              { kind: "lit", value: "user" },
            ],
          },
        ],
      },
      reads: ["local:App.auth"],
    });
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.submitOrder.success",
      ),
    ).toMatchObject({
      cls: "env",
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:pending", path: ["0", "opId"] },
          { kind: "lit", value: "api.submitOrder" },
        ],
      },
      reads: ["sys:pending"],
    });
  });

  it("resolves disabled guards to same-component state when state names repeat", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function Review() {
        const [submitting, setSubmitting] = useState(false);
        return <button disabled={submitting} onClick={() => setSubmitting(true)}>Review</button>;
      }
      export function Clarification() {
        const [submitting, setSubmitting] = useState(false);
        async function submit() {
          setSubmitting(true);
          await api.clarify();
          setSubmitting(false);
        }
        return <button disabled={submitting} onClick={submit}>Clarify</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.clarify"] },
    );

    expect(
      result.transitions.find(
        (transition) =>
          transition.id === "Clarification.onClick.api.clarify.start",
      ),
    ).toMatchObject({
      guard: {
        kind: "not",
        args: [{ kind: "read", var: "local:Clarification.submitting" }],
      },
      reads: ["local:Clarification.submitting"],
    });
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      guard: { kind: "read", var: "local:App.canSave" },
      reads: ["local:App.canSave"],
    });

    const model: Model = {
      schemaVersion: 1,
      id: "conditional-render-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      always(model, neq(readVar("local:App.saveStatus"), lit("posting")), {
        name: "postingNotReachable",
        reads: ["local:App.saveStatus"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("carries conditional rendering guards through JSX containers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [canSave, setCanSave] = useState<boolean>(false);
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <>{canSave && <section><button onClick={() => setSaveStatus('posting')}>Save</button></section>}</>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      guard: { kind: "read", var: "local:App.canSave" },
      reads: ["local:App.canSave"],
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
  });

  it("extracts false-branch conditional rendering guards through JSX containers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [locked, setLocked] = useState<boolean>(true);
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return locked ? null : <section><button onClick={() => setSaveStatus('posting')}>Save</button></section>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      guard: { kind: "not", args: [{ kind: "read", var: "local:App.locked" }] },
      reads: ["local:App.locked"],
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      confidence: "exact",
    });
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.label,
        transition.effect,
        transition.confidence,
      ]),
    ).toEqual([
      [
        "App.onChange.draft.empty",
        {
          kind: "input",
          valueClass: "empty",
          locator: { kind: "role", role: "textbox" },
        },
        {
          kind: "assign",
          var: "local:App.draft",
          expr: { kind: "lit", value: "empty" },
        },
        "exact",
      ],
      [
        "App.onChange.draft.nonEmpty",
        {
          kind: "input",
          valueClass: "nonEmpty",
          locator: { kind: "role", role: "textbox" },
        },
        {
          kind: "assign",
          var: "local:App.draft",
          expr: { kind: "lit", value: "nonEmpty" },
        },
        "exact",
      ],
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "input-extracted-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.draft"), lit("nonEmpty")), {
        name: "nonEmptyReachable",
        reads: ["local:App.draft"],
      }),
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.vars[0]).toMatchObject({
      id: "local:App.seats",
      domain: { kind: "boundedInt", min: 0, max: 2 },
      initial: 0,
    });
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.label,
        transition.effect,
        transition.confidence,
      ]),
    ).toEqual([
      [
        "App.onChange.seats.0",
        {
          kind: "input",
          valueClass: "0",
          locator: { kind: "role", role: "textbox" },
        },
        {
          kind: "assign",
          var: "local:App.seats",
          expr: { kind: "lit", value: 0 },
        },
        "exact",
      ],
      [
        "App.onChange.seats.1",
        {
          kind: "input",
          valueClass: "1",
          locator: { kind: "role", role: "textbox" },
        },
        {
          kind: "assign",
          var: "local:App.seats",
          expr: { kind: "lit", value: 1 },
        },
        "exact",
      ],
      [
        "App.onChange.seats.2",
        {
          kind: "input",
          valueClass: "2",
          locator: { kind: "role", role: "textbox" },
        },
        {
          kind: "assign",
          var: "local:App.seats",
          expr: { kind: "lit", value: 2 },
        },
        "exact",
      ],
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "numeric-input-extracted-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.seats"), lit(2)), {
        name: "twoSeatsReachable",
        reads: ["local:App.seats"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("reachable");
  });

  it("extracts allowed string input transforms as exact value-class transitions", () => {
    const trimmed = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('empty');
        return <input onChange={e => setDraft(e.target.value.trim())} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(trimmed.warnings).toEqual([]);
    expect(
      trimmed.transitions.map((transition) => [
        transition.id,
        transition.effect,
        transition.confidence,
      ]),
    ).toEqual([
      [
        "App.onChange.draft.empty",
        {
          kind: "assign",
          var: "local:App.draft",
          expr: { kind: "lit", value: "empty" },
        },
        "exact",
      ],
      [
        "App.onChange.draft.nonEmpty",
        {
          kind: "assign",
          var: "local:App.draft",
          expr: { kind: "lit", value: "nonEmpty" },
        },
        "exact",
      ],
    ]);

    const stringified = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('empty');
        return <input onChange={e => setDraft(String(e.currentTarget.value).toLowerCase())} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(stringified.warnings).toEqual([]);
    expect(stringified.transitions.map((transition) => transition.id)).toEqual([
      "App.onChange.draft.empty",
      "App.onChange.draft.nonEmpty",
    ]);
  });

  it("derives select input classes from literal option values", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [cycle, setCycle] = useState<'monthly' | 'yearly' | 'legacy'>('monthly');
        return <select onChange={e => setCycle(e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </select>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.label,
        transition.effect,
      ]),
    ).toEqual([
      [
        "App.onChange.cycle.monthly",
        {
          kind: "input",
          valueClass: "monthly",
          locator: { kind: "role", role: "combobox" },
        },
        {
          kind: "assign",
          var: "local:App.cycle",
          expr: { kind: "lit", value: "monthly" },
        },
      ],
      [
        "App.onChange.cycle.yearly",
        {
          kind: "input",
          valueClass: "yearly",
          locator: { kind: "role", role: "combobox" },
        },
        {
          kind: "assign",
          var: "local:App.cycle",
          expr: { kind: "lit", value: "yearly" },
        },
      ],
    ]);
  });

  it("derives radio input classes from literal radio values", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [cycle, setCycle] = useState<'monthly' | 'yearly' | 'legacy'>('monthly');
        return <input type="radio" value="yearly" aria-label="Yearly" onChange={e => setCycle(e.target.value)} />;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.label,
        transition.effect,
      ]),
    ).toEqual([
      [
        "App.onChange.cycle.yearly",
        {
          kind: "input",
          valueClass: "yearly",
          locator: { kind: "role", role: "radio", name: "Yearly" },
        },
        {
          kind: "assign",
          var: "local:App.cycle",
          expr: { kind: "lit", value: "yearly" },
        },
      ],
    ]);
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.cls,
        transition.triggeredBy,
      ]),
    ).toContainEqual(["App.useEffect.auth", "internal", ["local:App.auth"]]);

    const model: Model = {
      schemaVersion: 1,
      id: "effect-extracted-skeleton",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["noop"] },
                continuation: { kind: "enum", values: ["noop"] },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      always(model, eq(readVar("local:App.screen"), lit("home")), {
        name: "effectStabilizesScreen",
        reads: ["local:App.screen"],
      }),
    ]);
    expect(check.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("extracts M0 useEffect expressions and uses reads for missing dependency arrays", () => {
    const result = extractUseStateSkeleton(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        const [screen, setScreen] = useState<'home' | 'checkout'>('home');
        useEffect(() => {
          setScreen(auth === 'user' ? 'checkout' : 'home');
        });
        return <button onClick={() => setAuth('user')}>Login</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.useEffect.screen",
      ),
    ).toMatchObject({
      cls: "internal",
      triggeredBy: ["local:App.auth"],
      reads: ["local:App.auth", "local:App.screen"],
      effect: {
        kind: "assign",
        var: "local:App.screen",
        expr: {
          kind: "cond",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "readPre", var: "local:App.auth" },
                { kind: "lit", value: "user" },
              ],
            },
            { kind: "lit", value: "checkout" },
            { kind: "lit", value: "home" },
          ],
        },
      },
      confidence: "exact",
    });
  });

  it("skips havoc useEffect bodies that only depend on unmodeled explicit dependencies", () => {
    const result = extractUseStateSkeleton(
      `
      import { useEffect, useMemo, useState } from 'react';
      export function App({ external }: { external: string }) {
        const initialRange = useMemo(() => external, [external]);
        const [range, setRange] = useState<string | null>(null);
        useEffect(() => {
          setRange(initialRange);
        }, [initialRange]);
        return range;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.transitions.some(
        (transition) => transition.id === "App.useEffect.range",
      ),
    ).toBe(false);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unextractable effect App.useEffect",
    );
  });

  it("models M0 useEffect cleanup writes as over-approx internal transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [subscribed, setSubscribed] = useState<boolean>(false);
        useEffect(() => {
          return () => {
            setSubscribed(false);
          };
        }, []);
        return <button onClick={() => setSubscribed(true)}>Subscribe</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.useEffect.cleanup.subscribed",
      ),
    ).toMatchObject({
      cls: "internal",
      label: { kind: "internal", text: "App.useEffect.cleanup" },
      guard: { kind: "lit", value: true },
      effect: {
        kind: "assign",
        var: "local:App.subscribed",
        expr: { kind: "lit", value: false },
      },
      writes: ["local:App.subscribed"],
      confidence: "over-approx",
      triggeredBy: [],
    });
  });

  it("skips external no-channel calls in useEffect bodies", () => {
    const result = extractUseStateSkeleton(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [screen, setScreen] = useState<'home' | 'checkout'>('home');
        useEffect(() => {
          callExternal();
          setScreen('checkout');
        }, []);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.useEffect.screen",
      cls: "internal",
      effect: {
        kind: "assign",
        var: "local:App.screen",
        expr: { kind: "lit", value: "checkout" },
      },
      reads: ["local:App.screen"],
      writes: ["local:App.screen"],
      confidence: "exact",
    });
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save.escaped",
      effect: { kind: "havoc", var: "local:App.saveStatus" },
      writes: ["local:App.saveStatus"],
      confidence: "over-approx",
    });
  });

  it("havocs modeled state when a setter alias escapes to an unanalyzed call", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          const escapedSetter = setSaveStatus;
          callExternal(escapedSetter);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Save.escaped",
      effect: { kind: "havoc", var: "local:App.saveStatus" },
      writes: ["local:App.saveStatus"],
      confidence: "over-approx",
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
      { route: "/", fileName: "App.tsx", effectApis: ["api.saveTodo"] },
    );
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.cls,
        transition.writes,
      ]),
    ).toEqual([
      [
        "App.onClick.api.saveTodo.start",
        "user",
        ["local:App.saveStatus", "sys:pending"],
      ],
      [
        "App.onClick.api.saveTodo.success",
        "env",
        ["sys:pending", "local:App.saveStatus"],
      ],
      [
        "App.onClick.api.saveTodo.error",
        "env",
        ["sys:pending", "local:App.saveStatus"],
      ],
    ]);

    const model: Model = {
      schemaVersion: 1,
      id: "async-extracted-skeleton",
      bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: { kind: "enum", values: ["/"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "/",
        },
        {
          id: "sys:history",
          domain: {
            kind: "boundedList",
            inner: { kind: "enum", values: ["/"] },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: {
            kind: "boundedList",
            inner: {
              kind: "record",
              fields: {
                opId: { kind: "enum", values: ["api.saveTodo"] },
                continuation: {
                  kind: "enum",
                  values: ["App.onClick.api.saveTodo.cont"],
                },
                args: { kind: "record", fields: {} },
              },
            },
            maxLen: 1,
          },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, eq(readVar("local:App.saveStatus"), lit("posting")), {
        name: "postingReachable",
        reads: ["local:App.saveStatus"],
      }),
      reachable(model, eq(readVar("local:App.saveStatus"), lit("failed")), {
        name: "failedReachable",
        reads: ["local:App.saveStatus"],
      }),
    ]);
    expect(
      check.verdicts.map((verdict) => [verdict.property, verdict.status]),
    ).toEqual([
      ["postingReachable", "reachable"],
      ["failedReachable", "reachable"],
    ]);
  });

  it("snapshots modeled state read after await in continuation effects", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={async () => {
          await api.saveTodo();
          setSaveStatus(saveStatus);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.saveTodo"] },
    );
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      "Unhandled rejection App.onClick.api.saveTodo",
    ]);
    expect(
      result.transitions.map((transition) => [transition.id, transition.reads]),
    ).toEqual([
      ["App.onClick.api.saveTodo.start", []],
      [
        "App.onClick.api.saveTodo.success",
        ["local:App.saveStatus", "sys:pending"],
      ],
    ]);
    expect(
      result.transitions.find((transition) =>
        transition.id.endsWith(".success"),
      )?.effect,
    ).toMatchObject({
      kind: "seq",
      effects: [
        { kind: "dequeue", index: 0 },
        {
          kind: "assign",
          var: "local:App.saveStatus",
          expr: { kind: "readOpArg", key: "snap:local:App.saveStatus" },
        },
      ],
    });
  });

  it("captures simple effect API call arguments as pending op snapshots", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [userId, setUserId] = useState<'none' | 'u1'>('none');
        const [plan, setPlan] = useState<'none' | 'starter' | 'pro'>('none');
        const [status, setStatus] = useState<'idle' | 'submitting' | 'done'>('idle');
        return <button onClick={async () => {
          setStatus('submitting');
          await api.submitOrder({ userId, plan });
          setStatus('done');
        }}>Submit</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.submitOrder"] },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.submitOrder.start",
      ),
    ).toMatchObject({
      reads: ["local:App.plan", "local:App.userId"],
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: "local:App.status",
            expr: { kind: "lit", value: "submitting" },
          },
          {
            kind: "enqueue",
            op: "api.submitOrder",
            continuation: "App.onClick.api.submitOrder.cont",
            args: {
              userId: { kind: "read", var: "local:App.userId" },
              plan: { kind: "read", var: "local:App.plan" },
            },
          },
        ],
      },
    });
  });

  it("havocs async continuation writes when setters escape after await", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={async () => {
          await api.saveTodo();
          callExternal(setSaveStatus);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.saveTodo"] },
    );
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unhandled rejection App.onClick.api.saveTodo",
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.saveTodo.success",
      ),
    ).toMatchObject({
      cls: "env",
      effect: {
        kind: "seq",
        effects: [
          { kind: "dequeue", index: 0 },
          { kind: "havoc", var: "local:App.saveStatus" },
        ],
      },
      writes: ["sys:pending", "local:App.saveStatus"],
      confidence: "over-approx",
    });
  });

  it("models straight-line sequential awaits as chained continuations", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting' | 'done'>('idle');
        return <button onClick={async () => {
          setSaveStatus('posting');
          await api.saveTodo();
          await api.refreshTodo();
          setSaveStatus('done');
        }}>Save</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.saveTodo", "api.refreshTodo"],
      },
    );
    expect(result.warnings.map((warning) => warning.message)).toEqual([
      "Unhandled rejection App.onClick.api.saveTodo",
      "Unhandled rejection App.onClick.api.refreshTodo",
    ]);
    expect(
      result.transitions.map((transition) => [
        transition.id,
        transition.effect,
        transition.writes,
      ]),
    ).toEqual([
      [
        "App.onClick.api.saveTodo.start",
        {
          kind: "seq",
          effects: [
            {
              kind: "assign",
              var: "local:App.saveStatus",
              expr: { kind: "lit", value: "posting" },
            },
            {
              kind: "enqueue",
              op: "api.saveTodo",
              continuation: "App.onClick.api.saveTodo.cont",
              args: {},
            },
          ],
        },
        ["local:App.saveStatus", "sys:pending"],
      ],
      [
        "App.onClick.api.saveTodo.success",
        {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            {
              kind: "enqueue",
              op: "api.refreshTodo",
              continuation: "App.onClick.api.refreshTodo.cont",
              args: {},
            },
          ],
        },
        ["sys:pending"],
      ],
      [
        "App.onClick.api.refreshTodo.success",
        {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            {
              kind: "assign",
              var: "local:App.saveStatus",
              expr: { kind: "lit", value: "done" },
            },
          ],
        },
        ["local:App.saveStatus", "sys:pending"],
      ],
    ]);

    const variableAwait = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting' | 'done'>('idle');
        return <button onClick={async () => {
          setSaveStatus('posting');
          await api.saveTodo();
          const refreshed = await api.refreshTodo();
          setSaveStatus('done');
        }}>Save</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.saveTodo", "api.refreshTodo"],
      },
    );
    expect(
      variableAwait.transitions.map((transition) => transition.id),
    ).toEqual([
      "App.onClick.api.saveTodo.start",
      "App.onClick.api.saveTodo.success",
      "App.onClick.api.refreshTodo.success",
    ]);

    const promiseAllAwait = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting' | 'done'>('idle');
        return <button onClick={async () => {
          setSaveStatus('posting');
          await api.saveTodo();
          await Promise.all([api.refreshTodo(), api.logAudit()]);
          setSaveStatus('done');
        }}>Save</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.saveTodo", "api.refreshTodo", "api.logAudit"],
      },
    );
    expect(promiseAllAwait.warnings.map((warning) => warning.message)).toEqual([
      "Unhandled rejection App.onClick.api.saveTodo",
      "Unhandled rejection App.onClick.api.refreshTodo",
      "Unhandled rejection App.onClick.api.logAudit",
    ]);
    expect(
      promiseAllAwait.transitions.map((transition) => [
        transition.id,
        transition.guard,
        transition.effect,
      ]),
    ).toEqual([
      [
        "App.onClick.api.saveTodo.start",
        { kind: "lit", value: true },
        {
          kind: "seq",
          effects: [
            {
              kind: "assign",
              var: "local:App.saveStatus",
              expr: { kind: "lit", value: "posting" },
            },
            {
              kind: "enqueue",
              op: "api.saveTodo",
              continuation: "App.onClick.api.saveTodo.cont",
              args: {},
            },
          ],
        },
      ],
      [
        "App.onClick.api.saveTodo.success",
        {
          kind: "eq",
          args: [
            { kind: "read", var: "sys:pending", path: ["0", "opId"] },
            { kind: "lit", value: "api.saveTodo" },
          ],
        },
        {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            {
              kind: "enqueue",
              op: "api.refreshTodo",
              continuation: "App.onClick.Promise_all.cont",
              args: {},
            },
            {
              kind: "enqueue",
              op: "api.logAudit",
              continuation: "App.onClick.Promise_all.cont",
              args: {},
            },
          ],
        },
      ],
      [
        "App.onClick.Promise_all.success",
        {
          kind: "and",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "read", var: "sys:pending", path: ["0", "opId"] },
                { kind: "lit", value: "api.refreshTodo" },
              ],
            },
            {
              kind: "eq",
              args: [
                { kind: "read", var: "sys:pending", path: ["1", "opId"] },
                { kind: "lit", value: "api.logAudit" },
              ],
            },
          ],
        },
        {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 1 },
            { kind: "dequeue", index: 0 },
            {
              kind: "assign",
              var: "local:App.saveStatus",
              expr: { kind: "lit", value: "done" },
            },
          ],
        },
      ],
    ]);
  });

  it("extracts async try/catch handlers with variable await bindings", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
      export function App() {
        const [job, setJob] = useState<{ status: JobStatus } | null>(null);
        const [prompt, setPrompt] = useState('');
        const [lineAccountId, setLineAccountId] = useState('a1');
        return <button onClick={async () => {
          try {
            const result = await api.requestJob({ prompt, lineAccountId });
            setJob(result.job);
          } catch {
            setJob({ status: 'failed' });
          } finally {
            setPrompt('');
          }
        }}>Submit</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.requestJob"],
        asyncOutcomes: {
          "api.requestJob": {
            success: {
              job: { status: "pending" },
              accountId: "a1",
            },
          },
        },
      },
    );
    expect(
      result.transitions.map((transition) => [transition.id, transition.cls]),
    ).toEqual([
      ["App.onClick.api.requestJob.start", "user"],
      ["App.onClick.api.requestJob.success", "env"],
      ["App.onClick.api.requestJob.error", "env"],
    ]);
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.requestJob.start",
      ),
    ).toMatchObject({
      reads: ["local:App.lineAccountId", "local:App.prompt"],
      effect: {
        kind: "seq",
        effects: expect.arrayContaining([
          expect.objectContaining({
            kind: "enqueue",
            op: "api.requestJob",
            args: {
              prompt: { kind: "read", var: "local:App.prompt" },
              lineAccountId: { kind: "read", var: "local:App.lineAccountId" },
            },
          }),
        ]),
      },
    });
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.requestJob.success",
      )?.effect,
    ).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        expect.objectContaining({
          kind: "assign",
          var: "local:App.job",
          expr: {
            kind: "lit",
            value: { status: "pending" },
          },
        }),
      ]),
    });
  });

  it("assigns nested status fields from awaited result bindings", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle');
        return <button onClick={async () => {
          const result = await api.requestJob({});
          setStatus(result.job.status);
        }}>Submit</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.requestJob"],
        asyncOutcomes: {
          "api.requestJob": {
            success: {
              job: { status: "processing" },
            },
          },
        },
      },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.requestJob.success",
      )?.effect,
    ).toMatchObject({
      effects: expect.arrayContaining([
        expect.objectContaining({
          kind: "assign",
          var: "local:App.status",
          expr: { kind: "lit", value: "processing" },
        }),
      ]),
    });
  });

  it("infers nested finite record status domains", () => {
    const result = extractUseStateVars(
      `
      import { useState } from 'react';
      type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
      type Job = { job: { status: JobStatus } };
      export function App() {
        const [job, setJob] = useState<Job | null>(null);
        return null;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.vars.find((decl) => decl.id === "local:App.job")?.domain,
    ).toEqual({
      kind: "option",
      inner: {
        kind: "record",
        fields: {
          job: {
            kind: "record",
            fields: {
              status: {
                kind: "enum",
                values: ["pending", "processing", "completed", "failed"],
              },
            },
          },
        },
      },
    });
  });

  it("guards async continuation writes with stale-result checks", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [selectedAccountId, setSelectedAccountId] = useState('a1');
        const [job, setJob] = useState<{ status: string } | null>(null);
        return <button onClick={async () => {
          const result = await api.requestJob({ accountId: selectedAccountId });
          if (selectedAccountId !== result.accountId) return;
          setJob(result.job);
        }}>Submit</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.requestJob"],
        asyncOutcomes: {
          "api.requestJob": {
            success: { accountId: "a1", job: { status: "pending" } },
          },
        },
      },
    );
    const success = result.transitions.find(
      (transition) => transition.id === "App.onClick.api.requestJob.success",
    );
    expect(success?.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        expect.objectContaining({
          kind: "if",
          cond: {
            kind: "neq",
            args: [
              { kind: "readPre", var: "local:App.selectedAccountId" },
              { kind: "lit", value: "a1" },
            ],
          },
        }),
      ]),
    });
  });

  it("applies pre-await guard returns to async start transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [prompt, setPrompt] = useState('');
        const [status, setStatus] = useState<'idle' | 'submitting'>('idle');
        return <button onClick={async () => {
          if (!prompt) return;
          setStatus('submitting');
          await api.requestJob({ prompt });
        }}>Submit</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.requestJob"],
      },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.onClick.api.requestJob.start",
      ),
    ).toMatchObject({
      guard: { kind: "read", var: "local:App.prompt" },
      reads: ["local:App.prompt"],
    });
  });

  it("over-approximates unconfigured awaited result bindings without outcome readOpArg", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
      export function App() {
        const [job, setJob] = useState<{ status: JobStatus } | null>(null);
        return <button onClick={async () => {
          const result = await api.requestJob({ prompt: 'x' });
          setJob(result.job);
        }}>Submit</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.requestJob"],
      },
    );
    const startArgs = enqueueArgKeysForOp(result.transitions, "api.requestJob");
    const success = result.transitions.find(
      (transition) => transition.id === "App.onClick.api.requestJob.success",
    );
    expect(success).toBeDefined();
    for (const key of collectReadOpArgKeys(success!.effect)) {
      if (key.startsWith("outcome:api.requestJob")) {
        expect(startArgs.has(key)).toBe(true);
      }
    }
    expect(success?.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        expect.objectContaining({
          kind: "havoc",
          var: "local:App.job",
        }),
      ]),
    });
    expect(success?.confidence).toBe("over-approx");
  });

  it("over-approximates nested unconfigured awaited result property writes", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'pending' | 'processing'>('idle');
        return <button onClick={async () => {
          const result = await api.requestJob({});
          setStatus(result.job.status);
        }}>Submit</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.requestJob"],
      },
    );
    const startArgs = enqueueArgKeysForOp(result.transitions, "api.requestJob");
    const success = result.transitions.find(
      (transition) => transition.id === "App.onClick.api.requestJob.success",
    );
    for (const key of collectReadOpArgKeys(success!.effect)) {
      if (key.startsWith("outcome:api.requestJob")) {
        expect(startArgs.has(key)).toBe(true);
      }
    }
    expect(success?.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        expect.objectContaining({
          kind: "havoc",
          var: "local:App.status",
        }),
      ]),
    });
    expect(success?.confidence).toBe("over-approx");
  });

  it("models confirm-gated async delete with declined and accepted paths", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'deleting'>('idle');
        return <button onClick={async () => {
          if (!window.confirm('Delete?')) return;
          setStatus('deleting');
          await api.deleteDefinition({ id: 'd1' });
        }}>Delete</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        effectApis: ["api.deleteDefinition"],
      },
    );
    expect(
      result.warnings.map((warning) => warning.message),
    ).not.toContainEqual(expect.stringContaining("no-extractable-effect"));
    expect(result.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining([
        "App.onClick.api.deleteDefinition.start",
        "App.onClick.api.deleteDefinition.declined",
      ]),
    );
    const confirmVar = "sys:confirm:App.onClick.api.deleteDefinition";
    const start = result.transitions.find(
      (transition) =>
        transition.id === "App.onClick.api.deleteDefinition.start",
    );
    const declined = result.transitions.find(
      (transition) =>
        transition.id === "App.onClick.api.deleteDefinition.declined",
    );
    expect(declined?.confidence).toBe("over-approx");
    expect(declined?.effect).toMatchObject({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: confirmVar,
          expr: { kind: "lit", value: "declined" },
        },
      ],
    });
    expect(
      start?.effect.kind === "seq" &&
        start.effect.effects.some(
          (effect) =>
            effect.kind === "enqueue" && effect.op === "api.deleteDefinition",
        ),
    ).toBe(true);
    expect(
      start?.effect.kind === "seq" &&
        start.effect.effects.some(
          (effect) =>
            effect.kind === "assign" &&
            effect.var === confirmVar &&
            effect.expr.kind === "lit" &&
            effect.expr.value === "accepted",
        ),
    ).toBe(true);
    expect(
      declined?.effect.kind === "seq" &&
        !declined.effect.effects.some((effect) => effect.kind === "enqueue"),
    ).toBe(true);
  });

  it("extracts simple drag/drop state reset handlers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draggingId, setDraggingId] = useState<string | null>(null);
        const [overId, setOverId] = useState<string | null>(null);
        return (
          <>
            <div onDragStart={() => setDraggingId('d1')}>drag</div>
            <div onDragOver={() => setOverId('d2')}>over</div>
            <div onDragEnd={() => {
              setDraggingId(null);
              setOverId(null);
            }}>end</div>
          </>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.warnings.map((warning) => warning.message),
    ).not.toContainEqual(expect.stringContaining("no-extractable-effect"));
    expect(
      result.transitions.some(
        (transition) =>
          transition.id.startsWith("App.onDragEnd") &&
          transition.writes.includes("local:App.draggingId"),
      ),
    ).toBe(true);
    expect(
      result.transitions.some((transition) =>
        transition.writes.includes("local:App.overId"),
      ),
    ).toBe(true);
  });

  it("havocs finite-domain setter writes from unrepresentable expressions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => setSaveStatus(computeStatus());
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save.unrepresentable",
      effect: { kind: "havoc", var: "local:App.saveStatus" },
      writes: ["local:App.saveStatus"],
      confidence: "over-approx",
    });
  });

  it("summarizes SPI-provided global atom write channels with stable ids", () => {
    const result = extractUseStateSkeleton(
      `
      export function App() {
        return <button onClick={() => setAuth('user')}>Login</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        stateVars: [
          {
            id: "atom:authAtom",
            domain: { kind: "enum", values: ["guest", "user"] },
            origin: { file: "state.ts", line: 1, column: 1 },
            scope: { kind: "global" },
            initial: "guest",
          },
        ],
        writeChannels: [
          {
            id: "atom:authAtom.setter",
            varId: "atom:authAtom",
            symbolName: "setAuth",
            source: { file: "App.tsx", line: 3, column: 15 },
          },
        ],
      },
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Login",
      effect: {
        kind: "assign",
        var: "atom:authAtom",
        expr: { kind: "lit", value: "user" },
      },
      reads: [],
      writes: ["atom:authAtom"],
      confidence: "exact",
    });
  });

  it("summarizes SPI-provided store-style write channels", () => {
    const result = extractUseStateSkeleton(
      `
      export function App() {
        return <button onClick={() => store.set(authAtom, 'user')}>Login</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        stateVars: [
          {
            id: "atom:authAtom",
            domain: { kind: "enum", values: ["guest", "user"] },
            origin: { file: "state.ts", line: 1, column: 1 },
            scope: { kind: "global" },
            initial: "guest",
          },
        ],
        writeChannels: [
          {
            id: "atom:authAtom.store-set",
            varId: "atom:authAtom",
            symbolName: "store.set:authAtom",
            source: { file: "App.tsx", line: 3, column: 39 },
          },
        ],
      },
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.Login",
      effect: {
        kind: "assign",
        var: "atom:authAtom",
        expr: { kind: "lit", value: "user" },
      },
      reads: [],
      writes: ["atom:authAtom"],
      confidence: "exact",
    });
  });

  it("disambiguates duplicate transition ids with stable handler hashes", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        return <>
          <button onClick={() => setAuth('user')}>Auth</button>
          <button onClick={() => setAuth('guest')}>Auth</button>
        </>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const login = result.transitions.find(
      (transition) =>
        transition.effect.kind === "assign" &&
        transition.effect.expr.kind === "lit" &&
        transition.effect.expr.value === "user",
    );
    const logout = result.transitions.find(
      (transition) =>
        transition.effect.kind === "assign" &&
        transition.effect.expr.kind === "lit" &&
        transition.effect.expr.value === "guest",
    );
    expect(login?.id).toMatch(/^App\.onClick\.Auth\.[a-z0-9]{6}$/);
    expect(logout?.id).toMatch(/^App\.onClick\.Auth\.[a-z0-9]{6}$/);
    expect(login?.id).not.toBe(logout?.id);

    const withInsertedDuplicate = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        return <>
          <button onClick={() => setAuth('guest')}>Auth</button>
          <button onClick={() => setAuth('user')}>Auth</button>
          <button onClick={() => setAuth('guest')}>Auth</button>
        </>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const insertedLogin = withInsertedDuplicate.transitions.find(
      (transition) =>
        transition.effect.kind === "assign" &&
        transition.effect.expr.kind === "lit" &&
        transition.effect.expr.value === "user",
    );
    expect(insertedLogin?.id).toBe(login?.id);
  });

  it("reports unsupported event handlers instead of silently dropping them", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => {
          if (computeStatus()) setSaveStatus('posting');
        };
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toEqual([]);
    expect(
      result.warnings.some((warning) =>
        warning.message.includes("Unextractable handler App.onClick"),
      ),
    ).toBe(true);
  });

  it("reports useReducer as an unsupported v1 state source", () => {
    const result = extractUseStateSkeleton(
      `
      import { useReducer } from 'react';
      export function App() {
        const [state, dispatch] = useReducer(reducer, { status: 'idle' });
        return <button onClick={() => dispatch({ type: 'save' })}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.vars).toEqual([]);
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unsupported useReducer App.useReducer",
    );
  });

  it("uses custom router plugins to summarize navigation calls", () => {
    const routerPlugin: NavigationAdapter = {
      id: "custom-router",
      packageNames: ["custom-router"],
      discoverRoutes: async () => ({ routes: [] }),
      classifyNavigationCall: (callee, args) =>
        callee === "go" && typeof args[0] === "string"
          ? { mode: "replace", to: args[0] }
          : "unsupported",
      locationVars: () => [],
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
        navigate: () => undefined,
      },
    };
    const result = extractUseStateSkeleton(
      `
      export function App() {
        return <button onClick={() => go('/next')}>Go</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", routerPlugin },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.navigate._next",
      cls: "nav",
      effect: expect.objectContaining({ kind: "assign", var: "sys:route" }),
    });
  });

  it("uses source plugin summarizeWrite hooks before built-in setter handling", () => {
    const plugin: StateSourcePlugin = {
      id: "external-state",
      packageNames: ["external-state"],
      discover: () => [],
      writeChannels: () => [],
      summarizeWrite: (call) =>
        call.callee === "externalSet"
          ? {
              kind: "assign",
              var: "external",
              expr: { kind: "lit", value: "on" },
            }
          : "unsupported",
      harness: { setup: () => ({}), observe: () => "unobservable" },
    };
    const result = extractUseStateSkeleton(
      `
      export function App() {
        return <button onClick={() => externalSet('on')}>On</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        sourcePlugins: [plugin],
        stateVars: [
          {
            id: "external",
            domain: { kind: "enum", values: ["off", "on"] },
            origin: "system",
            scope: { kind: "global" },
            initial: "off",
          },
        ],
      },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.external-state.externalSet",
      effect: {
        kind: "assign",
        var: "external",
        expr: { kind: "lit", value: "on" },
      },
      reads: [],
      writes: ["external"],
      confidence: "exact",
    });
  });

  it("reports refs that hold modeled setters as global taints", () => {
    const result = extractUseStateSkeleton(
      `
      import { useRef, useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const setterRef = useRef(setSaveStatus);
        return <button onClick={() => setterRef.current('posting')}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "global-taint:local:App.saveStatus",
    );
  });

  it("reports setters assigned into ref.current as global taints", () => {
    const result = extractUseStateSkeleton(
      `
      import { useRef, useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const setterRef = useRef(null);
        setterRef.current = setSaveStatus;
        return <button onClick={() => setSaveStatus('posting')}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "global-taint:local:App.saveStatus",
    );
  });

  it("models M0 timer callbacks as environment timer transitions", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          setTimeout(() => setSaveStatus('posting'), 10);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(2);
    const click = result.transitions.find((t) => t.cls === "user");
    expect(click?.effect).toMatchObject({
      kind: "assign",
      expr: { kind: "lit", value: "scheduled" },
    });
    const fire = result.transitions.find((t) => t.cls === "env");
    expect(fire).toMatchObject({
      id: "App.setTimeout.saveStatus",
      cls: "env",
      label: { kind: "timer", key: "App.setTimeout.saveStatus" },
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: expect.stringMatching(/^sys:timer:/) },
          { kind: "lit", value: "scheduled" },
        ],
      },
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: expect.stringMatching(/^sys:timer:/) },
          {
            kind: "assign",
            var: "local:App.saveStatus",
            expr: { kind: "lit", value: "posting" },
          },
        ],
      },
      reads: [expect.stringMatching(/^sys:timer:/)],
      writes: ["local:App.saveStatus", expect.stringMatching(/^sys:timer:/)],
      confidence: "exact",
    });
  });

  it("skips external no-channel calls in timer callbacks", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          setTimeout(() => {
            callExternal();
            setSaveStatus('posting');
          }, 10);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(2);
    const fire = result.transitions.find((t) => t.cls === "env");
    expect(fire).toMatchObject({
      id: "App.setTimeout.saveStatus",
      cls: "env",
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: expect.stringMatching(/^sys:timer:/) },
          { kind: "lit", value: "scheduled" },
        ],
      },
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: expect.stringMatching(/^sys:timer:/) },
          {
            kind: "assign",
            var: "local:App.saveStatus",
            expr: { kind: "lit", value: "posting" },
          },
        ],
      },
      reads: [expect.stringMatching(/^sys:timer:/)],
      writes: ["local:App.saveStatus", expect.stringMatching(/^sys:timer:/)],
      confidence: "exact",
    });
  });

  it("havocs modeled state written inside loops", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        const save = () => {
          for (const item of items) {
            setSaveStatus(item.ready ? 'posting' : 'idle');
          }
        };
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toEqual([
      expect.objectContaining({
        id: "App.onClick.save.loop",
        effect: { kind: "havoc", var: "local:App.saveStatus" },
        reads: [],
        writes: ["local:App.saveStatus"],
        confidence: "over-approx",
      }),
    ]);
  });

  it("extracts switch branches as precise conditional effects", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [screen, setScreen] = useState<'home' | 'checkout'>('home');
        const save = () => {
          switch (screen) {
            case 'home':
              setScreen('checkout');
              break;
            default:
              setScreen('home');
          }
        };
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "readPre", var: "local:App.screen" },
            { kind: "lit", value: "home" },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: IR conditional field name
        then: {
          kind: "assign",
          var: "local:App.screen",
          expr: { kind: "lit", value: "checkout" },
        },
        else: {
          kind: "assign",
          var: "local:App.screen",
          expr: { kind: "lit", value: "home" },
        },
      },
      reads: ["local:App.screen"],
      writes: ["local:App.screen"],
      confidence: "exact",
    });
  });

  it("extracts nested blocks, guard returns, and TS expression wrappers", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [draft, setDraft] = useState<'empty' | 'nonEmpty'>('nonEmpty');
        const [saved, setSaved] = useState<'empty' | 'nonEmpty'>('empty');
        const save = () => {
          {
            const next = (draft satisfies 'empty' | 'nonEmpty');
            if (draft === 'empty') return;
            setSaved(next!);
          }
        };
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "readPre", var: "local:App.draft" },
            { kind: "lit", value: "empty" },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: IR conditional field name
        then: { kind: "seq", effects: [] },
        else: {
          kind: "assign",
          var: "local:App.saved",
          expr: { kind: "readPre", var: "local:App.draft" },
        },
      },
      reads: ["local:App.draft"],
      writes: ["local:App.saved"],
      confidence: "exact",
    });
  });

  it("havocs nested loop writes while preserving surrounding exact writes", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'posting'>('idle');
        const [saved, setSaved] = useState<'empty' | 'nonEmpty'>('empty');
        const save = () => {
          setSaved('nonEmpty');
          if (items.length > 0) {
            while (items.shift()) {
              setStatus(computeStatus());
            }
          }
        };
        return <button onClick={save}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.save",
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: "local:App.saved",
            expr: { kind: "lit", value: "nonEmpty" },
          },
          { kind: "havoc", var: "local:App.status" },
        ],
      },
      reads: [],
      writes: ["local:App.saved", "local:App.status"],
      confidence: "over-approx",
    });
  });
});

describe("React Router form action submits", () => {
  const routerPlugin = reactRouterAdapter();

  it("models Form method post with hidden intent as ACTION route op", () => {
    const result = extractReactSourceTransitions(
      `
      import { Form } from 'react-router';
      export default function Home() {
        return (
          <Form method="post">
            <input type="hidden" name="intent" value="brew-start" />
            <button type="submit">Start</button>
          </Form>
        );
      }
      `,
      {
        route: "/",
        fileName: "home.tsx",
        effectApis: ["ACTION /"],
        routerPlugin,
      },
    );
    const ids = result.transitions.map((transition) => transition.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "Home.onSubmit.ACTION /.start",
        "Home.onSubmit.ACTION /.success",
        "Home.onSubmit.ACTION /.error",
      ]),
    );
    const start = result.transitions.find(
      (transition) => transition.id === "Home.onSubmit.ACTION /.start",
    );
    expect(start?.label).toEqual({ kind: "submit" });
    expect(start?.cls).toBe("user");
  });

  it("adds disabled submit button guard to Form start transition", () => {
    const result = extractReactSourceTransitions(
      `
      import { useState } from 'react';
      import { Form } from 'react-router';
      export default function Home() {
        const [busy, setBusy] = useState(false);
        return (
          <Form method="post">
            <button type="submit" disabled={busy}>Start</button>
          </Form>
        );
      }
      `,
      {
        route: "/",
        fileName: "home.tsx",
        effectApis: ["ACTION /"],
        routerPlugin,
      },
    );
    const start = result.transitions.find(
      (transition) => transition.id === "Home.onSubmit.ACTION /.start",
    );
    expect(start?.guard).toEqual({
      kind: "not",
      args: [{ kind: "read", var: "local:Home.busy" }],
    });
  });

  it("models useActionData and useEffect continuation after action resolution", () => {
    const result = extractReactSourceTransitions(
      `
      import { Form, useActionData } from 'react-router';
      import { useEffect, useState } from 'react';
      export default function CustomerHome() {
        const actionData = useActionData();
        const [phase, setPhase] = useState<'confirm' | 'complete'>('confirm');
        useEffect(() => {
          if (actionData) setPhase('complete');
        }, [actionData]);
        return (
          <Form method="post">
            <input type="hidden" name="intent" value="confirm" />
            <button type="submit">Confirm</button>
          </Form>
        );
      }
      `,
      {
        route: "/customer",
        fileName: "customer.tsx",
        effectApis: ["ACTION /customer"],
        routerPlugin,
      },
    );
    expect(
      result.vars.some(
        (decl) =>
          decl.id === "router:actionData:_customer:CustomerHome" &&
          decl.initial === "none",
      ),
    ).toBe(true);
    const success = result.transitions.find((transition) =>
      transition.id.includes("ACTION /customer.success"),
    );
    expect(success?.effect).toEqual(
      expect.objectContaining({
        kind: "seq",
        effects: expect.arrayContaining([
          { kind: "dequeue", index: 0 },
          {
            kind: "assign",
            var: "router:actionData:_customer:CustomerHome",
            expr: { kind: "lit", value: "success" },
          },
        ]),
      }),
    );
    expect(
      result.transitions.some(
        (transition) =>
          transition.cls === "internal" &&
          (transition.triggeredBy?.includes(
            "router:actionData:_customer:CustomerHome",
          ) ??
            transition.reads.includes(
              "router:actionData:_customer:CustomerHome",
            )),
      ),
    ).toBe(true);
  });

  it("models useSubmit in onSubmit without unextractable warning", () => {
    const result = extractReactSourceTransitions(
      `
      import { useSubmit } from 'react-router';
      export default function CustomerHome() {
        const submit = useSubmit();
        const handlePrintSubmit = (e) => {
          e.preventDefault();
          submit(e.currentTarget);
        };
        return <form onSubmit={handlePrintSubmit} />;
      }
      `,
      {
        route: "/customer",
        fileName: "customer.tsx",
        effectApis: ["ACTION /customer"],
        routerPlugin,
      },
    );
    expect(result.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining(["CustomerHome.onSubmit.ACTION /customer.start"]),
    );
    expect(
      result.warnings.some((warning) =>
        warning.message.includes("Unextractable handler"),
      ),
    ).toBe(false);
  });

  const multiRouteInventory = {
    routes: [
      { pattern: "/", kind: "index" as const, file: "routes/home.tsx" },
      {
        pattern: "/customer",
        kind: "page" as const,
        file: "routes/customer.tsx",
      },
    ],
  };

  it("useSubmit uses component route rather than global extraction route", () => {
    const result = extractReactSourceTransitions(
      `
      import { useSubmit } from 'react-router';
      export default function Customer() {
        const submit = useSubmit();
        const onSubmit = (e) => {
          e.preventDefault();
          submit(e.currentTarget);
        };
        return <form onSubmit={onSubmit} />;
      }
      `,
      {
        route: "/",
        routePatterns: ["/", "/customer"],
        fileName: "routes/customer.tsx",
        effectApis: ["ACTION /", "ACTION /customer"],
        routerPlugin,
        inventory: multiRouteInventory,
      },
    );
    const actionIds = result.transitions
      .map((transition) => transition.id)
      .filter((id) => id.includes("ACTION"));
    expect(actionIds).toEqual(
      expect.arrayContaining([
        "Customer.onSubmit.ACTION /customer.start",
        "Customer.onSubmit.ACTION /customer.success",
        "Customer.onSubmit.ACTION /customer.error",
      ]),
    );
    expect(actionIds.some((id) => id.includes("ACTION /."))).toBe(false);
  });

  it("skips React Router Form without explicit method", () => {
    const result = extractReactSourceTransitions(
      `
      import { Form } from 'react-router';
      export default function Home() {
        return (
          <Form>
            <button type="submit">Search</button>
          </Form>
        );
      }
      `,
      {
        route: "/",
        fileName: "home.tsx",
        effectApis: ["ACTION /"],
        routerPlugin,
      },
    );
    expect(
      result.transitions.some((transition) => transition.id.includes("ACTION")),
    ).toBe(false);
  });

  it("skips React Router Form method get", () => {
    const result = extractReactSourceTransitions(
      `
      import { Form } from 'react-router';
      export default function Home() {
        return (
          <Form method="get">
            <button type="submit">Search</button>
          </Form>
        );
      }
      `,
      {
        route: "/",
        fileName: "home.tsx",
        effectApis: ["ACTION /"],
        routerPlugin,
      },
    );
    expect(
      result.transitions.some((transition) => transition.id.includes("ACTION")),
    ).toBe(false);
  });

  it("extracts hidden input wrapper values for action args", () => {
    const result = extractReactSourceTransitions(
      `
      import { Form } from 'react-router';
      export default function Home() {
        return (
          <Form method="post">
            <input type="hidden" name="intent" value={JSON.stringify("brew-start")} />
            <input type="hidden" name="label" value={String("brew-start")} />
            <input type="hidden" name="count" value={Number(2)} />
            <button type="submit">Start</button>
          </Form>
        );
      }
      `,
      {
        route: "/",
        fileName: "home.tsx",
        effectApis: ["ACTION /"],
        routerPlugin,
      },
    );
    const start = result.transitions.find(
      (transition) => transition.id === "Home.onSubmit.ACTION /.start",
    );
    const enqueue = (
      start?.effect as {
        kind: "seq";
        effects: Array<{ kind: string; args?: Record<string, unknown> }>;
      }
    )?.effects.find((effect) => effect.kind === "enqueue");
    expect(enqueue?.args).toEqual({
      intent: { kind: "lit", value: "brew-start" },
      label: { kind: "lit", value: "brew-start" },
      count: { kind: "lit", value: 2 },
    });
  });

  it("lowers functional numeric updater arithmetic to add and sub", () => {
    const increment = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount((s) => s + 1)}>Inc</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      increment.transitions.find((transition) =>
        transition.writes.includes("local:App.count"),
      )?.effect,
    ).toMatchObject({
      kind: "assign",
      var: "local:App.count",
      expr: {
        kind: "add",
        args: [
          { kind: "read", var: "local:App.count" },
          { kind: "lit", value: 1 },
        ],
      },
    });

    const decrement = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount((s) => s - 1)}>Dec</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      decrement.transitions.find((transition) =>
        transition.writes.includes("local:App.count"),
      )?.effect,
    ).toMatchObject({
      kind: "assign",
      var: "local:App.count",
      expr: {
        kind: "sub",
        args: [
          { kind: "read", var: "local:App.count" },
          { kind: "lit", value: 1 },
        ],
      },
    });
  });

  it("lowers Math.min and Math.max numeric clamps in functional updaters", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return (
          <button onClick={() => setCount((s) => Math.min(s + 10, 300))}>
            Add
          </button>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.transitions.find((transition) =>
        transition.writes.includes("local:App.count"),
      )
        ?.effect,
    ).toMatchObject({
      kind: "assign",
      var: "local:App.count",
      expr: {
        kind: "cond",
        args: [
          {
            kind: "lte",
            args: [
              {
                kind: "add",
                args: [
                  { kind: "read", var: "local:App.count" },
                  { kind: "lit", value: 10 },
                ],
              },
              { kind: "lit", value: 300 },
            ],
          },
          {
            kind: "add",
            args: [
              { kind: "read", var: "local:App.count" },
              { kind: "lit", value: 10 },
            ],
          },
          { kind: "lit", value: 300 },
        ],
      },
    });
    expect(
      result.vars.find((decl) => decl.id === "local:App.count")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 300,
      overflow: "forbid",
    });
  });

  it("does not lower string concatenation in functional updaters to numeric add", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [label, setLabel] = useState('a');
        return <button onClick={() => setLabel((s) => s + 'x')}>Append</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const transition = result.transitions.find((entry) =>
      entry.writes.includes("local:App.label"),
    );
    expect(transition?.effect.kind).toBe("havoc");
    expect(transition?.id).toContain(".unrepresentable");
  });

  it("widens clamp domains without excluding direct literal assignments", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return (
          <>
            <button onClick={() => setCount((s) => Math.min(s + 10, 300))}>
              Clamp
            </button>
            <button onClick={() => setCount(500)}>Set</button>
          </>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.vars.find((decl) => decl.id === "local:App.count")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 500,
      overflow: "forbid",
    });
    const countTransitions = result.transitions.filter((transition) =>
      transition.writes.includes("local:App.count"),
    );
    expect(
      countTransitions.every((transition) => transition.confidence === "exact"),
    ).toBe(true);
    expect(
      countTransitions.every(
        (transition) =>
          transition.effect.kind === "assign" &&
          transition.effect.var === "local:App.count",
      ),
    ).toBe(true);
  });

  it("merges multiple clamp bounds independent of encounter order", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [count, setCount] = useState(0);
        return (
          <>
            <button onClick={() => setCount((s) => Math.min(s + 1, 10))}>
              Small
            </button>
            <button onClick={() => setCount((s) => Math.min(s + 1, 300))}>
              Large
            </button>
          </>
        );
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.vars.find((decl) => decl.id === "local:App.count")?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 300,
      overflow: "forbid",
    });
  });

  it("does not lower numeric-looking plus for string useState", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [label, setLabel] = useState('a');
        return <button onClick={() => setLabel((s) => s + 1)}>Append</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const transition = result.transitions.find((entry) =>
      entry.writes.includes("local:App.label"),
    );
    expect(transition?.effect.kind).toBe("havoc");
    expect(transition?.id).toContain(".unrepresentable");
  });

  it("widens LaneTimer-like draftSec domains through extractUseStateSkeleton", () => {
    const maxDepth = 12;
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function LaneTimer() {
        const [draftSec, setDraftSec] = useState(0);
        return (
          <>
            <button onClick={() => setDraftSec((s) => s + 10)}>+10秒</button>
            <button onClick={() => setDraftSec((s) => s + 60)}>+1分</button>
            <button onClick={() => setDraftSec((s) => s + 180)}>+3分</button>
            <button onClick={() => setDraftSec(0)}>リセット</button>
          </>
        );
      }
      `,
      { route: "/", fileName: "LaneTimer.tsx", bounds: { maxDepth } },
    );
    expect(
      result.vars.find((decl) => decl.id === "local:LaneTimer.draftSec")
        ?.domain,
    ).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 180 * maxDepth,
      overflow: "forbid",
    });
    expect(
      result.transitions.some((transition) =>
        transition.id.includes("draftSec.unrepresentable"),
      ),
    ).toBe(false);
  });
});

describe("environment callbacks", () => {
  function effectContainsHavoc(effect: EffectIR): boolean {
    if (effect.kind === "havoc") return true;
    if (effect.kind === "seq") return effect.effects.some(effectContainsHavoc);
    if (effect.kind === "if")
      return (
        effectContainsHavoc(effect.then) || effectContainsHavoc(effect.else)
      );
    return false;
  }

  const webSocketMessageEnvironment = {
    webSockets: [
      {
        url: "/ws",
        messages: [
          { type: "snapshot", bind: { orders: "many" } },
          { type: "order-updated", bind: { order: "token" } },
        ],
      },
    ],
  };

  const webSocketMessageSource = `
      import { useEffect, useState } from 'react';
      export function App() {
        const [orders, setOrders] = useState<readonly string[]>([]);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            switch (message.type) {
              case "snapshot":
                setOrders(message.orders);
                break;
              case "order-updated":
                setOrders((current) => [...current, message.order]);
                break;
            }
          };
        }, []);
        return <span>{orders.length}</span>;
      }
      `;

  it("models WebSocket onopen as guarded environment transition", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [connected, setConnected] = useState(false);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onopen = () => setConnected(true);
        }, []);
        return <span>{connected ? 'on' : 'off'}</span>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings.map((warning) => warning.message)).not.toContain(
      "Unextractable effect App.useEffect",
    );
    expect(
      result.vars.some((decl) => decl.id.startsWith("sys:websocket:")),
    ).toBe(true);
    const internal = result.transitions.find(
      (transition) => transition.cls === "internal",
    );
    expect(internal?.effect).toMatchObject({
      kind: "assign",
      expr: { kind: "lit", value: "connecting" },
    });
    const onopen = result.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onopen",
    );
    expect(onopen).toMatchObject({
      cls: "env",
      writes: expect.arrayContaining(["local:App.connected"]),
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            expr: { kind: "lit", value: "open" },
          },
          {
            kind: "assign",
            var: "local:App.connected",
            expr: { kind: "lit", value: true },
          },
        ],
      },
    });
  });

  it("models WebSocket onclose and cleanup close separately", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [connected, setConnected] = useState(true);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onclose = () => setConnected(false);
          return () => ws.close();
        }, []);
        return <span>{connected ? 'on' : 'off'}</span>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const onclose = result.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onclose",
    );
    expect(onclose?.writes).toContain("local:App.connected");
    const cleanup = result.transitions.find(
      (transition) =>
        transition.cls === "internal" &&
        transition.label.kind === "internal" &&
        transition.label.text === "App.useEffect.cleanup",
    );
    expect(cleanup?.effect).toMatchObject({
      kind: "assign",
      expr: { kind: "lit", value: "closed" },
    });
  });

  it("models WebSocket onerror as environment transition", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [error, setError] = useState<string | null>(null);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onerror = () => setError("connection");
        }, []);
        return <span>{error ?? 'ok'}</span>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const onerror = result.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onerror",
    );
    expect(onerror?.writes).toContain("local:App.error");
  });

  it("models WebSocket addEventListener lifecycle callbacks", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [connected, setConnected] = useState(false);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.addEventListener("open", () => setConnected(true));
        }, []);
        return <span>{connected ? 'on' : 'off'}</span>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(
      result.transitions.some(
        (transition) =>
          transition.cls === "env" &&
          transition.label.kind === "env" &&
          transition.label.key === "App.websocket.onopen",
      ),
    ).toBe(true);
  });

  it("models configured WebSocket message variants from JSON.parse event.data", () => {
    const result = extractReactSourceTransitions(webSocketMessageSource, {
      route: "/",
      fileName: "App.tsx",
      environment: webSocketMessageEnvironment,
    });
    const socketVar = result.vars.find((decl) =>
      decl.id.startsWith("sys:websocket:"),
    )?.id;
    expect(socketVar).toBeDefined();
    const messageTransitions = result.transitions.filter(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onmessage",
    );
    expect(messageTransitions).toHaveLength(2);
    const snapshot = messageTransitions.find(
      (transition) =>
        transition.label.kind === "env" &&
        transition.label.outcome === "snapshot",
    );
    const orderUpdated = messageTransitions.find(
      (transition) =>
        transition.label.kind === "env" &&
        transition.label.outcome === "order-updated",
    );
    expect(snapshot).toMatchObject({
      confidence: "exact",
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: socketVar },
          { kind: "lit", value: "open" },
        ],
      },
      effect: {
        kind: "assign",
        var: "local:App.orders",
        expr: { kind: "lit", value: "many" },
      },
    });
    expect(snapshot && effectContainsHavoc(snapshot.effect)).toBe(false);
    expect(orderUpdated).toBeDefined();
    expect(orderUpdated?.confidence).not.toBe("over-approx");
    expect(orderUpdated?.effect).not.toEqual(snapshot?.effect);
  });

  it("models onmessage-only WebSocket as reachable through implicit open", () => {
    const result = extractReactSourceTransitions(webSocketMessageSource, {
      route: "/",
      fileName: "App.tsx",
      environment: webSocketMessageEnvironment,
    });
    const socketVar = result.vars.find((decl) =>
      decl.id.startsWith("sys:websocket:"),
    )?.id;
    expect(socketVar).toBeDefined();
    expect(
      result.transitions.some(
        (transition) =>
          transition.cls === "internal" &&
          transition.effect.kind === "assign" &&
          transition.effect.var === socketVar &&
          transition.effect.expr.kind === "lit" &&
          transition.effect.expr.value === "connecting",
      ),
    ).toBe(true);
    const openTransition = result.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onopen" &&
        transition.effect.kind === "assign" &&
        transition.effect.var === socketVar &&
        transition.effect.expr.kind === "lit" &&
        transition.effect.expr.value === "open",
    );
    expect(openTransition).toBeDefined();
    const messageTransition = result.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onmessage",
    );
    expect(messageTransition?.guard).toMatchObject({
      kind: "eq",
      args: [
        { kind: "read", var: socketVar },
        { kind: "lit", value: "open" },
      ],
    });
    expect(
      messageTransition && !effectContainsHavoc(messageTransition.effect),
    ).toBe(true);
  });

  it("does not duplicate implicit open when explicit onopen is registered", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [connected, setConnected] = useState(false);
        const [orders, setOrders] = useState<readonly string[]>([]);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onopen = () => setConnected(true);
          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.type === "snapshot") setOrders(message.orders);
          };
        }, []);
        return <span>{connected ? 'on' : 'off'}</span>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        environment: {
          webSockets: [
            {
              url: "/ws",
              messages: [{ type: "snapshot", bind: { orders: "many" } }],
            },
          ],
        },
      },
    );
    const openTransitions = result.transitions.filter(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onopen",
    );
    expect(openTransitions).toHaveLength(1);
    expect(openTransitions[0]?.id).not.toContain("implicit");
  });

  it("binds JSON.parse(String(event.data)) for configured WebSocket variants", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [orders, setOrders] = useState<readonly string[]>([]);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onmessage = (event) => {
            const message = JSON.parse(String(event.data));
            if (message.type === "snapshot") setOrders(message.orders);
          };
        }, []);
        return <span>{orders.length}</span>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        environment: {
          webSockets: [
            {
              url: "/ws",
              messages: [{ type: "snapshot", bind: { orders: "many" } }],
            },
          ],
        },
      },
    );
    const snapshot = result.transitions.find(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === "App.websocket.onmessage" &&
        transition.label.outcome === "snapshot",
    );
    expect(snapshot).toMatchObject({
      confidence: "exact",
      effect: {
        kind: "assign",
        var: "local:App.orders",
        expr: { kind: "lit", value: "many" },
      },
    });
    expect(snapshot && effectContainsHavoc(snapshot.effect)).toBe(false);
  });

  it("reports unsupported WebSocket message parse when parse source is not callback event data", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [orders, setOrders] = useState<readonly string[]>([]);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onmessage = (event) => {
            const other = event;
            const message = JSON.parse(other.data);
            setOrders(message.orders);
          };
        }, []);
        return <span>{orders.length}</span>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        environment: {
          webSockets: [
            {
              url: "/ws",
              messages: [{ type: "snapshot", bind: { orders: "many" } }],
            },
          ],
        },
      },
    );
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unsupported WebSocket onmessage payload binding App",
    );
    expect(
      result.transitions.filter(
        (transition) =>
          transition.cls === "env" &&
          transition.label.kind === "env" &&
          transition.label.key === "App.websocket.onmessage",
      ),
    ).toHaveLength(0);
  });

  it("does not treat registered WebSocket callback setters as immediate useEffect writes", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [connected, setConnected] = useState(false);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onopen = () => setConnected(true);
        }, []);
        return <span>{connected ? 'on' : 'off'}</span>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    const internal = result.transitions.filter(
      (transition) => transition.cls === "internal",
    );
    expect(
      internal.every(
        (transition) => !transition.writes.includes("local:App.connected"),
      ),
    ).toBe(true);
  });

  it("reports missing WebSocket message variants for onmessage writes", () => {
    const result = extractReactSourceTransitions(
      `
      import { useEffect, useState } from 'react';
      export function App() {
        const [orders, setOrders] = useState<readonly string[]>([]);
        useEffect(() => {
          const ws = new WebSocket("/ws");
          ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            setOrders(message.orders);
          };
        }, []);
        return <span>{orders.length}</span>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "WebSocket onmessage handler App has no configured message variants",
    );
  });

  it("preserves existing timer callback behavior", () => {
    const result = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [saveStatus, setSaveStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => {
          setTimeout(() => setSaveStatus('posting'), 10);
        }}>Save</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    const fire = result.transitions.find(
      (transition) => transition.cls === "env",
    );
    expect(fire?.label).toEqual({
      kind: "timer",
      key: "App.setTimeout.saveStatus",
    });
  });
});

describe("component and hook registry fallback", () => {
  it("resolves supplemental components and hooks by display name without semantic context", () => {
    const childText = `export function Child({ onDone }: { onDone: () => void }) {
  return <button onClick={onDone}>done</button>;
}`;
    const hookText = `export function useCounter() {
  const [count, setCount] = useState(0);
  return [count, setCount] as const;
}`;
    const appText = `import { Child } from "./Child.js";
import { useCounter } from "./useCounter.js";
export function App() {
  const [count, setCount] = useCounter();
  const [done, setDone] = useState(false);
  return <Child onDone={() => setDone(true)} />;
}`;
    const result = extractReactSourceTransitions(appText, {
      fileName: "App.tsx",
      route: "/",
      relatedFragments: [
        { sourceText: childText, fileName: "Child.tsx" },
        { sourceText: hookText, fileName: "useCounter.ts" },
        { sourceText: appText, fileName: "App.tsx" },
      ],
    });

    expect(result.vars.some((decl) => decl.id === "local:App.count")).toBe(
      true,
    );
    expect(result.vars.some((decl) => decl.id === "local:App.done")).toBe(true);
    expect(
      result.transitions.some(
        (transition) =>
          transition.id.includes("onClick") ||
          transition.id.includes("onDone") ||
          transition.id.includes("done"),
      ),
    ).toBe(true);
  });
});
