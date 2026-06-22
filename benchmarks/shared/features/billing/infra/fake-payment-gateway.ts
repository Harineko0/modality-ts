import {
  canCapturePayment,
  getInvoice,
  validatePaymentIntent,
} from "../application/billing-service.js";
import type { Invoice } from "../domain/invoice.js";
import type { PaymentIntent } from "../domain/payment.js";

export async function createPaymentIntent(
  input: unknown,
): Promise<PaymentIntent | null> {
  const intent = validatePaymentIntent(input);
  if (!intent) return null;
  return { ...intent, status: "created" };
}

export async function capturePayment(
  intent: PaymentIntent,
  invoiceId: Invoice["id"],
): Promise<{ captured: boolean; invoice: Invoice | null }> {
  const invoice = getInvoice(invoiceId) ?? null;
  if (!invoice) return { captured: false, invoice: null };
  return { captured: canCapturePayment(intent, invoice), invoice };
}

export async function retryInvoice(
  invoiceId: Invoice["id"],
): Promise<Invoice | null> {
  return getInvoice(invoiceId) ?? null;
}

export async function savePaymentMethod(input: {
  methodId: "pm-primary" | "pm-backup";
  status: "missing" | "valid" | "expired" | "requires_action";
}): Promise<{ saved: true; methodId: string }> {
  return { saved: true, methodId: input.methodId };
}
