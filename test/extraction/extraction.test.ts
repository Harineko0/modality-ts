import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import { always, reachable, type Model } from "modality-ts/core";
import {
  extractUseStateSkeleton,
  extractUseStateVars,
} from "../../src/extract/sources/use-state/transitions.js";
import type {
  RouterPlugin,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";

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
        { kind: "route-local", route: "/" },
      ],
      [
        "local:App.saveStatus",
        { kind: "enum", values: ["idle", "posting", "failed"] },
        "idle",
        { kind: "route-local", route: "/" },
      ],
      [
        "local:App.items",
        { kind: "lengthCat" },
        "0",
        { kind: "route-local", route: "/" },
      ],
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
      id: "App.onClick.saveStatus",
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
      reachable(model, (state) => state["local:App.saveStatus"] === "posting", {
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
        (transition) => transition.id === "App.onClick.role",
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
      reachable(model, (state) => state["local:App.role"] === "guest", {
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
      },
    );
    expect(
      result.transitions
        .filter((transition) => transition.cls === "nav")
        .map((transition) => transition.effect),
    ).toEqual(
      expect.arrayContaining([
        {
          kind: "navigate",
          mode: "push",
          to: { kind: "lit", value: "/links" },
        },
        {
          kind: "navigate",
          mode: "push",
          to: { kind: "lit", value: "/analytics" },
        },
        { kind: "navigate", mode: "push", to: { kind: "lit", value: "/tags" } },
      ]),
    );
  });

  it("normalizes query-string Link targets to route patterns", () => {
    const result = extractUseStateSkeleton(
      `
      import { Link } from 'react-router';
      export function App({ id }: { id: string }) {
        return <Link to={\`/analytics?linkId=\${id}\`}>Analytics</Link>;
      }
      `,
      { route: "/", fileName: "App.tsx", routePatterns: ["/", "/analytics"] },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "App.Link.navigate._analytics",
      ),
    ).toMatchObject({
      cls: "nav",
      effect: {
        kind: "navigate",
        mode: "push",
        to: { kind: "lit", value: "/analytics" },
      },
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
      { route: "/", fileName: "App.tsx", routePatterns: ["/", "/analytics"] },
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
      reads: ["sys:history", "sys:route"],
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
      },
    );
    const nav = result.transitions.filter(
      (transition) => transition.cls === "nav",
    );
    expect(nav.map((transition) => transition.effect)).toEqual(
      expect.arrayContaining([
        {
          kind: "navigate",
          mode: "push",
          to: { kind: "lit", value: "/admin" },
        },
        {
          kind: "navigate",
          mode: "push",
          to: { kind: "lit", value: "/links" },
        },
      ]),
    );
    expect(
      nav.every((transition) => transition.confidence === "over-approx"),
    ).toBe(true);
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
      },
    );
    const nav = result.transitions.filter(
      (transition) => transition.cls === "nav",
    );
    expect(nav.map((transition) => transition.effect)).toEqual(
      expect.arrayContaining([
        { kind: "navigate", mode: "push", to: { kind: "lit", value: "/" } },
        {
          kind: "navigate",
          mode: "push",
          to: { kind: "lit", value: "/analytics" },
        },
        { kind: "navigate", mode: "push", to: { kind: "lit", value: "/tags" } },
      ]),
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
            scope: { kind: "route-local", route: "/" },
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
      id: "App.onClick.saveStatus",
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
      id: "App.onClick.saveStatus",
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
      id: "App.onClick.saveStatus",
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
      id: "App.onClick.saveStatus",
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
      id: "App.onClick.saveStatus",
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
      id: "App.onClick.saveStatus",
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

  it("reports deeper component prop drilling as unextractable", () => {
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
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unextractable handler App.onPress",
    );
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
        "Unextractable handler Row.onClick",
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
            scope: { kind: "route-local", route: "/" },
            initial: [],
          },
          {
            id: "local:App.selected",
            domain: { kind: "enum", values: ["none", "a", "b"] },
            origin: { file: "App.tsx", line: 4, column: 15 },
            scope: { kind: "route-local", route: "/" },
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
      id: "App.onClick.open",
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
      reachable(model, (state) => state["local:App.open"] === true, {
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
      id: "App.onClick.saved",
      effect: {
        kind: "assign",
        var: "local:App.saved",
        expr: { kind: "read", var: "local:App.draft" },
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
      id: "App.onClick.saved",
      effect: {
        kind: "assign",
        var: "local:App.saved",
        expr: { kind: "read", var: "local:App.draft" },
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
      id: "App.onClick.draft_saved.seq",
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: "local:App.saved",
            expr: { kind: "read", var: "local:App.draft" },
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
        (state) =>
          state["local:App.saved"] === "nonEmpty" &&
          state["local:App.draft"] === "empty",
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
      id: "App.onClick.mode",
      effect: {
        kind: "assign",
        var: "local:App.mode",
        expr: { kind: "read", var: "local:App.auth", path: ["kind"] },
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
      id: "App.onClick.auth",
      effect: {
        kind: "assign",
        var: "local:App.auth",
        expr: {
          kind: "updateField",
          path: ["stale"],
          value: { kind: "lit", value: false },
          target: {
            kind: "updateField",
            target: { kind: "read", var: "local:App.auth" },
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
        (state) => {
          const auth = state["local:App.auth"] as {
            kind?: string;
            stale?: boolean;
          };
          return auth.kind === "user" && auth.stale === false;
        },
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
      id: "App.onClick.screen",
      effect: {
        kind: "assign",
        var: "local:App.screen",
        expr: {
          kind: "cond",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "read", var: "local:App.auth" },
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
      reachable(model, (state) => state["local:App.screen"] === "checkout", {
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
      id: "App.onClick.canSubmit",
      effect: {
        kind: "assign",
        var: "local:App.canSubmit",
        expr: {
          kind: "and",
          args: [
            { kind: "read", var: "local:App.hasDraft" },
            { kind: "not", args: [{ kind: "read", var: "local:App.saving" }] },
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
      id: "App.onClick.screen.if",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "read", var: "local:App.auth", path: ["kind"] },
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
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.warnings).toEqual([]);
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.navigate._checkout",
      cls: "nav",
      label: { kind: "navigate", mode: "push", to: "/checkout" },
      effect: {
        kind: "navigate",
        mode: "push",
        to: { kind: "lit", value: "/checkout" },
      },
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
      id: "App.onClick.screen.if",
      effect: {
        kind: "if",
        cond: {
          kind: "eq",
          args: [
            { kind: "read", var: "local:App.auth" },
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
      reachable(model, (state) => state["local:App.screen"] === "checkout", {
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
      always(model, (state) => state["local:App.saveStatus"] !== "idle", {
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
      always(model, (state) => state["local:App.saveStatus"] !== "posting", {
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
      reachable(model, (state) => state["local:App.draft"] === "nonEmpty", {
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
      reachable(model, (state) => state["local:App.seats"] === 2, {
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
    ).toContainEqual(["App.useEffect.screen", "internal", ["local:App.auth"]]);

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
      always(model, (state) => state["local:App.screen"] === "home", {
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
                { kind: "read", var: "local:App.auth" },
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

  it("does not partially extract unsupported useEffect bodies", () => {
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
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unextractable effect App.useEffect",
    );
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
      id: "App.onClick.saveStatus.escaped",
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
      id: "App.onClick.saveStatus.escaped",
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
          initial: [],
        },
        ...result.vars,
      ],
      transitions: result.transitions,
    };
    const check = checkModel(model, [
      reachable(model, (state) => state["local:App.saveStatus"] === "posting", {
        name: "postingReachable",
        reads: ["local:App.saveStatus"],
      }),
      reachable(model, (state) => state["local:App.saveStatus"] === "failed", {
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

  it("reports stale-read risks for modeled state read after await", () => {
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
      "Stale-read risk App.onClick.api.saveTodo:local:App.saveStatus",
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
          expr: { kind: "read", var: "local:App.saveStatus" },
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
    expect(variableAwait.transitions).toEqual([]);
    expect(variableAwait.warnings.map((warning) => warning.message)).toContain(
      "Unextractable handler App.onClick",
    );

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
      id: "App.onClick.saveStatus.unrepresentable",
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
      id: "App.onClick.authAtom",
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
      id: "App.onClick.authAtom",
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
          <button onClick={() => setAuth('user')}>Login</button>
          <button onClick={() => setAuth('guest')}>Logout</button>
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
    expect(login?.id).toMatch(/^App\.onClick\.auth\.[a-z0-9]{6}$/);
    expect(logout?.id).toMatch(/^App\.onClick\.auth\.[a-z0-9]{6}$/);
    expect(login?.id).not.toBe(logout?.id);

    const withInsertedDuplicate = extractUseStateSkeleton(
      `
      import { useState } from 'react';
      export function App() {
        const [auth, setAuth] = useState<'guest' | 'user'>('guest');
        return <>
          <button onClick={() => setAuth('guest')}>Reset</button>
          <button onClick={() => setAuth('user')}>Login</button>
          <button onClick={() => setAuth('guest')}>Logout</button>
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
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Unextractable handler App.onClick",
    );
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
    const routerPlugin: RouterPlugin = {
      id: "custom-router",
      packageNames: ["custom-router"],
      routeVars: () => [],
      navigationCall: (callee, args) =>
        callee === "go" && typeof args[0] === "string"
          ? { mode: "replace", to: args[0] }
          : "unsupported",
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
      effect: {
        kind: "navigate",
        mode: "replace",
        to: { kind: "lit", value: "/next" },
      },
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
      "Global taint local:App.saveStatus",
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
      "Global taint local:App.saveStatus",
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
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.setTimeout.saveStatus",
      cls: "env",
      label: { kind: "timer", key: "App.setTimeout.saveStatus" },
      effect: {
        kind: "assign",
        var: "local:App.saveStatus",
        expr: { kind: "lit", value: "posting" },
      },
      reads: [],
      writes: ["local:App.saveStatus"],
      confidence: "exact",
    });
  });

  it("reports non-M0 timer-held setters as global taints", () => {
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
    expect(result.transitions).toEqual([]);
    expect(result.warnings.map((warning) => warning.message)).toContain(
      "Global taint local:App.saveStatus",
    );
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
        id: "App.onClick.saveStatus.loop",
        effect: { kind: "havoc", var: "local:App.saveStatus" },
        reads: [],
        writes: ["local:App.saveStatus"],
        confidence: "over-approx",
      }),
    ]);
  });
});
