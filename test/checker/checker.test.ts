import {
  checkModel,
  modelInitialStates,
  propertySliceMode,
  sliceModel,
  sliceModelForCheckProperty,
  targetedAlwaysStepTransitionIds,
} from "modality-ts/check";
import {
  always,
  alwaysStep,
  andExpr,
  lit as coreLit,
  enabled,
  enabledTransitionPrefix,
  eq,
  leadsToWithin,
  type Model,
  neq,
  notExpr,
  orExpr,
  type Property,
  reachable,
  reachableFrom,
  readVar,
  stepAny,
  stepEnqueued,
  stepTransitionId,
  UNMOUNTED,
} from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { routeMountScope } from "../../src/extract/engine/ts/routes.js";
import { checkerOracleCorpus } from "./oracle-corpus.js";

function lit(value: unknown) {
  return coreLit(value as never);
}

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

function partialStateExpr(expected: Record<string, unknown>) {
  return andExpr(
    ...Object.entries(expected).map(([key, value]) =>
      eq(readVar(key), lit(value)),
    ),
  );
}

function tagsOneDialogOpenInvariant() {
  const createOpen = eq(readVar("local:Tags.createOpen"), lit(true));
  const editOpen = neq(readVar("local:Tags.editTarget"), lit("none"));
  const deleteOpen = neq(readVar("local:Tags.deleteTarget"), lit("none"));
  return andExpr(
    notExpr(andExpr(createOpen, editOpen)),
    notExpr(andExpr(createOpen, deleteOpen)),
    notExpr(andExpr(editOpen, deleteOpen)),
  );
}

function firstTransition(model: Model): Model["transitions"][number] {
  const transition = model.transitions[0];
  if (!transition) throw new Error("Fixture is missing first transition");
  return transition;
}

describe("checker", () => {
  it("reaches the native binding and returns a shaped CheckResult", () => {
    const m = model();
    const result = checkModel(m, []);
    expect(result).toMatchObject({
      verdicts: [],
      stats: expect.objectContaining({
        states: expect.any(Number),
        edges: expect.any(Number),
        depth: expect.any(Number),
      }),
      vacuityWarnings: expect.any(Array),
      boundHits: expect.any(Array),
    });
  });

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
          scope: routeMountScope("/a"),
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
      reachable(routeLocalModel, eq(readVar("local:Page.choice"), lit("y")), {
        name: "canMountY",
      }),
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
      reachable(tokenModel, neq(readVar("next"), lit("userA")), {
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
      reachable(taggedModel, eq(readVar("entered"), lit(true)), {
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
      always(
        m,
        notExpr(
          andExpr(
            eq(readVar("done"), lit(true)),
            eq(readVar("draft"), lit("empty")),
          ),
        ),
        {
          name: "badDoneInvariant",
        },
      ),
      alwaysStep(
        m,
        {
          negate: true,
          step: stepEnqueued("POST"),
          pre: eq(readVar("auth"), lit(false)),
        },
        { name: "guestCannotSubmit" },
      ),
      reachable(m, eq(readVar("done"), lit(true)), { name: "doneReachable" }),
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
        stepEnqueued("POST"),
        orExpr(
          eq(readVar("done"), lit(true)),
          eq(readVar("status"), lit("failed")),
        ),
        { name: "submitSettles", budget: { environment: 1 } },
      ),
      reachableFrom(
        m,
        eq(readVar("status"), lit("failed")),
        eq(readVar("auth"), lit(true)),
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
        stepEnqueued("POST"),
        orExpr(
          eq(readVar("done"), lit(true)),
          eq(readVar("status"), lit("failed")),
        ),
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
        eq(readVar("status"), lit("failed")),
        eq(readVar("done"), lit(true)),
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
      reachable(m, eq(readVar("done"), lit(true)), {
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
      leadsToWithin(m, stepEnqueued("POST"), eq(readVar("done"), lit(true)), {
        name: "submitDoneImmediately",
        budget: { environment: 0 },
      }),
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
        stepTransitionId("fire"),
        eq(readVar("done"), lit(true)),
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

  it("treats route-local transitionId leadsToWithin triggers as fired", () => {
    const customerRoute = { kind: "enum", values: ["/customer"] } as const;
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-transitionid-leads-to",
      bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: customerRoute,
          origin: "system",
          scope: { kind: "global" },
          initial: "/customer",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: customerRoute, maxLen: 1 },
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
          id: "local:CustomerHome.isPrinterSettingsOpen",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/customer"),
          initial: false,
        },
      ],
      transitions: [
        {
          id: "CustomerHome.onClick.isPrinterSettingsOpen",
          cls: "user",
          label: { kind: "click", text: "Printer settings" },
          source: [],
          guard: {
            kind: "not",
            args: [read("local:CustomerHome.isPrinterSettingsOpen")],
          },
          effect: {
            kind: "assign",
            var: "local:CustomerHome.isPrinterSettingsOpen",
            expr: lit(true),
          },
          reads: ["local:CustomerHome.isPrinterSettingsOpen"],
          writes: ["local:CustomerHome.isPrinterSettingsOpen"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      reachable(
        m,
        eq(readVar("local:CustomerHome.isPrinterSettingsOpen"), lit(true)),
        { name: "printerSettingsOpenReachable" },
      ),
      leadsToWithin(
        m,
        stepTransitionId("CustomerHome.onClick.isPrinterSettingsOpen"),
        eq(readVar("local:CustomerHome.isPrinterSettingsOpen"), lit(true)),
        {
          name: "printerSettingsOpenClickImmediatelyOpensDialog",
          budget: { steps: 0, environment: 0 },
          enabledTransitions: ["CustomerHome.onClick.isPrinterSettingsOpen"],
        },
      ),
    ]);
    const reachableVerdict = result.verdicts.find(
      (v) => v.property === "printerSettingsOpenReachable",
    );
    expect(reachableVerdict?.status).toBe("reachable");
    expect(
      reachableVerdict?.status === "reachable"
        ? reachableVerdict.trace.steps.map((step) => step.transitionId)
        : [],
    ).toEqual(["CustomerHome.onClick.isPrinterSettingsOpen"]);
    const leadsToVerdict = result.verdicts.find(
      (v) => v.property === "printerSettingsOpenClickImmediatelyOpensDialog",
    );
    expect(leadsToVerdict?.status).toBe("verified-within-bounds");
    expect(leadsToVerdict?.status).not.toBe("vacuous-warning");
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
      leadsToWithin(m, stepEnqueued("POST"), eq(readVar("done"), lit(true)), {
        name: "settlesWithoutUserInterference",
        budget: { environment: 1 },
        reads: ["done"],
      }),
      leadsToWithin(m, stepEnqueued("POST"), eq(readVar("done"), lit(true)), {
        name: "adversarialUserCanDelaySettlement",
        budget: { environment: 1 },
        allowUserEvents: true,
        reads: ["done"],
      }),
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
      always(broken, lit(true), { name: "p" }),
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
        andExpr(eq(readVar("a"), lit(true)), eq(readVar("b"), lit(true))),
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
      alwaysStep(toggleLoop, stepAny(), { name: "allEdgesOk", reads: [] }),
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
        { step: stepAny(), post: eq(readVar("a"), lit(true)) },
        {
          name: "aMustStayTrue",
          reads: ["a"],
        },
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
      always(independentBits, lit(true), {
        name: "trivialAlways",
        reads: ["a", "b"],
      }),
      reachable(independentBits, eq(readVar("a"), lit(true)), {
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
      reachable(m, eq(readVar("done"), lit(true)), {
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
        stepEnqueued("POST"),
        orExpr(
          eq(readVar("done"), lit(true)),
          eq(readVar("status"), lit("failed")),
        ),
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
        eq(readVar("status"), lit("failed")),
        eq(readVar("auth"), lit(true)),
        { name: "failedCanRemainAuthed" },
      ),
    ]);
    expect(reachResult.diagnostics?.storage?.edgeRecordingMode).toBe("reverse");
    expect(reachResult.diagnostics?.storage?.recordedEdges).toBe(
      reachResult.stats.edges,
    );
  });

  it("rejects opaque effects in the Rust checker", () => {
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
      reachable(m, eq(readVar("done"), lit(true)), {
        name: "doneViaOpaque",
        reads: ["done"],
      }),
    ]);
    expect(result.verdicts[0]?.status).toBe("error");
    expect(
      result.verdicts[0]?.status === "error" ? result.verdicts[0].message : "",
    ).toContain("unsupported opaque effect");
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
      always(
        m,
        notExpr(
          andExpr(
            eq(readVar("done"), lit(true)),
            eq(readVar("draft"), lit("empty")),
          ),
        ),
        {
          name: "badDoneInvariant",
          reads: ["done", "draft"],
        },
      ),
      reachable(m, eq(readVar("done"), lit(true)), {
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
      always(
        m,
        notExpr(
          andExpr(
            eq(readVar("done"), lit(true)),
            eq(readVar("draft"), lit("empty")),
          ),
        ),
        {
          name: "badDoneInvariant",
        },
      ),
      reachable(m, eq(readVar("done"), lit(true)), { name: "doneReachable" }),
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
      always(m, neq(readVar("done"), lit(true)), {
        name: "badStateReads",
        reads: [],
      }),
      alwaysStep(
        m,
        { step: stepAny(), pre: neq(readVar("auth"), lit("guest")) },
        {
          name: "badStepReads",
          reads: [],
        },
      ),
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
      reachable(
        m,
        andExpr(eq(readVar("a"), lit(true)), eq(readVar("b"), lit(true))),
        {
          name: "bothInternalEffectsRan",
          reads: ["a", "b"],
        },
      ),
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
      reachable(
        m,
        andExpr(eq(readVar("x"), lit("b")), eq(readVar("seen"), lit("sawA"))),
        {
          name: "aThenBReachable",
          reads: ["x", "seen"],
        },
      ),
      reachable(
        m,
        andExpr(eq(readVar("x"), lit("a")), eq(readVar("seen"), lit("sawB"))),
        {
          name: "bThenAReachable",
          reads: ["x", "seen"],
        },
      ),
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
          scope: routeMountScope("/a"),
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
        andExpr(
          eq(readVar("sys:route"), lit("/b")),
          eq(readVar("local:A.draft"), lit(UNMOUNTED)),
        ),
        { name: "localUnmountsOnB", includeUnmounted: true },
      ),
      always(
        m,
        notExpr(
          andExpr(
            eq(readVar("sys:route"), lit("/b")),
            eq(readVar("local:A.draft"), lit("nonEmpty")),
          ),
        ),
        { name: "cannotTypeWhileUnmounted" },
      ),
      alwaysStep(
        m,
        {
          negate: true,
          step: stepTransitionId("back"),
          pre: eq(readVar("sys:route"), lit("/b")),
          post: neq(readVar("local:A.draft"), lit("empty")),
        },
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
          scope: routeMountScope("/a"),
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
        notExpr(
          andExpr(
            eq(readVar("sys:route"), lit("/b")),
            eq(readVar("local:A.draft"), lit("nonEmpty")),
          ),
        ),
        {
          name: "offRouteInternalCannotWrite",
          reads: ["sys:route", "local:A.draft"],
        },
      ),
      reachable(
        m,
        andExpr(
          eq(readVar("sys:route"), lit("/b")),
          eq(readVar("local:A.draft"), lit(UNMOUNTED)),
        ),
        {
          name: "offRouteLocalRemainsUnmounted",
          reads: ["sys:route", "local:A.draft"],
          includeUnmounted: true,
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

  it("evaluates route-local properties only while their locals are mounted", () => {
    const tagsRoutes = {
      kind: "enum",
      values: ["/tags", "/analytics"],
    } as const;
    const dialogTarget = {
      kind: "enum",
      values: ["none", "link-1", "link-2"],
    } as const;
    const m: Model = {
      schemaVersion: 1,
      id: "route-local-mounted",
      bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: tagsRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/tags",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: tagsRoutes, maxLen: 2 },
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
          id: "local:Tags.createOpen",
          domain: bool,
          origin: "system",
          scope: routeMountScope("/tags"),
          initial: false,
        },
        {
          id: "local:Tags.editTarget",
          domain: dialogTarget,
          origin: "system",
          scope: routeMountScope("/tags"),
          initial: "none",
        },
        {
          id: "local:Tags.deleteTarget",
          domain: dialogTarget,
          origin: "system",
          scope: routeMountScope("/tags"),
          initial: "none",
        },
      ],
      transitions: [
        {
          id: "openCreate",
          cls: "user",
          label: { kind: "click", text: "Open create" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "local:Tags.createOpen",
            expr: lit(true),
          },
          reads: ["local:Tags.createOpen"],
          writes: ["local:Tags.createOpen"],
          confidence: "exact",
        },
        {
          id: "openEdit",
          cls: "user",
          label: { kind: "click", text: "Open edit" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "local:Tags.editTarget",
            expr: lit("link-1"),
          },
          reads: ["local:Tags.editTarget"],
          writes: ["local:Tags.editTarget"],
          confidence: "exact",
        },
        {
          id: "goAnalytics",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/analytics" },
          source: [],
          guard: { kind: "eq", args: [read("sys:route"), lit("/tags")] },
          effect: {
            kind: "navigate",
            mode: "push",
            to: lit("/analytics"),
          },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };
    const dialogReads = [
      "local:Tags.createOpen",
      "local:Tags.editTarget",
      "local:Tags.deleteTarget",
    ] as const;
    const goAnalyticsTransition = m.transitions.find(
      (transition) => transition.id === "goAnalytics",
    );
    const tagsNavigationModel: Model = {
      ...m,
      transitions: goAnalyticsTransition ? [goAnalyticsTransition] : [],
    };
    const result = checkModel(m, [
      always(m, tagsOneDialogOpenInvariant(), {
        name: "tagsOnlyOneDialogOpenViolatesWhileMounted",
        reads: [...dialogReads],
      }),
      reachable(
        m,
        andExpr(
          eq(readVar("sys:route"), lit("/tags")),
          eq(readVar("local:Tags.createOpen"), lit(true)),
          eq(readVar("local:Tags.editTarget"), lit("link-1")),
        ),
        {
          name: "tagsMountedBadStateReachable",
          reads: ["sys:route", ...dialogReads],
        },
      ),
      alwaysStep(
        m,
        {
          negate: true,
          step: stepTransitionId("goAnalytics"),
          pre: eq(readVar("local:Tags.createOpen"), lit(true)),
          post: neq(readVar("local:Tags.createOpen"), lit(true)),
        },
        {
          name: "tagsStepSkipsRouteLeavingEdge",
          reads: ["local:Tags.createOpen"],
        },
      ),
      reachable(
        m,
        andExpr(
          eq(readVar("sys:route"), lit("/analytics")),
          eq(readVar("local:Tags.createOpen"), lit(true)),
        ),
        {
          name: "tagsOffRouteDialogStateUnreachable",
          reads: ["sys:route", "local:Tags.createOpen"],
        },
      ),
    ]);
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
    const navigationResult = checkModel(tagsNavigationModel, [
      always(tagsNavigationModel, tagsOneDialogOpenInvariant(), {
        name: "tagsOnlyOneDialogOpen",
        reads: [...dialogReads],
      }),
    ]);
    expect(navigationResult.verdicts[0]?.status).toBe("verified-within-bounds");
    expect(byName.get("tagsOnlyOneDialogOpenViolatesWhileMounted")).toBe(
      "violated",
    );
    expect(byName.get("tagsMountedBadStateReachable")).toBe("reachable");
    expect(byName.get("tagsStepSkipsRouteLeavingEdge")).toBe(
      "verified-within-bounds",
    );
    expect(byName.get("tagsOffRouteDialogStateUnreachable")).toBe(
      "vacuous-warning",
    );
  });

  it("includeUnmounted opts into off-route sentinel property evaluation", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "include-unmounted",
      bounds: { maxDepth: 3, maxPending: 1, maxInternalSteps: 4 },
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
          scope: routeMountScope("/a"),
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
      ],
    };
    const defaultResult = checkModel(m, [
      reachable(
        m,
        andExpr(
          eq(readVar("sys:route"), lit("/b")),
          eq(readVar("local:A.draft"), lit(UNMOUNTED)),
        ),
        {
          name: "defaultSkipsUnmounted",
          reads: ["sys:route", "local:A.draft"],
        },
      ),
    ]);
    const optInResult = checkModel(m, [
      reachable(
        m,
        andExpr(
          eq(readVar("sys:route"), lit("/b")),
          eq(readVar("local:A.draft"), lit(UNMOUNTED)),
        ),
        {
          name: "includeUnmountedWitnessesOffRouteSentinel",
          reads: ["sys:route", "local:A.draft"],
          includeUnmounted: true,
        },
      ),
    ]);
    expect(defaultResult.verdicts[0]?.status).toBe("vacuous-warning");
    expect(optInResult.verdicts[0]?.status).toBe("reachable");
  });

  it("verifies edit-link draft visibility within mounted bounds after navigation away", () => {
    const editRoutes = {
      kind: "enum",
      values: ["/links/:id", "/analytics"],
    } as const;
    const draftVisibility = {
      kind: "enum",
      values: ["hidden", "visible"],
    } as const;
    const m: Model = {
      schemaVersion: 1,
      id: "edit-link-mounted",
      bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "sys:route",
          domain: editRoutes,
          origin: "system",
          scope: { kind: "global" },
          initial: "/links/:id",
        },
        {
          id: "sys:history",
          domain: { kind: "boundedList", inner: editRoutes, maxLen: 2 },
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
          id: "local:EditLink.draft",
          domain: {
            kind: "record",
            fields: { visibility: draftVisibility },
          },
          origin: "system",
          scope: routeMountScope("/links/:id"),
          initial: { visibility: "hidden" },
        },
      ],
      transitions: [
        {
          id: "showDraft",
          cls: "user",
          label: { kind: "click", text: "Show draft" },
          source: [],
          guard: lit(true),
          effect: {
            kind: "assign",
            var: "local:EditLink.draft",
            expr: lit({ visibility: "visible" }),
          },
          reads: ["local:EditLink.draft"],
          writes: ["local:EditLink.draft"],
          confidence: "exact",
        },
        {
          id: "goAnalytics",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/analytics" },
          source: [],
          guard: {
            kind: "eq",
            args: [read("sys:route"), lit("/links/:id")],
          },
          effect: {
            kind: "navigate",
            mode: "push",
            to: lit("/analytics"),
          },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
      ],
    };
    const result = checkModel(m, [
      always(
        m,
        orExpr(
          eq(readVar("local:EditLink.draft", ["visibility"]), lit("hidden")),
          eq(readVar("local:EditLink.draft", ["visibility"]), lit("visible")),
        ),
        {
          name: "editDraftVisibilityStaysValid",
          reads: ["local:EditLink.draft"],
        },
      ),
    ]);
    expect(result.verdicts[0]?.status).toBe("verified-within-bounds");
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
        {
          negate: true,
          step: { transitionId: "pushB", navigated: false },
        },
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
        eq({ kind: "lenCat", arg: readVar("sys:pending") }, lit("1")),
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
      reachable(m, eq(readVar("sys:route"), lit("/b")), {
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
      always(bounded, lit(true), { name: "ok" }),
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
      always(terminal, lit(true), { name: "ok" }),
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
      reachable(m, eq(readVar("next"), lit("tok1")), {
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
      always(m, notExpr(enabled(m, "go")), {
        name: "goNeverEnabled",
        reads: [],
      }),
      reachable(m, eq(readVar("clicked"), lit(true)), {
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

  it("enabledTransitionPrefix matches suffixed transition ids when exact id is absent", () => {
    const draftSecVar = "local:LaneTimer.draftSec";
    const resetPrefix = "LaneTimer.onClick.draftSec";
    const m: Model = {
      schemaVersion: 1,
      id: "lane-timer-prefix",
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
          id: draftSecVar,
          domain: { kind: "boundedInt", min: 0, max: 180, overflow: "forbid" },
          origin: "system",
          scope: routeMountScope("/"),
          initial: 0,
        },
      ],
      transitions: [
        {
          id: "LaneTimer.onClick.draftSec.gpspae",
          cls: "user",
          label: { kind: "click", text: "+10秒" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: draftSecVar,
            expr: {
              kind: "add",
              args: [read(draftSecVar), lit(10)],
            },
          },
          reads: [draftSecVar],
          writes: [draftSecVar],
          confidence: "exact",
        },
        {
          id: "LaneTimer.onClick.draftSec.1ku31x",
          cls: "user",
          label: { kind: "click", text: "+1分" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: draftSecVar,
            expr: {
              kind: "add",
              args: [read(draftSecVar), lit(60)],
            },
          },
          reads: [draftSecVar],
          writes: [draftSecVar],
          confidence: "exact",
        },
        {
          id: "LaneTimer.onClick.draftSec.e4lq40",
          cls: "user",
          label: { kind: "click", text: "+3分" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: draftSecVar,
            expr: {
              kind: "add",
              args: [read(draftSecVar), lit(180)],
            },
          },
          reads: [draftSecVar],
          writes: [draftSecVar],
          confidence: "exact",
        },
        {
          id: "LaneTimer.onClick.draftSec.1sxiol",
          cls: "user",
          label: { kind: "click", text: "リセット" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: {
            kind: "assign",
            var: draftSecVar,
            expr: lit(0),
          },
          reads: [draftSecVar],
          writes: [draftSecVar],
          confidence: "exact",
        },
      ],
    };
    const exactEnabled = checkModel(m, [
      always(m, enabled(m, resetPrefix), {
        name: "exactResetIdAbsent",
      }),
    ]);
    expect(exactEnabled.verdicts[0]?.status).toBe("violated");
    const prefixEnabled = checkModel(m, [
      always(m, enabledTransitionPrefix(m, resetPrefix), {
        name: "resetFamilyAlwaysEnabled",
      }),
    ]);
    expect(prefixEnabled.verdicts[0]?.status).toBe("verified-within-bounds");
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
      reachable(m, eq(readVar("value"), lit("a")), {
        name: "aReachable",
        reads: ["value"],
      }),
      reachable(m, eq(readVar("value"), lit("b")), {
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
      reachable(
        m,
        andExpr(
          eq(readVar("source"), lit(true)),
          eq(readVar("target"), lit(true)),
        ),
        {
          name: "triggerRuns",
          reads: ["source", "target"],
        },
      ),
      reachable(
        m,
        andExpr(
          eq(readVar("source"), lit(true)),
          eq(readVar("target"), lit(false)),
        ),
        {
          name: "unrelatedTargetWriteDoesNotRetrigger",
          reads: ["source", "target"],
        },
      ),
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
          andExpr(
            eq(readVar("phase"), lit(state.phase)),
            eq(readVar("flag"), lit(state.flag)),
          ),
          { name: `oracle${index}` },
        ),
      ),
      reachable(
        m,
        andExpr(
          eq(readVar("phase"), lit("start")),
          eq(readVar("flag"), lit(true)),
        ),
        {
          name: "oracleImpossible",
        },
      ),
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
          reachable(oracle.model, partialStateExpr(expected), {
            name: `${oracle.name}:reachable:${index}`,
          }),
        ),
        ...oracle.unreachable.map((expected, index) =>
          reachable(oracle.model, partialStateExpr(expected), {
            name: `${oracle.name}:unreachable:${index}`,
          }),
        ),
        leadsToWithin(
          oracle.model,
          stepEnqueued(oracle.boundedResponse.triggerOp),
          eq(readVar(oracle.boundedResponse.goalVar), lit("done")),
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
          scope: routeMountScope("/a"),
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
          scope: routeMountScope("/a"),
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
          scope: routeMountScope("/a"),
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
      always(m, eq(readVar("local:/a.panel"), lit(true)), {
        name: "panelStaysMounted",
        reads: ["local:/a.panel"],
      }),
    ];
    const unsliced = checkModel(m, props);
    const sliced = checkModel(m, props, { slicing: true });
    expect(unsliced.verdicts[0]?.status).toBe("verified-within-bounds");
    expect(sliced.verdicts[0]?.status).toBe("verified-within-bounds");
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
      always(m, eq(readVar("needed"), lit(false)), {
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

  it("drops irrelevant numeric vars when slicing and retains numeric guards", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "numeric-slice",
      bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 2 },
      vars: [
        {
          id: "counter",
          domain: { kind: "boundedInt", min: 0, max: 3 },
          origin: "system",
          scope: { kind: "global" },
          initial: 0,
        },
        {
          id: "noise",
          domain: { kind: "boundedInt", min: 0, max: 100 },
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
          guard: {
            kind: "lt",
            args: [read("counter"), lit(3)],
          },
          effect: {
            kind: "assign",
            var: "counter",
            expr: { kind: "add", args: [read("counter"), lit(1)] },
          },
          reads: ["counter"],
          writes: ["counter"],
          confidence: "exact",
        },
        {
          id: "touchNoise",
          cls: "user",
          label: { kind: "click", text: "touchNoise" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: { kind: "assign", var: "noise", expr: lit(1) },
          reads: [],
          writes: ["noise"],
          confidence: "exact",
        },
      ],
    };
    const sliced = sliceModel(m, ["counter"]);
    expect(sliced.vars.map((decl) => decl.id)).toEqual(["counter"]);
    expect(sliced.transitions.map((transition) => transition.id)).toEqual([
      "inc",
    ]);
    const props: Property[] = [
      always(
        m,
        {
          kind: "lte",
          args: [readVar("counter"), lit(3)],
        },
        { name: "counterBounded", reads: ["counter"] },
      ),
    ];
    expect(
      checkModel(m, props, { slicing: true }).verdicts.map((verdict) => [
        verdict.property,
        verdict.status,
      ]),
    ).toEqual([["counterBounded", "verified-within-bounds"]]);
  });

  function focusedAlwaysStepNoiseModel(spamCount = 8): Model {
    const spamVars = Array.from({ length: spamCount }, (_, index) => ({
      id: `spam${index}`,
      domain: bool,
      origin: "system" as const,
      scope: { kind: "global" as const },
      initial: false,
    }));
    const spamTransitions = Array.from({ length: spamCount }, (_, index) => ({
      id: `spamPending${index}`,
      cls: "user" as const,
      label: { kind: "click" as const, text: `Spam ${index}` },
      source: [],
      guard: lit(true),
      effect: {
        kind: "seq" as const,
        effects: [
          {
            kind: "enqueue" as const,
            op: "POST",
            continuation: `spam#${index}`,
            args: {},
          },
          {
            kind: "assign" as const,
            var: `spam${index}`,
            expr: lit(true),
          },
        ],
      },
      reads: [`spam${index}`],
      writes: ["sys:pending", `spam${index}`],
      confidence: "exact" as const,
    }));
    return {
      schemaVersion: 1,
      id: "focused-always-step-noise",
      bounds: { maxDepth: spamCount + 4, maxPending: 2, maxInternalSteps: 8 },
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
          domain: { kind: "boundedList", inner: pendingOp, maxLen: 2 },
          origin: "system",
          scope: { kind: "global" },
          initial: [],
        },
        {
          id: "draft",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
        ...spamVars,
      ],
      transitions: [
        {
          id: "prepare",
          cls: "user",
          label: { kind: "click", text: "Prepare" },
          source: [],
          guard: eq(read("draft"), lit("empty")),
          effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
          reads: ["draft"],
          writes: ["draft"],
          confidence: "exact",
        },
        {
          id: "submit",
          cls: "user",
          label: { kind: "submit", text: "Submit" },
          source: [],
          guard: eq(read("draft"), lit("nonEmpty")),
          effect: {
            kind: "seq",
            effects: [
              {
                kind: "enqueue",
                op: "POST",
                continuation: "submit#1",
                args: {},
              },
              { kind: "assign", var: "draft", expr: lit("empty") },
            ],
          },
          reads: ["draft"],
          writes: ["draft", "sys:pending"],
          confidence: "exact",
        },
        {
          id: "otherSubmit",
          cls: "user",
          label: { kind: "submit", text: "Other" },
          source: [],
          guard: eq(read("draft"), lit("nonEmpty")),
          effect: {
            kind: "seq",
            effects: [
              {
                kind: "enqueue",
                op: "POST",
                continuation: "other#1",
                args: {},
              },
              { kind: "assign", var: "draft", expr: lit("empty") },
            ],
          },
          reads: ["draft"],
          writes: ["draft", "sys:pending"],
          confidence: "exact",
        },
        {
          id: "navigateAway",
          cls: "nav",
          label: { kind: "navigate", mode: "push", to: "/b" },
          source: [],
          guard: lit(true),
          effect: { kind: "navigate", mode: "push", to: lit("/b") },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history"],
          confidence: "exact",
        },
        ...spamTransitions,
      ],
    };
  }

  it("detects syntactic alwaysStep transition targets for slicing", () => {
    const m = focusedAlwaysStepNoiseModel(1);
    const targeted = alwaysStep(
      m,
      {
        negate: true,
        step: stepTransitionId("submit"),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );
    const enabledOnly = alwaysStep(
      m,
      {
        negate: true,
        step: stepAny(),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      { name: "enabledOnly", reads: ["draft"], enabledTransitions: ["submit"] },
    );
    const positiveTarget = alwaysStep(m, stepTransitionId("submit"), {
      name: "positiveTarget",
      reads: [],
      enabledTransitions: ["submit"],
    });
    expect(targetedAlwaysStepTransitionIds(targeted)).toEqual(["submit"]);
    expect(propertySliceMode(targeted)).toBe("targetedStep");
    expect(propertySliceMode(enabledOnly)).toBe("full");
    expect(targetedAlwaysStepTransitionIds(positiveTarget)).toEqual(["submit"]);
    expect(propertySliceMode(positiveTarget)).toBe("full");
  });

  it("slices targeted alwaysStep without unrelated pending and navigation transitions", () => {
    const m = focusedAlwaysStepNoiseModel();
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: stepTransitionId("submit"),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );
    const sliced = sliceModelForCheckProperty(m, property).model;
    expect(sliced.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining(["prepare", "submit"]),
    );
    expect(sliced.transitions.map((transition) => transition.id)).not.toEqual(
      expect.arrayContaining(["navigateAway", "spamPending0", "spamPending1"]),
    );
    expect(sliced.vars.map((decl) => decl.id)).not.toContain("sys:history");
  });

  it("keeps step-fact vars out of targeted alwaysStep dependency closure", () => {
    const m = focusedAlwaysStepNoiseModel();
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: { ...stepTransitionId("submit"), ...stepEnqueued("POST") },
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitEnqueueResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );
    const sliced = sliceModelForCheckProperty(m, property).model;
    const transitionIds = sliced.transitions.map((transition) => transition.id);
    expect(sliced.vars.map((decl) => decl.id)).toContain("sys:pending");
    expect(transitionIds).toEqual(
      expect.arrayContaining(["prepare", "submit"]),
    );
    expect(transitionIds).not.toEqual(
      expect.arrayContaining(["spamPending0", "spamPending1", "navigateAway"]),
    );
  });

  it("keeps positive targeted alwaysStep on the full model under slicing", () => {
    const m = focusedAlwaysStepNoiseModel(2);
    const property = alwaysStep(m, stepTransitionId("submit"), {
      name: "everyEdgeIsSubmit",
      reads: [],
      enabledTransitions: ["submit"],
    });
    const full = checkModel(m, [property]);
    const sliced = checkModel(m, [property], { slicing: true });
    expect(propertySliceMode(property)).toBe("full");
    expect(sliced.diagnostics?.slicing?.sliceSummaries?.[0]?.mode).toBe("full");
    expect(sliced.diagnostics?.slicing?.sliceSummaries?.[0]?.transitions).toBe(
      m.transitions.length,
    );
    expect(sliced.verdicts).toEqual(full.verdicts);
    expect(sliced.verdicts[0]?.status).toBe("violated");
  });

  it("keeps targeted alwaysStep verdict parity between sliced and full search", () => {
    const m = focusedAlwaysStepNoiseModel(4);
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: stepTransitionId("submit"),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );
    const full = checkModel(m, [property]);
    const sliced = checkModel(m, [property], { slicing: true });
    expect(sliced.verdicts).toEqual(full.verdicts);
    expect(sliced.diagnostics?.slicing?.sliceSummaries?.[0]?.mode).toBe(
      "targetedStep",
    );
    expect(
      sliced.diagnostics?.slicing?.sliceSummaries?.[0]?.transitions,
    ).toBeLessThan(m.transitions.length);
  });

  it("lets targeted alwaysStep slicing avoid low maxEdges failures", () => {
    const m = focusedAlwaysStepNoiseModel(10);
    const property = alwaysStep(
      m,
      {
        negate: true,
        step: stepTransitionId("submit"),
        post: eq(readVar("draft"), lit("nonEmpty")),
      },
      {
        name: "submitResetsDraft",
        reads: ["draft"],
        enabledTransitions: ["submit"],
      },
    );
    const maxEdges = 40;
    const unsliced = checkModel(m, [property], { slicing: false, maxEdges });
    const sliced = checkModel(m, [property], { slicing: true, maxEdges });
    expect(unsliced.verdicts[0]?.status).toBe("error");
    expect(
      unsliced.verdicts[0]?.status === "error"
        ? unsliced.verdicts[0]?.message
        : "",
    ).toContain("search limit exceeded");
    expect(sliced.diagnostics?.slicing?.sliceSummaries?.[0]?.transitions).toBe(
      3,
    );
    expect(sliced.stats.edges).toBeLessThan(maxEdges);
    expect(sliced.verdicts[0]?.status).toBe("verified-within-bounds");
  });

  it("keeps untargeted alwaysStep on the full model when slicing", () => {
    const m = focusedAlwaysStepNoiseModel(4);
    const property = alwaysStep(m, stepAny(), {
      name: "allEdgesOk",
      reads: ["draft"],
    });
    const result = checkModel(m, [property], { slicing: true });
    expect(propertySliceMode(property)).toBe("full");
    expect(result.diagnostics?.slicing?.sliceSummaries?.[0]?.transitions).toBe(
      m.transitions.length,
    );
    expect(result.diagnostics?.slicing?.sliceSummaries?.[0]?.mode).toBe("full");
  });

  it("groups targeted alwaysStep slices by transition set, not vars alone", () => {
    const m: Model = {
      schemaVersion: 1,
      id: "focused-step-grouping",
      bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "draftA",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
        {
          id: "draftB",
          domain: { kind: "enum", values: ["empty", "nonEmpty"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "empty",
        },
      ],
      transitions: [
        {
          id: "prepareA",
          cls: "user",
          label: { kind: "click", text: "Prepare A" },
          source: [],
          guard: eq(read("draftA"), lit("empty")),
          effect: { kind: "assign", var: "draftA", expr: lit("nonEmpty") },
          reads: ["draftA"],
          writes: ["draftA"],
          confidence: "exact",
        },
        {
          id: "submitA",
          cls: "user",
          label: { kind: "submit", text: "Submit A" },
          source: [],
          guard: eq(read("draftA"), lit("nonEmpty")),
          effect: { kind: "assign", var: "draftA", expr: lit("empty") },
          reads: ["draftA"],
          writes: ["draftA"],
          confidence: "exact",
        },
        {
          id: "prepareB",
          cls: "user",
          label: { kind: "click", text: "Prepare B" },
          source: [],
          guard: eq(read("draftB"), lit("empty")),
          effect: { kind: "assign", var: "draftB", expr: lit("nonEmpty") },
          reads: ["draftB"],
          writes: ["draftB"],
          confidence: "exact",
        },
        {
          id: "submitB",
          cls: "user",
          label: { kind: "submit", text: "Submit B" },
          source: [],
          guard: eq(read("draftB"), lit("nonEmpty")),
          effect: { kind: "assign", var: "draftB", expr: lit("empty") },
          reads: ["draftB"],
          writes: ["draftB"],
          confidence: "exact",
        },
      ],
    };
    const submitProperty = alwaysStep(
      m,
      {
        negate: true,
        step: stepTransitionId("submitA"),
        post: eq(readVar("draftA"), lit("nonEmpty")),
      },
      {
        name: "submitAResetsDraft",
        reads: ["draftA"],
        enabledTransitions: ["submitA"],
      },
    );
    const otherProperty = alwaysStep(
      m,
      {
        negate: true,
        step: stepTransitionId("submitB"),
        post: eq(readVar("draftB"), lit("nonEmpty")),
      },
      {
        name: "submitBResetsDraft",
        reads: ["draftB"],
        enabledTransitions: ["submitB"],
      },
    );
    const result = checkModel(m, [submitProperty, otherProperty], {
      slicing: true,
    });
    const summaries = result.diagnostics?.slicing?.sliceSummaries ?? [];
    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.mode)).toEqual([
      "targetedStep",
      "targetedStep",
    ]);
    expect(result.verdicts.map((verdict) => verdict.status)).toEqual([
      "verified-within-bounds",
      "verified-within-bounds",
    ]);
    expect(result.verdicts.map((verdict) => verdict.property)).toEqual([
      "submitAResetsDraft",
      "submitBResetsDraft",
    ]);
  });

  it("stops gracefully when maxStates is exceeded", () => {
    const m = model();
    const props: Property[] = [
      reachable(m, eq(readVar("done"), lit(true)), {
        name: "doneReachable",
        reads: ["done"],
      }),
      always(m, neq(readVar("draft"), lit("missing")), {
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
      always(m, neq(readVar("a"), lit(true)), {
        name: "notA",
        reads: ["a"],
      }),
      always(m, neq(readVar("b"), lit(true)), {
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
      reachable(m, eq(readVar("choice"), lit("b9")), {
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
      reachable(m, eq(readVar("choice"), lit("b9")), {
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
    const toggleIds = Array.from(
      { length: toggleCount },
      (_, index) => `t${index}`,
    );
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
        andExpr(...toggleIds.map((id) => eq(readVar(id), lit(true)))),
        {
          name: "allToggled",
          reads: toggleIds,
        },
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
      reachable(m, eq(readVar("done"), lit(true)), {
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
      reachable(m, eq(readVar("stamped"), lit(true)), {
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
      reachable(m, eq(readVar("derived"), lit(true)), {
        name: "derivedFromSource",
        reads: ["derived"],
      }),
      reachable(m, eq(readVar("noise"), lit(true)), {
        name: "noiseReachable",
        reads: ["noise"],
      }),
    ]);
    expect(result.stats).toEqual({ states: 3, edges: 2, depth: 2 });
    expect(
      result.verdicts.find(
        (verdict) => verdict.property === "derivedFromSource",
      )?.status,
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
