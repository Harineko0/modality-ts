import type {
  AccountStatus,
  Plan,
  QueueBucket,
} from "../../fixtures/domain/fixtures.js";

export type AccountId = "acct-alpha" | "acct-beta" | "acct-gamma";

export type Account = {
  id: AccountId;
  name: string;
  status: AccountStatus;
  plan: Plan;
  seatCount: number;
};

export type AccountBucket = QueueBucket;

export type AccountDetailTab =
  | "subscription"
  | "billing"
  | "payment-methods"
  | "support";
