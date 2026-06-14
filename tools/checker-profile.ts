import { checkModel } from "modality-ts/check";
import { reachable, type Model } from "modality-ts/core";

const bool = { kind: "bool" } as const;
const route = { kind: "enum", values: ["/"] } as const;

function read(id: string) {
  return { kind: "read" as const, var: id };
}

function lit(value: unknown) {
  return { kind: "lit" as const, value: value as never };
}

function independentToggleModel(toggleCount: number): Model {
  const toggleIds = Array.from(
    { length: toggleCount },
    (_, index) => `t${index}`,
  );
  return {
    schemaVersion: 1,
    id: "checker-profile-independent-toggles",
    bounds: {
      maxDepth: toggleCount,
      maxPending: 0,
      maxInternalSteps: 4,
    },
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
        domain: {
          kind: "boundedList",
          inner: {
            kind: "record",
            fields: {
              opId: { kind: "enum", values: ["POST"] },
              continuation: { kind: "enum", values: ["submit#1"] },
              args: { kind: "record", fields: {} },
            },
          },
          maxLen: 0,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      ...toggleIds.map((id) => ({
        id,
        domain: bool,
        origin: "system" as const,
        scope: { kind: "global" as const },
        initial: false,
      })),
    ],
    transitions: toggleIds.map((id) => ({
      id: `flip${id}`,
      cls: "user" as const,
      label: { kind: "click" as const, text: id },
      source: [],
      guard: { kind: "not" as const, args: [read(id)] },
      effect: { kind: "assign" as const, var: id, expr: lit(true) },
      reads: [id],
      writes: [id],
      confidence: "exact" as const,
    })),
  };
}

const toggleCount = Number(process.argv[2] ?? 10);
const model = independentToggleModel(toggleCount);
const toggleIds = Array.from(
  { length: toggleCount },
  (_, index) => `t${index}`,
);
const startedAt = performance.now();
const result = checkModel(model, [
  reachable(model, (state) => toggleIds.every((id) => state[id] === true), {
    name: "allToggled",
    reads: toggleIds,
  }),
]);
const elapsedMs = performance.now() - startedAt;

console.log(
  JSON.stringify(
    {
      toggleCount,
      states: result.stats.states,
      edges: result.stats.edges,
      depth: result.stats.depth,
      elapsedMs: Math.round(elapsedMs),
      hotPath: result.diagnostics?.hotPath,
    },
    null,
    2,
  ),
);
