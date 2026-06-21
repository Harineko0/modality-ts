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
} from "modality-ts/properties";
import { useSubscriptionStore } from "../../../../features/subscription/state/subscription-store.modals";

const seatDraft = useSubscriptionStore.seatDraft;
const approvalStatus = useSubscriptionStore.approvalStatus;
const requestSnapshot = useSubscriptionStore.requestSnapshot;

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
