import type { ApprovalStatus, Plan } from "../../fixtures/domain/fixtures.js";

export type SubscriptionDraft = {
  plan: Plan;
  seatCount: number;
};

export type ApprovalRequest = {
  accountId: string;
  requestedPlan: Plan;
  requestedSeats: number;
  status: ApprovalStatus;
};

export type ApprovalQueueFilter = "all" | "requested" | "approved" | "rejected";
