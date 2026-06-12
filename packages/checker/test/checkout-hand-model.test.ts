import { describe, expect, it } from "vitest";
import { checkModel } from "../src/index.js";
import { always, alwaysStep, reachableFrom, type ExprIR, type Model, type Property, type Value } from "@modality/kernel";

const route = { kind: "enum", values: ["/checkout"] } as const;
const pendingOrder = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST_ORDER"] },
    continuation: { kind: "enum", values: ["submitOrder#1"] },
    args: {
      kind: "record",
      fields: {
        userId: { kind: "enum", values: ["u1"] },
        plan: { kind: "enum", values: ["starter", "pro"] }
      }
    }
  }
} as const;

const lit = (value: Value): ExprIR => ({ kind: "lit", value });
const read = (id: string, path?: string[]): ExprIR => ({ kind: "read", var: id, path });
const eq = (left: ExprIR, right: ExprIR): ExprIR => ({ kind: "eq", args: [left, right] });
const neq = (left: ExprIR, right: ExprIR): ExprIR => ({ kind: "neq", args: [left, right] });
const and = (...args: ExprIR[]): ExprIR => ({ kind: "and", args });

function checkoutModel(): Model {
  return {
    schemaVersion: 1,
    id: "checkout-hand-model",
    bounds: { maxDepth: 10, maxPending: 2, maxInternalSteps: 8 },
    vars: [
      { id: "sys:route", domain: route, origin: "system", scope: { kind: "global" }, initial: "/checkout" },
      { id: "sys:history", domain: { kind: "boundedList", inner: route, maxLen: 1 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "sys:pending", domain: { kind: "boundedList", inner: pendingOrder, maxLen: 2 }, origin: "system", scope: { kind: "global" }, initial: [] },
      { id: "auth", domain: { kind: "enum", values: ["guest", "user"] }, origin: "system", scope: { kind: "global" }, initial: "guest" },
      { id: "userId", domain: { kind: "enum", values: ["none", "u1"] }, origin: "system", scope: { kind: "global" }, initial: "none" },
      { id: "plan", domain: { kind: "enum", values: ["none", "starter", "pro"] }, origin: "system", scope: { kind: "global" }, initial: "none" },
      { id: "step", domain: { kind: "enum", values: ["plan", "billing", "review", "success"] }, origin: "system", scope: { kind: "global" }, initial: "plan" },
      { id: "paymentMethod", domain: { kind: "enum", values: ["none", "valid"] }, origin: "system", scope: { kind: "global" }, initial: "none" },
      { id: "submitStatus", domain: { kind: "enum", values: ["idle", "submitting", "failed"] }, origin: "system", scope: { kind: "global" }, initial: "idle" }
    ],
    transitions: [
      user("login", eq(read("auth"), lit("guest")), [
        assign("auth", "user"),
        assign("userId", "u1")
      ]),
      user("logout", eq(read("auth"), lit("user")), [
        assign("auth", "guest"),
        assign("userId", "none"),
        assign("step", "plan"),
        assign("plan", "none"),
        assign("paymentMethod", "none"),
        assign("submitStatus", "idle")
      ]),
      user("selectPro", eq(read("auth"), lit("user")), [assign("plan", "pro")]),
      user("selectStarter", eq(read("auth"), lit("user")), [assign("plan", "starter")]),
      user("goBilling", and(eq(read("auth"), lit("user")), neq(read("plan"), lit("none"))), [assign("step", "billing")]),
      user("selectPayment", and(eq(read("auth"), lit("user")), eq(read("step"), lit("billing"))), [assign("paymentMethod", "valid")]),
      user("goReview", and(eq(read("auth"), lit("user")), eq(read("step"), lit("billing")), eq(read("paymentMethod"), lit("valid"))), [assign("step", "review")]),
      {
        id: "submitOrder",
        cls: "user",
        label: { kind: "submit", text: "Submit order" },
        source: [],
        guard: and(eq(read("auth"), lit("user")), eq(read("step"), lit("review")), eq(read("submitStatus"), lit("idle")), neq(read("plan"), lit("none"))),
        effect: {
          kind: "seq",
          effects: [
            assign("submitStatus", "submitting"),
            { kind: "enqueue", op: "POST_ORDER", continuation: "submitOrder#1", args: { userId: read("userId"), plan: read("plan") } }
          ]
        },
        reads: ["auth", "step", "submitStatus", "plan", "userId"],
        writes: ["submitStatus", "sys:pending"],
        confidence: "exact"
      },
      {
        id: "resolveOrderSuccess",
        cls: "env",
        label: { kind: "resolve", op: "POST_ORDER", outcome: "success" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("POST_ORDER")),
        effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, assign("submitStatus", "idle"), assign("step", "success")] },
        reads: ["sys:pending"],
        writes: ["sys:pending", "submitStatus", "step"],
        confidence: "exact"
      },
      {
        id: "resolveOrderError",
        cls: "env",
        label: { kind: "resolve", op: "POST_ORDER", outcome: "error" },
        source: [],
        guard: eq(read("sys:pending", ["0", "opId"]), lit("POST_ORDER")),
        effect: { kind: "seq", effects: [{ kind: "dequeue", index: 0 }, assign("submitStatus", "failed")] },
        reads: ["sys:pending"],
        writes: ["sys:pending", "submitStatus"],
        confidence: "exact"
      }
    ]
  };
}

function checkoutProperties(model: Model): Property[] {
  return [
    always(model, (s) => !(s.auth === "guest" && s.step === "success"), { name: "guestCannotReachSuccess", reads: ["auth", "step"] }),
    alwaysStep(
      model,
      (_pre, step, post) =>
        !(step.resolved("POST_ORDER", "success") && post.step === "success") ||
        (post.auth === "user" && step.op?.args.userId === post.userId),
      { name: "orderSuccessMatchesUser", reads: ["auth", "userId", "step", "sys:pending"] }
    ),
    alwaysStep(
      model,
      (_pre, step, post) =>
        !(step.resolved("POST_ORDER", "success") && post.step === "success" && post.auth === "user") ||
        step.op?.args.plan === post.plan,
      { name: "orderSuccessMatchesCart", reads: ["plan", "step", "sys:pending"] }
    ),
    reachableFrom(
      model,
      (s) => s.step === "review" && s.submitStatus === "idle" && s.auth === "user",
      (s) => s.step === "success",
      { name: "reviewCanReachSuccess", reads: ["submitStatus", "auth", "step"] }
    )
  ];
}

describe("hand-written checkout IR", () => {
  it("reproduces representative stale-submit checkout violations", () => {
    const model = checkoutModel();
    const result = checkModel(model, checkoutProperties(model));
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict]));

    expect(byName.get("guestCannotReachSuccess")?.status).toBe("violated");
    expect(byName.get("orderSuccessMatchesUser")?.status).toBe("violated");
    expect(byName.get("orderSuccessMatchesCart")?.status).toBe("violated");
    expect(byName.get("reviewCanReachSuccess")?.status).toBe("verified-within-bounds");
  });

  it("pins checkout counterexample trace shapes", () => {
    const model = checkoutModel();
    const result = checkModel(model, checkoutProperties(model));
    const byName = new Map(result.verdicts.map((verdict) => [verdict.property, verdict]));
    const staleUser = byName.get("orderSuccessMatchesUser");
    const staleCart = byName.get("orderSuccessMatchesCart");

    expect(staleUser?.status === "violated" ? staleUser.trace.steps.map((step) => step.transitionId) : []).toEqual([
      "login",
      "selectPro",
      "goBilling",
      "selectPayment",
      "goReview",
      "submitOrder",
      "logout",
      "resolveOrderSuccess"
    ]);
    expect(staleCart?.status === "violated" ? staleCart.trace.steps.map((step) => step.transitionId) : []).toEqual([
      "login",
      "selectPro",
      "goBilling",
      "selectPayment",
      "goReview",
      "submitOrder",
      "selectStarter",
      "resolveOrderSuccess"
    ]);
  });

  it("keeps representative checkout verdicts stable with slicing enabled", () => {
    const model = checkoutModel();
    const full = checkModel(model, checkoutProperties(model));
    const sliced = checkModel(model, checkoutProperties(model), { slicing: true });
    expect(sliced.verdicts.map((verdict) => [verdict.property, verdict.status])).toEqual(
      full.verdicts.map((verdict) => [verdict.property, verdict.status])
    );
  });
});

function user(id: string, guard: ExprIR, effects: Extract<Model["transitions"][number]["effect"], { kind: "assign" }>[]): Model["transitions"][number] {
  const writes = [...new Set(effects.map((effect) => effect.var))];
  const reads = [...exprReads(guard)];
  return {
    id,
    cls: "user",
    label: { kind: "click", text: id },
    source: [],
    guard,
    effect: { kind: "seq", effects },
    reads,
    writes,
    confidence: "exact"
  };
}

function assign(variable: string, value: Value): Extract<Model["transitions"][number]["effect"], { kind: "assign" }> {
  return { kind: "assign", var: variable, expr: lit(value) };
}

function exprReads(expr: ExprIR): Set<string> {
  const reads = new Set<string>();
  const visit = (node: ExprIR): void => {
    if (node.kind === "read") reads.add(node.var);
    if ("args" in node) node.args.forEach(visit);
    if (node.kind === "updateField") {
      visit(node.target);
      visit(node.value);
    }
    if (node.kind === "tagIs" || node.kind === "lenCat") visit(node.arg);
  };
  visit(expr);
  return reads;
}
