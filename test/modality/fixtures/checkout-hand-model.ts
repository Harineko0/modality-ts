import type { ExprIR, Model, Value } from "modality-ts/kernel";

const lit = (value: Value): ExprIR => ({ kind: "lit", value });
const read = (id: string, path?: string[]): ExprIR => ({ kind: "read", var: id, path });
const eq = (left: ExprIR, right: ExprIR): ExprIR => ({ kind: "eq", args: [left, right] });
const neq = (left: ExprIR, right: ExprIR): ExprIR => ({ kind: "neq", args: [left, right] });
const not = (arg: ExprIR): ExprIR => ({ kind: "not", args: [arg] });
const or = (...args: ExprIR[]): ExprIR => ({ kind: "or", args });
const pendingOp = (op: string): ExprIR => eq(read("sys:pending", ["0", "opId"]), lit(op));

export function checkoutHandModel(): Model {
  return {
    schemaVersion: 1,
    id: "checkout-hand-model",
    bounds: { maxDepth: 16, maxPending: 2, maxInternalSteps: 16 },
    vars: [
      { id: "sys:route", domain: { kind: "enum", values: ["/checkout"] }, origin: "system", scope: { kind: "global" }, initial: "/checkout" },
      { id: "sys:history", domain: { kind: "boundedList", inner: { kind: "enum", values: ["/checkout"] }, maxLen: 4 }, origin: "system", scope: { kind: "global" }, initial: [] },
      {
        id: "sys:pending",
        domain: {
          kind: "boundedList",
          inner: {
            kind: "record",
            fields: {
              opId: { kind: "enum", values: ["api.fetchQuote", "api.submitOrder"] },
              continuation: { kind: "enum", values: ["App.onChange.api.fetchQuote.cont", "App.onChange.api.submitOrder.cont", "App.onClick.api.fetchQuote.cont", "App.onClick.api.submitOrder.cont", "App.onSubmit.api.fetchQuote.cont", "App.onSubmit.api.submitOrder.cont"] },
              args: {
                kind: "record",
                fields: {
                  userId: { kind: "enum", values: ["none", "u1"] },
                  plan: { kind: "enum", values: ["none", "starter", "pro"] }
                }
              }
            }
          },
          maxLen: 2
        },
        origin: "system",
        scope: { kind: "global" },
        initial: []
      },
      { id: "local:App.auth", domain: { kind: "enum", values: ["guest", "user"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "guest" },
      { id: "local:App.userId", domain: { kind: "enum", values: ["none", "u1"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "none" },
      { id: "local:App.plan", domain: { kind: "enum", values: ["none", "starter", "pro"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "none" },
      { id: "local:App.quoteStatus", domain: { kind: "enum", values: ["missing", "loading", "valid", "invalid"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "missing" },
      { id: "local:App.step", domain: { kind: "enum", values: ["plan", "billing", "review", "success"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "plan" },
      { id: "local:App.paymentMethod", domain: { kind: "enum", values: ["none", "valid"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "none" },
      { id: "local:App.submitStatus", domain: { kind: "enum", values: ["idle", "submitting", "failed"] }, origin: "system", scope: { kind: "route-local", route: "/checkout" }, initial: "idle" }
    ],
    transitions: [
      userSeq("App.onClick.auth_userId.seq", [
        assign("local:App.auth", "user"),
        assign("local:App.userId", "u1")
      ], not(neq(read("local:App.auth"), lit("guest"))), ["local:App.auth"]),
      userSeq("App.onClick.auth_paymentMethod_plan_quoteStatus_step_submitStatus_userId.seq", [
        assign("local:App.auth", "guest"),
        assign("local:App.userId", "none"),
        assign("local:App.step", "plan"),
        assign("local:App.plan", "none"),
        assign("local:App.quoteStatus", "missing"),
        assign("local:App.paymentMethod", "none"),
        assign("local:App.submitStatus", "idle")
      ]),
      {
        id: "App.onClick.api.fetchQuote.start",
        cls: "user",
        label: { kind: "click", text: "App.onClick.api.fetchQuote.start" },
        source: [],
        guard: not(neq(read("local:App.auth"), lit("user"))),
        effect: {
          kind: "seq",
          effects: [
            assign("local:App.plan", "pro"),
            assign("local:App.quoteStatus", "loading"),
            {
              kind: "enqueue",
              op: "api.fetchQuote",
              continuation: "App.onClick.api.fetchQuote.cont",
              args: {
                plan: lit("pro")
              }
            }
          ]
        },
        reads: ["local:App.auth"],
        writes: ["local:App.plan", "local:App.quoteStatus", "sys:pending"],
        confidence: "exact"
      },
      {
        id: "App.onClick.api.fetchQuote.success",
        cls: "env",
        label: { kind: "resolve", op: "api.fetchQuote", outcome: "success" },
        source: [],
        guard: pendingOp("api.fetchQuote"),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            assign("local:App.quoteStatus", "invalid")
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "local:App.quoteStatus"],
        confidence: "exact"
      },
      userSeq("App.onClick.plan_quoteStatus.seq", [
        assign("local:App.plan", "starter"),
        assign("local:App.quoteStatus", "valid")
      ], not(neq(read("local:App.auth"), lit("user"))), ["local:App.auth"]),
      userAssign("App.onClick.step.my8cwv", "local:App.step", "billing", not(or(neq(read("local:App.auth"), lit("user")), eq(read("local:App.plan"), lit("none")))), ["local:App.auth", "local:App.plan"]),
      userAssign("App.onClick.paymentMethod", "local:App.paymentMethod", "valid", not(or(neq(read("local:App.auth"), lit("user")), neq(read("local:App.step"), lit("billing")))), ["local:App.auth", "local:App.step"]),
      userAssign("App.onClick.step.ny1ruq", "local:App.step", "review", not(or(or(neq(read("local:App.auth"), lit("user")), neq(read("local:App.step"), lit("billing"))), eq(read("local:App.paymentMethod"), lit("none")))), ["local:App.auth", "local:App.step", "local:App.paymentMethod"]),
      userAssign("App.onClick.step.3k1mh1", "local:App.step", "plan"),
      {
        id: "App.onClick.api.submitOrder.start",
        cls: "user",
        label: { kind: "click", locator: { kind: "role", role: "button", name: "Submit order" } },
        source: [],
        guard: not(or(or(or(neq(read("local:App.auth"), lit("user")), neq(read("local:App.step"), lit("review"))), eq(read("local:App.submitStatus"), lit("submitting"))), eq(read("local:App.plan"), lit("none")))),
        effect: {
          kind: "seq",
          effects: [
            assign("local:App.submitStatus", "submitting"),
            {
              kind: "enqueue",
              op: "api.submitOrder",
              continuation: "App.onClick.api.submitOrder.cont",
              args: {
                userId: read("local:App.userId"),
                plan: read("local:App.plan")
              }
            }
          ]
        },
        reads: ["local:App.plan", "local:App.userId", "local:App.auth", "local:App.step", "local:App.submitStatus"],
        writes: ["local:App.submitStatus", "sys:pending"],
        confidence: "exact"
      },
      {
        id: "App.onClick.api.submitOrder.success",
        cls: "env",
        label: { kind: "resolve", op: "api.submitOrder", outcome: "success" },
        source: [],
        guard: pendingOp("api.submitOrder"),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            assign("local:App.submitStatus", "idle"),
            assign("local:App.step", "success")
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "local:App.submitStatus", "local:App.step"],
        confidence: "exact"
      },
      {
        id: "App.onClick.api.submitOrder.error",
        cls: "env",
        label: { kind: "resolve", op: "api.submitOrder", outcome: "error" },
        source: [],
        guard: pendingOp("api.submitOrder"),
        effect: {
          kind: "seq",
          effects: [
            { kind: "dequeue", index: 0 },
            assign("local:App.submitStatus", "failed")
          ]
        },
        reads: ["sys:pending"],
        writes: ["sys:pending", "local:App.submitStatus"],
        confidence: "exact"
      }
    ]
  };
}

function userSeq(id: string, effects: Extract<Model["transitions"][number]["effect"], { kind: "assign" }>[], guard: ExprIR = lit(true), reads: string[] = []): Model["transitions"][number] {
  return {
    id,
    cls: "user",
    label: { kind: "click", text: id },
    source: [],
    guard,
    effect: { kind: "seq", effects },
    reads,
    writes: effects.map((effect) => effect.var),
    confidence: "exact"
  };
}

function userAssign(id: string, variable: string, value: Value, guard: ExprIR = lit(true), reads: string[] = []): Model["transitions"][number] {
  return {
    id,
    cls: "user",
    label: { kind: "click", text: id },
    source: [],
    guard,
    effect: assign(variable, value),
    reads,
    writes: [variable],
    confidence: "exact"
  };
}

function assign(variable: string, value: Value): Extract<Model["transitions"][number]["effect"], { kind: "assign" }> {
  return { kind: "assign", var: variable, expr: lit(value) };
}
