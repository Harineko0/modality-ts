"use client";

import { useParams } from "next/navigation";
import { api } from "../../../../../../features/auth/infra/api.js";
import { InvoiceStatusBadge } from "../../../../../../features/billing/_components/InvoiceStatusBadge.js";
import { useInvoiceDetail } from "../../../../../../features/billing/infra/billing-queries.js";
import { useInvoiceStore } from "../../../../../../features/billing/state/invoice-store.js";
import { invoiceActionSchema } from "../../../../../../shared/features/billing/domain/billing.schema.js";
import type { InvoiceId } from "../../../../../../shared/features/billing/domain/invoice.js";

export function InvoiceActions() {
  const { invoiceId: rawInvoiceId = "inv-100" } = useParams();
  const invoiceId = (
    Array.isArray(rawInvoiceId) ? rawInvoiceId[0] : rawInvoiceId
  ) as InvoiceId;
  const invoiceStatus = useInvoiceStore((s) => s.invoiceStatus);
  const retryCount = useInvoiceStore((s) => s.retryCount);
  const setInvoiceStatus = useInvoiceStore((s) => s.setInvoiceStatus);
  const incrementRetry = useInvoiceStore((s) => s.incrementRetry);
  useInvoiceDetail(invoiceId);

  const runAction = async (action: "pay" | "void" | "dispute" | "retry") => {
    const parsed = invoiceActionSchema.safeParse({ invoiceId, action });
    if (!parsed.success) return;
    if (action === "retry") {
      await api.retryInvoice(invoiceId);
      incrementRetry();
      return;
    }
    if (action === "pay") setInvoiceStatus("paid");
    if (action === "void" && invoiceStatus !== "paid") setInvoiceStatus("void");
    if (action === "dispute") setInvoiceStatus("disputed");
  };

  return (
    <section>
      <h2>invoice detail: {invoiceId}</h2>
      <InvoiceStatusBadge status={invoiceStatus} />
      <button
        type="button"
        disabled={invoiceStatus === "paid"}
        onClick={() => runAction("void")}
      >
        void button
      </button>
      <button type="button" onClick={() => runAction("dispute")}>
        dispute button
      </button>
      <button type="button" onClick={() => runAction("pay")}>
        pay button
      </button>
      <p>retry count output: {retryCount}</p>
      <button type="button" onClick={() => runAction("retry")}>
        retry button
      </button>
    </section>
  );
}
