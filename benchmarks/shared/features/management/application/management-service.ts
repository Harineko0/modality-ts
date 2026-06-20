import { parseManagementSummary } from "../domain/dashboard.ark.js";
import type {
  ManagementSummary,
  OperationsQueue,
  RevenueQueue,
  RiskQueue,
} from "../domain/dashboard.js";
import type { RiskBucket, Role } from "../../fixtures/domain/fixtures.js";
import { roleHasPermission } from "../../auth/domain/rbac.js";
import {
  bucketCount,
  seedManagementSummary,
} from "../../fixtures/domain/fixtures.js";

export function loadSummary(): ManagementSummary {
  parseManagementSummary(seedManagementSummary);
  return seedManagementSummary;
}

export function loadRiskQueue(bucket: RiskBucket): RiskQueue {
  return { bucket, accountCount: bucket === "high" ? "many" : "some" };
}

export function loadRevenueQueue(): RevenueQueue {
  return {
    health: seedManagementSummary.revenueHealth,
    failedPayments:
      seedManagementSummary.revenueHealth === "critical" ? "many" : "some",
  };
}

export function loadOperationsQueue(): OperationsQueue {
  return {
    approvals: seedManagementSummary.approvalQueue,
    supportBreaches: seedManagementSummary.supportBreachQueue,
  };
}

export function canBulkSuspend(role: Role): boolean {
  return roleHasPermission(role, "bulk_suspend_accounts");
}

export function bulkSuspendCount(bucket: RiskBucket): number {
  return bucketCount(bucket === "high" ? "many" : "some");
}

export function criticalRevenueRequiresFailedPayments(
  summary: ManagementSummary,
  queue: RevenueQueue,
): boolean {
  if (summary.revenueHealth !== "critical") return true;
  return queue.failedPayments !== "empty";
}
