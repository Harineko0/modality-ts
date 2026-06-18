import { describe, expect, it } from "vitest";
import { checkModel } from "modality-ts/check";
import type { Model } from "modality-ts/core";

function countModel(effect: Model["transitions"][number]["effect"]): Model {
  return {
    schemaVersion: 1,
    id: "batch",
    bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
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
          maxLen: 0,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: {
          kind: "boundedList",
          inner: { kind: "record", fields: {} },
          maxLen: 0,
        },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "count",
        domain: { kind: "boundedInt", min: 0, max: 3 },
        origin: "system",
        scope: { kind: "global" },
        initial: 0,
      },
    ],
    transitions: [
      {
        id: "batch",
        cls: "user",
        label: { kind: "click" },
        source: [],
        guard: { kind: "lit", value: true },
        effect,
        reads: ["count"],
        writes: ["count"],
        confidence: "exact",
      },
    ],
  };
}

describe("batching snapshot checker", () => {
  it("direct readPre batch applies once from frozen snapshot", () => {
    const model = countModel({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: "count",
          expr: {
            kind: "cond",
            args: [
              {
                kind: "eq",
                args: [
                  { kind: "readPre", var: "count" },
                  { kind: "lit", value: 0 },
                ],
              },
              { kind: "lit", value: 1 },
              { kind: "readPre", var: "count" },
            ],
          },
        },
        {
          kind: "assign",
          var: "count",
          expr: {
            kind: "cond",
            args: [
              {
                kind: "eq",
                args: [
                  { kind: "readPre", var: "count" },
                  { kind: "lit", value: 0 },
                ],
              },
              { kind: "lit", value: 1 },
              { kind: "readPre", var: "count" },
            ],
          },
        },
      ],
    });
    const result = checkModel(model, []);
    expect(result.stats.states).toBe(2);
  });

  it("functional read batch chains twice", () => {
    const model = countModel({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: "count",
          expr: {
            kind: "cond",
            args: [
              {
                kind: "eq",
                args: [
                  { kind: "read", var: "count" },
                  { kind: "lit", value: 0 },
                ],
              },
              { kind: "lit", value: 1 },
              { kind: "read", var: "count" },
            ],
          },
        },
        {
          kind: "assign",
          var: "count",
          expr: {
            kind: "cond",
            args: [
              {
                kind: "eq",
                args: [
                  { kind: "read", var: "count" },
                  { kind: "lit", value: 1 },
                ],
              },
              { kind: "lit", value: 2 },
              { kind: "read", var: "count" },
            ],
          },
        },
      ],
    });
    const result = checkModel(model, []);
    expect(result.stats.states).toBe(2);
  });
});
