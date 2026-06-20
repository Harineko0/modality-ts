import { create } from "zustand";
import type {
  ApprovalStatus,
  Plan,
} from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { ApprovalRequest } from "../../../../shared/features/subscription/domain/approval.js";

type SubscriptionState = {
  planDraft: Plan;
  seatDraft: number;
  approvalStatus: ApprovalStatus;
  requestSnapshot: ApprovalRequest | null;
  setPlanDraft: (plan: Plan) => void;
  adjustSeats: (delta: number) => void;
  markApprovalRequested: (request: ApprovalRequest) => void;
  applyApproval: () => void;
};

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  planDraft: "growth",
  seatDraft: 12,
  approvalStatus: "none",
  requestSnapshot: null,
  setPlanDraft: (plan) => set({ planDraft: plan }),
  adjustSeats: (delta) =>
    set((state) => ({ seatDraft: Math.max(1, state.seatDraft + delta) })),
  markApprovalRequested: (request) =>
    set({ approvalStatus: "requested", requestSnapshot: request }),
  applyApproval: () => {
    set({ approvalStatus: "approved" });
  },
}));
