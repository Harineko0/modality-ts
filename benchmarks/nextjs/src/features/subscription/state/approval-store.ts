import { create } from "zustand";
import type {
  ApprovalStatus,
  AsyncStatus,
} from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { ApprovalQueueFilter } from "../../../../shared/features/subscription/domain/approval.js";

type ApprovalState = {
  queueFilter: ApprovalQueueFilter;
  decisionStatus: AsyncStatus;
  approvalStatus: ApprovalStatus;
  setQueueFilter: (filter: ApprovalQueueFilter) => void;
  approve: () => void;
  reject: () => void;
  applyApproved: () => void;
};

export const useApprovalStore = create<ApprovalState>((set) => ({
  queueFilter: "requested",
  decisionStatus: "idle",
  approvalStatus: "requested",
  setQueueFilter: (filter) => set({ queueFilter: filter }),
  approve: () => set({ approvalStatus: "approved", decisionStatus: "success" }),
  reject: () => set({ approvalStatus: "rejected", decisionStatus: "success" }),
  applyApproved: () => set({ decisionStatus: "submitting" }),
}));
