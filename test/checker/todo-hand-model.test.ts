import { checkModel } from "modality-ts/check";
import {
  type ExprIR,
  enabled,
  type Model,
  not,
  or,
  type Property,
  readPreVar,
  readVar,
  stepEnqueued,
  stepResolved,
  type Value,
} from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { always, alwaysStep, reachable } from "../helpers/property-builders.js";

const route = { kind: "enum", values: ["/"] } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["GET_TODOS", "POST_TODO"] },
    continuation: { kind: "enum", values: ["swr#resolve", "submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

const lit = (value: Value): ExprIR => ({ kind: "lit", value });
const read = (id: string, path?: string[]): ExprIR => ({
  kind: "read",
  var: id,
  path,
});
const eq = (left: ExprIR, right: ExprIR): ExprIR => ({
  kind: "eq",
  args: [left, right],
});
const neq = (left: ExprIR, right: ExprIR): ExprIR => ({
  kind: "neq",
  args: [left, right],
});
const and = (...args: ExprIR[]): ExprIR => ({ kind: "and", args });

function todoModel(): Model {
  return {
    schemaVersion: 1,
    id: "todo-hand-model",
    bounds: { maxDepth: 10, maxPending: 3, maxInternalSteps: 8 },
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
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 3 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "auth",
        domain: { kind: "enum", values: ["guest", "user"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "guest",
      },
      {
        id: "draft",
        domain: { kind: "enum", values: ["empty", "nonEmpty"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "empty",
      },
      {
        id: "saveStatus",
        domain: { kind: "enum", values: ["idle", "posting", "failed"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "idle",
      },
      {
        id: "todosData",
        domain: { kind: "enum", values: ["none", "0", "1", "many"] },
        origin: "library-template",
        scope: { kind: "global" },
        initial: "none",
      },
      {
        id: "todosValidating",
        domain: { kind: "bool" },
        origin: "library-template",
        scope: { kind: "global" },
        initial: false,
      },
      {
        id: "todosError",
        domain: { kind: "bool" },
        origin: "library-template",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "App.login",
        cls: "user",
        label: { kind: "click", text: "Login" },
        source: [],
        guard: eq(read("auth"), lit("guest")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "auth", expr: lit("user") },
            {
              kind: "if",
              cond: eq(read("todosData"), lit("none")),
              // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
              then: {
                kind: "seq",
                effects: [
                  { kind: "assign", var: "todosValidating", expr: lit(true) },
                  {
                    kind: "enqueue",
                    op: "GET_TODOS",
                    continuation: "swr#resolve",
                    args: {},
                  },
                ],
              },
              else: { kind: "seq", effects: [] },
            },
          ],
        },
        reads: ["auth", "todosData"],
        writes: ["auth", "todosValidating", "sys:pending"],
        confidence: "exact",
      },
      {
        id: "App.logout",
        cls: "user",
        label: { kind: "click", text: "Logout" },
        source: [],
        guard: eq(read("auth"), lit("user")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "auth", expr: lit("guest") },
            { kind: "assign", var: "draft", expr: lit("empty") },
            { kind: "assign", var: "saveStatus", expr: lit("idle") },
          ],
        },
        reads: ["auth"],
        writes: ["auth", "draft", "saveStatus"],
        confidence: "exact",
      },
      {
        id: "App.input.nonEmpty",
        cls: "user",
        label: { kind: "input", valueClass: "nonEmpty" },
        source: [],
        guard: and(
          eq(read("auth"), lit("user")),
          neq(read("todosData"), lit("none")),
        ),
        effect: { kind: "assign", var: "draft", expr: lit("nonEmpty") },
        reads: ["auth", "todosData"],
        writes: ["draft"],
        confidence: "exact",
      },
      {
        id: "App.submit",
        cls: "user",
        label: { kind: "submit", text: "Add" },
        source: [],
        guard: and(
          eq(read("auth"), lit("user")),
          eq(read("draft"), lit("nonEmpty")),
          eq(read("saveStatus"), lit("idle")),
        ),
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "saveStatus", expr: lit("posting") },
            {
              kind: "enqueue",
              op: "POST_TODO",
              continuation: "submit#1",
              args: {},
            },
          ],
        },
        reads: ["auth", "draft", "saveStatus"],
        writes: ["saveStatus", "sys:pending"],
        confidence: "exact",
      },
      resolveGet("successEmpty", "0"),
      resolveGet("successSome", "1"),
      resolveGet("error", null),
      {
        id: "resolve.POST.success",
        cls: "env",
        label: { kind: "resolve", op: "POST_TODO", outcome: "success" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("POST_TODO")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "draft", expr: lit("empty") },
            { kind: "assign", var: "saveStatus", expr: lit("idle") },
            { kind: "assign", var: "todosValidating", expr: lit(true) },
            {
              kind: "enqueue",
              op: "GET_TODOS",
              continuation: "swr#resolve",
              args: {},
            },
          ],
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "draft", "saveStatus", "todosValidating"],
        confidence: "exact",
      },
      {
        id: "resolve.POST.error",
        cls: "env",
        label: { kind: "resolve", op: "POST_TODO", outcome: "error" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("POST_TODO")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "saveStatus", expr: lit("failed") },
          ],
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "saveStatus"],
        confidence: "exact",
      },
    ],
  };
}

function resolveGet(suffix: string, data: "0" | "1" | null) {
  return {
    id: `resolve.GET.${suffix}`,
    cls: "env" as const,
    label: { kind: "resolve" as const, op: "GET_TODOS", outcome: suffix },
    source: [],
    guard: eq(read("sys:pending", ["0", "opId"]), lit("GET_TODOS")),
    effect:
      data === null
        ? {
            kind: "seq" as const,
            effects: [
              { kind: "dequeue" as const, index: 0 },
              {
                kind: "assign" as const,
                var: "todosValidating",
                expr: lit(false),
              },
              { kind: "assign" as const, var: "todosError", expr: lit(true) },
            ],
          }
        : {
            kind: "seq" as const,
            effects: [
              { kind: "dequeue" as const, index: 0 },
              { kind: "assign" as const, var: "todosData", expr: lit(data) },
              {
                kind: "assign" as const,
                var: "todosValidating",
                expr: lit(false),
              },
              { kind: "assign" as const, var: "todosError", expr: lit(false) },
            ],
          },
    reads: ["sys:pending"],
    writes: ["sys:pending", "todosData", "todosValidating", "todosError"],
    confidence: "exact" as const,
  };
}

function atMostOnePendingOp(opId: string): ExprIR {
  return and(
    or(
      neq(readVar("sys:pending", ["0", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["1", "opId"]), lit(opId)),
    ),
    or(
      neq(readVar("sys:pending", ["0", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["2", "opId"]), lit(opId)),
    ),
    or(
      neq(readVar("sys:pending", ["1", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["2", "opId"]), lit(opId)),
    ),
  );
}

function todoProperties(model: Model): Property[] {
  return [
    alwaysStep(
      model,
      {
        negate: true,
        step: stepEnqueued("POST_TODO"),
        pre: eq(readVar("auth"), lit("guest")),
      },
      { name: "guestCannotSubmit", reads: ["auth", "sys:pending"] },
    ),
    alwaysStep(
      model,
      {
        negate: true,
        step: stepEnqueued("POST_TODO"),
        pre: eq(readVar("draft"), lit("empty")),
      },
      { name: "emptyDraftCannotSubmit", reads: ["draft", "sys:pending"] },
    ),
    alwaysStep(
      model,
      {
        negate: true,
        step: stepEnqueued("POST_TODO"),
        pre: eq(readVar("saveStatus"), lit("posting")),
      },
      { name: "noSubmitWhilePosting", reads: ["saveStatus", "sys:pending"] },
    ),
    alwaysStep(
      model,
      {
        negate: true,
        step: stepResolved("POST_TODO", "error"),
        post: not(
          and(
            eq(readVar("draft"), readPreVar("draft")),
            eq(readVar("saveStatus"), lit("failed")),
          ),
        ),
      },
      {
        name: "failedPostKeepsDraft",
        reads: ["draft", "saveStatus", "sys:pending"],
      },
    ),
    alwaysStep(
      model,
      {
        negate: true,
        step: stepResolved("POST_TODO", "success"),
        post: not(
          and(
            eq(readVar("draft"), lit("empty")),
            eq(readVar("saveStatus"), lit("idle")),
          ),
        ),
      },
      { name: "successResets", reads: ["draft", "saveStatus", "sys:pending"] },
    ),
    always(
      model,
      or(
        not(
          and(
            eq(readVar("auth"), lit("user")),
            eq(readVar("todosError"), lit(true)),
          ),
        ),
        enabled("App.logout"),
      ),
      {
        name: "logoutAvailableDuringGetError",
        reads: ["auth", "todosError", "sys:route"],
        enabledTransitions: ["App.logout"],
      },
    ),
    reachable(
      model,
      and(
        eq(readVar("auth"), lit("user")),
        or(
          eq(readVar("todosData"), lit("1")),
          eq(readVar("todosData"), lit("many")),
        ),
      ),
      { name: "loadedTodosReachable", reads: ["auth", "todosData"] },
    ),
    always(model, atMostOnePendingOp("POST_TODO"), {
      name: "naiveNoDoubleSubmitInvariant",
      reads: ["sys:pending"],
    }),
    alwaysStep(
      model,
      {
        negate: true,
        step: stepResolved("POST_TODO", "success"),
        pre: neq(readVar("saveStatus"), lit("posting")),
        post: neq(readVar("draft"), readPreVar("draft")),
      },
      {
        name: "staleCompletionIsInert",
        reads: ["saveStatus", "draft", "sys:pending"],
      },
    ),
  ];
}

describe("hand-written ToDo IR", () => {
  it("reproduces the walkthrough verdicts for the core properties", () => {
    const model = todoModel();
    const result = checkModel(model, todoProperties(model));
    expect(result.stats).toEqual({ states: 139, edges: 435, depth: 10 });
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict]),
    );

    for (const name of [
      "guestCannotSubmit",
      "emptyDraftCannotSubmit",
      "noSubmitWhilePosting",
      "failedPostKeepsDraft",
      "successResets",
      "logoutAvailableDuringGetError",
    ]) {
      expect(byName.get(name)?.status, name).toBe("verified-within-bounds");
    }
    expect(byName.get("loadedTodosReachable")?.status).toMatch(/^verified/);
    expect(byName.get("naiveNoDoubleSubmitInvariant")?.status).toBe("violated");
    expect(byName.get("staleCompletionIsInert")?.status).toBe("violated");
  });

  it("pins the walkthrough counterexample shapes", () => {
    const model = todoModel();
    const result = checkModel(model, todoProperties(model));
    const byName = new Map(
      result.verdicts.map((verdict) => [verdict.property, verdict]),
    );
    const doubleSubmit = byName.get("naiveNoDoubleSubmitInvariant");
    const staleCompletion = byName.get("staleCompletionIsInert");

    expect(doubleSubmit?.status).toBe("violated");
    expect(
      doubleSubmit?.status === "violated"
        ? doubleSubmit.trace.steps.map((step) => step.transitionId)
        : [],
    ).toEqual([]);

    expect(staleCompletion?.status).toBe("violated");
    expect(
      staleCompletion?.status === "violated"
        ? staleCompletion.trace.steps.map((step) => step.transitionId)
        : [],
    ).toEqual([
      "App.login",
      "resolve.GET.successEmpty",
      "App.input.nonEmpty",
      "App.submit",
      "App.logout",
      "App.login",
      "App.input.nonEmpty",
      "resolve.POST.success",
    ]);
  });

  it("is deterministic across repeated runs", () => {
    const model = todoModel();
    const first = checkModel(model, todoProperties(model));
    const second = checkModel(model, todoProperties(model));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("keeps ToDo verdicts stable with slicing enabled", () => {
    const model = todoModel();
    const full = checkModel(model, todoProperties(model));
    const sliced = checkModel(model, todoProperties(model), { slicing: true });
    expect(
      sliced.verdicts.map((verdict) => [verdict.property, verdict.status]),
    ).toEqual(
      full.verdicts.map((verdict) => [verdict.property, verdict.status]),
    );
  });
});
