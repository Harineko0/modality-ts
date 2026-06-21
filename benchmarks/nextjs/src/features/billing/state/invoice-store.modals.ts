import { variable, type Variable } from "modality-ts/core";

export const useInvoiceStore = {
  // state
  invoiceStatus: variable("zustand:useInvoiceStore.invoiceStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["open"] }, "zustand:useInvoiceStore.invoiceStatus">,
  retryCount: variable("zustand:useInvoiceStore.retryCount") as Variable<{ readonly kind: "boundedInt"; readonly min: 0; readonly max: 0 }, "zustand:useInvoiceStore.retryCount">,
};
