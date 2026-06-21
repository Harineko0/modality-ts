import { variable, type Variable } from "modality-ts/core";

export const useBillingStore = {
  // state
  invoiceBucket: variable("zustand:useBillingStore.invoiceBucket") as Variable<{ readonly kind: "enum"; readonly values: readonly ["some"] }, "zustand:useBillingStore.invoiceBucket">,
  paymentIntentStatus: variable("zustand:useBillingStore.paymentIntentStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useBillingStore.paymentIntentStatus">,
  retryCount: variable("zustand:useBillingStore.retryCount") as Variable<{ readonly kind: "boundedInt"; readonly min: 0; readonly max: 0 }, "zustand:useBillingStore.retryCount">,
  riskScore: variable("zustand:useBillingStore.riskScore") as Variable<{ readonly kind: "boundedInt"; readonly min: 10; readonly max: 10 }, "zustand:useBillingStore.riskScore">,
  selectedInvoiceId: variable("zustand:useBillingStore.selectedInvoiceId") as Variable<{ readonly kind: "enum"; readonly values: readonly ["event.target.value as typeof selectedInvoiceId", "inv-100"] }, "zustand:useBillingStore.selectedInvoiceId">,
};
