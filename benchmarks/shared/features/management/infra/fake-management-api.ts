import type { RiskBucket } from "../../fixtures/domain/fixtures.js";
import {
  bulkSuspendCount,
  loadOperationsQueue,
  loadRevenueQueue,
  loadRiskQueue,
  loadSummary,
} from "../application/management-service.js";

export async function loadManagementSummary() {
  return loadSummary();
}

export async function bulkSuspendAccounts(input: {
  riskBucket: RiskBucket;
}): Promise<{ suspendedCount: number; riskBucket: RiskBucket }> {
  return {
    riskBucket: input.riskBucket,
    suspendedCount: bulkSuspendCount(input.riskBucket),
  };
}

export async function loadRiskQueueData(riskBucket: RiskBucket) {
  return loadRiskQueue(riskBucket);
}

export async function loadRevenueQueueData() {
  return loadRevenueQueue();
}

export async function loadOperationsQueueData() {
  return loadOperationsQueue();
}
