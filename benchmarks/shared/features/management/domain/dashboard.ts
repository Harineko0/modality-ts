import type {
  QueueBucket,
  RevenueHealth,
  RiskBucket,
} from "../../fixtures/domain/fixtures.js";

export type ManagementTab = "overview" | "risk" | "revenue" | "operations";

export type ManagementSummary = {
  riskBucket: RiskBucket;
  revenueHealth: RevenueHealth;
  approvalQueue: QueueBucket;
  supportBreachQueue: QueueBucket;
};

export type RiskQueue = {
  bucket: RiskBucket;
  accountCount: QueueBucket;
};

export type RevenueQueue = {
  health: RevenueHealth;
  failedPayments: QueueBucket;
};

export type OperationsQueue = {
  approvals: QueueBucket;
  supportBreaches: QueueBucket;
};
