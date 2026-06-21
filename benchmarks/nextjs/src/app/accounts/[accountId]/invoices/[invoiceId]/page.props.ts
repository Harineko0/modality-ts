import {
  always,
  and,
  enabled,
  eq,
  group,
  lessThan,
  not,
  stepChangedTo,
} from "modality-ts/properties";
import { useInvoiceStore } from "../../../../../features/billing/state/invoice-store.modals";

const invoiceStatus = useInvoiceStore.invoiceStatus;
const retryCount = useInvoiceStore.retryCount;

group("invoice", () => {
  always("invoice.retryBudgetNeverExceedsTwo", lessThan(retryCount, 3));

  always(
    "billing.paidInvoiceVoidDisabled",
    not(
      and(
        eq(invoiceStatus, "paid"),
        enabled("InvoiceActions.onClick.void button"),
      ),
    ),
  );

  stepChangedTo("zustand:useInvoiceStore.invoiceStatus", "paid");
});
