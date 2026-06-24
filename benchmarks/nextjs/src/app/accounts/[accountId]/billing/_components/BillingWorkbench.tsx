"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { api } from "../../../../../features/auth/infra/api.js";
import { PaymentIntentPanel } from "../../../../../features/billing/_components/PaymentIntentPanel.js";
import { useBillingAccount } from "../../../../../features/billing/infra/billing-queries.js";
import { useBillingStore } from "../../../../../features/billing/state/billing-store.js";
import { paymentIntentSchema } from "../../../../../shared/features/billing/domain/billing.schema.js";

type InvoiceId = "inv-100" | "inv-200" | "inv-300";

export function BillingWorkbench() {
  const { accountId: rawAccountId = "acct-alpha" } = useParams();
  const accountId = Array.isArray(rawAccountId)
    ? rawAccountId[0]
    : rawAccountId;
  const paymentIntentStatus = useBillingStore((s) => s.paymentIntentStatus);
  const retryCount = useBillingStore((s) => s.retryCount);
  const riskScore = useBillingStore((s) => s.riskScore);
  const selectedInvoiceId = useBillingStore((s) => s.selectedInvoiceId);
  const markPaymentIntentCreated = useBillingStore(
    (s) => s.markPaymentIntentCreated,
  );
  const markCaptureSucceeded = useBillingStore((s) => s.markCaptureSucceeded);
  const markRetryFailed = useBillingStore((s) => s.markRetryFailed);
  const [enqueuedInvoiceId, setEnqueuedInvoiceId] =
    useState<InvoiceId>("inv-100");
  useBillingAccount(accountId);

  return (
    <section>
      <label>
        invoice bucket
        <select
          value={selectedInvoiceId}
          onChange={(event) => {
            const nextInvoiceId = invoiceIdFromValue(event.target.value);
            useBillingStore.setState({
              selectedInvoiceId: nextInvoiceId,
            });
          }}
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
      <span hidden data-modality-var="local:BillingWorkbench.enqueuedInvoiceId">
        {JSON.stringify(enqueuedInvoiceId)}
      </span>
    </section>
  );
}

function invoiceIdFromValue(value: string): InvoiceId {
  if (value === "inv-200") return "inv-200";
  if (value === "inv-300") return "inv-300";
  return "inv-100";
}
