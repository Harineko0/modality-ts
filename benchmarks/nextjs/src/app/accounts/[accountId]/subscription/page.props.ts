import {
  always,
  alwaysStep,
  and,
  eq,
  greaterThan,
  group,
  neq,
  readOpArg,
  stepChanged,
  stepResolved,
  stepTransitionId,
  variable,
} from "modality-ts/properties";

const seatDraft = variable("zustand:useSubscriptionStore.seatDraft");
const approvalStatus = variable("zustand:useSubscriptionStore.approvalStatus");
const requestSnapshot = variable(
  "zustand:useSubscriptionStore.requestSnapshot",
);

group("subscription", () => {
  alwaysStep("subscription.approvalAppliesRequestedSeats", {
    negate: true,
    step: stepResolved("api.applyApproval"),
    post: and(
      eq(approvalStatus, "approved"),
      neq(readOpArg("requestedSeats"), requestSnapshot.at("seatCount")),
    ),
  });

  always("subscription.seatDraftPositive", greaterThan(seatDraft, 0));

  stepChanged("zustand:useSubscriptionStore.seatDraft");

  stepTransitionId("SubscriptionEditor.onClick.apply approval button");
});
