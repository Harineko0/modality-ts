import {
  checkModel,
  sliceModel,
  sliceModelForCheckProperty,
} from "modality-ts/check";
import { routeMountScope } from "../../src/extract/engine/ts/routes.js";
import {
  always,
  enabled,
  eq,
  lit,
  mountGuardForScope,
  orExpr,
  reachable,
  readVar,
  UNMOUNTED,
  validateModel,
  type Model,
} from "modality-ts/core";
import { describe, expect, it } from "vitest";

const twoRoutes = { kind: "enum", values: ["/a", "/b"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function systemVars(routeInitial = "/a"): Model["vars"] {
  return [
    {
      id: "sys:route",
      domain: twoRoutes,
      origin: "system",
      scope: { kind: "global" },
      initial: routeInitial,
    },
    {
      id: "sys:history",
      domain: { kind: "boundedList", inner: twoRoutes, maxLen: 2 },
      origin: "system",
      scope: { kind: "global" },
      initial: [],
    },
    {
      id: "sys:pending",
      domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
      origin: "system",
      scope: { kind: "global" },
      role: { kind: "pending-queue" },
      initial: [],
    },
  ];
}

function read(id: string) {
  return { kind: "read" as const, var: id };
}

describe("mounted scopes", () => {
  it("accepts route mount-local guards derived from extraction", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "route-mount-local",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
      ],
      transitions: [],
    };
    expect(validateModel(model)).toEqual({ ok: true, errors: [] });
    expect(mountGuardForScope(model.vars[3].scope)).toEqual({
      kind: "eq",
      args: [read("sys:route"), { kind: "lit", value: "/a" }],
    });
  });

  it("validates mount-local when as boolean and rejects self-reference", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "mount-local",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "sys:slotA",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: {
              kind: "eq",
              args: [read("sys:slotA"), { kind: "lit", value: true }],
            },
          },
          initial: false,
        },
      ],
      transitions: [],
    };
    expect(validateModel(model)).toEqual({ ok: true, errors: [] });

    const selfRef: Model = {
      ...model,
      vars: [
        ...model.vars.slice(0, -1),
        {
          ...model.vars[4],
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: {
              kind: "eq",
              args: [read("local:panel"), { kind: "lit", value: true }],
            },
          },
        },
      ],
    };
    expect(validateModel(selfRef).errors.join("\n")).toContain(
      "mount-local when must not read the scoped var itself",
    );
  });

  it("rejects mount-local guards that read unknown vars or are non-boolean", () => {
    const base: Model = {
      schemaVersion: 1,
      id: "mount-local-guard-validation",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: {
              kind: "eq",
              args: [read("sys:missing"), { kind: "lit", value: true }],
            },
          },
          initial: false,
        },
      ],
      transitions: [],
    };
    expect(validateModel(base).errors.join("\n")).toContain(
      "expression reads unknown var sys:missing",
    );

    const nonBoolean: Model = {
      ...base,
      vars: [
        ...base.vars.slice(0, -1),
        {
          ...base.vars[3],
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: { kind: "read", var: "sys:route" },
          },
        },
      ],
    };
    expect(validateModel(nonBoolean).errors.join("\n")).toContain(
      "mount-local when must be boolean",
    );
  });

  it("slices mount-local deps from when reads", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "mount-local-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "sys:slotA",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: {
              kind: "eq",
              args: [read("sys:slotA"), { kind: "lit", value: true }],
            },
          },
          initial: false,
        },
      ],
      transitions: [],
    };
    const sliced = sliceModel(model, ["local:panel"]);
    expect(sliced.vars.map((decl) => decl.id).sort()).toEqual([
      "local:panel",
      "sys:slotA",
    ]);
  });

  it("retains only required mount guard vars for mount-local property reads", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "mount-local-guard-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
      ],
      transitions: [],
    };
    const { model: sliced, diagnostics } = sliceModelForCheckProperty(model, {
      kind: "reachable",
      name: "panelReachable",
      predicate: eq(readVar("local:panel"), lit(true)),
      reads: ["local:panel"],
    });
    expect(sliced.vars.map((decl) => decl.id).sort()).toEqual([
      "local:panel",
      "sys:route",
    ]);
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("sys:history");
    expect(diagnostics?.mountScopeDependencies).toEqual([
      {
        varId: "local:panel",
        guardReads: ["sys:route"],
        retainedBecause: ["property-read"],
      },
    ]);
  });

  it("does not retain route-local siblings when only a shared guard var is read", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "mount-local-guard-reverse",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "sys:slotA",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
        {
          id: "local:slotPanel",
          domain: { kind: "bool" },
          origin: "system",
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: {
              kind: "eq",
              args: [read("sys:slotA"), { kind: "lit", value: true }],
            },
          },
          initial: false,
        },
      ],
      transitions: [],
    };
    const { model: sliced } = sliceModelForCheckProperty(model, {
      kind: "always",
      name: "onRouteA",
      predicate: eq(readVar("sys:route"), lit("/a")),
      reads: ["sys:route"],
    });
    expect(sliced.vars.map((decl) => decl.id).sort()).toEqual(["sys:route"]);
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("local:panel");
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("local:slotPanel");
  });

  it("includes mountScopeDependencies in sliced check diagnostics", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "mount-local-check-diagnostics",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: routeMountScope("/a"),
          initial: false,
        },
      ],
      transitions: [],
    };
    const result = checkModel(
      model,
      [
        reachable(model, eq(readVar("local:panel"), lit(true)), {
          name: "panelReachable",
          reads: ["local:panel"],
        }),
      ],
      { slicing: true },
    );
    const summary = result.diagnostics?.slicing?.sliceSummaries?.[0];
    expect(summary?.mountScopeDependencies).toEqual([
      {
        varId: "local:panel",
        guardReads: ["sys:route"],
        retainedBecause: ["property-read"],
      },
    ]);
    expect(summary?.retainedSystemVars).toEqual(
      expect.arrayContaining(["sys:route"]),
    );
    expect(summary?.prunedSystemVars).toEqual(
      expect.arrayContaining(["sys:history", "sys:pending"]),
    );
  });

  it("resets mount-local state on activation and disables off-mount transitions", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "mount-local-check",
      bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "sys:slotA",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "local:panel",
          domain: { kind: "enum", values: ["off", "on"] },
          origin: "system",
          scope: {
            kind: "mount-local",
            id: "slot-a",
            when: {
              kind: "eq",
              args: [read("sys:slotA"), { kind: "lit", value: true }],
            },
          },
          initial: "off",
        },
      ],
      transitions: [
        {
          id: "enableSlot",
          cls: "user",
          label: { kind: "click", text: "Enable" },
          source: [],
          guard: { kind: "not", args: [read("sys:slotA")] },
          effect: {
            kind: "assign",
            var: "sys:slotA",
            expr: { kind: "lit", value: true },
          },
          reads: ["sys:slotA"],
          writes: ["sys:slotA"],
          confidence: "exact",
        },
        {
          id: "turnOn",
          cls: "user",
          label: { kind: "click", text: "On" },
          source: [],
          guard: { kind: "eq", args: [read("local:panel"), lit("off")] },
          effect: {
            kind: "assign",
            var: "local:panel",
            expr: lit("on"),
          },
          reads: ["local:panel"],
          writes: ["local:panel"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(model, [
      always(
        model,
        orExpr(
          eq(readVar("sys:slotA"), lit(true)),
          eq(readVar("local:panel"), lit(UNMOUNTED)),
        ),
        { name: "unmountedWhenSlotOff" },
      ),
      always(
        model,
        orExpr(
          eq(readVar("sys:slotA"), lit(true)),
          eq(enabled(model, "turnOn"), lit(false)),
        ),
        { name: "turnOnDisabledWhenUnmounted" },
      ),
      reachable(model, eq(readVar("local:panel"), lit("off")), {
        name: "panelInitializesOnActivation",
        reads: ["local:panel"],
      }),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
    expect(byName.get("unmountedWhenSlotOff")).toBe("verified-within-bounds");
    expect(byName.get("turnOnDisabledWhenUnmounted")).toBe(
      "verified-within-bounds",
    );
    expect(byName.get("panelInitializesOnActivation")).toBe("reachable");
  });
});
