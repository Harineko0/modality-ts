import { checkModel } from "modality-ts/check";
import { and, eq, lit, type Model, neq, or, readVar } from "modality-ts/core";
import {
  createSwrKeyWindowTemplate,
  createSwrTemplate,
  extractSwrSkeleton,
  swrSource,
  swrVarId,
  swrWindowEvictedSummaryId,
  swrWindowView,
} from "modality-ts/extract/plugins/state/swr";
import { describe, expect, it } from "vitest";
import { createSemanticProjectForTest } from "../../../src/extract/lang/ts/driver/semantic-project.js";
import {
  observe,
  setup,
} from "../../../src/extract/plugins/state/swr/harness.js";
import { always, reachable } from "../../helpers/property-builders.js";

const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["GET_TODOS"] },
    continuation: { kind: "enum", values: ["swr:todos:resolve"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function model(): Model {
  const template = createSwrTemplate({
    id: "todos",
    op: "GET_TODOS",
    payloadDomain: { kind: "lengthCat" },
    activeWhen: {
      kind: "eq",
      args: [
        { kind: "read", var: "auth" },
        { kind: "lit", value: "user" },
      ],
    },
  });
  return {
    schemaVersion: 1,
    id: "swr-template-fixture",
    bounds: { maxDepth: 5, maxPending: 2, maxInternalSteps: 4 },
    vars: [
      {
        id: "sys:route",
        domain: route,
        origin: "system",
        scope: { kind: "global" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: { kind: "boundedList", inner: route, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 2 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "auth",
        domain: { kind: "enum", values: ["guest", "user"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "guest",
      },
      ...template.vars,
    ],
    transitions: [
      {
        id: "login",
        cls: "user",
        label: { kind: "click", text: "Login" },
        source: [],
        guard: {
          kind: "eq",
          args: [
            { kind: "read", var: "auth" },
            { kind: "lit", value: "guest" },
          ],
        },
        effect: {
          kind: "assign",
          var: "auth",
          expr: { kind: "lit", value: "user" },
        },
        reads: ["auth"],
        writes: ["auth"],
        confidence: "exact",
      },
      ...template.transitions,
    ],
  };
}

describe("SWR template", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = swrSource();
    expect(plugin.id).toBe("swr");
    expect(plugin.packageNames).toEqual(["swr"]);
    expect(
      plugin.discover({ sourceText: "", fileName: "App.tsx", route: "/" }),
    ).toEqual([]);
    expect(
      plugin.writeChannels({ sourceText: "", fileName: "App.tsx" }),
    ).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe("swr>=2");
  });

  it("observes SWR data values through harness cache handles", () => {
    const handles = setup({ cache: new Map([["api_user", { id: "u1" }]]) });
    expect(observe("swr:api_user:data", handles)).toEqual({
      value: { id: "u1" },
    });
    expect(swrSource().harness.observe("swr:api_user:data", handles)).toEqual({
      value: { id: "u1" },
    });
  });

  it("falls back to initial model state for SWR observation", () => {
    expect(
      observe(
        "swr:api_user:error",
        setup({ initialState: { "swr:api_user:error": false } }),
      ),
    ).toEqual({ value: false });
    expect(observe("swr:missing:data", setup({}))).toBe("unobservable");
  });

  it("discovers useSWR call sites and instantiates template fragments through SPI", () => {
    const source = `
      import useSWR from 'swr';
      type Todo = { id: string };
      export function App() {
        const { data } = useSWR<Todo[]>('/api/todos', fetchTodos, { revalidateOnFocus: true });
        return data?.length;
      }
    `;
    const decls = swrSource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    expect(decls).toEqual([
      {
        id: "swr:api_todos",
        kind: "swr/useSWR",
        origin: { file: "App.tsx", line: 5, column: 26 },
        metadata: {
          key: "/api/todos",
          id: "api_todos",
          op: "GET /api/todos",
          payloadDomain: { kind: "lengthCat" },
          revalidateOnFocus: true,
        },
      },
    ]);
    const decl = decls[0];
    if (!decl) throw new Error("Expected discovered SWR declaration");
    const fragment = swrSource().template?.(decl, { route: "/" });
    expect(fragment?.vars.map((decl) => decl.id)).toEqual([
      "swr:api_todos:data",
      "swr:api_todos:isValidating",
      "swr:api_todos:error",
    ]);
    expect(fragment?.transitions.map((transition) => transition.id)).toContain(
      "swr:api_todos:focus-revalidate",
    );
  });

  it("uses the enclosing custom hook name as the SWR instance id", () => {
    const source = `
      import useSWR from 'swr';
      export function useDashboardSummary(selectedAccount: string) {
        return useSWR(["dashboard", selectedAccount], fetchSummary);
      }
    `;
    const decl = swrSource().discover({
      sourceText: source,
      fileName: "dashboard-queries.ts",
      route: "/",
    })[0];
    if (!decl) throw new Error("Expected discovered SWR declaration");

    expect(decl).toMatchObject({
      id: "swr:useDashboardSummary",
      metadata: {
        key: "dashboard:selectedAccount",
        id: "useDashboardSummary",
        op: "GET dashboard:selectedAccount",
      },
    });
    const fragment = swrSource().template?.(decl, { route: "/" });
    expect(fragment?.vars.map((decl) => decl.id)).toEqual([
      "swr:useDashboardSummary:data",
      "swr:useDashboardSummary:isValidating",
      "swr:useDashboardSummary:error",
    ]);
    expect(fragment?.transitions.map((transition) => transition.id)).toContain(
      "swr:useDashboardSummary:fetch",
    );
  });

  it("discovers read channels from custom SWR hook destructuring", () => {
    const source = `
      import { useApprovals } from './subscription-queries';
      export function ApprovalQueue() {
        const { data } = useApprovals();
        return data;
      }
    `;
    expect(
      swrSource().writeChannels({
        sourceText: source,
        fileName: "ApprovalQueue.tsx",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "swr:useApprovals.data.read",
          varId: "swr:useApprovals:data",
          symbolName: "data",
        }),
      ]),
    );
  });

  it("keeps key-derived ids for direct component useSWR calls", () => {
    const source = `
      import useSWR from 'swr';
      export function DashboardPage() {
        return useSWR(["dashboard", selectedAccount], fetchSummary).data;
      }
    `;
    const decl = swrSource().discover({
      sourceText: source,
      fileName: "dashboard.tsx",
      route: "/",
    })[0];
    if (!decl) throw new Error("Expected discovered SWR declaration");

    expect(decl).toMatchObject({
      id: "swr:dashboard_selectedAccount",
      metadata: { id: "dashboard_selectedAccount" },
    });
  });

  it("suffixes hook ids when one custom hook owns multiple SWR calls", () => {
    const source = `
      import useSWR from 'swr';
      export const useThing = () => {
        const x = useSWR(["thing", "x"], fetchX);
        const y = useSWR(["thing", "y"], fetchY);
        return { x, y };
      };
    `;
    const decls = swrSource().discover({
      sourceText: source,
      fileName: "thing.ts",
      route: "/",
    });

    expect(decls.map((decl) => decl.id)).toEqual([
      "swr:useThing_thing_x",
      "swr:useThing_thing_y",
    ]);
    expect(decls.map((decl) => decl.metadata.id)).toEqual([
      "useThing_thing_x",
      "useThing_thing_y",
    ]);
  });

  it("extracts conditional literal keys as guarded template declarations", () => {
    const source = `
      import { useSWR } from 'swr';
      export function App() {
        useSWR(isLoggedIn ? '/api/me' : null);
      }
    `;
    const decl = swrSource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    })[0];
    if (!decl) throw new Error("Expected discovered SWR declaration");
    expect(decl).toMatchObject({
      id: "swr:api_me",
      metadata: {
        activeWhen: { kind: "read", var: "isLoggedIn" },
      },
    });
    const fragment = swrSource().template?.(decl, { route: "/" });
    expect(fragment?.transitions[0]?.guard).toEqual({
      kind: "read",
      var: "isLoggedIn",
    });
  });

  it("extracts inverted conditional keys as inactive-branch guards", () => {
    const source = `
      import useSWR from 'swr';
      export function App() {
        useSWR(isPaused ? null : ['/api/search', query]);
      }
    `;
    const decl = swrSource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    })[0];
    if (!decl) throw new Error("Expected discovered SWR declaration");
    expect(decl).toMatchObject({
      id: "swr:api_search_query",
      metadata: {
        key: "/api/search:query",
        activeWhen: { kind: "not", args: [{ kind: "read", var: "isPaused" }] },
      },
    });
    const fragment = swrSource().template?.(decl, { route: "/" });
    expect(fragment?.transitions[0]?.guard).toEqual({
      kind: "not",
      args: [{ kind: "read", var: "isPaused" }],
    });
    expect(fragment?.transitions[0]?.reads).toEqual(["isPaused"]);
  });

  it("models loading, success data, and stale-data retention on error", () => {
    const m = model();
    const todosData = swrVarId("todos", "data");
    const todosValidating = swrVarId("todos", "isValidating");
    const todosError = swrVarId("todos", "error");
    const result = checkModel(m, [
      reachable(
        m,
        and(
          eq(readVar(todosData), lit(null)),
          eq(readVar(todosValidating), lit(true)),
        ),
        {
          name: "loadingReachable",
        },
      ),
      reachable(
        m,
        or(
          eq(readVar(todosData), lit("1")),
          eq(readVar(todosData), lit("many")),
        ),
        {
          name: "loadedSomeReachable",
        },
      ),
      reachable(
        m,
        and(
          or(
            eq(readVar(todosData), lit("1")),
            eq(readVar(todosData), lit("many")),
          ),
          eq(readVar(todosError), lit(true)),
        ),
        { name: "staleDataWithErrorReachable" },
      ),
      always(
        m,
        or(
          neq(readVar("auth"), lit("guest")),
          eq(readVar(todosValidating), lit(false)),
        ),
        { name: "inactiveGuestDoesNotFetch" },
      ),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
    expect(byName.get("loadingReachable")).toMatch(/^verified/);
    expect(byName.get("loadedSomeReachable")).toMatch(/^verified/);
    expect(byName.get("staleDataWithErrorReachable")).toMatch(/^verified/);
    expect(byName.get("inactiveGuestDoesNotFetch")).toBe(
      "verified-within-bounds",
    );
  });

  it("emits stable ids and active guard reads", () => {
    const template = createSwrTemplate({
      id: "user",
      op: "GET_USER",
      payloadDomain: { kind: "tokens", count: 1 },
      activeWhen: {
        kind: "eq",
        args: [
          { kind: "read", var: "session" },
          { kind: "lit", value: "present" },
        ],
      },
    });
    expect(template.vars.map((decl) => decl.id)).toEqual([
      "swr:user:data",
      "swr:user:isValidating",
      "swr:user:error",
    ]);
    expect(template.transitions[0]?.id).toBe("swr:user:fetch");
    expect(template.transitions[0]?.reads).toEqual(["session"]);
  });

  it("models opt-in focus revalidation and mutate API effects", () => {
    const template = createSwrTemplate({
      id: "todos",
      op: "GET_TODOS",
      payloadDomain: { kind: "lengthCat" },
      activeWhen: {
        kind: "eq",
        args: [
          { kind: "read", var: "auth" },
          { kind: "lit", value: "user" },
        ],
      },
      revalidateOnFocus: true,
      mutate: true,
    });
    expect(
      template.transitions.map((transition) => [
        transition.id,
        transition.label.kind,
      ]),
    ).toContainEqual(["swr:todos:focus-revalidate", "focus-revalidate"]);
    expect(template.transitions.map((transition) => transition.id)).toContain(
      "swr:todos:mutate:2",
    );

    const focus = template.transitions.find(
      (transition) => transition.id === "swr:todos:focus-revalidate",
    );
    expect(focus).toMatchObject({
      cls: "library",
      writes: ["swr:todos:isValidating", "sys:pending"],
    });
    const mutateMany = template.transitions.find(
      (transition) => transition.id === "swr:todos:mutate:2",
    );
    expect(mutateMany).toMatchObject({
      cls: "library",
      effect: {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: "swr:todos:data",
            expr: { kind: "lit", value: "many" },
          },
          {
            kind: "assign",
            var: "swr:todos:isValidating",
            expr: { kind: "lit", value: false },
          },
          {
            kind: "assign",
            var: "swr:todos:error",
            expr: { kind: "lit", value: false },
          },
        ],
      },
    });
  });

  it("instantiates isolated entries for a bounded key window", () => {
    const template = createSwrKeyWindowTemplate({
      id: "quote",
      op: "GET_QUOTE",
      payloadDomain: { kind: "lengthCat" },
      entries: [
        {
          id: "basic",
          activeWhen: {
            kind: "eq",
            args: [
              { kind: "read", var: "plan" },
              { kind: "lit", value: "basic" },
            ],
          },
        },
        {
          id: "pro",
          activeWhen: {
            kind: "eq",
            args: [
              { kind: "read", var: "plan" },
              { kind: "lit", value: "pro" },
            ],
          },
        },
        {
          id: "enterprise",
          activeWhen: {
            kind: "eq",
            args: [
              { kind: "read", var: "plan" },
              { kind: "lit", value: "enterprise" },
            ],
          },
        },
      ],
      windowSize: 2,
    });
    expect(template.vars.map((decl) => decl.id)).toEqual([
      "swr:quote:basic:data",
      "swr:quote:basic:isValidating",
      "swr:quote:basic:error",
      "swr:quote:pro:data",
      "swr:quote:pro:isValidating",
      "swr:quote:pro:error",
      "swr:quote:evicted:data",
      "swr:quote:evicted:isValidating",
      "swr:quote:evicted:error",
    ]);
    expect(
      template.transitions.map((transition) => transition.id),
    ).not.toContain("swr:quote:enterprise:fetch");
    const basicSuccess = template.transitions.find(
      (transition) => transition.id === "swr:quote:basic:resolve:success:2",
    );
    expect(basicSuccess?.writes).toContain("swr:quote:basic:data");
    expect(basicSuccess?.writes).not.toContain("swr:quote:pro:data");

    const state = {
      "swr:quote:basic:data": "many",
      "swr:quote:basic:isValidating": false,
      "swr:quote:basic:error": false,
      "swr:quote:pro:data": null,
      "swr:quote:pro:isValidating": false,
      "swr:quote:pro:error": false,
    };
    expect(swrWindowView(state, "quote", "basic").loadedSome).toBe(true);
    expect(swrWindowView(state, "quote", "pro").loadedSome).toBe(false);
  });

  it("keeps the current key and nearest previous keys in a bounded key window", () => {
    const template = createSwrKeyWindowTemplate({
      id: "quote",
      op: "GET_QUOTE",
      payloadDomain: { kind: "lengthCat" },
      entries: [
        { id: "basic" },
        { id: "pro" },
        { id: "enterprise" },
        { id: "vip" },
      ],
      currentKey: "enterprise",
      windowSize: 2,
    });
    expect(template.vars.map((decl) => decl.id)).toEqual([
      "swr:quote:pro:data",
      "swr:quote:pro:isValidating",
      "swr:quote:pro:error",
      "swr:quote:enterprise:data",
      "swr:quote:enterprise:isValidating",
      "swr:quote:enterprise:error",
      "swr:quote:evicted:data",
      "swr:quote:evicted:isValidating",
      "swr:quote:evicted:error",
    ]);
    expect(
      template.transitions.map((transition) => transition.id),
    ).not.toContain("swr:quote:basic:fetch");
    expect(
      template.transitions.map((transition) => transition.id),
    ).not.toContain("swr:quote:vip:fetch");

    const state = {
      "swr:quote:pro:data": "many",
      "swr:quote:pro:isValidating": false,
      "swr:quote:pro:error": false,
      "swr:quote:enterprise:data": null,
      "swr:quote:enterprise:isValidating": true,
      "swr:quote:enterprise:error": false,
    };
    expect(swrWindowView(state, "quote", "enterprise").isLoading).toBe(true);
    expect(swrWindowView(state, "quote", "enterprise").loadedSome).toBe(false);
    expect(swrWindowView(state, "quote", "pro").loadedSome).toBe(true);
  });

  it("keeps key-window mutate transitions isolated per entry", () => {
    const template = createSwrKeyWindowTemplate({
      id: "quote",
      op: "GET_QUOTE",
      payloadDomain: { kind: "lengthCat" },
      entries: [{ id: "basic" }, { id: "pro" }],
      mutate: true,
    });
    const basicMutate = template.transitions.find(
      (transition) => transition.id === "swr:quote:basic:mutate:2",
    );
    expect(basicMutate?.writes).toEqual([
      "swr:quote:basic:data",
      "swr:quote:basic:isValidating",
      "swr:quote:basic:error",
    ]);
    expect(basicMutate?.writes).not.toContain("swr:quote:pro:data");
  });

  it("adds an evicted summary entry for keys outside the bounded window", () => {
    const template = createSwrKeyWindowTemplate({
      id: "quote",
      op: "GET_QUOTE",
      payloadDomain: { kind: "lengthCat" },
      entries: [{ id: "basic" }, { id: "pro" }, { id: "enterprise" }],
      currentKey: "enterprise",
      windowSize: 2,
    });
    const evictedId = swrWindowEvictedSummaryId("quote");
    expect(template.vars.map((decl) => [decl.id, decl.initial])).toEqual(
      expect.arrayContaining([
        [`swr:${evictedId}:data`, [null, "0", "1", "many"]],
        [`swr:${evictedId}:isValidating`, false],
        [`swr:${evictedId}:error`, [false, true]],
      ]),
    );

    const state = {
      "swr:quote:pro:data": "0",
      "swr:quote:pro:isValidating": false,
      "swr:quote:pro:error": false,
      "swr:quote:enterprise:data": null,
      "swr:quote:enterprise:isValidating": false,
      "swr:quote:enterprise:error": false,
      "swr:quote:evicted:data": "many",
      "swr:quote:evicted:isValidating": false,
      "swr:quote:evicted:error": true,
    };
    expect(swrWindowView(state, "quote", "basic")).toMatchObject({
      data: "many",
      error: true,
      loadedSome: true,
    });
    expect(swrWindowView(state, "quote", "pro")).toMatchObject({
      data: "0",
      error: false,
      loadedEmpty: true,
    });
  });

  it("extracts simple mutate writes through the shared transition adapter", () => {
    const result = extractSwrSkeleton(
      `
      import useSWR from 'swr';
      export function App() {
        const { mutate } = useSWR<'empty' | 'full'>('/api/todos', fetcher);
        return <button onClick={() => mutate('full')}>Fill</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.Fill",
        effect: {
          kind: "assign",
          var: "swr:api_todos:data",
          expr: { kind: "lit", value: "full" },
        },
        writes: ["swr:api_todos:data"],
      }),
    );
  });

  it("places async mutate writes in modeled effect success continuations", () => {
    const result = extractSwrSkeleton(
      `
      import useSWR from 'swr';
      export function App() {
        const { mutate } = useSWR<'empty' | 'full'>('/api/todos', fetcher);
        return <button onClick={async () => {
          await api.refresh();
          mutate('empty');
        }}>Refresh</button>;
      }
      `,
      { route: "/", fileName: "App.tsx", effectApis: ["api.refresh"] },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.api.refresh.success",
        effect: expect.objectContaining({
          kind: "seq",
          effects: expect.arrayContaining([
            {
              kind: "assign",
              var: "swr:api_todos:data",
              expr: { kind: "lit", value: "empty" },
            },
          ]),
        }),
        writes: ["sys:pending", "swr:api_todos:data"],
      }),
    );
  });

  it("havocs SWR mutate writes inside loops through the shared transition adapter", () => {
    const result = extractSwrSkeleton(
      `
      import useSWR from 'swr';
      export function App() {
        const { mutate } = useSWR<'empty' | 'full'>('/api/todos', fetcher);
        return <button onClick={() => {
          for (const item of items) mutate(item.done ? 'full' : 'empty');
        }}>Loop</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.Loop.loop",
        effect: { kind: "havoc", var: "swr:api_todos:data" },
        writes: ["swr:api_todos:data"],
        confidence: "over-approx",
      }),
    );
  });

  it("unwraps TypeScript expression wrappers on SWR mutate arguments", () => {
    const result = extractSwrSkeleton(
      `
      import useSWR from 'swr';
      export function App() {
        const { mutate } = useSWR<'empty' | 'full'>('/api/todos', fetcher);
        return <button onClick={() => {
          mutate(('full' as const) satisfies 'empty' | 'full');
        }}>Fill</button>;
      }
      `,
      { route: "/", fileName: "App.tsx" },
    );
    expect(result.transitions).toContainEqual(
      expect.objectContaining({
        id: "App.onClick.Fill",
        effect: {
          kind: "assign",
          var: "swr:api_todos:data",
          expr: { kind: "lit", value: "full" },
        },
        writes: ["swr:api_todos:data"],
        confidence: "exact",
      }),
    );
  });

  it("recognizes useSWR through import aliases and local barrels", () => {
    const barrelPath = "/project/swr.ts";
    const appPath = "/project/App.tsx";
    const barrelText = `export { default as useSWR } from "swr";`;
    const source = `import { useSWR as useData } from "./swr.js";
export function App() {
  const { data } = useData('/api/todos', fetcher);
  return data?.length;
}`;
    const semanticProject = createSemanticProjectForTest([
      { path: barrelPath, text: barrelText },
      { path: appPath, text: source },
    ]);
    const types = {
      program: semanticProject.program,
      checker: semanticProject.checker,
      sourceFile: semanticProject.getSourceFile(appPath),
      getSourceFile: (name: string) => semanticProject.getSourceFile(name),
      canonicalFileName: (name: string) =>
        semanticProject.canonicalFileName(name),
      resolveModuleName: (specifier: string, containingFile: string) =>
        semanticProject.resolveModuleName(specifier, containingFile),
      symbolAt: (node: import("typescript").Node) =>
        semanticProject.symbolAt(node),
      aliasedSymbolAt: (node: import("typescript").Node) =>
        semanticProject.aliasedSymbolAt(node),
      symbolKey: (symbol: import("typescript").Symbol) =>
        semanticProject.symbolKey(symbol),
      localSymbolKey: (node: import("typescript").Node) =>
        semanticProject.localSymbolKey(node),
    };
    const decls = swrSource().discover({
      sourceText: source,
      fileName: appPath,
      route: "/",
      types,
    });
    expect(decls).toEqual([
      expect.objectContaining({
        id: "swr:api_todos",
        kind: "swr/useSWR",
      }),
    ]);
  });

  it("keeps syntax-only swr import fallback without semantic context", () => {
    const source = `
      import useSWR from 'swr';
      export function App() {
        const { data } = useSWR('/api/todos', fetcher);
        return data?.length;
      }
    `;
    expect(
      swrSource().discover({
        sourceText: source,
        fileName: "App.tsx",
        route: "/",
      }),
    ).toEqual([
      expect.objectContaining({ id: "swr:api_todos", kind: "swr/useSWR" }),
    ]);
  });
});
