import { invoiceById } from "../../fixtures/domain/fixtures.js";
import { paymentIntentSchema } from "../domain/billing.schema.js";
import type { Invoice } from "../domain/invoice.js";
import { canRetryInvoice, canVoidInvoice } from "../domain/invoice.js";
import type { PaymentIntent } from "../domain/payment.js";

export function validatePaymentIntent(input: unknown): PaymentIntent | null {
  const parsed = paymentIntentSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    invoiceId: parsed.data.invoiceId,
    amountBucket: parsed.data.amountBucket,
    status: "draft",
  };
}

export function canCapturePayment(
  intent: PaymentIntent,
  invoice: Invoice,
): boolean {
  return intent.status === "created" && invoice.status === "open";
}

export function canVoid(invoice: Invoice): boolean {
  return canVoidInvoice(invoice.status);
}

export function canRetry(invoice: Invoice): boolean {
  return canRetryInvoice(invoice.retryCount);
}

export function getInvoice(invoiceId: Invoice["id"]): Invoice | undefined {
  return invoiceById(invoiceId);
}
