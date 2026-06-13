import type { ExprIR, Model, Value } from "@modality-ts/kernel";

const lit = (value: Value): ExprIR => ({ kind: "lit", value });
const read = (id: string, path?: string[]): ExprIR => ({ kind: "read", var: id, path });
const eq = (left: ExprIR, right: ExprIR): ExprIR => ({ kind: "eq", args: [left, right] });

export function demoHandModel(): Model {
  return {
    schemaVersion: 1,
    id: "demo-hand-model",
    bounds: { maxDepth: 12, maxPending: 3, maxInternalSteps: 4 },
    vars: [
      {
        id: "sys:route",
        domain: { kind: "enum", values: ["/", "/admin"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "/"
      },
      {
        id: "sys:history",
        domain: { kind: "boundedList", inner: { kind: "enum", values: ["/", "/admin"] }, maxLen: 4 },
        origin: "system",
        scope: { kind: "global" },
        initial: []
      },
      {
        id: "sys:pending",
        domain: {
          kind: "boundedList",
          inner: {
            kind: "record",
            fields: {
              opId: { kind: "enum", values: ["GET /api/user", "api.placeOrder"] },
              continuation: {
                kind: "enum",
                values: [
                  "App.onChange.api.placeOrder.cont",
                  "App.onClick.api.placeOrder.cont",
                  "App.onSubmit.api.placeOrder.cont",
                  "swr:api_user:resolve"
                ]
              },
              args: { kind: "record", fields: {} }
            }
          },
          maxLen: 3
        },
        origin: "system",
        scope: { kind: "global" },
        initial: []
      },
      {
        id: "local:App.orderStatus",
        domain: { kind: "enum", values: ["idle", "submitting", "done"] },
        origin: "system",
        scope: { kind: "route-local", route: "/" },
        initial: "idle"
      },
      {
        id: "atom:authAtom",
        domain: { kind: "enum", values: ["guest", "user"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "guest"
      },
      {
        id: "swr:api_user:data",
        domain: { kind: "option", inner: { kind: "tokens", count: 1 } },
        origin: "library-template",
        scope: { kind: "global" },
        initial: null
      },
      {
        id: "swr:api_user:isValidating",
        domain: { kind: "bool" },
        origin: "library-template",
        scope: { kind: "global" },
        initial: false
      },
      {
        id: "swr:api_user:error",
        domain: { kind: "bool" },
        origin: "library-template",
        scope: { kind: "global" },
        initial: false
      }
    ],
    transitions: [
      {
        id: "App.onClick.authAtom.h4jaed",
        cls: "user",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Login" } },
        source: [],
        guard: lit(true),
        effect: { kind: "assign", var: "atom:authAtom", expr: lit("user") },
        reads: [],
        writes: ["atom:authAtom"],
        confidence: "exact"
      },
      {
        id: "App.onClick.navigate._admin",
        cls: "nav",
        label: { kind: "navigate", mode: "push", to: "/admin" },
        source: [],
        guard: lit(true),
        effect: { kind: "navigate", mode: "push", to: lit("/admin") },
        reads: ["sys:route", "sys:history"],
        writes: ["sys:route", "sys:history"],
        confidence: "exact"
      },
      {
        id: "App.onClick.authAtom.1bllkl",
        cls: "user",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Logout" } },
        source: [],
        guard: lit(true),
        effect: { kind: "assign", var: "atom:authAtom", expr: lit("guest") },
        reads: [],
        writes: ["atom:authAtom"],
        confidence: "exact"
      },
      {
        id: "App.onClick.api.placeOrder.start",
        cls: "user",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Place order" } },
        source: [],
        guard: lit(true),
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "local:App.orderStatus", expr: lit("submitting") },
            { kind: "enqueue", op: "api.placeOrder", continuation: "App.onClick.api.placeOrder.cont", args: {} }
          ]
        },
        reads: [],
        writes: ["local:App.orderStatus", "sys:pending"],
        confidence: "exact"
      },
      {
        id: "App.onClick.api.placeOrder.success",
        cls: "env",
        label: { kind: "resolve", op: "api.placeOrder", outcome: "success" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("api.placeOrder")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "local:App.orderStatus", expr: lit("done") }
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "local:App.orderStatus"],
        confidence: "exact"
      },
      {
        id: "swr:api_user:fetch",
        cls: "library",
        label: { kind: "timer", key: "api_user" },
        source: [],
        guard: lit(true),
        effect: {
          kind: "seq",
          effects: [
            { kind: "assign", var: "swr:api_user:isValidating", expr: lit(true) },
            { kind: "enqueue", op: "GET /api/user", continuation: "swr:api_user:resolve", args: {} }
          ]
        },
        reads: [],
        writes: ["swr:api_user:isValidating", "sys:pending"],
        confidence: "exact"
      },
      {
        id: "swr:api_user:resolve:success:0",
        cls: "env",
        label: { kind: "resolve", op: "GET /api/user", outcome: "success:0" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("GET /api/user")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "swr:api_user:data", expr: lit("tok1") },
            { kind: "assign", var: "swr:api_user:isValidating", expr: lit(false) },
            { kind: "assign", var: "swr:api_user:error", expr: lit(false) }
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "swr:api_user:data", "swr:api_user:isValidating", "swr:api_user:error"],
        confidence: "exact"
      },
      {
        id: "swr:api_user:resolve:error",
        cls: "env",
        label: { kind: "resolve", op: "GET /api/user", outcome: "error" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("GET /api/user")),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            { kind: "assign", var: "swr:api_user:isValidating", expr: lit(false) },
            { kind: "assign", var: "swr:api_user:error", expr: lit(true) }
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "swr:api_user:isValidating", "swr:api_user:error"],
        confidence: "exact"
      }
    ]
  };
}
