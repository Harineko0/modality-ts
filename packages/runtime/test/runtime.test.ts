import { describe, expect, it } from "vitest";
import { always, reachable, type Model } from "@modality/kernel";
import { assertObservableInvariantsOrThrow, assertObservableState, assertObservableStateOrThrow, evaluateObservableInvariants, observable } from "../src/index.js";

const model = {} as Model;

describe("@modality/runtime observable assertions", () => {
  it("compares observable app values against a model state", () => {
    const result = assertObservableState(
      { "local:App.status": "idle", "swr:todos:data": "many" },
      [
        observable("local:App.status", (app: { status: string }) => app.status),
        observable("swr:todos:data", (app: { todos: string }) => app.todos)
      ],
      { status: "idle", todos: "0" }
    );
    expect(result).toEqual({
      ok: false,
      mismatches: [{ var: "swr:todos:data", expected: "many", actual: "0" }]
    });
  });

  it("throws a compact divergence message for replay codegen", () => {
    expect(() =>
      assertObservableStateOrThrow(
        { flag: true },
        [observable("flag", (app: { flag: boolean }) => app.flag)],
        { flag: false }
      )
    ).toThrow("flag expected=true actual=false");
  });

  it("evaluates observable-only invariants against live app state", () => {
    const properties = [
      always(model, (state) => state.auth === "user" || state.route !== "/checkout", { name: "checkoutRequiresUser", reads: ["auth", "route"] }),
      always(model, (state) => state.missing === true, { name: "missingObservable", reads: ["missing"] }),
      reachable(model, (state) => state.auth === "user", { name: "notAnInvariant", reads: ["auth"] })
    ];
    const result = evaluateObservableInvariants(
      properties,
      [
        observable("auth", (app: { auth: string; route: string }) => app.auth),
        observable("route", (app: { auth: string; route: string }) => app.route)
      ],
      { auth: "guest", route: "/checkout" }
    );
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([{ property: "checkoutRequiresUser", message: "observable invariant failed" }]);
    expect(result.skipped).toEqual([
      { property: "missingObservable", reason: "unobservable reads: missing" },
      { property: "notAnInvariant", reason: "unsupported property kind: reachable" }
    ]);
  });

  it("throws compact observable invariant failures", () => {
    expect(() =>
      assertObservableInvariantsOrThrow(
        [always(model, (state) => state.flag === true, { name: "flagTrue", reads: ["flag"] })],
        [observable("flag", (app: { flag: boolean }) => app.flag)],
        { flag: false }
      )
    ).toThrow("flagTrue: observable invariant failed");
  });
});
