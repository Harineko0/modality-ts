import { always, and, eq, neq, not, or } from "modality-ts/properties";
import { pending, route } from "modality-ts/vars";
import { api_user, authAtom } from "./App.modals";

const userCache = api_user.data;

function atMostOnePendingOp(opId: string) {
  return and(
    or(
      neq(pending.at("0", "opId"), opId),
      neq(pending.at("1", "opId"), opId),
    ),
    or(
      neq(pending.at("0", "opId"), opId),
      neq(pending.at("2", "opId"), opId),
    ),
    or(
      neq(pending.at("1", "opId"), opId),
      neq(pending.at("2", "opId"), opId),
    ),
  );
}

always("noDoubleSubmit", atMostOnePendingOp("api.placeOrder"));

always(
  "guestCannotReachAdmin",
  not(and(eq(route, "/admin"), eq(authAtom, "guest"))),
);

always(
  "guestDoesNotSeeUserCache",
  not(and(eq(authAtom, "guest"), neq(userCache, null))),
);
