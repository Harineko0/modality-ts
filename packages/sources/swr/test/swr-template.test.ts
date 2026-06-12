import { describe, expect, it } from "vitest";
import { checkModel } from "../../../checker/src/index.js";
import { always, reachable, type Model } from "@modality/kernel";
import { createSwrKeyWindowTemplate, createSwrTemplate, swrVarId, swrView, swrWindowView } from "../src/index.js";

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
});
