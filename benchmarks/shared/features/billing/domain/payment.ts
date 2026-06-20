import type { PaymentMethodStatus } from "../../fixtures/domain/fixtures.js";

export type PaymentMethod = {
  id: "pm-primary" | "pm-backup";
  status: PaymentMethodStatus;
  isPrimary: boolean;
};

export type PaymentIntent = {
  invoiceId: string;
  amountBucket: "small" | "medium" | "large";
  status: "draft" | "created" | "captured" | "failed";
};
