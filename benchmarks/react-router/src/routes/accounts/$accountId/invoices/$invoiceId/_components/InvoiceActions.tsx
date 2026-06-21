import { useParams } from "react-router-dom";
import { useInvoiceStore } from "../../../../../../features/billing/state/invoice-store.js";
import { useInvoiceDetail } from "../../../../../../features/billing/infra/billing-queries.js";
import { invoiceActionSchema } from "../../../../../../shared/features/billing/domain/billing.schema.js";
import type { InvoiceId } from "../../../../../../shared/features/billing/domain/invoice.js";
import { InvoiceStatusBadge } from "../../../../../../features/billing/_components/InvoiceStatusBadge.js";
import { api } from "../../../../../../features/auth/infra/api.js";

export function InvoiceActions() {
  const { invoiceId = "inv-100" } = useParams();
  const typedInvoiceId = invoiceId as InvoiceId;
  const invoiceStatus = useInvoiceStore((s) => s.invoiceStatus);
  const retryCount = useInvoiceStore((s) => s.retryCount);
  const setInvoiceStatus = useInvoiceStore((s) => s.setInvoiceStatus);
  const incrementRetry = useInvoiceStore((s) => s.incrementRetry);
  useInvoiceDetail(typedInvoiceId);

  const runAction = async (action: "pay" | "void" | "dispute" | "retry") => {
    const parsed = invoiceActionSchema.safeParse({
      invoiceId: typedInvoiceId,
      action,
    });
    if (!parsed.success) return;
    if (action === "retry") {
      await api.retryInvoice(typedInvoiceId);
      incrementRetry();
      return;
    }
    if (action === "pay") setInvoiceStatus("paid");
    if (action === "void" && invoiceStatus !== "paid") setInvoiceStatus("void");
    if (action === "dispute") setInvoiceStatus("disputed");
  };

  return (
    <section>
      <h2>invoice detail: {typedInvoiceId}</h2>
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
