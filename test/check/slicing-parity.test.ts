import {
  checkModel,
  sliceModel,
  sliceModelForCheckProperty,
} from "modality-ts/check";
import { routeMountScope } from "../../src/extract/engine/ts/routes.js";
import {
  always,
  alwaysStep,
  enabled,
  eq,
  lit,
  notExpr,
  readVar,
  reachable,
  stepChangedTo,
  stepEnqueued,
  stepTransitionId,
  type Model,
} from "modality-ts/core";
import { describe, expect, it } from "vitest";

const bool = { kind: "bool" } as const;
const twoRoutes = { kind: "enum", values: ["/a", "/b"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function read(id: string) {
  return { kind: "read" as const, var: id };
}

function mountScope(route: string) {
  return {
    kind: "mount-local" as const,
    id: `route:${route}`,
    when: {
      kind: "eq" as const,
      args: [read("app:location"), lit(route)],
    },
  };
}

describe("neutral slicing parity", () => {
  it("includes changed and changedTo vars from step facts", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "changed-facts",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "app:location",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "mark",
          cls: "user",
          label: { kind: "click", text: "Mark" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
          reads: ["draft"],
          writes: ["draft"],
          confidence: "exact",
        },
      ],
    };
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: {
          ...stepTransitionId("mark"),
          ...stepChangedTo("draft", "nonEmpty"),
        },
        post: eq(readVar("app:location"), lit("/a")),
      },
      { name: "markChangedDraft", reads: ["app:location"] },
    );
    const sliced = sliceModelForCheckProperty(m, property).model;
    expect(sliced.vars.map((decl) => decl.id)).toContain("draft");
  });

  it("includes pending queue role vars for step facts", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "pending-role-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "app:asyncQueue",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "pending-queue" },
          initial: [],
        },
        {
          id: "draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "enqueue",
            queue: "app:asyncQueue",
            op: "POST",
            continuation: "submit#1",
            args: {},
          },
          reads: [],
          writes: ["app:asyncQueue"],
          confidence: "exact",
        },
      ],
    };
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: { ...stepTransitionId("submit"), ...stepEnqueued("POST") },
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      { name: "submitEnqueue", reads: ["draft"] },
    );
    const sliced = sliceModelForCheckProperty(m, property).model;
    expect(sliced.vars.map((decl) => decl.id)).toContain("app:asyncQueue");
  });

  it("prunes sibling route-local vars sharing the same mount guard", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-sibling-prune",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "local:a.flag",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
        {
          id: "local:a.noise",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
        {
          id: "local:a.wide",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
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
          id: "setFlag",
          cls: "user",
          label: { kind: "click", text: "Set flag" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "local:a.flag", expr: lit(true) },
          reads: ["local:a.flag"],
          writes: ["local:a.flag"],
          confidence: "exact",
        },
        {
          id: "setNoise",
          cls: "user",
          label: { kind: "click", text: "Set noise" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "local:a.noise", expr: lit(true) },
          reads: ["local:a.noise"],
          writes: ["local:a.noise"],
          confidence: "exact",
        },
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
    const { model: sliced, diagnostics } = sliceModelForCheckProperty(m, {
      kind: "always",
      name: "flagSet",
      predicate: eq(readVar("local:a.flag"), lit(true)),
      reads: ["local:a.flag"],
    });
    const varIds = sliced.vars.map((decl) => decl.id);
    expect(varIds).toEqual(expect.arrayContaining(["local:a.flag", "sys:route"]));
    expect(varIds).not.toEqual(
      expect.arrayContaining(["local:a.noise", "local:a.wide", "sys:pending"]),
    );
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "setFlag",
    ]);
    expect(
      sliced.transitions.every(
        (transition) => transition.effect.kind !== "enqueue",
      ),
    ).toBe(true);
    expect(diagnostics?.mountScopeDependencies).toEqual([
      {
        varId: "local:a.flag",
        guardReads: ["sys:route"],
        retainedBecause: ["property-read"],
      },
    ]);
  });

  it("includes mount guard vars for touched mount-local vars", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "mount-guard-slice",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "app:location",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
        {
          id: "local:panel",
          domain: bool,
          origin: "system",
          scope: mountScope("/a"),
          initial: false,
        },
      ],
      transitions: [],
    };
    const sliced = sliceModel(m, ["local:panel"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining(["local:panel", "app:location"]),
    );
  });

  it("does not pull route vars for transitionEnabled without route dependency", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-no-location",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "app:location",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          role: { kind: "location-current" },
          initial: "/a",
        },
      ],
      transitions: [
        {
          id: "toggle",
          cls: "user",
          label: { kind: "click", text: "Toggle" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "flag", expr: lit(true) },
          reads: ["flag"],
          writes: ["flag"],
          confidence: "exact",
        },
      ],
    };
    const property = always(m, notExpr(enabled(m, "toggle")), {
      name: "toggleUnavailable",
      reads: [],
    });
    const sliced = sliceModel(m, property.reads ?? []);
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("app:location");
  });

  it("drops unrelated tree cache and environment vars from slices", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "noise-vars",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "needed",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "sys:tree",
          domain: { kind: "enum", values: ["cold", "warm"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "cold",
        },
        {
          id: "sys:cache",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "sys:environment",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "writer",
          cls: "user",
          label: { kind: "click", text: "Write" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "needed", expr: lit(true) },
          reads: ["needed"],
          writes: ["needed"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["needed"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(["needed"]);
    expect(sliced.vars.map((decl) => decl.id)).not.toEqual(
      expect.arrayContaining(["sys:tree", "sys:cache", "sys:environment"]),
    );
  });

  it("checks commit ordinal internal stabilization without route-specific vars", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "commit-ordinal",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: true,
        },
        {
          id: "value",
          domain: { kind: "enum", values: ["none", "a", "b"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "none",
        },
      ],
      transitions: [
        {
          id: "internal:setA",
          cls: "internal",
          label: { kind: "internal", text: "set a" },
          source: [],
          guard: {
            kind: "and",
            args: [
              read("flag"),
              { kind: "eq", args: [read("value"), lit("none")] },
            ],
          },
          effect: { kind: "assign", var: "value", expr: lit("a") },
          reads: ["flag", "value"],
          writes: ["value"],
          phase: 0,
          confidence: "exact",
        },
        {
          id: "internal:setB",
          cls: "internal",
          label: { kind: "internal", text: "set b" },
          source: [],
          guard: {
            kind: "and",
            args: [
              read("flag"),
              { kind: "eq", args: [read("value"), lit("none")] },
            ],
          },
          effect: { kind: "assign", var: "value", expr: lit("b") },
          reads: ["flag", "value"],
          writes: ["value"],
          phase: 1,
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, eq(readVar("value"), lit("a")), {
        name: "ordinalA",
        reads: ["value"],
      }),
    ]);
    expect(result.verdicts[0]?.status).toBe("reachable");
    const sliced = sliceModel(m, ["value"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining(["flag", "value"]),
    );
  });
});
