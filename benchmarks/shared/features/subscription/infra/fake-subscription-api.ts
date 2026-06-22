import { canApplyApproval } from "../application/subscription-service.js";
import type { ApprovalRequest, SubscriptionDraft } from "../domain/approval.js";

export async function requestApproval(
  draft: SubscriptionDraft,
  accountId: string,
): Promise<ApprovalRequest> {
  return {
    accountId,
    requestedPlan: draft.plan,
    requestedSeats: draft.seatCount,
    status: "requested",
  };
}

export async function applyApproval(request: ApprovalRequest): Promise<{
  applied: boolean;
  seats: number;
  plan: ApprovalRequest["requestedPlan"];
}> {
  return {
    applied: canApplyApproval(request),
    seats: request.requestedSeats,
    plan: request.requestedPlan,
  };
}
