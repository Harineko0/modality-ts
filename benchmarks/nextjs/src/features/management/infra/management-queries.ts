export {
  loadManagementSummary,
  bulkSuspendAccounts,
} from "../../../../shared/features/management/infra/fake-management-api.js";
import useSWR from "swr";
import {
  loadManagementSummary,
  loadOperationsQueueData,
  loadRevenueQueueData,
  loadRiskQueueData,
} from "../../../../shared/features/management/infra/fake-management-api.js";
import type { RiskBucket } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function useManagementSummary() {
  return useSWR("management-summary", () => loadManagementSummary());
}

export function useRiskQueue(riskBucket: RiskBucket) {
  return useSWR(["risk-queue", riskBucket], () =>
    loadRiskQueueData(riskBucket),
  );
}

export function useRevenueQueue() {
  return useSWR("revenue-queue", () => loadRevenueQueueData());
}

export function useOperationsQueue() {
  return useSWR("operations-queue", () => loadOperationsQueueData());
}
