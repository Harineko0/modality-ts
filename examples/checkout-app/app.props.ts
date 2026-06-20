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
  auth,
  plan,
  quoteStatus,
  step,
  submitStatus,
  userId,
} from "./App.modals";

always("guestCannotReachSuccess", not(and(eq(auth, "guest"), eq(step, "success"))));

alwaysStep("orderSuccessMatchesUser", {
  negate: true,
  step: stepResolved("api.submitOrder", "success"),
  post: and(
    eq(step, "success"),
    not(and(eq(auth, "user"), eq(readOpArg("userId"), userId))),
  ),
});

alwaysStep("orderSuccessMatchesCart", {
  negate: true,
  step: stepResolved("api.submitOrder", "success"),
  post: and(
    eq(step, "success"),
    eq(auth, "user"),
    neq(readOpArg("plan"), plan),
  ),
});

alwaysStep("staleFailureDoesNotMutateGuestStatus", {
  negate: true,
  step: stepResolved("api.submitOrder", "error"),
  pre: eq(auth, "guest"),
  post: neq(submitStatus, pre(submitStatus)),
});

alwaysStep("invalidQuoteCannotEnterBilling", {
  negate: true,
  step: stepAny(),
  pre: eq(quoteStatus, "invalid"),
  post: eq(step, "billing"),
});

reachableFrom(
  "reviewCanReachSuccess",
  and(eq(auth, "user"), eq(step, "review"), eq(submitStatus, "idle")),
  eq(step, "success"),
);
