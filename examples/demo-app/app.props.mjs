import {
  andExpr,
  eq,
  lit,
  neq,
  notExpr,
  orExpr,
  readVar,
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
      name: "noDoubleSubmit",
      reads: ["sys:pending"],
      predicate: atMostOnePendingOp("api.placeOrder"),
    },
    {
      kind: "always",
      name: "guestCannotReachAdmin",
      reads: ["sys:route", "atom:authAtom"],
      predicate: notExpr(
        andExpr(
          eq(readVar("sys:route"), lit("/admin")),
          eq(readVar("atom:authAtom"), lit("guest")),
        ),
      ),
    },
    {
      kind: "always",
      name: "guestDoesNotSeeUserCache",
      reads: ["atom:authAtom", "swr:api_user:data"],
      predicate: notExpr(
        andExpr(
          eq(readVar("atom:authAtom"), lit("guest")),
          neq(readVar("swr:api_user:data"), lit(null)),
        ),
      ),
    },
  ];
}
