import { describe, expect, it } from "vitest";
import { checkModel, sliceModel } from "../src/index.js";
import { always, alwaysStep, enabled, leadsToWithin, reachable, reachableFrom, type Model, type Property } from "@modality/kernel";

const bool = { kind: "bool" } as const;
const route = { kind: "enum", values: ["/"] } as const;
const twoRoutes = { kind: "enum", values: ["/a", "/b"] } as const;
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

  it("marks reachableFrom counterexamples as non-replayable", () => {
    const m = model();
    const result = checkModel(m, [
      reachableFrom(m, (s) => s.status === "failed", (s) => s.done === true, { name: "failedCannotForceDone", reads: ["status", "done"] })
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("violated");
    expect(verdict?.status === "violated" ? verdict.replayable : undefined).toBe(false);
    expect(verdict?.status === "violated" ? verdict.replayBlockedReason : "").toContain("reachableFrom counterexamples");
  });

  it("marks locatorless user-event counterexamples as non-replayable", () => {
    const m = model();
    const result = checkModel(m, [reachable(m, (s) => s.done === true, { name: "doneReachable", reads: ["done"] })]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("reachable");
    expect(verdict?.status === "reachable" ? verdict.replayable : undefined).toBe(false);
    expect(verdict?.status === "reachable" ? verdict.replayBlockedReason : "").toContain("login:click");
    expect(verdict?.status === "reachable" ? verdict.replayBlockedReason : "").toContain("input:input");
    expect(verdict?.status === "reachable" ? verdict.trace.steps.at(-1)?.transitionId : undefined).toBe("resolvePostSuccess");
  });

  it("includes the failing bounded-response suffix in leadsToWithin traces", () => {
    const m = model();
    const result = checkModel(m, [
      leadsToWithin(m, (step) => step.enqueued("POST"), (s) => s.done === true, { name: "submitDoneImmediately", budget: { environment: 0 } })
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("violated");
    expect(verdict?.status === "violated" ? verdict.trace.steps.map((step) => step.transitionId).slice(0, 3) : []).toEqual(["login", "input", "submit"]);
    expect(verdict?.status === "violated" ? verdict.trace.steps[3]?.label.kind : undefined).toBe("resolve");
  });

  it("excludes user interference from bounded response unless explicitly allowed", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "leads-to-scheduler",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "done", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "canceled", domain: bool, origin: "system", scope: { kind: "global" }, initial: false }
      ],
      transitions: [
        {
          id: "start",
          cls: "user",
          label: { kind: "click", text: "Start" },
          source: [],
          guard: lit(true),
          effect: { kind: "enqueue", op: "POST", continuation: "submit#1", args: {} },
          reads: [],
          writes: ["sys:pending"],
          confidence: "exact"
        },
        {
          id: "cancel",
          cls: "user",
          label: { kind: "click", text: "Cancel" },
          source: [],
          guard: { kind: "eq", args: [read("sys:pending", ["0", "opId"]), lit("POST")] },
          effect: {
            kind: "seq",
            effects: [
              { kind: "dequeue", index: 0 },
              { kind: "assign", var: "canceled", expr: lit(true) }
            ]
          },
          reads: ["sys:pending"],
          writes: ["sys:pending", "canceled"],
          confidence: "exact"
        },
        {
          id: "finish",
          cls: "env",
          label: { kind: "resolve", op: "POST", outcome: "success" },
          source: [],
          guard: { kind: "eq", args: [read("sys:pending", ["0", "opId"]), lit("POST")] },
          effect: {
            kind: "seq",
            effects: [
              { kind: "dequeue", index: 0 },
              { kind: "assign", var: "done", expr: lit(true) }
            ]
          },
          reads: ["sys:pending"],
          writes: ["sys:pending", "done"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [
      leadsToWithin(m, (step) => step.enqueued("POST"), (s) => s.done === true, { name: "settlesWithoutUserInterference", budget: { environment: 1 }, reads: ["done"] }),
      leadsToWithin(m, (step) => step.enqueued("POST"), (s) => s.done === true, { name: "adversarialUserCanDelaySettlement", budget: { environment: 1 }, allowUserEvents: true, reads: ["done"] })
    ]);
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict]));
    expect(byName.get("settlesWithoutUserInterference")?.status).toBe("verified-within-bounds");
    const adversarial = byName.get("adversarialUserCanDelaySettlement");
    expect(adversarial?.status).toBe("violated");
    expect(adversarial?.status === "violated" ? adversarial.trace.steps.map((step) => step.transitionId) : []).toEqual(["start", "cancel"]);
  });

  it("reports validation errors instead of checking malformed models", () => {
    const m = model();
    const broken: Model = { ...m, transitions: [{ ...m.transitions[0], writes: [] }] };
    const [verdict] = checkModel(broken, [always(broken, () => true, { name: "p" })]).verdicts;
    expect(verdict.status).toBe("error");
    expect(verdict.status === "error" ? verdict.message : "").toContain("writes auth");
  });

  it("pins oracle micro-model state and edge counts", () => {
    const independentBits: Model = {
      schemaVersion: 1,
      id: "oracle-independent-bits",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "a", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "b", domain: bool, origin: "system", scope: { kind: "global" }, initial: false }
      ],
      transitions: [
        {
          id: "flipA",
          cls: "user",
          label: { kind: "click", text: "A" },
          source: [],
          guard: { kind: "not", args: [read("a")] },
          effect: { kind: "assign", var: "a", expr: lit(true) },
          reads: ["a"],
          writes: ["a"],
          confidence: "exact"
        },
        {
          id: "flipB",
          cls: "user",
          label: { kind: "click", text: "B" },
          source: [],
          guard: { kind: "not", args: [read("b")] },
          effect: { kind: "assign", var: "b", expr: lit(true) },
          reads: ["b"],
          writes: ["b"],
          confidence: "exact"
        }
      ]
    };
    const diamond = checkModel(independentBits, [reachable(independentBits, (state) => state.a === true && state.b === true, { name: "bothSet", reads: ["a", "b"] })]);
    expect(diamond.stats).toEqual({ states: 4, edges: 4, depth: 2 });
    expect(diamond.verdicts[0]?.status).toBe("reachable");

    const toggleLoop: Model = {
      ...independentBits,
      id: "oracle-toggle-loop",
      bounds: { ...independentBits.bounds, maxDepth: 4 },
      vars: independentBits.vars.filter((decl) => decl.id !== "b"),
      transitions: [
        {
          ...independentBits.transitions[0]!,
          id: "setTrue",
          guard: { kind: "not", args: [read("a")] },
          effect: { kind: "assign", var: "a", expr: lit(true) }
        },
        {
          ...independentBits.transitions[0]!,
          id: "setFalse",
          guard: read("a"),
          effect: { kind: "assign", var: "a", expr: lit(false) }
        }
      ]
    };
    const loop = checkModel(toggleLoop, [alwaysStep(toggleLoop, () => true, { name: "allEdgesOk", reads: [] })]);
    expect(loop.stats).toEqual({ states: 2, edges: 2, depth: 2 });
  });

  it("executes opaque effects and validates their declared write footprint", () => {
    const m: Model = {
      ...model(),
      transitions: [
        {
          id: "opaqueSetDone",
          cls: "user",
          label: { kind: "click", text: "Opaque" },
          source: [],
          guard: lit(true),
          effect: { kind: "opaque", ref: { module: "packages/checker/test/opaque-effects.cjs", export: "setDone", declaredReads: [], declaredWrites: ["done"] } },
          reads: [],
          writes: ["done"],
          confidence: "manual"
        }
      ]
    };
    const result = checkModel(m, [reachable(m, (state) => state.done === true, { name: "doneViaOpaque", reads: ["done"] })]);
    expect(result.verdicts[0]?.status).toBe("reachable");

    const undeclaredWrite: Model = {
      ...m,
      transitions: [
        {
          ...m.transitions[0]!,
          effect: { kind: "opaque", ref: { module: "packages/checker/test/opaque-effects.cjs", export: "writeUndeclared", declaredReads: [], declaredWrites: ["done"] } }
        }
      ]
    };
    expect(() => checkModel(undeclaredWrite, [])).toThrow("wrote undeclared var auth");

    const invalidValue: Model = {
      ...m,
      transitions: [
        {
          ...m.transitions[0]!,
          effect: { kind: "opaque", ref: { module: "packages/checker/test/opaque-effects.cjs", export: "invalidDone", declaredReads: [], declaredWrites: ["done"] } }
        }
      ]
    };
    expect(() => checkModel(invalidValue, [])).toThrow("produced invalid value for done");

    const nondeterministic: Model = {
      ...m,
      transitions: [
        {
          ...m.transitions[0]!,
          effect: { kind: "opaque", ref: { module: "packages/checker/test/opaque-effects.cjs", export: "nondeterministicDone", declaredReads: [], declaredWrites: ["done"] } }
        }
      ]
    };
    expect(() => checkModel(nondeterministic, [])).toThrow("returned nondeterministic results for identical input");
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

  it("checks sliced properties using inferred state reads", () => {
    const m = model();
    const props: Property[] = [
      always(m, (s) => !(s.done === true && s.draft === "empty"), { name: "badDoneInvariant" }),
      reachable(m, (s) => s.done === true, { name: "doneReachable" })
    ];
    const full = checkModel(m, props);
    const sliced = checkModel(m, props, { slicing: true });
    expect(props.map((property) => [property.name, property.reads])).toEqual([
      ["badDoneInvariant", ["done", "draft"]],
      ["doneReachable", ["done"]]
    ]);
    expect(sliced.verdicts.map((v) => [v.property, v.status])).toEqual(full.verdicts.map((v) => [v.property, v.status]));
  });

  it("reports property errors when declared reads omit accessed state vars", () => {
    const m = model();
    const result = checkModel(m, [
      always(m, (state) => state.done !== true, { name: "badStateReads", reads: [] }),
      alwaysStep(m, (pre) => pre.auth !== "guest", { name: "badStepReads", reads: [] })
    ]);
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict]));
    expect(byName.get("badStateReads")?.status).toBe("error");
    expect(byName.get("badStateReads")?.status === "error" ? byName.get("badStateReads")?.message : "").toContain("read undeclared var done");
    expect(byName.get("badStepReads")?.status).toBe("error");
    expect(byName.get("badStepReads")?.status === "error" ? byName.get("badStepReads")?.message : "").toContain("read undeclared var auth");
  });

  it("runs all same-batch non-conflicting internal transitions in deterministic order", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "internal-batch",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "source", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "a", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "b", domain: bool, origin: "system", scope: { kind: "global" }, initial: false }
      ],
      transitions: [
        {
          id: "kick",
          cls: "user",
          label: { kind: "click", text: "Kick" },
          source: [],
          guard: { kind: "not", args: [read("source")] },
          effect: { kind: "assign", var: "source", expr: lit(true) },
          reads: ["source"],
          writes: ["source"],
          confidence: "exact"
        },
        {
          id: "setA",
          cls: "internal",
          label: { kind: "internal", text: "set a" },
          source: [],
          triggeredBy: ["source"],
          guard: read("source"),
          effect: { kind: "assign", var: "a", expr: lit(true) },
          reads: ["source"],
          writes: ["a"],
          confidence: "exact"
        },
        {
          id: "setB",
          cls: "internal",
          label: { kind: "internal", text: "set b" },
          source: [],
          triggeredBy: ["source"],
          guard: read("source"),
          effect: { kind: "assign", var: "b", expr: lit(true) },
          reads: ["source"],
          writes: ["b"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [
      reachable(m, (s) => s.a === true && s.b === true, { name: "bothInternalEffectsRan", reads: ["a", "b"] })
    ]);
    expect(result.verdicts[0]?.status).toBe("reachable");
    expect(result.stats).toEqual({ states: 2, edges: 1, depth: 1 });
  });

  it("explores both orders for same-batch conflicting internal transitions", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "internal-conflict-orders",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "source", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "x", domain: { kind: "enum", values: ["unset", "a", "b"] }, origin: "system", scope: { kind: "global" }, initial: "unset" },
        { id: "seen", domain: { kind: "enum", values: ["unset", "sawA", "sawB"] }, origin: "system", scope: { kind: "global" }, initial: "unset" }
      ],
      transitions: [
        {
          id: "kick",
          cls: "user",
          label: { kind: "click", text: "Kick" },
          source: [],
          guard: { kind: "not", args: [read("source")] },
          effect: { kind: "assign", var: "source", expr: lit(true) },
          reads: ["source"],
          writes: ["source"],
          confidence: "exact"
        },
        {
          id: "setA",
          cls: "internal",
          label: { kind: "internal", text: "set a" },
          source: [],
          triggeredBy: ["source"],
          guard: read("source"),
          effect: {
            kind: "seq",
            effects: [
              { kind: "assign", var: "seen", expr: { kind: "cond", args: [{ kind: "eq", args: [read("x"), lit("b")] }, lit("sawB"), read("seen")] } },
              { kind: "assign", var: "x", expr: lit("a") }
            ]
          },
          reads: ["source", "x", "seen"],
          writes: ["x", "seen"],
          confidence: "exact"
        },
        {
          id: "setB",
          cls: "internal",
          label: { kind: "internal", text: "set b" },
          source: [],
          triggeredBy: ["source"],
          guard: read("source"),
          effect: {
            kind: "seq",
            effects: [
              { kind: "assign", var: "seen", expr: { kind: "cond", args: [{ kind: "eq", args: [read("x"), lit("a")] }, lit("sawA"), read("seen")] } },
              { kind: "assign", var: "x", expr: lit("b") }
            ]
          },
          reads: ["source", "x", "seen"],
          writes: ["x", "seen"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [
      reachable(m, (s) => s.x === "b" && s.seen === "sawA", { name: "aThenBReachable", reads: ["x", "seen"] }),
      reachable(m, (s) => s.x === "a" && s.seen === "sawB", { name: "bThenAReachable", reads: ["x", "seen"] })
    ]);
    expect(result.verdicts.map((verdict) => [verdict.property, verdict.status])).toEqual([
      ["aThenBReachable", "reachable"],
      ["bThenAReachable", "reachable"]
    ]);
    expect(result.stats).toEqual({ states: 3, edges: 2, depth: 1 });
  });

  it("resets route-local state on remount and disables off-route local transitions", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local",
      bounds: { maxDepth: 5, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: twoRoutes, origin: "system", scope: { kind: "global" }, initial: "/a" },
        { id: "sys:history", domain: { kind: "boundedList", inner: twoRoutes, maxLen: 2 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "local:A.draft", domain: { kind: "enum", values: ["empty", "nonEmpty"] }, origin: "system", scope: { kind: "route-local", route: "/a" }, initial: "empty" }
      ],
      transitions: [
        {
          id: "typeDraft",
          cls: "user",
          label: { kind: "input", valueClass: "nonEmpty" },
          source: [],
          guard: { kind: "eq", args: [read("local:A.draft"), lit("empty")] },
          effect: { kind: "assign", var: "local:A.draft", expr: lit("nonEmpty") },
          reads: ["local:A.draft"],
          writes: ["local:A.draft"],
          confidence: "exact"
        },
        {
          id: "goB",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/b" },
          source: [],
          guard: { kind: "eq", args: [read("sys:route"), lit("/a")] },
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact"
        },
        {
          id: "back",
          cls: "nav",
          label: { kind: "navigate", mode: "back" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "back" },
          reads: ["sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [
      reachable(m, (s) => s["sys:route"] === "/b" && s["local:A.draft"] === "__modality_unmounted__", { name: "localUnmountsOnB" }),
      always(m, (s) => !(s["sys:route"] === "/b" && s["local:A.draft"] === "nonEmpty"), { name: "cannotTypeWhileUnmounted" }),
      alwaysStep(m, (pre, step, post) => step.transition.id !== "back" || pre["sys:route"] !== "/b" || post["local:A.draft"] === "empty", { name: "backRemountResetsDraft" })
    ]);
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict.status]));
    expect(byName.get("localUnmountsOnB")).toBe("reachable");
    expect(byName.get("cannotTypeWhileUnmounted")).toBe("verified-within-bounds");
    expect(byName.get("backRemountResetsDraft")).toBe("verified-within-bounds");
  });

  it("does not stabilize off-route internal transitions that touch route-local state", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-internal",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: twoRoutes, origin: "system", scope: { kind: "global" }, initial: "/a" },
        { id: "sys:history", domain: { kind: "boundedList", inner: twoRoutes, maxLen: 2 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "local:A.draft", domain: { kind: "enum", values: ["empty", "nonEmpty"] }, origin: "system", scope: { kind: "route-local", route: "/a" }, initial: "empty" }
      ],
      transitions: [
        {
          id: "goB",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/b" },
          source: [],
          guard: { kind: "eq", args: [read("sys:route"), lit("/a")] },
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact"
        },
        {
          id: "offRouteEffect",
          cls: "internal",
          label: { kind: "internal", text: "off route effect" },
          source: [],
          triggeredBy: ["sys:route"],
          guard: lit(true),
          effect: { kind: "assign", var: "local:A.draft", expr: lit("nonEmpty") },
          reads: ["sys:route"],
          writes: ["local:A.draft"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [
      always(m, (s) => !(s["sys:route"] === "/b" && s["local:A.draft"] === "nonEmpty"), { name: "offRouteInternalCannotWrite", reads: ["sys:route", "local:A.draft"] }),
      reachable(m, (s) => s["sys:route"] === "/b" && s["local:A.draft"] === "__modality_unmounted__", { name: "offRouteLocalRemainsUnmounted", reads: ["sys:route", "local:A.draft"] })
    ]);
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict.status]));
    expect(byName.get("offRouteInternalCannotWrite")).toBe("verified-within-bounds");
    expect(byName.get("offRouteLocalRemainsUnmounted")).toBe("reachable");
  });

  it("reports pending-cap bound hits", () => {
    const m: Model = {
      ...model(),
      bounds: { ...model().bounds, maxPending: 1 },
      vars: model().vars.map((decl) =>
        decl.id === "sys:pending" && decl.domain.kind === "boundedList"
          ? { ...decl, domain: { ...decl.domain, maxLen: 1 } }
          : decl
      ),
      transitions: [
        {
          id: "spam",
          cls: "user",
          label: { kind: "click", text: "Spam" },
          source: [],
          guard: lit(true),
          effect: { kind: "enqueue", op: "POST", continuation: "submit#1", args: {} },
          reads: [],
          writes: ["sys:pending"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [reachable(m, (s) => Array.isArray(s["sys:pending"]) && s["sys:pending"].length === 1, { name: "onePendingReachable" })]);
    expect(result.boundHits).toContain("pending cap saturated at spam");
  });

  it("reports max-depth bound hits only when enabled transitions remain at the boundary", () => {
    const bounded: Model = { ...model(), bounds: { ...model().bounds, maxDepth: 0 } };
    const boundedResult = checkModel(bounded, [always(bounded, () => true, { name: "ok" })]);
    expect(boundedResult.boundHits).toEqual(["maxDepth reached before login"]);
    expect(boundedResult.vacuityWarnings).not.toContain("transition never enabled: login");

    const terminal: Model = { ...model(), transitions: [], bounds: { ...model().bounds, maxDepth: 0 } };
    const terminalResult = checkModel(terminal, [always(terminal, () => true, { name: "ok" })]);
    expect(terminalResult.boundHits).toEqual([]);
  });

  it("reports token bound hits when freshToken is exhausted", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "token-bound",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "current", domain: { kind: "tokens", count: 1 }, origin: "system", scope: { kind: "global" }, initial: "tok1" },
        { id: "next", domain: { kind: "tokens", count: 1 }, origin: "system", scope: { kind: "global" }, initial: "tok1" }
      ],
      transitions: [
        {
          id: "allocate",
          cls: "user",
          label: { kind: "click", text: "Allocate" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "next", expr: { kind: "freshToken", domainOf: "current" } },
          reads: [],
          writes: ["next"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [reachable(m, (state) => state.next === "tok1", { name: "onlyInitialReachable", reads: ["next"] })]);
    expect(result.stats.edges).toBe(0);
    expect(result.boundHits).toContain("token cap exhausted at allocate");
  });

  it("keeps enabled transition dependencies in sliced checks", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "mode", domain: { kind: "enum", values: ["closed", "open"] }, origin: "system", scope: { kind: "global" }, initial: "closed" },
        { id: "clicked", domain: bool, origin: "system", scope: { kind: "global" }, initial: false }
      ],
      transitions: [
        {
          id: "open",
          cls: "user",
          label: { kind: "click", text: "Open" },
          source: [],
          guard: { kind: "eq", args: [read("mode"), lit("closed")] },
          effect: { kind: "assign", var: "mode", expr: lit("open") },
          reads: ["mode"],
          writes: ["mode"],
          confidence: "exact"
        },
        {
          id: "go",
          cls: "user",
          label: { kind: "click", text: "Go" },
          source: [],
          guard: { kind: "eq", args: [read("mode"), lit("open")] },
          effect: { kind: "assign", var: "clicked", expr: lit(true) },
          reads: ["mode"],
          writes: ["clicked"],
          confidence: "exact"
        }
      ]
    };
    const props = [always(m, (state) => !enabled(m, "go")(state), { name: "goNeverEnabled", reads: [] })];
    expect(checkModel(m, props).verdicts[0]?.status).toBe("violated");
    expect(checkModel(m, props, { slicing: true }).verdicts[0]?.status).toBe("violated");
  });

  it("explores conflicting internal transition orders during stabilization", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "internal-conflict",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "flag", domain: bool, origin: "system", scope: { kind: "global" }, initial: true },
        { id: "value", domain: { kind: "enum", values: ["none", "a", "b"] }, origin: "system", scope: { kind: "global" }, initial: "none" }
      ],
      transitions: [
        {
          id: "internal:setA",
          cls: "internal",
          label: { kind: "internal", text: "set a" },
          source: [],
          guard: { kind: "and", args: [read("flag"), { kind: "eq", args: [read("value"), lit("none")] }] },
          effect: { kind: "assign", var: "value", expr: lit("a") },
          reads: ["flag", "value"],
          writes: ["value"],
          confidence: "exact"
        },
        {
          id: "internal:setB",
          cls: "internal",
          label: { kind: "internal", text: "set b" },
          source: [],
          guard: { kind: "and", args: [read("flag"), { kind: "eq", args: [read("value"), lit("none")] }] },
          effect: { kind: "assign", var: "value", expr: lit("b") },
          reads: ["flag", "value"],
          writes: ["value"],
          confidence: "exact"
        }
      ]
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.value === "a", { name: "aReachable", reads: ["value"] }),
      reachable(m, (state) => state.value === "b", { name: "bReachable", reads: ["value"] })
    ]);
    expect(result.verdicts.map((verdict) => [verdict.property, verdict.status])).toEqual([
      ["aReachable", "reachable"],
      ["bReachable", "reachable"]
    ]);
  });

  it("runs triggered internal transitions only when their dependency vars changed", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "triggered-internal",
      bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/" },
        { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOp, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
        { id: "source", domain: bool, origin: "system", scope: { kind: "global" }, initial: false },
        { id: "target", domain: bool, origin: "system", scope: { kind: "global" }, initial: false }
      ],
      transitions: [
        {
          id: "enableSource",
          cls: "user",
          label: { kind: "click", text: "Enable source" },
          source: [],
          guard: { kind: "not", args: [read("source")] },
          effect: { kind: "assign", var: "source", expr: lit(true) },
          reads: ["source"],
          writes: ["source"],
          confidence: "exact"
        },
        {
          id: "resetTarget",
          cls: "user",
          label: { kind: "click", text: "Reset target" },
          source: [],
          guard: read("target"),
          effect: { kind: "assign", var: "target", expr: lit(false) },
          reads: ["target"],
          writes: ["target"],
          confidence: "exact"
        },
        {
          id: "internal:copySource",
          cls: "internal",
          label: { kind: "internal", text: "copy source" },
          source: [],
          guard: read("source"),
          effect: { kind: "assign", var: "target", expr: lit(true) },
          reads: ["source"],
          writes: ["target"],
          confidence: "exact",
          triggeredBy: ["source"]
        }
      ]
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.source === true && state.target === true, { name: "triggerRuns", reads: ["source", "target"] }),
      reachable(m, (state) => state.source === true && state.target === false, { name: "unrelatedTargetWriteDoesNotRetrigger", reads: ["source", "target"] })
    ]);
    expect(result.verdicts.map((verdict) => [verdict.property, verdict.status])).toEqual([
      ["triggerRuns", "reachable"],
      ["unrelatedTargetWriteDoesNotRetrigger", "reachable"]
    ]);
  });
});
