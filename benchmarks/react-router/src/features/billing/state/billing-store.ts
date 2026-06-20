import { create } from "zustand";
import type {
  AsyncStatus,
  QueueBucket,
} from "../../../../shared/features/fixtures/domain/fixtures.js";

type BillingState = {
  paymentIntentStatus: AsyncStatus;
  retryCount: number;
  riskScore: number;
  invoiceBucket: QueueBucket;
  selectedInvoiceId: "inv-100" | "inv-200" | "inv-300";
  setInvoiceBucket: (bucket: QueueBucket) => void;
  markPaymentIntentCreated: () => void;
  markCaptureSucceeded: (invoiceId: "inv-100" | "inv-200" | "inv-300") => void;
  markRetryFailed: () => void;
};

export const useBillingStore = create<BillingState>((set, get) => ({
  paymentIntentStatus: "idle",
  retryCount: 0,
  riskScore: 10,
  invoiceBucket: "some",
  selectedInvoiceId: "inv-100",
  setInvoiceBucket: (bucket) => set({ invoiceBucket: bucket }),
  markPaymentIntentCreated: () => set({ paymentIntentStatus: "success" }),
  markCaptureSucceeded: (invoiceId) => {
    set({ paymentIntentStatus: "success", selectedInvoiceId: invoiceId });
  },
  markRetryFailed: () => {
    const count = get().retryCount;
    const risk = get().riskScore;
    if (count < 3 || risk < 50) {
      set({ retryCount: count + 1, riskScore: risk + 15 });
    }
  },
}));
