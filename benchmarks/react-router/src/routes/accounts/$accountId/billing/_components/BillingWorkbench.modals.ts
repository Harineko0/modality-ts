import { variable, type Variable } from "modality-ts/core";
import type { TransitionRef } from "modality-ts/properties";

export const BillingWorkbench = {
  // state
  enqueuedInvoiceId: variable("local:BillingWorkbench.enqueuedInvoiceId") as Variable<{ readonly kind: "enum"; readonly values: readonly ["inv-100", "inv-200", "inv-300"] }, "local:BillingWorkbench.enqueuedInvoiceId">,

  // transitions
  onChange: {
    zustand: {
      useBillingStore_setState: "BillingWorkbench.onChange.zustand.useBillingStore_setState" as TransitionRef<"BillingWorkbench.onChange.zustand.useBillingStore_setState">,
    },
  },
};
