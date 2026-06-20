import { useSubscriptionStore } from "../state/subscription-store.js";

export function useSubscriptionActions() {
  const setPlanDraft = useSubscriptionStore((state) => state.setPlanDraft);
  const adjustSeats = useSubscriptionStore((state) => state.adjustSeats);
  const markApprovalRequested = useSubscriptionStore(
    (state) => state.markApprovalRequested,
  );
  const applyApproval = useSubscriptionStore((state) => state.applyApproval);
  return { setPlanDraft, adjustSeats, markApprovalRequested, applyApproval };
}
