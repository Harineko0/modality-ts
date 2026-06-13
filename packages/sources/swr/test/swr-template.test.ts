import { describe, expect, it } from "vitest";
import { checkModel } from "../../../checker/src/index.js";
import { always, reachable, type Model } from "modality-ts/kernel";
import { createSwrKeyWindowTemplate, createSwrTemplate, discoverSwrHooks, swrSource, swrVarId, swrView, swrWindowView } from "../src/index.js";
import { observe, setup } from "../src/harness.js";

const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["GET_TODOS"] },
    continuation: { kind: "enum", values: ["swr:todos:resolve"] },
    args: { kind: "record", fields: {} }
  }
} as const;

function model(): Model {
  const template = createSwrTemplate({
    id: "todos",
    op: "GET_TODOS",
    payloadDomain: { kind: "lengthCat" },
    activeWhen: { kind: "eq", args: [{ kind: "read", var: "auth" }, { kind: "lit", value: "user" }] }
  });
  return {
    schemaVersion: 1,
    id: "swr-template-fixture",
    bounds: { maxDepth: 5, maxPending: 2, maxInternalSteps: 4 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 2 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "auth", domain: { kind: "enum", values: ["guest", "user"] }, origin: "system", scope: { kind: "global" }, initial: "guest" },
      ...template.vars
    ],
    transitions: [
      {
        id: "login",
        cls: "user",
        label: { kind: "click", text: "Login" },
        source: [],
        guard: { kind: "eq", args: [{ kind: "read", var: "auth" }, { kind: "lit", value: "guest" }] },
        effect: { kind: "assign", var: "auth", expr: { kind: "lit", value: "user" } },
        reads: ["auth"],
        writes: ["auth"],
        confidence: "exact"
      },
      ...template.transitions
    ]
  };
}

describe("SWR template", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = swrSource();
    expect(plugin.id).toBe("swr");
    expect(plugin.packageNames).toEqual(["swr"]);
    expect(plugin.discover({ sourceText: "", fileName: "App.tsx", route: "/" })).toEqual([]);
    expect(plugin.writeChannels({ sourceText: "", fileName: "App.tsx" })).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe("swr>=2");
  });

  it("observes SWR data values through harness cache handles", () => {
    const handles = setup({ cache: new Map([["api_user", { id: "u1" }]]) });
    expect(observe("swr:api_user:data", handles)).toEqual({ value: { id: "u1" } });
    expect(swrSource().harness.observe("swr:api_user:data", handles)).toEqual({ value: { id: "u1" } });
  });

  it("falls back to initial model state for SWR observation", () => {
    expect(observe("swr:api_user:error", setup({ initialState: { "swr:api_user:error": false } }))).toEqual({ value: false });
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
    const decls = discoverSwrHooks(source, "App.tsx");
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
          revalidateOnFocus: true
        }
      }
    ]);
    const fragment = swrSource().template?.(decls[0]!, { route: "/" });
    expect(fragment?.vars.map((decl) => decl.id)).toEqual(["swr:api_todos:data", "swr:api_todos:isValidating", "swr:api_todos:error"]);
    expect(fragment?.transitions.map((transition) => transition.id)).toContain("swr:api_todos:focus-revalidate");
  });

  it("extracts conditional literal keys as guarded template declarations", () => {
    const source = `
      import { useSWR } from 'swr';
      export function App() {
        useSWR(isLoggedIn ? '/api/me' : null);
      }
    `;
    const decl = discoverSwrHooks(source, "App.tsx")[0];
    expect(decl).toMatchObject({
      id: "swr:api_me",
      metadata: {
        activeWhen: { kind: "read", var: "isLoggedIn" }
      }
    });
    const fragment = swrSource().template?.(decl!, { route: "/" });
    expect(fragment?.transitions[0]?.guard).toEqual({ kind: "read", var: "isLoggedIn" });
  });

  it("models loading, success data, and stale-data retention on error", () => {
    const m = model();
    const result = checkModel(m, [
      reachable(m, (s) => swrView(s, "todos").isLoading, { name: "loadingReachable" }),
      reachable(m, (s) => swrView(s, "todos").loadedSome, { name: "loadedSomeReachable" }),
      reachable(m, (s) => swrView(s, "todos").loadedSome && swrView(s, "todos").error, { name: "staleDataWithErrorReachable" }),
      always(m, (s) => s.auth !== "guest" || s[swrVarId("todos", "isValidating")] === false, { name: "inactiveGuestDoesNotFetch" })
    ]);
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict.status]));
    expect(byName.get("loadingReachable")).toBe("reachable");
    expect(byName.get("loadedSomeReachable")).toBe("reachable");
    expect(byName.get("staleDataWithErrorReachable")).toBe("reachable");
    expect(byName.get("inactiveGuestDoesNotFetch")).toBe("verified-within-bounds");
  });

  it("emits stable ids and active guard reads", () => {
    const template = createSwrTemplate({
      id: "user",
      op: "GET_USER",
      payloadDomain: { kind: "tokens", count: 1 },
      activeWhen: { kind: "eq", args: [{ kind: "read", var: "session" }, { kind: "lit", value: "present" }] }
    });
    expect(template.vars.map((decl) => decl.id)).toEqual(["swr:user:data", "swr:user:isValidating", "swr:user:error"]);
    expect(template.transitions[0]?.id).toBe("swr:user:fetch");
    expect(template.transitions[0]?.reads).toEqual(["session"]);
  });

  it("models opt-in focus revalidation and mutate API effects", () => {
    const template = createSwrTemplate({
      id: "todos",
      op: "GET_TODOS",
      payloadDomain: { kind: "lengthCat" },
      activeWhen: { kind: "eq", args: [{ kind: "read", var: "auth" }, { kind: "lit", value: "user" }] },
      revalidateOnFocus: true,
      mutate: true
    });
    expect(template.transitions.map((transition) => [transition.id, transition.label.kind])).toContainEqual(["swr:todos:focus-revalidate", "focus-revalidate"]);
    expect(template.transitions.map((transition) => transition.id)).toContain("swr:todos:mutate:2");

    const focus = template.transitions.find((transition) => transition.id === "swr:todos:focus-revalidate");
    expect(focus).toMatchObject({
      cls: "library",
      writes: ["swr:todos:isValidating", "sys:pending"]
    });
    const mutateMany = template.transitions.find((transition) => transition.id === "swr:todos:mutate:2");
    expect(mutateMany).toMatchObject({
      cls: "library",
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: "swr:todos:data", expr: { kind: "lit", value: "many" } },
          { kind: "assign", var: "swr:todos:isValidating", expr: { kind: "lit", value: false } },
          { kind: "assign", var: "swr:todos:error", expr: { kind: "lit", value: false } }
        ]
      }
    });
  });

  it("instantiates isolated entries for a bounded key window", () => {
    const template = createSwrKeyWindowTemplate({
      id: "quote",
      op: "GET_QUOTE",
      payloadDomain: { kind: "lengthCat" },
      entries: [
        { id: "basic", activeWhen: { kind: "eq", args: [{ kind: "read", var: "plan" }, { kind: "lit", value: "basic" }] } },
        { id: "pro", activeWhen: { kind: "eq", args: [{ kind: "read", var: "plan" }, { kind: "lit", value: "pro" }] } },
        { id: "enterprise", activeWhen: { kind: "eq", args: [{ kind: "read", var: "plan" }, { kind: "lit", value: "enterprise" }] } }
      ],
      windowSize: 2
    });
    expect(template.vars.map((decl) => decl.id)).toEqual([
      "swr:quote:basic:data",
      "swr:quote:basic:isValidating",
      "swr:quote:basic:error",
      "swr:quote:pro:data",
      "swr:quote:pro:isValidating",
      "swr:quote:pro:error"
    ]);
    expect(template.transitions.map((transition) => transition.id)).not.toContain("swr:quote:enterprise:fetch");
    const basicSuccess = template.transitions.find((transition) => transition.id === "swr:quote:basic:resolve:success:2");
    expect(basicSuccess?.writes).toContain("swr:quote:basic:data");
    expect(basicSuccess?.writes).not.toContain("swr:quote:pro:data");

    const state = {
      "swr:quote:basic:data": "many",
      "swr:quote:basic:isValidating": false,
      "swr:quote:basic:error": false,
      "swr:quote:pro:data": null,
      "swr:quote:pro:isValidating": false,
      "swr:quote:pro:error": false
    };
    expect(swrWindowView(state, "quote", "basic").loadedSome).toBe(true);
    expect(swrWindowView(state, "quote", "pro").loadedSome).toBe(false);
  });

  it("keeps key-window mutate transitions isolated per entry", () => {
    const template = createSwrKeyWindowTemplate({
      id: "quote",
      op: "GET_QUOTE",
      payloadDomain: { kind: "lengthCat" },
      entries: [{ id: "basic" }, { id: "pro" }],
      mutate: true
    });
    const basicMutate = template.transitions.find((transition) => transition.id === "swr:quote:basic:mutate:2");
    expect(basicMutate?.writes).toEqual(["swr:quote:basic:data", "swr:quote:basic:isValidating", "swr:quote:basic:error"]);
    expect(basicMutate?.writes).not.toContain("swr:quote:pro:data");
  });
});
