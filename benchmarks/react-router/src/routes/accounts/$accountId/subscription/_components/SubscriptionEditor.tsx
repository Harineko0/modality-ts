import { useParams } from "react-router-dom";
import { useSubscriptionStore } from "../../../../../features/subscription/state/subscription-store.js";
import { useSubscription } from "../../../../../features/subscription/infra/subscription-queries.js";
import { parseSubscriptionDraft } from "../../../../../shared/features/subscription/domain/subscription.ark.js";
import { PlanSelector } from "../../../../../features/subscription/_components/PlanSelector.js";
import { ApprovalBanner } from "../../../../../features/subscription/_components/ApprovalBanner.js";
import { api } from "../../../../../features/auth/infra/api.js";

export function SubscriptionEditor() {
  const { accountId = "acct-alpha" } = useParams();
  const planDraft = useSubscriptionStore((s) => s.planDraft);
  const seatDraft = useSubscriptionStore((s) => s.seatDraft);
  const approvalStatus = useSubscriptionStore((s) => s.approvalStatus);
  const setPlanDraft = useSubscriptionStore((s) => s.setPlanDraft);
  const adjustSeats = useSubscriptionStore((s) => s.adjustSeats);
  const markApprovalRequested = useSubscriptionStore(
    (s) => s.markApprovalRequested,
  );
  const applyApproval = useSubscriptionStore((s) => s.applyApproval);
  useSubscription(accountId);
  parseSubscriptionDraft({ plan: planDraft, seatCount: seatDraft });

  return (
    <section>
      <PlanSelector value={planDraft} onChange={setPlanDraft} />
      <button type="button" onClick={() => adjustSeats(-1)}>
        -
      </button>
      <span>seat stepper: {seatDraft}</span>
      <button type="button" onClick={() => adjustSeats(1)}>
        +
      </button>
      <button
        type="button"
        onClick={async () => {
          const request = await api.requestApproval(
            { plan: planDraft, seatCount: seatDraft },
            accountId,
          );
          markApprovalRequested(request);
        }}
      >
        request approval button
      </button>
      <button
        type="button"
        onClick={async () => {
          const request = useSubscriptionStore.getState().requestSnapshot;
          const seats = useSubscriptionStore.getState().seatDraft;
          if (request) {
            await api.applyApproval({ ...request, requestedSeats: seats });
          }
          applyApproval();
        }}
      >
        apply approval button
      </button>
      <ApprovalBanner status={approvalStatus} />
    </section>
  );
}
