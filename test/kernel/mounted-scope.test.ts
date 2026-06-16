import { checkModel, sliceModel } from "modality-ts/check";
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
      initial: [],
    },
  ];
}

function read(id: string) {
  return { kind: "read" as const, var: id };
}

describe("mounted scopes", () => {
  it("keeps route-local models valid", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "route-local-compat",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        ...systemVars(),
        {
          id: "local:panel",
          domain: { kind: "bool" },
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
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
