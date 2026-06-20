import {
  always,
  and,
  enabled,
  eq,
  group,
  lessThan,
  not,
  stepChangedTo,
  variable,
} from "modality-ts/properties";

const invoiceStatus = variable("zustand:useInvoiceStore.invoiceStatus");
const retryCount = variable("zustand:useInvoiceStore.retryCount");

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
