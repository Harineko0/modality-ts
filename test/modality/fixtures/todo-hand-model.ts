import { resolve } from "node:path";
import { routeMountScope } from "../../../src/extract/engine/ts/routes.js";
import type { ExprIR, Model, Value } from "modality-ts/core";

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
const not = (arg: ExprIR): ExprIR => ({ kind: "not", args: [arg] });

export function todoHandModel(): Model {
  return {
    schemaVersion: 1,
    id: "todo-hand-model",
    bounds: { maxDepth: 12, maxPending: 3, maxInternalSteps: 16 },
    metadata: {
      varAnchors: {
        "atom:authAtom": {
          file: resolve("examples/todo-app/App.tsx"),
          line: 5,
          column: 14,
        },
      },
    },
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
          maxLen: 4,
        },
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
              opId: {
                kind: "enum",
                values: ["GET /api/todos", "api.createTodo"],
              },
              continuation: {
                kind: "enum",
                values: [
                  "App.onChange.api.createTodo.cont",
                  "App.onClick.api.createTodo.cont",
                  "App.onSubmit.api.createTodo.cont",
                  "swr:api_todos:resolve",
                ],
              },
              args: { kind: "record", fields: {} },
            },
          },
          maxLen: 3,
        },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      {
        id: "local:App.draft",
        domain: { kind: "enum", values: ["empty", "nonEmpty"] },
        origin: "system",
        scope: routeMountScope("/"),
        initial: "empty",
      },
      {
        id: "local:App.saveStatus",
        domain: { kind: "enum", values: ["idle", "posting", "failed"] },
        origin: "system",
        scope: routeMountScope("/"),
        initial: "idle",
      },
      {
        id: "atom:authAtom",
        domain: { kind: "enum", values: ["guest", "user"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "guest",
      },
      {
        id: "swr:api_todos:data",
        domain: { kind: "option", inner: { kind: "tokens", count: 1 } },
        origin: "library-template",
        scope: { kind: "global" },
        initial: null,
      },
      {
        id: "swr:api_todos:isValidating",
        domain: { kind: "bool" },
        origin: "library-template",
        scope: { kind: "global" },
        initial: false,
      },
      {
        id: "swr:api_todos:error",
        domain: { kind: "bool" },
        origin: "library-template",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "App.onClick.authAtom",
        cls: "user",
        label: {
          kind: "click",
          locator: { kind: "role", role: "button", name: "Login" },
        },
        source: [],
        guard: lit(true),
        effect: { kind: "assign", var: "atom:authAtom", expr: lit("user") },
        reads: [],
        writes: ["atom:authAtom"],
        confidence: "exact",
      },
      {
        id: "App.onClick.authAtom_draft_saveStatus.seq",
        cls: "user",
        label: {
          kind: "click",
          locator: { kind: "role", role: "button", name: "Logout" },
        },
        source: [],
        guard: lit(true),
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "atom:authAtom", expr: lit("guest") },
            { kind: "assign", var: "local:App.draft", expr: lit("empty") },
            { kind: "assign", var: "local:App.saveStatus", expr: lit("idle") },
          ],
        },
        reads: [],
        writes: ["atom:authAtom", "local:App.draft", "local:App.saveStatus"],
        confidence: "exact",
      },
      {
        id: "App.onChange.draft.empty",
        cls: "user",
        label: {
          kind: "input",
          valueClass: "empty",
          locator: { kind: "testId", value: "draft" },
        },
        source: [],
        guard: lit(true),
        effect: { kind: "assign", var: "local:App.draft", expr: lit("empty") },
        reads: [],
        writes: ["local:App.draft"],
        confidence: "exact",
      },
      {
        id: "App.onChange.draft.nonEmpty",
        cls: "user",
        label: {
          kind: "input",
          valueClass: "nonEmpty",
          locator: { kind: "testId", value: "draft" },
        },
        source: [],
        guard: lit(true),
        effect: {
          kind: "assign",
          var: "local:App.draft",
          expr: lit("nonEmpty"),
        },
        reads: [],
        writes: ["local:App.draft"],
        confidence: "exact",
      },
      {
        id: "App.onClick.api.createTodo.start",
        cls: "user",
        label: {
          kind: "click",
          locator: { kind: "role", role: "button", name: "Add" },
        },
        source: [],
        guard: not(eq(read("local:App.saveStatus"), lit("posting"))),
        effect: {
          kind: "seq",
          effects: [
            {
              kind: "assign",
              var: "local:App.saveStatus",
              expr: lit("posting"),
            },
            {
              kind: "enqueue",
              op: "api.createTodo",
              continuation: "App.onClick.api.createTodo.cont",
              args: {},
            },
          ],
        },
        reads: ["local:App.saveStatus"],
        writes: ["local:App.saveStatus", "sys:pending"],
        confidence: "exact",
      },
      {
        id: "App.onClick.api.createTodo.success",
        cls: "env",
        label: { kind: "resolve", op: "api.createTodo", outcome: "success" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("api.createTodo")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "local:App.draft", expr: lit("empty") },
            { kind: "assign", var: "local:App.saveStatus", expr: lit("idle") },
          ],
        },
        reads: ["sys:pending", "local:App.saveStatus"],
        writes: ["sys:pending", "local:App.draft", "local:App.saveStatus"],
        confidence: "exact",
      },
      {
        id: "swr:api_todos:fetch",
        cls: "library",
        label: { kind: "timer", key: "api_todos" },
        source: [],
        guard: lit(true),
        effect: {
          kind: "seq",
          effects: [
            {
              kind: "assign",
              var: "swr:api_todos:isValidating",
              expr: lit(true),
            },
            {
              kind: "enqueue",
              op: "GET /api/todos",
              continuation: "swr:api_todos:resolve",
              args: {},
            },
          ],
        },
        reads: [],
        writes: ["swr:api_todos:isValidating", "sys:pending"],
        confidence: "exact",
      },
      {
        id: "swr:api_todos:resolve:success:0",
        cls: "env",
        label: { kind: "resolve", op: "GET /api/todos", outcome: "success:0" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("GET /api/todos")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "swr:api_todos:data", expr: lit("tok1") },
            {
              kind: "assign",
              var: "swr:api_todos:isValidating",
              expr: lit(false),
            },
            { kind: "assign", var: "swr:api_todos:error", expr: lit(false) },
          ],
        },
        reads: ["sys:pending"],
        writes: [
          "sys:pending",
          "swr:api_todos:data",
          "swr:api_todos:isValidating",
          "swr:api_todos:error",
        ],
        confidence: "exact",
      },
      {
        id: "swr:api_todos:resolve:error",
        cls: "env",
        label: { kind: "resolve", op: "GET /api/todos", outcome: "error" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("GET /api/todos")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            {
              kind: "assign",
              var: "swr:api_todos:isValidating",
              expr: lit(false),
            },
            { kind: "assign", var: "swr:api_todos:error", expr: lit(true) },
          ],
        },
        reads: ["sys:pending"],
        writes: [
          "sys:pending",
          "swr:api_todos:isValidating",
          "swr:api_todos:error",
        ],
        confidence: "exact",
      },
    ],
  };
}
