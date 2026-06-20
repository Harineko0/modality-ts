import type { InvoiceStatus } from "../../fixtures/domain/fixtures.js";

export type InvoiceId = "inv-100" | "inv-200" | "inv-300";

export type Invoice = {
  id: InvoiceId;
  accountId: string;
  status: InvoiceStatus;
  amountBucket: "small" | "medium" | "large";
  retryCount: number;
};

export const maxInvoiceRetryCount = 2;

export function canVoidInvoice(status: InvoiceStatus): boolean {
  return status !== "paid";
}

export function canRetryInvoice(retryCount: number): boolean {
  return retryCount < maxInvoiceRetryCount;
}
