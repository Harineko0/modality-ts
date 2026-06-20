import useSWR from "swr";
import { seedInvoices } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function useBillingAccount(accountId: string) {
  return useSWR(["billing", accountId], async () => ({
    accountId,
    invoices: seedInvoices.filter((inv) => inv.accountId === accountId),
  }));
}

export function usePaymentMethods(accountId: string) {
  return useSWR(["payment-methods", accountId], async () => ({
    accountId,
    methods: [{ id: "pm-primary", status: "valid" }],
  }));
}

export function useInvoiceDetail(invoiceId: string) {
  return useSWR(["invoice", invoiceId], async () =>
    seedInvoices.find((inv) => inv.id === invoiceId),
  );
}
