import { create } from "zustand";
import type { InvoiceStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";

type InvoiceState = {
  invoiceStatus: InvoiceStatus;
  retryCount: number;
  setInvoiceStatus: (status: InvoiceStatus) => void;
  incrementRetry: () => void;
};

export const useInvoiceStore = create<InvoiceState>((set, get) => ({
  invoiceStatus: "open",
  retryCount: 0,
  setInvoiceStatus: (status) => set({ invoiceStatus: status }),
  incrementRetry: () => set({ retryCount: get().retryCount + 1 }),
}));
