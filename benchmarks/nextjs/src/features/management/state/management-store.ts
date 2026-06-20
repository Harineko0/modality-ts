import { create } from "zustand";
import type {
  AsyncStatus,
  QueueBucket,
  RevenueHealth,
  RiskBucket,
} from "../../../../shared/features/fixtures/domain/fixtures.js";

type ManagementState = {
  summaryStatus: AsyncStatus;
  riskFilter: RiskBucket;
  selectedRiskBucket: RiskBucket;
  bulkDraft: QueueBucket;
  bulkStatus: AsyncStatus;
  revenueHealth: RevenueHealth;
  failedPaymentQueue: QueueBucket;
  exportStatus: AsyncStatus;
  opsQueue: QueueBucket;
  assignmentStatus: AsyncStatus;
  setRiskFilter: (bucket: RiskBucket) => void;
  enqueueBulkSuspend: (bucket: RiskBucket) => void;
  resolveBulkSuspend: (enqueuedBucket: RiskBucket) => void;
};

export const useManagementStore = create<ManagementState>((set) => ({
  summaryStatus: "idle",
  riskFilter: "medium",
  selectedRiskBucket: "high",
  bulkDraft: "some",
  bulkStatus: "idle",
  revenueHealth: "watch",
  failedPaymentQueue: "some",
  exportStatus: "idle",
  opsQueue: "some",
  assignmentStatus: "idle",
  setRiskFilter: (bucket) => set({ riskFilter: bucket }),
  enqueueBulkSuspend: (bucket) =>
    set({ bulkStatus: "submitting", selectedRiskBucket: bucket }),
  resolveBulkSuspend: (enqueuedBucket) => {
    set({ bulkStatus: "success", selectedRiskBucket: enqueuedBucket });
  },
}));
