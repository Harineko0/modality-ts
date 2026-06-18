import { describe, expect, it } from "vitest";
import { validateModel, type ExprIR, type Model } from "modality-ts/core";

function baseModel(
  countDomain: Model["vars"][number]["domain"],
  guard: ExprIR,
  assignExpr: ExprIR,
): Model {
  const route = { kind: "enum", values: ["/"] } as const;
  const pendingOp = {
    kind: "record",
    fields: {
      opId: { kind: "enum", values: ["noop"] },
      continuation: { kind: "enum", values: ["noop"] },
      args: { kind: "record", fields: {} },
    },
  } as const;
  return {
    schemaVersion: 1,
    id: "numeric-fixture",
    bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
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
        domain: { kind: "boundedList", inner: route, maxLen: 0 },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "count",
        domain: countDomain,
        origin: "system",
        scope: { kind: "global" },
        initial: 0,
      },
    ],
    transitions: [
      {
        id: "inc",
        cls: "user",
        label: { kind: "click", text: "inc" },
        source: [],
        guard,
        effect: { kind: "assign", var: "count", expr: assignExpr },
        reads: ["count"],
        writes: ["count"],
        confidence: "exact",
      },
    ],
  };
}

describe("numeric IR validation", () => {
  it("accepts comparison guards on numeric domains", () => {
    const model = baseModel(
      { kind: "boundedInt", min: 0, max: 3 },
      {
        kind: "lt",
        args: [
          { kind: "read", var: "count" },
          { kind: "lit", value: 3 },
        ],
      },
      {
        kind: "add",
        args: [
          { kind: "read", var: "count" },
          { kind: "lit", value: 1 },
        ],
      },
    );
    expect(validateModel(model).ok).toBe(true);
  });

  it("accepts arithmetic assignment without rejecting reachable overflow", () => {
    const model = baseModel(
      { kind: "boundedInt", min: 0, max: 3, overflow: "forbid" },
      { kind: "lit", value: true },
      {
        kind: "add",
        args: [
          { kind: "read", var: "count" },
          { kind: "lit", value: 1 },
        ],
      },
    );
    const result = validateModel(model);
    expect(result.ok).toBe(true);
    expect(result.errors).not.toContainEqual(
      expect.stringContaining("expects int(0,3) but got"),
    );
  });

  it("rejects arithmetic on non-numeric domains", () => {
    const model = baseModel(
      { kind: "bool" },
      { kind: "lit", value: true },
      {
        kind: "add",
        args: [
          { kind: "read", var: "count" },
          { kind: "lit", value: 1 },
        ],
      },
    );
    const result = validateModel(model);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("add expects numeric")),
    ).toBe(true);
  });

  it("rejects numeric comparison results in boolean contexts", () => {
    const comparison: ExprIR = {
      kind: "lt",
      args: [
        { kind: "read", var: "count" },
        { kind: "lit", value: 3 },
      ],
    };
    const model = baseModel(
      { kind: "boundedInt", min: 0, max: 3 },
      comparison,
      {
        kind: "add",
        args: [comparison, { kind: "lit", value: 1 }],
      },
    );
    const result = validateModel(model);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) => error.includes("add expects numeric")),
    ).toBe(true);
  });

  it("rejects non-numeric assignment to numeric vars", () => {
    const model = baseModel(
      { kind: "intSet", values: [0, 2] },
      { kind: "lit", value: true },
      { kind: "lit", value: true },
    );
    const result = validateModel(model);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes("expects a numeric expression"),
      ),
    ).toBe(true);
  });

  it("rejects comparison operands that are not numeric", () => {
    const model = baseModel(
      { kind: "boundedInt", min: 0, max: 3 },
      {
        kind: "lt",
        args: [
          { kind: "read", var: "count" },
          { kind: "lit", value: true },
        ],
      },
      { kind: "read", var: "count" },
    );
    const result = validateModel(model);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((error) =>
        error.includes("lt expects numeric right operand"),
      ),
    ).toBe(true);
  });
});
