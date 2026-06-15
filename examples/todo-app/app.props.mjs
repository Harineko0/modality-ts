import {
  andExpr,
  eq,
  lit,
  neq,
  notExpr,
  orExpr,
  readPreVar,
  readVar,
  stepEnqueued,
  stepResolved,
} from "modality-ts/core";

function atMostOnePendingOp(opId) {
  return andExpr(
    orExpr(
      neq(readVar("sys:pending", ["0", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["1", "opId"]), lit(opId)),
    ),
    orExpr(
      neq(readVar("sys:pending", ["0", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["2", "opId"]), lit(opId)),
    ),
    orExpr(
      neq(readVar("sys:pending", ["1", "opId"]), lit(opId)),
      neq(readVar("sys:pending", ["2", "opId"]), lit(opId)),
    ),
  );
}

export function properties() {
  return [
    {
      kind: "always",
      name: "naiveNoDoubleSubmitInvariant",
      reads: ["sys:pending"],
      predicate: atMostOnePendingOp("api.createTodo"),
    },
    {
      kind: "alwaysStep",
      name: "guestCannotSubmit",
      reads: ["atom:authAtom", "sys:pending"],
      predicate: {
        negate: true,
        step: stepEnqueued("api.createTodo"),
        pre: eq(readVar("atom:authAtom"), lit("guest")),
      },
    },
    {
      kind: "alwaysStep",
      name: "emptyDraftCannotSubmit",
      reads: ["local:App.draft", "sys:pending"],
      predicate: {
        negate: true,
        step: stepEnqueued("api.createTodo"),
        pre: eq(readVar("local:App.draft"), lit("empty")),
      },
    },
    {
      kind: "alwaysStep",
      name: "staleCompletionIsInert",
      reads: ["local:App.saveStatus", "local:App.draft", "sys:pending"],
      predicate: {
        negate: true,
        step: stepResolved("api.createTodo", "success"),
        pre: neq(readVar("local:App.saveStatus"), lit("posting")),
        post: neq(readVar("local:App.draft"), readPreVar("local:App.draft")),
      },
    },
  ];
}
