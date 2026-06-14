import { describe, expect, it } from "vitest";
import { checkModel, modelInitialStates, sliceModel } from "modality-ts/check";
import {
  always,
  alwaysStep,
  enabled,
  leadsToWithin,
  reachable,
  reachableFrom,
  type Model,
  type Property,
} from "modality-ts/core";
import { checkerOracleCorpus } from "./oracle-corpus.js";

const bool = { kind: "bool" } as const;
const route = { kind: "enum", values: ["/"] } as const;
const twoRoutes = { kind: "enum", values: ["/a", "/b"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
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
      {
        id: "sys:route",
        domain: route,
        origin: "system",
        scope: { kind: "global" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: { kind: "boundedList", inner: route, maxLen: 2 },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "sys:pending",
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 2 },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "auth",
        domain: bool,
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
      {
        id: "draft",
        domain: { kind: "enum", values: ["empty", "nonEmpty"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "empty",
      },
      {
        id: "status",
        domain: { kind: "enum", values: ["idle", "posting", "failed"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "idle",
      },
      {
        id: "done",
        domain: bool,
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
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
        confidence: "exact",
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
        confidence: "exact",
      },
      {
        id: "submit",
        cls: "user",
        label: { kind: "submit", text: "Add" },
        source: [],
        guard: {
          kind: "and",
          args: [
            read("auth"),
            { kind: "eq", args: [read("draft"), lit("nonEmpty")] },
            { kind: "eq", args: [read("status"), lit("idle")] },
          ],
        },
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "status", expr: lit("posting") },
            { kind: "enqueue", op: "POST", continuation: "submit#1", args: {} },
          ],
        },
        reads: ["auth", "draft", "status"],
        writes: ["status", "sys:pending"],
        confidence: "exact",
      },
      {
        id: "resolvePostSuccess",
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
            { kind: "assign", var: "draft", expr: lit("empty") },
            { kind: "assign", var: "status", expr: lit("idle") },
            { kind: "assign", var: "done", expr: lit(true) },
          ],
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "draft", "status", "done"],
        confidence: "exact",
      },
      {
        id: "resolvePostError",
        cls: "env",
        label: { kind: "resolve", op: "POST", outcome: "error" },
        source: [],
        guard: {
          kind: "eq",
          args: [read("sys:pending", ["0", "opId"]), lit("POST")],
        },
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "status", expr: lit("failed") },
          ],
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "status"],
        confidence: "exact",
      },
    ],
  };
}

function firstTransition(model: Model): Model["transitions"][number] {
  const transition = model.transitions[0];
  if (!transition) throw new Error("Fixture is missing first transition");
  return transition;
}

describe("checker", () => {
  it("preserves nondeterministic route-local initials on initial mount and remount", () => {
    const routeLocalModel: Model = {
      schemaVersion: 1,
      id: "route-local-initials",
      bounds: { maxDepth: 3, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "local:Page.choice",
          domain: { kind: "enum", values: ["x", "y"] },
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
          initial: ["x", "y"],
        },
      ],
      transitions: [
        {
          id: "goB",
          cls: "nav",
          label: { kind: "navigate", to: "/b" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
        {
          id: "goA",
          cls: "nav",
          label: { kind: "navigate", to: "/a" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/a") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };

    expect(
      modelInitialStates(routeLocalModel)
        .map((state) => state["local:Page.choice"])
        .sort(),
    ).toEqual(["x", "y"]);
    const check = checkModel(routeLocalModel, [
      reachable(
        routeLocalModel,
        (state) => state["local:Page.choice"] === "y",
        { name: "canMountY" },
      ),
    ]);
    expect(check.verdicts[0]).toMatchObject({
      status: "reachable",
      property: "canMountY",
    });
  });

  it("treats named token values as used when freshToken checks exhaustion", () => {
    const tokenModel: Model = {
      schemaVersion: 1,
      id: "named-token-exhaustion",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "payload",
          domain: { kind: "tokens", count: 1, names: ["userA"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "userA",
        },
        {
          id: "next",
          domain: { kind: "tokens", count: 1, names: ["userA"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "userA",
        },
      ],
      transitions: [
        {
          id: "fresh",
          cls: "user",
          label: { kind: "click", text: "Fresh" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "next",
            expr: { kind: "freshToken", domainOf: "next" },
          },
          reads: [],
          writes: ["next"],
          confidence: "exact",
        },
      ],
    };

    const check = checkModel(tokenModel, [
      reachable(tokenModel, (state) => state.next !== "userA", {
        name: "freshGenerated",
      }),
    ]);
    expect(check.stats.edges).toBe(0);
    expect(check.boundHits).toEqual(["token cap exhausted at fresh"]);
    expect(check.verdicts[0]).toMatchObject({
      status: "vacuous-warning",
      property: "freshGenerated",
    });
  });

  it("matches tagIs against the tagged domain discriminant only", () => {
    const taggedModel: Model = {
      schemaVersion: 1,
      id: "tagged-discriminant",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "session",
          domain: {
            kind: "tagged",
            tag: "kind",
            variants: {
              guest: {
                kind: "record",
                fields: { role: { kind: "enum", values: ["admin"] } },
              },
              admin: { kind: "record", fields: {} },
            },
          },
          origin: "system",
          scope: { kind: "global" },
          initial: { kind: "guest", role: "admin" },
        },
        {
          id: "entered",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "enterAdmin",
          cls: "user",
          label: { kind: "click", text: "Enter admin" },
          source: [],
          guard: { kind: "tagIs", arg: read("session"), tag: "admin" },
          effect: { kind: "assign", var: "entered", expr: lit(true) },
          reads: ["session"],
          writes: ["entered"],
          confidence: "exact",
        },
      ],
    };

    const check = checkModel(taggedModel, [
      reachable(taggedModel, (state) => state.entered === true, {
        name: "enteredAdmin",
      }),
    ]);
    expect(check.verdicts[0]).toMatchObject({
      status: "vacuous-warning",
      property: "enteredAdmin",
    });
    expect(check.stats.edges).toBe(0);
  });

  it("finds shortest traces for state and step violations", () => {
    const m = model();
    const props: Property[] = [
      always(m, (s) => !(s.done === true && s.draft === "empty"), {
        name: "badDoneInvariant",
      }),
      alwaysStep(
        m,
        (pre, step) => !(step.enqueued("POST") && pre.auth === false),
        { name: "guestCannotSubmit" },
      ),
      reachable(m, (s) => s.done === true, { name: "doneReachable" }),
    ];
    const result = checkModel(m, props);
    expect(result.stats.states).toBeGreaterThan(1);
    expect(
      result.verdicts.find((v) => v.property === "badDoneInvariant")?.status,
    ).toBe("violated");
    expect(
      result.verdicts.find((v) => v.property === "guestCannotSubmit")?.status,
    ).toBe("verified-within-bounds");
    const reachableVerdict = result.verdicts.find(
      (v) => v.property === "doneReachable",
    );
    expect(reachableVerdict?.status).toBe("reachable");
    expect(
      reachableVerdict?.status === "reachable"
        ? reachableVerdict.trace.steps.map((s) => s.transitionId)
        : [],
    ).toEqual(["login", "input", "submit", "resolvePostSuccess"]);
  });

  it("checks bounded response and conditional reachability", () => {
    const m = model();
    const props: Property[] = [
      leadsToWithin(
        m,
        (step) => step.enqueued("POST"),
        (s) => s.done === true || s.status === "failed",
        { name: "submitSettles", budget: { environment: 1 } },
      ),
      reachableFrom(
        m,
        (s) => s.status === "failed",
        (s) => s.auth === true,
        { name: "failedCanRemainAuthed" },
      ),
    ];
    const result = checkModel(m, props);
    expect(
      result.verdicts.find((v) => v.property === "submitSettles")?.status,
    ).toBe("verified-within-bounds");
    expect(
      result.verdicts.find((v) => v.property === "failedCanRemainAuthed")
        ?.status,
    ).toBe("verified-within-bounds");
  });

  it("checks bounded response beyond the global BFS frontier", () => {
    const m: Model = {
      ...model(),
      bounds: { ...model().bounds, maxDepth: 3 },
    };
    const result = checkModel(m, [
      leadsToWithin(
        m,
        (step) => step.enqueued("POST"),
        (s) => s.done === true || s.status === "failed",
        { name: "submitSettlesAfterFrontier", budget: { environment: 1 } },
      ),
    ]);

    expect(result.boundHits).toContain(
      "maxDepth reached before resolvePostError",
    );
    expect(result.boundHits).toContain(
      "maxDepth reached before resolvePostSuccess",
    );
    expect(result.verdicts[0]).toMatchObject({
      status: "verified-within-bounds",
      property: "submitSettlesAfterFrontier",
    });
  });

  it("marks reachableFrom counterexamples as non-replayable", () => {
    const m = model();
    const result = checkModel(m, [
      reachableFrom(
        m,
        (s) => s.status === "failed",
        (s) => s.done === true,
        { name: "failedCannotForceDone", reads: ["status", "done"] },
      ),
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("violated");
    expect(
      verdict?.status === "violated" ? verdict.replayable : undefined,
    ).toBe(false);
    expect(
      verdict?.status === "violated" ? verdict.replayBlockedReason : "",
    ).toContain("reachableFrom counterexamples");
  });

  it("marks locatorless user-event counterexamples as non-replayable", () => {
    const m = model();
    const result = checkModel(m, [
      reachable(m, (s) => s.done === true, {
        name: "doneReachable",
        reads: ["done"],
      }),
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("reachable");
    expect(
      verdict?.status === "reachable" ? verdict.replayable : undefined,
    ).toBe(false);
    expect(
      verdict?.status === "reachable" ? verdict.replayBlockedReason : "",
    ).toContain("login:click");
    expect(
      verdict?.status === "reachable" ? verdict.replayBlockedReason : "",
    ).toContain("input:input");
    expect(
      verdict?.status === "reachable"
        ? verdict.trace.steps.at(-1)?.transitionId
        : undefined,
    ).toBe("resolvePostSuccess");
  });

  it("includes the failing bounded-response suffix in leadsToWithin traces", () => {
    const m = model();
    const result = checkModel(m, [
      leadsToWithin(
        m,
        (step) => step.enqueued("POST"),
        (s) => s.done === true,
        { name: "submitDoneImmediately", budget: { environment: 0 } },
      ),
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("violated");
    expect(
      verdict?.status === "violated"
        ? verdict.trace.steps.map((step) => step.transitionId).slice(0, 3)
        : [],
    ).toEqual(["login", "input", "submit"]);
    expect(
      verdict?.status === "violated" ? verdict.trace.steps.length : undefined,
    ).toBe(3);
  });

  it("does not slice leadsToWithin trigger edges away", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "leads-to-trigger-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "done",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "triggered",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "fire",
          cls: "user",
          label: { kind: "click", text: "Fire" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "triggered", expr: lit(true) },
          reads: [],
          writes: ["triggered"],
          confidence: "exact",
        },
      ],
    };
    const props = [
      leadsToWithin(
        m,
        (step) => step.transition.id === "fire",
        (state) => state.done === true,
        { name: "fireEventuallyDone", budget: { environment: 0 } },
      ),
    ];
    const unsliced = checkModel(m, props);
    const sliced = checkModel(m, props, { slicing: true });
    expect(unsliced.verdicts[0]?.status).toBe("violated");
    expect(sliced.verdicts[0]?.status).toBe("violated");
    expect(sliced.verdicts[0]?.status).not.toBe("vacuous-warning");
    expect(
      sliced.verdicts[0]?.status === "violated"
        ? sliced.verdicts[0].trace.steps.map((step) => step.transitionId)
        : [],
    ).toEqual(["fire"]);
  });

  it("excludes user interference from bounded response unless explicitly allowed", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "leads-to-scheduler",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "done",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "canceled",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "start",
          cls: "user",
          label: { kind: "click", text: "Start" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "enqueue",
            op: "POST",
            continuation: "submit#1",
            args: {},
          },
          reads: [],
          writes: ["sys:pending"],
          confidence: "exact",
        },
        {
          id: "cancel",
          cls: "user",
          label: { kind: "click", text: "Cancel" },
          source: [],
          guard: {
            kind: "eq",
            args: [read("sys:pending", ["0", "opId"]), lit("POST")],
          },
          effect: {
            kind: "seq",
            effects: [
              { kind: "dequeue", index: 0 },
              { kind: "assign", var: "canceled", expr: lit(true) },
            ],
          },
          reads: ["sys:pending"],
          writes: ["sys:pending", "canceled"],
          confidence: "exact",
        },
        {
          id: "finish",
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
              { kind: "assign", var: "done", expr: lit(true) },
            ],
          },
          reads: ["sys:pending"],
          writes: ["sys:pending", "done"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      leadsToWithin(
        m,
        (step) => step.enqueued("POST"),
        (s) => s.done === true,
        {
          name: "settlesWithoutUserInterference",
          budget: { environment: 1 },
          reads: ["done"],
        },
      ),
      leadsToWithin(
        m,
        (step) => step.enqueued("POST"),
        (s) => s.done === true,
        {
          name: "adversarialUserCanDelaySettlement",
          budget: { environment: 1 },
          allowUserEvents: true,
          reads: ["done"],
        },
      ),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict]),
    );
    expect(byName.get("settlesWithoutUserInterference")?.status).toBe(
      "verified-within-bounds",
    );
    const adversarial = byName.get("adversarialUserCanDelaySettlement");
    expect(adversarial?.status).toBe("violated");
    expect(
      adversarial?.status === "violated"
        ? adversarial.trace.steps.map((step) => step.transitionId)
        : [],
    ).toEqual(["start", "cancel"]);
  });

  it("reports validation errors instead of checking malformed models", () => {
    const m = model();
    const broken: Model = {
      ...m,
      transitions: [{ ...m.transitions[0], writes: [] }],
    };
    const [verdict] = checkModel(broken, [
      always(broken, () => true, { name: "p" }),
    ]).verdicts;
    expect(verdict.status).toBe("error");
    expect(verdict.status === "error" ? verdict.message : "").toContain(
      "writes auth",
    );
  });

  it("pins oracle micro-model state and edge counts", () => {
    const independentBits: Model = {
      schemaVersion: 1,
      id: "oracle-independent-bits",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "a",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "b",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
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
          confidence: "exact",
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
          confidence: "exact",
        },
      ],
    };
    const diamond = checkModel(independentBits, [
      reachable(
        independentBits,
        (state) => state.a === true && state.b === true,
        { name: "bothSet", reads: ["a", "b"] },
      ),
    ]);
    expect(diamond.stats).toEqual({ states: 4, edges: 4, depth: 2 });
    expect(diamond.verdicts[0]?.status).toBe("reachable");

    const toggleLoop: Model = {
      ...independentBits,
      id: "oracle-toggle-loop",
      bounds: { ...independentBits.bounds, maxDepth: 4 },
      vars: independentBits.vars.filter((decl) => decl.id !== "b"),
      transitions: [
        {
          ...firstTransition(independentBits),
          id: "setTrue",
          guard: { kind: "not", args: [read("a")] },
          effect: { kind: "assign", var: "a", expr: lit(true) },
        },
        {
          ...firstTransition(independentBits),
          id: "setFalse",
          guard: read("a"),
          effect: { kind: "assign", var: "a", expr: lit(false) },
        },
      ],
    };
    const loop = checkModel(toggleLoop, [
      alwaysStep(toggleLoop, () => true, { name: "allEdgesOk", reads: [] }),
    ]);
    expect(loop.stats).toEqual({ states: 2, edges: 2, depth: 2 });
    expect(diamond.diagnostics?.storage).toMatchObject({
      edgeRecordingMode: "none",
      recordedEdges: 0,
      storedStates: 4,
      parentEntries: 4,
    });
  });

  it("observes alwaysStep violations on edges into already visited states", () => {
    const toggleLoop: Model = {
      schemaVersion: 1,
      id: "oracle-toggle-loop-violation",
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
          initial: [],
        },
        {
          id: "a",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "setTrue",
          cls: "user",
          label: { kind: "click", text: "Set true" },
          source: [],
          guard: { kind: "not", args: [read("a")] },
          effect: { kind: "assign", var: "a", expr: lit(true) },
          reads: ["a"],
          writes: ["a"],
          confidence: "exact",
        },
        {
          id: "setFalse",
          cls: "user",
          label: { kind: "click", text: "Set false" },
          source: [],
          guard: read("a"),
          effect: { kind: "assign", var: "a", expr: lit(false) },
          reads: ["a"],
          writes: ["a"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(toggleLoop, [
      alwaysStep(
        toggleLoop,
        (_pre, _step, post) => post.a === true,
        { name: "aMustStayTrue", reads: ["a"] },
      ),
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("violated");
    expect(
      verdict?.status === "violated"
        ? verdict.trace.steps.at(-1)?.transitionId
        : undefined,
    ).toBe("setFalse");
    expect(result.diagnostics?.storage?.edgeRecordingMode).toBe("none");
  });

  it("skips edge recording for always and reachable property sets", () => {
    const independentBits: Model = {
      schemaVersion: 1,
      id: "oracle-independent-bits-storage",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "a",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "b",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
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
          confidence: "exact",
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
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(independentBits, [
      always(independentBits, () => true, {
        name: "trivialAlways",
        reads: ["a", "b"],
      }),
      reachable(independentBits, (state) => state.a === true, {
        name: "aReachable",
        reads: ["a"],
      }),
    ]);
    expect(result.diagnostics?.storage).toMatchObject({
      edgeRecordingMode: "none",
      recordedEdges: 0,
    });
    expect(result.stats.edges).toBe(4);
  });

  it("reconstructs traces with correct pre/post state diffs after compact parent storage", () => {
    const m = model();
    const result = checkModel(m, [
      reachable(m, (state) => state.done === true, {
        name: "doneReachable",
        reads: ["done"],
      }),
    ]);
    const verdict = result.verdicts[0];
    expect(verdict?.status).toBe("reachable");
    const submitStep =
      verdict?.status === "reachable"
        ? verdict.trace.steps.find((step) => step.transitionId === "submit")
        : undefined;
    expect(submitStep?.diff.status).toEqual({
      before: "idle",
      after: "posting",
    });
    expect(submitStep?.pre.status).toBe("idle");
    expect(submitStep?.post.status).toBe("posting");
  });

  it("uses compact edge recording for leadsToWithin and reverse recording for reachableFrom", () => {
    const m = model();
    const leadsResult = checkModel(m, [
      leadsToWithin(
        m,
        (step) => step.enqueued("POST"),
        (state) => state.done === true || state.status === "failed",
        { name: "submitSettles", budget: { environment: 1 } },
      ),
    ]);
    expect(leadsResult.diagnostics?.storage?.edgeRecordingMode).toBe("compact");
    expect(leadsResult.diagnostics?.storage?.recordedEdges).toBe(
      leadsResult.stats.edges,
    );

    const reachResult = checkModel(m, [
      reachableFrom(
        m,
        (state) => state.status === "failed",
        (state) => state.auth === true,
        { name: "failedCanRemainAuthed" },
      ),
    ]);
    expect(reachResult.diagnostics?.storage?.edgeRecordingMode).toBe("reverse");
    expect(reachResult.diagnostics?.storage?.recordedEdges).toBe(
      reachResult.stats.edges,
    );
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
          effect: {
            kind: "opaque",
            ref: {
              module: "test/checker/opaque-effects.cjs",
              export: "setDone",
              declaredReads: [],
              declaredWrites: ["done"],
            },
          },
          reads: [],
          writes: ["done"],
          confidence: "manual",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.done === true, {
        name: "doneViaOpaque",
        reads: ["done"],
      }),
    ]);
    expect(result.verdicts[0]?.status).toBe("reachable");

    const undeclaredWrite: Model = {
      ...m,
      transitions: [
        {
          ...firstTransition(m),
          effect: {
            kind: "opaque",
            ref: {
              module: "test/checker/opaque-effects.cjs",
              export: "writeUndeclared",
              declaredReads: [],
              declaredWrites: ["done"],
            },
          },
        },
      ],
    };
    expect(() => checkModel(undeclaredWrite, [])).toThrow(
      "wrote undeclared var auth",
    );

    const invalidValue: Model = {
      ...m,
      transitions: [
        {
          ...firstTransition(m),
          effect: {
            kind: "opaque",
            ref: {
              module: "test/checker/opaque-effects.cjs",
              export: "invalidDone",
              declaredReads: [],
              declaredWrites: ["done"],
            },
          },
        },
      ],
    };
    expect(() => checkModel(invalidValue, [])).toThrow(
      "produced invalid value for done",
    );

    const nondeterministic: Model = {
      ...m,
      transitions: [
        {
          ...firstTransition(m),
          effect: {
            kind: "opaque",
            ref: {
              module: "test/checker/opaque-effects.cjs",
              export: "nondeterministicDone",
              declaredReads: [],
              declaredWrites: ["done"],
            },
          },
        },
      ],
    };
    expect(() => checkModel(nondeterministic, [])).toThrow(
      "returned nondeterministic results for identical input",
    );
  });

  it("reports run-level vacuity warnings", () => {
    const m: Model = {
      ...model(),
      vars: [
        ...model().vars,
        {
          id: "neverMode",
          domain: { kind: "enum", values: ["seen", "missing"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "seen",
        },
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
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, []);
    expect(result.vacuityWarnings).toContain(
      "transition never enabled: neverEnabled",
    );
    expect(result.vacuityWarnings).toContain(
      "enum value never inhabited: neverMode=missing",
    );
  });

  it("checks properties on conservative slices when reads are declared", () => {
    const m: Model = {
      ...model(),
      vars: [
        ...model().vars,
        {
          id: "unrelated",
          domain: { kind: "enum", values: ["cold", "hot"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "cold",
        },
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
          confidence: "exact",
        },
      ],
    };
    const props: Property[] = [
      always(m, (s) => !(s.done === true && s.draft === "empty"), {
        name: "badDoneInvariant",
        reads: ["done", "draft"],
      }),
      reachable(m, (s) => s.done === true, {
        name: "doneReachable",
        reads: ["done"],
      }),
    ];
    const sliced = checkModel(m, props, { slicing: true });
    const full = checkModel(m, props);
    expect(sliced.verdicts.map((v) => [v.property, v.status])).toEqual(
      full.verdicts.map((v) => [v.property, v.status]),
    );
    expect(
      sliceModel(m, ["done", "draft"]).vars.map((decl) => decl.id),
    ).not.toContain("unrelated");
  });

  it("checks sliced properties using inferred state reads", () => {
    const m = model();
    const props: Property[] = [
      always(m, (s) => !(s.done === true && s.draft === "empty"), {
        name: "badDoneInvariant",
      }),
      reachable(m, (s) => s.done === true, { name: "doneReachable" }),
    ];
    const full = checkModel(m, props);
    const sliced = checkModel(m, props, { slicing: true });
    expect(props.map((property) => [property.name, property.reads])).toEqual([
      ["badDoneInvariant", ["done", "draft"]],
      ["doneReachable", ["done"]],
    ]);
    expect(sliced.verdicts.map((v) => [v.property, v.status])).toEqual(
      full.verdicts.map((v) => [v.property, v.status]),
    );
  });

  it("reports property errors when declared reads omit accessed state vars", () => {
    const m = model();
    const result = checkModel(m, [
      always(m, (state) => state.done !== true, {
        name: "badStateReads",
        reads: [],
      }),
      alwaysStep(m, (pre) => pre.auth !== "guest", {
        name: "badStepReads",
        reads: [],
      }),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict]),
    );
    expect(byName.get("badStateReads")?.status).toBe("error");
    expect(
      byName.get("badStateReads")?.status === "error"
        ? byName.get("badStateReads")?.message
        : "",
    ).toContain("read undeclared var done");
    expect(byName.get("badStepReads")?.status).toBe("error");
    expect(
      byName.get("badStepReads")?.status === "error"
        ? byName.get("badStepReads")?.message
        : "",
    ).toContain("read undeclared var auth");
  });

  it("runs all same-batch non-conflicting internal transitions in deterministic order", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "internal-batch",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "source",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "a",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "b",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
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
          confidence: "exact",
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
          confidence: "exact",
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
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (s) => s.a === true && s.b === true, {
        name: "bothInternalEffectsRan",
        reads: ["a", "b"],
      }),
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
          initial: [],
        },
        {
          id: "source",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "x",
          domain: { kind: "enum", values: ["unset", "a", "b"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "unset",
        },
        {
          id: "seen",
          domain: { kind: "enum", values: ["unset", "sawA", "sawB"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "unset",
        },
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
          confidence: "exact",
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
              {
                kind: "assign",
                var: "seen",
                expr: {
                  kind: "cond",
                  args: [
                    { kind: "eq", args: [read("x"), lit("b")] },
                    lit("sawB"),
                    read("seen"),
                  ],
                },
              },
              { kind: "assign", var: "x", expr: lit("a") },
            ],
          },
          reads: ["source", "x", "seen"],
          writes: ["x", "seen"],
          confidence: "exact",
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
              {
                kind: "assign",
                var: "seen",
                expr: {
                  kind: "cond",
                  args: [
                    { kind: "eq", args: [read("x"), lit("a")] },
                    lit("sawA"),
                    read("seen"),
                  ],
                },
              },
              { kind: "assign", var: "x", expr: lit("b") },
            ],
          },
          reads: ["source", "x", "seen"],
          writes: ["x", "seen"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (s) => s.x === "b" && s.seen === "sawA", {
        name: "aThenBReachable",
        reads: ["x", "seen"],
      }),
      reachable(m, (s) => s.x === "a" && s.seen === "sawB", {
        name: "bThenAReachable",
        reads: ["x", "seen"],
      }),
    ]);
    expect(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    ).toEqual([
      ["aThenBReachable", "reachable"],
      ["bThenAReachable", "reachable"],
    ]);
    expect(result.stats).toEqual({ states: 3, edges: 2, depth: 1 });
  });

  it("resets route-local state on remount and disables off-route local transitions", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local",
      bounds: { maxDepth: 5, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
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
        {
          id: "local:A.draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "typeDraft",
          cls: "user",
          label: { kind: "input", valueClass: "nonEmpty" },
          source: [],
          guard: { kind: "eq", args: [read("local:A.draft"), lit("empty")] },
          effect: {
            kind: "assign",
            var: "local:A.draft",
            expr: lit("nonEmpty"),
          },
          reads: ["local:A.draft"],
          writes: ["local:A.draft"],
          confidence: "exact",
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
          confidence: "exact",
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
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(
        m,
        (s) =>
          s["sys:route"] === "/b" &&
          s["local:A.draft"] === "__modality_unmounted__",
        { name: "localUnmountsOnB" },
      ),
      always(
        m,
        (s) => !(s["sys:route"] === "/b" && s["local:A.draft"] === "nonEmpty"),
        { name: "cannotTypeWhileUnmounted" },
      ),
      alwaysStep(
        m,
        (pre, step, post) =>
          step.transition.id !== "back" ||
          pre["sys:route"] !== "/b" ||
          post["local:A.draft"] === "empty",
        { name: "backRemountResetsDraft" },
      ),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
    expect(byName.get("localUnmountsOnB")).toBe("reachable");
    expect(byName.get("cannotTypeWhileUnmounted")).toBe(
      "verified-within-bounds",
    );
    expect(byName.get("backRemountResetsDraft")).toBe("verified-within-bounds");
  });

  it("does not stabilize off-route internal transitions that touch route-local state", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-internal",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
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
        {
          id: "local:A.draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
          initial: "empty",
        },
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
          confidence: "exact",
        },
        {
          id: "offRouteEffect",
          cls: "internal",
          label: { kind: "internal", text: "off route effect" },
          source: [],
          triggeredBy: ["sys:route"],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "local:A.draft",
            expr: lit("nonEmpty"),
          },
          reads: ["sys:route"],
          writes: ["local:A.draft"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      always(
        m,
        (s) => !(s["sys:route"] === "/b" && s["local:A.draft"] === "nonEmpty"),
        {
          name: "offRouteInternalCannotWrite",
          reads: ["sys:route", "local:A.draft"],
        },
      ),
      reachable(
        m,
        (s) =>
          s["sys:route"] === "/b" &&
          s["local:A.draft"] === "__modality_unmounted__",
        {
          name: "offRouteLocalRemainsUnmounted",
          reads: ["sys:route", "local:A.draft"],
        },
      ),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
    expect(byName.get("offRouteInternalCannotWrite")).toBe(
      "verified-within-bounds",
    );
    expect(byName.get("offRouteLocalRemainsUnmounted")).toBe("reachable");
  });

  it("exposes generic navigation step facts", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "navigation-step-facts",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: twoRoutes, maxLen: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
      ],
      transitions: [
        {
          id: "pushB",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/b" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };

    const result = checkModel(m, [
      alwaysStep(
        m,
        (_pre, step) =>
          step.transition.id !== "pushB" ||
          (step.navigated() && step.navigatedTo("/b")),
        { name: "pushReportsNavigation", reads: ["sys:route"] },
      ),
    ]);
    expect(result.verdicts[0]).toMatchObject({
      status: "verified-within-bounds",
      property: "pushReportsNavigation",
    });
  });

  it("reports pending-cap bound hits", () => {
    const m: Model = {
      ...model(),
      bounds: { ...model().bounds, maxPending: 1 },
      vars: model().vars.map((decl) =>
        decl.id === "sys:pending" && decl.domain.kind === "boundedList"
          ? { ...decl, domain: { ...decl.domain, maxLen: 1 } }
          : decl,
      ),
      transitions: [
        {
          id: "spam",
          cls: "user",
          label: { kind: "click", text: "Spam" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "enqueue",
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
    const result = checkModel(m, [
      reachable(
        m,
        (s) => Array.isArray(s["sys:pending"]) && s["sys:pending"].length === 1,
        { name: "onePendingReachable" },
      ),
    ]);
    expect(result.boundHits).toContain("pending cap saturated at spam");
  });

  it("reports history-cap bound hits on push navigation", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "history-bound",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: twoRoutes, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "sys:pending",
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
      ],
      transitions: [
        {
          id: "pushB",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/b" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };

    const result = checkModel(m, [
      reachable(m, (s) => s["sys:route"] === "/b", {
        name: "pushedB",
        reads: ["sys:route"],
      }),
    ]);
    expect(result.verdicts[0]).toMatchObject({
      status: "vacuous-warning",
      property: "pushedB",
    });
    expect(result.boundHits).toContain("history cap saturated at pushB");
  });

  it("reports max-depth bound hits only when enabled transitions remain at the boundary", () => {
    const bounded: Model = {
      ...model(),
      bounds: { ...model().bounds, maxDepth: 0 },
    };
    const boundedResult = checkModel(bounded, [
      always(bounded, () => true, { name: "ok" }),
    ]);
    expect(boundedResult.boundHits).toEqual(["maxDepth reached before login"]);
    expect(boundedResult.vacuityWarnings).not.toContain(
      "transition never enabled: login",
    );

    const terminal: Model = {
      ...model(),
      transitions: [],
      bounds: { ...model().bounds, maxDepth: 0 },
    };
    const terminalResult = checkModel(terminal, [
      always(terminal, () => true, { name: "ok" }),
    ]);
    expect(terminalResult.boundHits).toEqual([]);
  });

  it("reports token bound hits when freshToken is exhausted", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "token-bound",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "current",
          domain: { kind: "tokens", count: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
        {
          id: "next",
          domain: { kind: "tokens", count: 1 },
          origin: "system",
          scope: { kind: "global" },
          initial: "tok1",
        },
      ],
      transitions: [
        {
          id: "allocate",
          cls: "user",
          label: { kind: "click", text: "Allocate" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "next",
            expr: { kind: "freshToken", domainOf: "current" },
          },
          reads: [],
          writes: ["next"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.next === "tok1", {
        name: "onlyInitialReachable",
        reads: ["next"],
      }),
    ]);
    expect(result.stats.edges).toBe(0);
    expect(result.boundHits).toContain("token cap exhausted at allocate");
  });

  it("preserves enabled() verdicts and witnesses when slicing is enabled", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "enabled-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "mode",
          domain: { kind: "enum", values: ["closed", "open"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "closed",
        },
        {
          id: "clicked",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
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
          confidence: "exact",
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
          confidence: "exact",
        },
      ],
    };
    const props = [
      always(m, (state) => !enabled(m, "go")(state), {
        name: "goNeverEnabled",
        reads: [],
      }),
      reachable(m, (state) => state.clicked === true, {
        name: "goCanClick",
        reads: ["clicked"],
      }),
    ];
    const unsliced = checkModel(m, props);
    const sliced = checkModel(m, props, { slicing: true });
    expect(
      sliced.verdicts.map((verdict) => [verdict.property, verdict.status]),
    ).toEqual(
      unsliced.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
    expect(
      sliced.verdicts.map((verdict) =>
        "trace" in verdict
          ? verdict.trace.steps.map((step) => step.transitionId)
          : [],
      ),
    ).toEqual(
      unsliced.verdicts.map((verdict) =>
        "trace" in verdict
          ? verdict.trace.steps.map((step) => step.transitionId)
          : [],
      ),
    );
  });

  it("explores conflicting internal transition orders during stabilization", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "internal-conflict",
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
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
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.value === "a", {
        name: "aReachable",
        reads: ["value"],
      }),
      reachable(m, (state) => state.value === "b", {
        name: "bReachable",
        reads: ["value"],
      }),
    ]);
    expect(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    ).toEqual([
      ["aReachable", "reachable"],
      ["bReachable", "reachable"],
    ]);
  });

  it("runs triggered internal transitions only when their dependency vars changed", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "triggered-internal",
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
          initial: [],
        },
        {
          id: "source",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "target",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
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
          confidence: "exact",
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
          confidence: "exact",
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
          triggeredBy: ["source"],
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.source === true && state.target === true, {
        name: "triggerRuns",
        reads: ["source", "target"],
      }),
      reachable(m, (state) => state.source === true && state.target === false, {
        name: "unrelatedTargetWriteDoesNotRetrigger",
        reads: ["source", "target"],
      }),
    ]);
    expect(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    ).toEqual([
      ["triggerRuns", "reachable"],
      ["unrelatedTargetWriteDoesNotRetrigger", "reachable"],
    ]);
  });

  it("matches an explicit finite-state oracle for branching bounded reachability", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "finite-oracle",
      bounds: { maxDepth: 3, maxPending: 0, maxInternalSteps: 4 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "phase",
          domain: { kind: "enum", values: ["start", "middle", "done"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "start",
        },
        {
          id: "flag",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "begin",
          cls: "user",
          label: { kind: "click", text: "Begin" },
          source: [],
          guard: { kind: "eq", args: [read("phase"), lit("start")] },
          effect: { kind: "assign", var: "phase", expr: lit("middle") },
          reads: ["phase"],
          writes: ["phase"],
          confidence: "exact",
        },
        {
          id: "finish",
          cls: "user",
          label: { kind: "click", text: "Finish" },
          source: [],
          guard: { kind: "eq", args: [read("phase"), lit("middle")] },
          effect: { kind: "assign", var: "phase", expr: lit("done") },
          reads: ["phase"],
          writes: ["phase"],
          confidence: "exact",
        },
        {
          id: "flip",
          cls: "env",
          label: { kind: "timer", key: "flip" },
          source: [],
          guard: { kind: "eq", args: [read("phase"), lit("middle")] },
          effect: { kind: "havoc", var: "flag" },
          reads: ["phase"],
          writes: ["flag"],
          confidence: "over-approx",
        },
      ],
    };
    const expected = [
      { phase: "start", flag: false },
      { phase: "middle", flag: false },
      { phase: "done", flag: false },
      { phase: "middle", flag: true },
      { phase: "done", flag: true },
    ];
    const result = checkModel(m, [
      ...expected.map((state, index) =>
        reachable(
          m,
          (candidate) =>
            candidate.phase === state.phase && candidate.flag === state.flag,
          { name: `oracle${index}` },
        ),
      ),
      reachable(m, (state) => state.phase === "start" && state.flag === true, {
        name: "oracleImpossible",
      }),
    ]);

    expect(result.stats).toEqual({ states: 5, edges: 7, depth: 3 });
    expect(
      result.verdicts
        .slice(0, expected.length)
        .every((verdict) => verdict.status === "reachable"),
    ).toBe(true);
    expect(result.verdicts.at(-1)).toMatchObject({
      property: "oracleImpossible",
      status: "vacuous-warning",
    });
  });

  it("runs reusable structured oracle corpus cases", () => {
    for (const oracle of checkerOracleCorpus()) {
      const reachability = [
        ...oracle.reachable.map((expected, index) =>
          reachable(
            oracle.model,
            (state) => partialStateMatches(state, expected),
            { name: `${oracle.name}:reachable:${index}` },
          ),
        ),
        ...oracle.unreachable.map((expected, index) =>
          reachable(
            oracle.model,
            (state) => partialStateMatches(state, expected),
            { name: `${oracle.name}:unreachable:${index}` },
          ),
        ),
        leadsToWithin(
          oracle.model,
          (step) => step.enqueued(oracle.boundedResponse.triggerOp),
          (state) => state[oracle.boundedResponse.goalVar] === "done",
          {
            name: `${oracle.name}:bounded-response`,
            budget: oracle.boundedResponse.budget,
          },
        ),
      ];
      const result = checkModel(oracle.model, reachability);
      expect(result.stats, oracle.name).toEqual(oracle.stats);
      expect(
        result.verdicts
          .slice(0, oracle.reachable.length)
          .every((verdict) => verdict.status === "reachable"),
        oracle.name,
      ).toBe(true);
      expect(
        result.verdicts
          .slice(
            oracle.reachable.length,
            oracle.reachable.length + oracle.unreachable.length,
          )
          .every((verdict) => verdict.status === "vacuous-warning"),
        oracle.name,
      ).toBe(true);
      expect(result.verdicts.at(-1), oracle.name).toMatchObject({
        status: oracle.boundedResponse.status,
      });
    }
  });

  it("does not retain unrelated sys:history in slices for local-only properties", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "history-noise",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          id: "counter",
          domain: { kind: "enum", values: ["zero", "one"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "zero",
        },
      ],
      transitions: [
        {
          id: "bump",
          cls: "user",
          label: { kind: "click", text: "Bump" },
          source: [],
          guard: { kind: "eq", args: [read("counter"), lit("zero")] },
          effect: { kind: "assign", var: "counter", expr: lit("one") },
          reads: ["counter"],
          writes: ["counter"],
          confidence: "exact",
        },
        {
          id: "navigateAway",
          cls: "user",
          label: { kind: "click", text: "Navigate" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "navigate",
            to: "/other",
            pushHistory: true,
          },
          reads: ["sys:route"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["counter"]);
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("sys:history");
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "bump",
    ]);
  });

  it("keeps minimum route var for route-local properties with mount semantics", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "local:/a.panel",
          domain: bool,
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "openPanel",
          cls: "user",
          label: { kind: "click", text: "Open" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: "local:/a.panel",
            expr: lit(true),
          },
          reads: ["local:/a.panel", "sys:route"],
          writes: ["local:/a.panel"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["local:/a.panel"]);
    expect(sliced.vars.map((decl) => decl.id)).toContain("sys:route");
    expect(sliced.vars.map((decl) => decl.id)).toContain("local:/a.panel");
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "openPanel",
    ]);
  });

  it("keeps navigation transitions that reset route-local vars", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-nav-slice",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: twoRoutes, maxLen: 1 },
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
        {
          id: "local:/a.panel",
          domain: bool,
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
          initial: true,
        },
      ],
      transitions: [
        {
          id: "navigateAway",
          cls: "user",
          label: { kind: "click", text: "Navigate" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["local:/a.panel"]);
    expect(sliced.transitions.map((transition) => transition.id)).toContain(
      "navigateAway",
    );
    expect(sliced.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining(["local:/a.panel", "sys:route", "sys:history"]),
    );
  });

  it("keeps sliced route-local verdicts sound when navigation unmounts state", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-nav-verdict",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: twoRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/a",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: twoRoutes, maxLen: 1 },
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
        {
          id: "local:/a.panel",
          domain: bool,
          origin: "system",
          scope: { kind: "route-local", route: "/a" },
          initial: true,
        },
      ],
      transitions: [
        {
          id: "navigateAway",
          cls: "user",
          label: { kind: "click", text: "Navigate" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };
    const props = [
      always(m, (state) => state["local:/a.panel"] === true, {
        name: "panelStaysMounted",
        reads: ["local:/a.panel"],
      }),
    ];
    const unsliced = checkModel(m, props);
    const sliced = checkModel(m, props, { slicing: true });
    expect(unsliced.verdicts[0]?.status).toBe("violated");
    expect(sliced.verdicts[0]?.status).toBe("violated");
    expect(sliced.verdicts[0]?.status).toBe(unsliced.verdicts[0]?.status);
  });

  it("drops reader-only transitions that do not write into the property cone", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "reader-only",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
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
          initial: [],
        },
        {
          id: "needed",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "noise",
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
          guard: { kind: "eq", args: [read("needed"), lit(false)] },
          effect: { kind: "assign", var: "needed", expr: lit(true) },
          reads: ["needed"],
          writes: ["needed"],
          confidence: "exact",
        },
        {
          id: "readerOnly",
          cls: "user",
          label: { kind: "click", text: "Read" },
          source: [],
          guard: { kind: "eq", args: [read("needed"), lit(true)] },
          effect: { kind: "assign", var: "noise", expr: lit(true) },
          reads: ["needed"],
          writes: ["noise"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["needed"]);
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "writer",
    ]);
    const props = [
      always(m, (state) => state.needed === false, {
        name: "neededStaysFalse",
        reads: ["needed"],
      }),
    ];
    expect(
      checkModel(m, props, { slicing: true }).verdicts.map((verdict) => [
        verdict.property,
        verdict.status,
      ]),
    ).toEqual(
      checkModel(m, props).verdicts.map((verdict) => [
        verdict.property,
        verdict.status,
      ]),
    );
  });

  it("stops gracefully when maxStates is exceeded", () => {
    const m = model();
    const props: Property[] = [
      reachable(m, (state) => state.done === true, {
        name: "doneReachable",
        reads: ["done"],
      }),
      always(m, (state) => state.draft !== "missing", {
        name: "draftKnown",
        reads: ["draft"],
      }),
    ];
    const result = checkModel(m, props, { maxStates: 1 });
    expect(result.diagnostics?.limits?.reason).toContain("maxStates=1");
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict]),
    );
    expect(byName.get("doneReachable")?.status).toBe("error");
    expect(
      byName.get("doneReachable")?.status === "error"
        ? byName.get("doneReachable")?.message
        : "",
    ).toContain("search limit exceeded");
  });

  it("reports search diagnostics with frontier and depth stats", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "independent-diagnostic-slices",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 2 },
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
          initial: [],
        },
        {
          id: "a",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "b",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "setA",
          cls: "user",
          label: { kind: "click", text: "A" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "a", expr: lit(true) },
          reads: [],
          writes: ["a"],
          confidence: "exact",
        },
        {
          id: "setB",
          cls: "user",
          label: { kind: "click", text: "B" },
          source: [],
          guard: lit(true),
          effect: { kind: "assign", var: "b", expr: lit(true) },
          reads: [],
          writes: ["b"],
          confidence: "exact",
        },
      ],
    };
    const props: Property[] = [
      always(m, (state) => state.a !== true, {
        name: "notA",
        reads: ["a"],
      }),
      always(m, (state) => state.b !== true, {
        name: "notB",
        reads: ["b"],
      }),
    ];
    const result = checkModel(m, props, { slicing: true });
    expect(result.diagnostics?.search).toMatchObject({
      maxFrontier: expect.any(Number),
      finalFrontier: expect.any(Number),
      expandedDepths: expect.any(Number),
    });
    expect(result.diagnostics?.slicing).toMatchObject({
      enabled: true,
      slices: expect.any(Number),
    });
    expect(result.diagnostics?.slicing?.slices).toBeGreaterThan(1);
    expect(result.diagnostics?.storage).toMatchObject({
      edgeRecordingMode: "none",
      recordedEdges: 0,
      storedStates: result.stats.states,
      parentEntries: result.stats.states,
    });
  });

  it("stops mid-depth when maxEdges is exceeded", () => {
    const m = highBranchingModel();
    const props: Property[] = [
      reachable(m, (state) => state.choice === "b9", {
        name: "lastBranchReachable",
        reads: ["choice"],
      }),
    ];
    const result = checkModel(m, props, { maxEdges: 2 });
    expect(result.diagnostics?.limits?.reason).toContain("maxEdges=2");
    expect(result.diagnostics?.limits?.maxEdges).toBe(2);
    expect(result.stats.edges).toBeLessThanOrEqual(2);
    expect(result.stats.edges).toBeLessThan(10);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict]),
    );
    expect(byName.get("lastBranchReachable")?.status).toBe("error");
    expect(
      byName.get("lastBranchReachable")?.status === "error"
        ? byName.get("lastBranchReachable")?.message
        : "",
    ).toContain("search limit exceeded");
  });

  it("stops mid-depth when maxFrontier is exceeded", () => {
    const m = highBranchingModel();
    const props: Property[] = [
      reachable(m, (state) => state.choice === "b9", {
        name: "lastBranchReachable",
        reads: ["choice"],
      }),
    ];
    const result = checkModel(m, props, { maxFrontier: 2 });
    expect(result.diagnostics?.limits?.reason).toContain("maxFrontier=2");
    expect(result.diagnostics?.limits?.maxFrontier).toBe(2);
    expect(result.diagnostics?.search?.maxFrontier).toBeLessThanOrEqual(2);
    expect(result.diagnostics?.search?.maxFrontier).toBeLessThan(10);
    expect(result.stats.states).toBeLessThanOrEqual(3);
  });

  it("pins deterministic state and edge counts for many independent toggles", () => {
    const toggleCount = 8;
    const toggleIds = Array.from({ length: toggleCount }, (_, index) => `t${index}`);
    const m: Model = {
      schemaVersion: 1,
      id: "hot-path-independent-toggles",
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
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
    const result = checkModel(m, [
      reachable(
        m,
        (state) => toggleIds.every((id) => state[id] === true),
        { name: "allToggled", reads: toggleIds },
      ),
    ]);
    expect(result.stats).toEqual({ states: 256, edges: 1024, depth: 8 });
    expect(result.verdicts[0]?.status).toBe("reachable");
    expect(result.diagnostics?.hotPath).toMatchObject({
      canonicalCache: true,
      transitionIndex: true,
      internalTransitionIndex: false,
    });
  });

  it("keeps indexed guard transitions as candidates when guards become true later", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "indexed-guard-later-true",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "armed",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "done",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "arm",
          cls: "user",
          label: { kind: "click", text: "Arm" },
          source: [],
          guard: { kind: "not", args: [read("armed")] },
          effect: { kind: "assign", var: "armed", expr: lit(true) },
          reads: ["armed"],
          writes: ["armed"],
          confidence: "exact",
        },
        {
          id: "finish",
          cls: "user",
          label: { kind: "click", text: "Finish" },
          source: [],
          guard: read("armed"),
          effect: { kind: "assign", var: "done", expr: lit(true) },
          reads: ["armed"],
          writes: ["done"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.done === true, {
        name: "canFinishAfterArm",
        reads: ["done"],
      }),
    ]);
    expect(result.stats).toEqual({ states: 3, edges: 2, depth: 2 });
    expect(result.verdicts[0]?.status).toBe("reachable");
  });

  it("still stabilizes internal transitions without triggeredBy on every pass", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "always-triggered-internal",
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 4 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "stamped",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
      ],
      transitions: [
        {
          id: "stamp",
          cls: "internal",
          label: { kind: "internal", text: "stamp" },
          source: [],
          guard: { kind: "not", args: [read("stamped")] },
          effect: { kind: "assign", var: "stamped", expr: lit(true) },
          reads: ["stamped"],
          writes: ["stamped"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.stamped === true, {
        name: "stampedOnInit",
        reads: ["stamped"],
      }),
    ]);
    expect(result.stats).toEqual({ states: 1, edges: 0, depth: 1 });
    expect(result.verdicts[0]?.status).toBe("reachable");
    expect(result.diagnostics?.hotPath?.internalTransitionIndex).toBe(true);
  });

  it("fires triggeredBy internal transitions only when the triggering var changes", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "triggered-by-internal-only-on-change",
      bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "source",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "derived",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
        {
          id: "noise",
          domain: bool,
          origin: "system",
          scope: { kind: "global" },
          initial: false,
        },
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
          confidence: "exact",
        },
        {
          id: "flipNoise",
          cls: "user",
          label: { kind: "click", text: "Noise" },
          source: [],
          guard: read("source"),
          effect: { kind: "assign", var: "noise", expr: lit(true) },
          reads: ["source", "noise"],
          writes: ["noise"],
          confidence: "exact",
        },
        {
          id: "derive",
          cls: "internal",
          label: { kind: "internal", text: "derive" },
          source: [],
          triggeredBy: ["source"],
          guard: read("source"),
          effect: { kind: "assign", var: "derived", expr: lit(true) },
          reads: ["source"],
          writes: ["derived"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(m, (state) => state.derived === true, {
        name: "derivedFromSource",
        reads: ["derived"],
      }),
      reachable(m, (state) => state.noise === true, {
        name: "noiseReachable",
        reads: ["noise"],
      }),
    ]);
    expect(result.stats).toEqual({ states: 3, edges: 2, depth: 2 });
    expect(
      result.verdicts.find((verdict) => verdict.property === "derivedFromSource")
        ?.status,
    ).toBe("reachable");
    expect(
      result.verdicts.find((verdict) => verdict.property === "noiseReachable")
        ?.status,
    ).toBe("reachable");
  });
});

function highBranchingModel(): Model {
  const branchValues = [
    "start",
    "b0",
    "b1",
    "b2",
    "b3",
    "b4",
    "b5",
    "b6",
    "b7",
    "b8",
    "b9",
  ] as const;
  return {
    schemaVersion: 1,
    id: "high-branching",
    bounds: { maxDepth: 2, maxPending: 0, maxInternalSteps: 4 },
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
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 0 },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "choice",
        domain: { kind: "enum", values: [...branchValues] },
        origin: "system",
        scope: { kind: "global" },
        initial: "start",
      },
    ],
    transitions: Array.from({ length: 10 }, (_, index) => ({
      id: `toB${index}`,
      cls: "user" as const,
      label: { kind: "click" as const, text: `Branch ${index}` },
      source: [],
      guard: { kind: "eq" as const, args: [read("choice"), lit("start")] },
      effect: {
        kind: "assign" as const,
        var: "choice",
        expr: lit(`b${index}`),
      },
      reads: ["choice"],
      writes: ["choice"],
      confidence: "exact" as const,
    })),
  };
}

function partialStateMatches(
  state: Record<string, unknown>,
  expected: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(
    ([key, value]) => JSON.stringify(state[key]) === JSON.stringify(value),
  );
}
