import {
  andExpr,
  eq,
  lit,
  neq,
  notExpr,
  readOpArg,
  readPreVar,
  readVar,
  stepAny,
  stepResolved,
} from "modality-ts/core";
import type { PropertyFactory } from "modality-ts/core";

export const properties: PropertyFactory = (_model) => [
    {
      kind: "always",
      name: "guestCannotReachSuccess",
      reads: ["local:App.auth", "local:App.step"],
      predicate: notExpr(
        andExpr(
          eq(readVar("local:App.auth"), lit("guest")),
          eq(readVar("local:App.step"), lit("success")),
        ),
      ),
    },
    {
      kind: "alwaysStep",
      name: "orderSuccessMatchesUser",
      reads: [
        "local:App.auth",
        "local:App.userId",
        "local:App.step",
        "sys:pending",
      ],
      predicate: {
        negate: true,
        step: stepResolved("api.submitOrder", "success"),
        post: andExpr(
          eq(readVar("local:App.step"), lit("success")),
          notExpr(
            andExpr(
              eq(readVar("local:App.auth"), lit("user")),
              eq(readOpArg("userId"), readVar("local:App.userId")),
            ),
          ),
        ),
      },
    },
    {
      kind: "alwaysStep",
      name: "orderSuccessMatchesCart",
      reads: [
        "local:App.auth",
        "local:App.plan",
        "local:App.step",
        "sys:pending",
      ],
      predicate: {
        negate: true,
        step: stepResolved("api.submitOrder", "success"),
        post: andExpr(
          eq(readVar("local:App.step"), lit("success")),
          eq(readVar("local:App.auth"), lit("user")),
          neq(readOpArg("plan"), readVar("local:App.plan")),
        ),
      },
    },
    {
      kind: "alwaysStep",
      name: "staleFailureDoesNotMutateGuestStatus",
      reads: ["local:App.auth", "local:App.submitStatus", "sys:pending"],
      predicate: {
        negate: true,
        step: stepResolved("api.submitOrder", "error"),
        pre: eq(readVar("local:App.auth"), lit("guest")),
        post: neq(
          readVar("local:App.submitStatus"),
          readPreVar("local:App.submitStatus"),
        ),
      },
    },
    {
      kind: "alwaysStep",
      name: "invalidQuoteCannotEnterBilling",
      reads: ["local:App.quoteStatus", "local:App.step"],
      predicate: {
        negate: true,
        step: stepAny(),
        pre: eq(readVar("local:App.quoteStatus"), lit("invalid")),
        post: eq(readVar("local:App.step"), lit("billing")),
      },
    },
    {
      kind: "reachableFrom",
      name: "reviewCanReachSuccess",
      reads: ["local:App.auth", "local:App.step", "local:App.submitStatus"],
      when: andExpr(
        eq(readVar("local:App.auth"), lit("user")),
        eq(readVar("local:App.step"), lit("review")),
        eq(readVar("local:App.submitStatus"), lit("idle")),
      ),
      goal: eq(readVar("local:App.step"), lit("success")),
    },
];
