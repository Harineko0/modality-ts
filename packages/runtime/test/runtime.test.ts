import { describe, expect, it } from "vitest";
import { assertObservableState, assertObservableStateOrThrow, observable } from "../src/index.js";

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
});
