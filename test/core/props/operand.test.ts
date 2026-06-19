import { describe, expect, it } from "vitest";
import {
  add,
  and,
  type AbstractDomain,
  eq,
  lessThan,
  lit,
  not,
  readVar,
  type Variable,
  variable,
} from "modality-ts/core";
import { isExprIR, isVariable, lift } from "../../../src/core/props/operand.js";

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends <T>() => T extends Right ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

describe("operand lift", () => {
  it("preserves literal var ids in the handle type", () => {
    const handle = variable("local:App.phase");
    type _IdIsLiteral = Expect<
      Equal<typeof handle, Variable<AbstractDomain, "local:App.phase">>
    >;
    expect(handle.varId).toBe("local:App.phase");
  });

  it("lifts handles to read nodes", () => {
    const handle = variable("atom:auth");
    expect(isVariable(handle)).toBe(true);
    expect(lift(handle)).toEqual({ kind: "read", var: "atom:auth" });
  });

  it("lifts primitives to literals", () => {
    expect(lift("guest")).toEqual({ kind: "lit", value: "guest" });
    expect(lift(false)).toEqual({ kind: "lit", value: false });
  });

  it("passes through ExprIR", () => {
    const expr = readVar("flag");
    expect(isExprIR(expr)).toBe(true);
    expect(lift(expr)).toBe(expr);
  });
});

describe("expression builders", () => {
  it("builds eq from handles and primitives", () => {
    const handle = variable("local:App.step");
    expect(eq(handle, "confirm")).toEqual({
      kind: "eq",
      args: [
        { kind: "read", var: "local:App.step" },
        { kind: "lit", value: "confirm" },
      ],
    });
    expect(eq(readVar("x"), "y")).toEqual(eq(readVar("x"), lit("y")));
  });

  it("builds boolean and numeric IR", () => {
    const count = variable("local:Cart.count");
    const capacity = variable("local:Cart.capacity");
    expect(and(eq(count, 1), not(eq(count, 0)))).toEqual({
      kind: "and",
      args: [
        {
          kind: "eq",
          args: [
            { kind: "read", var: "local:Cart.count" },
            { kind: "lit", value: 1 },
          ],
        },
        {
          kind: "not",
          args: [
            {
              kind: "eq",
              args: [
                { kind: "read", var: "local:Cart.count" },
                { kind: "lit", value: 0 },
              ],
            },
          ],
        },
      ],
    });
    expect(lessThan(capacity, add(count, 1))).toEqual({
      kind: "lt",
      args: [
        { kind: "read", var: "local:Cart.capacity" },
        {
          kind: "add",
          args: [
            { kind: "read", var: "local:Cart.count" },
            { kind: "lit", value: 1 },
          ],
        },
      ],
    });
  });
});
