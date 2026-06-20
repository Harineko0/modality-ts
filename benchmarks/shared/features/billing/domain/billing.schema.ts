import { z } from "zod";

export const paymentIntentSchema = z.object({
  invoiceId: z.enum(["inv-100", "inv-200", "inv-300"]),
  amountBucket: z.enum(["small", "medium", "large"]),
});

export const paymentMethodSchema = z.object({
  methodId: z.enum(["pm-primary", "pm-backup"]),
  status: z.enum(["missing", "valid", "expired", "requires_action"]),
});

export const invoiceActionSchema = z.object({
  invoiceId: z.enum(["inv-100", "inv-200", "inv-300"]),
  action: z.enum(["pay", "void", "dispute", "retry"]),
});

export type PaymentIntentInput = z.infer<typeof paymentIntentSchema>;
export type PaymentMethodInput = z.infer<typeof paymentMethodSchema>;
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>;
