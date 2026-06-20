import {
  always,
  alwaysStep,
  and,
  eq,
  neq,
  not,
  pre,
  readOpArg,
  reachableFrom,
  stepAny,
  stepResolved,
} from "modality-ts/properties";
import {
  App,
} from "./App.modals";

always("guestCannotReachSuccess", not(and(eq(App.auth, "guest"), eq(App.step, "success"))));

alwaysStep("orderSuccessMatchesUser", {
  negate: true,
  step: stepResolved("api.submitOrder", "success"),
  post: and(
    eq(App.step, "success"),
    not(and(eq(App.auth, "user"), eq(readOpArg("userId"), App.userId))),
  ),
});

alwaysStep("orderSuccessMatchesCart", {
  negate: true,
  step: stepResolved("api.submitOrder", "success"),
  post: and(
    eq(App.step, "success"),
    eq(App.auth, "user"),
    neq(readOpArg("plan"), App.plan),
  ),
});

alwaysStep("staleFailureDoesNotMutateGuestStatus", {
  negate: true,
  step: stepResolved("api.submitOrder", "error"),
  pre: eq(App.auth, "guest"),
  post: neq(App.submitStatus, pre(App.submitStatus)),
});

alwaysStep("invalidQuoteCannotEnterBilling", {
  negate: true,
  step: stepAny(),
  pre: eq(App.quoteStatus, "invalid"),
  post: eq(App.step, "billing"),
});

reachableFrom(
  "reviewCanReachSuccess",
  and(eq(App.auth, "user"), eq(App.step, "review"), eq(App.submitStatus, "idle")),
  eq(App.step, "success"),
);
