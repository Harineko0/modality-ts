import type { QueueBucket } from "../../fixtures/domain/fixtures.js";

export type SupportPriority = "low" | "normal" | "urgent";

export type SupportCase = {
  accountId: string;
  priority: SupportPriority;
  escalationBucket: QueueBucket;
  owner: "unassigned" | "agent-a" | "agent-b";
};
