import { describe, expect, it } from "vitest";
import { checkModel, sliceModel } from "../src/index.js";
import { always, alwaysStep, leadsToWithin, reachable, reachableFrom, type Model, type Property } from "@modality/kernel";

const bool = { kind: "bool" } as const;
const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} }
  }
} as const;

function lit(value: unknown) {
  return { kind: "lit" as const, value: value as never };
}

function read(id: string, path?: string[]) {
  return { kind: "read" as const, var: id, path };
}

function model(): Model {
  return {
    schemaVersion: 1,
    id: "oracle",
    bounds: { maxDepth: 6, maxPending: 2, maxInternalSteps: 8 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 2 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 2 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "auth", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
      { id: "draft", domain: { kind: "enum", values: ["empty", "nonEmpty"] }, origin: "system", scope: { kind: "global" }, initial: "empty" },
      { id: "status", domain: { kind: "enum", values: ["idle", "posting", "failed"] }, origin: "system", scope: { kind: "global" }, initial: "idle" },
      { id: "done", domain: bool, origin: "system", scope: { kind: "global" }, initial: false }
    ],
    transitions: [
      {
        id: "login",
        cls: "user",
        label: { kind: "click", text: "Login" },
        source: [],
        guard: { kind: "not", args: [read("auth")] },
        effect: { kind: "assign", var: "auth", expr: lit(true) },
        reads: ["auth"],
        writes: ["auth"],
        confidence: "exact"
      },
      {
        id: "input",
        cls: "user",
        label: { kind: "input", valueClass: "nonEmpty" },
        source: [],
        guard: read("auth"),
        effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
        reads: ["auth"],
        writes: ["draft"],
        confidence: "exact"
      },
      {
        id: "submit",
        cls: "user",
        label: { kind: "submit", text: "Add" },
        source: [],
        guard: { kind: "and", args: [read("auth"), { kind: "eq", args: [read("draft"), lit("nonEmpty")] }, { kind: "eq", args: [read("status"), lit("idle")] }] },
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "status", expr: lit("posting") },
            { kind: "enqueue", op: "POST", continuation: "submit#1", args: {} }
          ]
        },
        reads: ["auth", "draft", "status"],
        writes: ["status", "sys:pending"],
        confidence: "exact"
      },
      {
        id: "resolvePostSuccess",
        cls: "env",
        label: { kind: "resolve", op: "POST", outcome: "success" },
        source: [],
        guard: { kind: "eq", args: [read("sys:pending", ["0", "opId"]), lit("POST")] },
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "draft", expr: lit("empty") },
            { kind: "assign", var: "status", expr: lit("idle") },
            { kind: "assign", var: "done", expr: lit(true) }
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "draft", "status", "done"],
        confidence: "exact"
      },
      {
        id: "resolvePostError",
        cls: "env",
        label: { kind: "resolve", op: "POST", outcome: "error" },
        source: [],
        guard: { kind: "eq", args: [read("sys:pending", ["0", "opId"]), lit("POST")] },
        effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, { kind: "assign", var: "status", expr: lit("failed") }] },
        reads: ["sys:pending"],
        writes: ["sys:pending", "status"],
        confidence: "exact"
      }
    ]
  };
}

describe("checker", () => {
  it("finds shortest traces for state and step violations", () => {
    const m = model();
    const props: Property[] = [
      always(m, (s) => !(s.done === true && s.draft === "empty"), { name: "badDoneInvariant" }),
      alwaysStep(m, (pre, step) => !(step.enqueued("POST") && pre.auth === false), { name: "guestCannotSubmit" }),
      reachable(m, (s) => s.done === true, { name: "doneReachable" })
    ];
    const result = checkModel(m, props);
    expect(result.stats.states).toBeGreaterThan(1);
    expect(result.verdicts.find((v) => v.property === "badDoneInvariant")?.status).toBe("violated");
    expect(result.verdicts.find((v) => v.property === "guestCannotSubmit")?.status).toBe("verified-within-bounds");
    const reachableVerdict = result.verdicts.find((v) => v.property === "doneReachable");
    expect(reachableVerdict?.status).toBe("reachable");
    expect(reachableVerdict?.status === "reachable" ? reachableVerdict.trace.steps.map((s) => s.transitionId) : []).toEqual(["login", "input", "submit", "resolvePostSuccess"]);
  });

  it("checks bounded response and conditional reachability", () => {
    const m = model();
    const props: Property[] = [
      leadsToWithin(m, (step) => step.enqueued("POST"), (s) => s.done === true || s.status === "failed", { name: "submitSettles", budget: { environment: 1 } }),
      reachableFrom(m, (s) => s.status === "failed", (s) => s.auth === true, { name: "failedCanRemainAuthed" })
    ];
    const result = checkModel(m, props);
    expect(result.verdicts.find((v) => v.property === "submitSettles")?.status).toBe("verified-within-bounds");
    expect(result.verdicts.find((v) => v.property === "failedCanRemainAuthed")?.status).toBe("verified-within-bounds");
  });

  it("reports validation errors instead of checking malformed models", () => {
    const m = model();
    const broken: Model = { ...m, transitions: [{ ...m.transitions[0], writes: [] }] };
    const [verdict] = checkModel(broken, [always(broken, () => true, { name: "p" })]).verdicts;
    expect(verdict.status).toBe("error");
    expect(verdict.status === "error" ? verdict.message : "").toContain("writes auth");
  });

  it("reports run-level vacuity warnings", () => {
    const m: Model = {
      ...model(),
      vars: [
        ...model().vars,
        { id: "neverMode", domain: { kind: "enum", values: ["seen", "missing"] }, origin: "system", scope: { kind: "global" }, initial: "seen" }
      ],
      transitions: [
        ...model().transitions,
        {
          id: "neverEnabled",
          cls: "user",
          label: { kind: "click", text: "Never" },
          source: [],
          guard: { kind: "eq", args: [read("neverMode"), lit("missing")] },
          effect: { kind: "assign", var: "neverMode", expr: lit("seen") },
          reads: ["neverMode"],
          writes: ["neverMode"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, []);
    expect(result.vacuityWarnings).toContain("transition never enabled: neverEnabled");
    expect(result.vacuityWarnings).toContain("enum value never inhabited: neverMode=missing");
  });

  it("checks properties on conservative slices when reads are declared", () => {
    const m: Model = {
      ...model(),
      vars: [
        ...model().vars,
        { id: "unrelated", domain: { kind: "enum", values: ["cold", "hot"] }, origin: "system", scope: { kind: "global" }, initial: "cold" }
      ],
      transitions: [
        ...model().transitions,
        {
          id: "heat",
          cls: "user",
          label: { kind: "click", text: "Heat" },
          source: [],
          guard: { kind: "eq", args: [read("unrelated"), lit("cold")] },
          effect: { kind: "assign", var: "unrelated", expr: lit("hot") },
          reads: ["unrelated"],
          writes: ["unrelated"],
          confidence: "exact"
        }
      ]
    };
    const props: Property[] = [
      always(m, (s) => !(s.done === true && s.draft === "empty"), { name: "badDoneInvariant", reads: ["done", "draft"] }),
      reachable(m, (s) => s.done === true, { name: "doneReachable", reads: ["done"] })
    ];
    const sliced = checkModel(m, props, { slicing: true });
    const full = checkModel(m, props);
    expect(sliced.verdicts.map((v) => [v.property, v.status])).toEqual(full.verdicts.map((v) => [v.property, v.status]));
    expect(sliceModel(m, ["done", "draft"]).vars.map((decl) => decl.id)).not.toContain("unrelated");
  });
});
