import { type } from "arktype";
import { seedApprovalRequests } from "../../fixtures/domain/fixtures.js";
import type { ApprovalRequest, SubscriptionDraft } from "../domain/approval.js";
import { isSeatCountValidForPlan } from "../domain/plan.js";
import { parseSubscriptionDraft } from "../domain/subscription.ark.js";

export function validateSubscriptionDraft(
  input: unknown,
): SubscriptionDraft | null {
  const parsed = parseSubscriptionDraft(input);
  if (parsed instanceof type.errors) return null;
  if (!isSeatCountValidForPlan(parsed.plan, parsed.seatCount ?? 1)) {
    return null;
  }
  return { plan: parsed.plan, seatCount: parsed.seatCount ?? 1 };
}

export function listApprovals(): readonly ApprovalRequest[] {
  return seedApprovalRequests;
}

export function canApplyApproval(request: ApprovalRequest): boolean {
  return request.status === "approved";
}
