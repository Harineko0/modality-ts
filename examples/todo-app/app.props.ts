import {
  always,
  alwaysStep,
  and,
  eq,
  neq,
  not,
  or,
  pre,
  stepEnqueued,
  stepResolved,
} from "modality-ts/properties";
import { pending } from "modality-ts/vars";
import { authAtom } from "./App";
import { App } from "./App.modals";

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

always("naiveNoDoubleSubmitInvariant", atMostOnePendingOp("api.createTodo"));

alwaysStep("guestCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(authAtom, "guest"),
});

alwaysStep("emptyDraftCannotSubmit", {
  negate: true,
  step: stepEnqueued("api.createTodo"),
  pre: eq(App.draft, "empty"),
});

alwaysStep("staleCompletionIsInert", {
  negate: true,
  step: stepResolved("api.createTodo", "success"),
  pre: neq(App.saveStatus, "posting"),
  post: neq(App.draft, pre(App.draft)),
});
