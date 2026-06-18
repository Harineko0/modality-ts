import type { Model, ModelState } from "modality-ts/core";

const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function lit(value: string | boolean) {
  return { kind: "lit" as const, value };
}

function read(id: string, path?: string[]) {
  return { kind: "read" as const, var: id, path };
}

export interface CheckerOracleCase {
  name: string;
  model: Model;
  stats: { states: number; edges: number; depth: number };
  reachable: readonly Partial<ModelState>[];
  unreachable: readonly Partial<ModelState>[];
  boundedResponse: {
    triggerOp: string;
    goalVar: string;
    budget: { environment: number };
    status: "verified-within-bounds" | "violated";
  };
}

export function checkerOracleCorpus(): CheckerOracleCase[] {
  return [
    {
      name: "submit-settles-oracle",
      model: {
        schemaVersion: 1,
        id: "submit-settles-oracle",
        bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
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
            domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 },
            origin: "system",
            scope: { kind: "global" },
            role: { kind: "pending-queue" },
            initial: [],
          },
          {
            id: "phase",
            domain: { kind: "enum", values: ["idle", "pending", "done"] },
            origin: "system",
            scope: { kind: "global" },
            initial: "idle",
          },
        ],
        transitions: [
          {
            id: "submit",
            cls: "user",
            label: { kind: "submit", text: "Submit" },
            source: [],
            guard: { kind: "eq", args: [read("phase"), lit("idle")] },
            effect: {
              kind: "seq",
              effects: [
                { kind: "assign", var: "phase", expr: lit("pending") },
                {
                  kind: "enqueue",
                  op: "POST",
                  continuation: "submit#1",
                  args: {},
                },
              ],
            },
            reads: ["phase"],
            writes: ["phase", "sys:pending"],
            confidence: "exact",
          },
          {
            id: "resolve",
            cls: "env",
            label: { kind: "resolve", op: "POST", outcome: "success" },
            source: [],
            guard: {
              kind: "eq",
              args: [read("sys:pending", ["0", "opId"]), lit("POST")],
            },
            effect: {
              kind: "seq",
              effects: [
                { kind: "dequeue", index: 0 },
                { kind: "assign", var: "phase", expr: lit("done") },
              ],
            },
            reads: ["sys:pending"],
            writes: ["sys:pending", "phase"],
            confidence: "exact",
          },
        ],
      },
      stats: { states: 3, edges: 2, depth: 3 },
      reachable: [{ phase: "idle" }, { phase: "pending" }, { phase: "done" }],
      unreachable: [
        {
          phase: "idle",
          "sys:pending": [{ opId: "POST", continuation: "submit#1", args: {} }],
        },
      ],
      boundedResponse: {
        triggerOp: "POST",
        goalVar: "phase",
        budget: { environment: 1 },
        status: "verified-within-bounds",
      },
    },
  ];
}
