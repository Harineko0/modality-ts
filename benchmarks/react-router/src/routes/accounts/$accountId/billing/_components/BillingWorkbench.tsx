import { useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../../../../../features/auth/infra/api.js";
import { PaymentIntentPanel } from "../../../../../features/billing/_components/PaymentIntentPanel.js";
import { useBillingAccount } from "../../../../../features/billing/infra/billing-queries.js";
import { useBillingStore } from "../../../../../features/billing/state/billing-store.js";
import { paymentIntentSchema } from "../../../../../shared/features/billing/domain/billing.schema.js";

export function BillingWorkbench() {
  const { accountId = "acct-alpha" } = useParams();
  const paymentIntentStatus = useBillingStore((s) => s.paymentIntentStatus);
  const retryCount = useBillingStore((s) => s.retryCount);
  const riskScore = useBillingStore((s) => s.riskScore);
  const selectedInvoiceId = useBillingStore((s) => s.selectedInvoiceId);
  const markPaymentIntentCreated = useBillingStore(
    (s) => s.markPaymentIntentCreated,
  );
  const markCaptureSucceeded = useBillingStore((s) => s.markCaptureSucceeded);
  const markRetryFailed = useBillingStore((s) => s.markRetryFailed);
  const [enqueuedInvoiceId, setEnqueuedInvoiceId] = useState<
    "inv-100" | "inv-200" | "inv-300"
  >("inv-100");
  useBillingAccount(accountId);

  return (
    <section>
      <label>
        invoice bucket
        <select
          value={selectedInvoiceId}
          onChange={(event) =>
            useBillingStore.setState({
              selectedInvoiceId: event.target.value as typeof selectedInvoiceId,
            })
          }
        >
          <option value="inv-100">inv-100</option>
          <option value="inv-200">inv-200</option>
          <option value="inv-300">inv-300</option>
        </select>
      </label>
      <p>amount bucket: small</p>
      <p>risk score: {riskScore}</p>
      <p>retry count output: {retryCount}</p>
      <PaymentIntentPanel
        status={paymentIntentStatus}
        onCreate={async () => {
          const parsed = paymentIntentSchema.safeParse({
            invoiceId: selectedInvoiceId,
            amountBucket: "small",
          });
          if (!parsed.success) return;
          await api.createPaymentIntent(parsed.data);
          setEnqueuedInvoiceId(selectedInvoiceId);
          markPaymentIntentCreated();
        }}
        onCapture={async () => {
          await api.capturePayment(
            {
              invoiceId: selectedInvoiceId,
              amountBucket: "small",
              status: "created",
            },
            selectedInvoiceId,
          );
          markCaptureSucceeded(enqueuedInvoiceId);
        }}
      />
      <button type="button" onClick={markRetryFailed}>
        retry invoice button
      </button>
    </section>
  );
}
