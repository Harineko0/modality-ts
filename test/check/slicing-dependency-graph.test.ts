import {
  buildModelDependencyGraph,
  computeStateSliceClosure,
  computeTargetedStepSliceClosure,
} from "../../src/check/slicing/dependency-graph.js";
import { routeMountScope } from "../../src/extract/engine/ts/routes.js";
import { lit, type Model } from "modality-ts/core";
import { describe, expect, it } from "vitest";

const bool = { kind: "bool" } as const;
const twoRoutes = {
  kind: "enum",
  values: ["/customer/home", "/other"],
} as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function routeLocalEconomyModel(): Model {
  const productValues = Array.from({ length: 32 }, (_, index) => `sku${index}`);
  const siblingIds = ["local:home.flag", "local:home.noise", "local:home.cart"];
  return {
    schemaVersion: 1,
    id: "route-local-economy",
    bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "sys:route",
        domain: twoRoutes,
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-current" },
        initial: "/customer/home",
      },
      {
        id: "domain:product.catalog",
        domain: { kind: "enum", values: productValues },
        origin: "system",
        scope: { kind: "global" },
        initial: "sku0",
      },
      {
        id: "local:home.focus",
        domain: bool,
        origin: "system",
        scope: routeMountScope("/customer/home"),
        initial: false,
      },
      ...siblingIds.map((id) => ({
        id,
        domain: bool,
        origin: "system" as const,
        scope: routeMountScope("/customer/home"),
        initial: false,
      })),
      {
        id: "sys:pending",
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
    ],
    transitions: [
      {
        id: "setFocus",
        cls: "user",
        label: { kind: "click", text: "Set focus" },
        source: [],
        guard: lit(true),
        effect: { kind: "assign", var: "local:home.focus", expr: lit(true) },
        reads: ["local:home.focus"],
        writes: ["local:home.focus"],
        confidence: "exact",
      },
      ...siblingIds.map((id) => ({
        id: `set:${id}`,
        cls: "user" as const,
        label: { kind: "click" as const, text: `Set ${id}` },
        source: [],
        guard: lit(true),
        effect: { kind: "assign" as const, var: id, expr: lit(true) },
        reads: [id],
        writes: [id],
        confidence: "exact" as const,
      })),
      {
        id: "submit",
        cls: "user",
        label: { kind: "submit", text: "Submit" },
        source: [],
        guard: lit(true),
        effect: {
          kind: "enqueue",
          queue: "sys:pending",
          op: "POST",
          continuation: "submit#1",
          args: {},
        },
        reads: [],
        writes: ["sys:pending"],
        confidence: "exact",
      },
    ],
  };
}

describe("dependency graph slicing", () => {
  it("indexes transitions and pending queue role vars once per model", () => {
    const model = routeLocalEconomyModel();
    const graph = buildModelDependencyGraph(model);
    expect(graph.pendingQueueVarIds).toEqual(new Set(["sys:pending"]));
    expect(graph.solePendingQueueVarId).toBe("sys:pending");
    expect(graph.transitionsByWrittenVar.get("local:home.focus")?.length).toBe(
      1,
    );
    expect(graph.mountLocalVars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining([
        "local:home.focus",
        "local:home.flag",
        "local:home.noise",
        "local:home.cart",
      ]),
    );
  });

  it("closes state reads without reverse mount-local sibling expansion", () => {
    const model = routeLocalEconomyModel();
    const graph = buildModelDependencyGraph(model);
    const closure = computeStateSliceClosure(graph, {
      propertyReads: ["local:home.focus"],
      enabledTransitionIds: [],
    });
    expect([...closure.neededVars].sort()).toEqual(
      expect.arrayContaining(["local:home.focus", "sys:route"]),
    );
    expect([...closure.neededVars]).not.toEqual(
      expect.arrayContaining([
        "local:home.flag",
        "local:home.noise",
        "local:home.cart",
        "domain:product.catalog",
        "sys:pending",
      ]),
    );
    expect([...closure.neededTransitions]).toEqual(["setFocus"]);
    expect(closure.mountScopeDependencies).toEqual([
      {
        varId: "local:home.focus",
        guardReads: ["sys:route"],
        retainedBecause: ["property-read"],
      },
    ]);
  });

  it("does not reverse-expand route-local siblings from guard-var property reads", () => {
    const model = routeLocalEconomyModel();
    const graph = buildModelDependencyGraph(model);
    const closure = computeStateSliceClosure(graph, {
      propertyReads: ["sys:route"],
      enabledTransitionIds: [],
    });
    expect([...closure.neededVars]).toEqual(["sys:route"]);
    expect([...closure.neededTransitions]).toEqual([]);
    expect(closure.mountScopeDependencies).toEqual([]);
  });

  it("keeps pending queue vars out of unrelated targeted-step closure", () => {
    const model = routeLocalEconomyModel();
    const graph = buildModelDependencyGraph(model);
    const closure = computeTargetedStepSliceClosure(graph, {
      propertyReads: ["local:home.focus"],
      preconditionReads: [],
      postconditionReads: [],
      postMentionedVars: [],
      stepFactVars: [],
      enabledTransitionIds: ["setFocus"],
      targetTransitionIds: ["setFocus"],
    });
    expect([...closure.executionVars]).not.toContain("sys:pending");
    expect([...closure.neededTransitions]).toEqual(["setFocus"]);
  });
});
