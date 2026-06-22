"use client";

import { useParams } from "next/navigation";
import { api } from "../../../../../features/auth/infra/api.js";
import { usePaymentMethods } from "../../../../../features/billing/infra/billing-queries.js";
import { usePaymentMethodStore } from "../../../../../features/billing/state/payment-method-store.js";
import { paymentMethodSchema } from "../../../../../shared/features/billing/domain/billing.schema.js";

export function PaymentMethodEditor() {
  const { accountId: rawAccountId = "acct-alpha" } = useParams();
  const accountId = Array.isArray(rawAccountId)
    ? rawAccountId[0]
    : rawAccountId;
  const methodStatus = usePaymentMethodStore((s) => s.methodStatus);
  const saveStatus = usePaymentMethodStore((s) => s.saveStatus);
  const setMethodStatus = usePaymentMethodStore((s) => s.setMethodStatus);
  const markSaved = usePaymentMethodStore((s) => s.markSaved);
  usePaymentMethods(accountId);

  return (
    <section>
      <p>payment method status: {methodStatus}</p>
      <button
        type="button"
        onClick={async () => {
          const parsed = paymentMethodSchema.safeParse({
            methodId: "pm-primary",
            status: "valid",
          });
          if (!parsed.success) return;
          await api.savePaymentMethod(parsed.data);
          markSaved();
        }}
      >
        add method button
      </button>
      <button type="button" onClick={() => setMethodStatus("expired")}>
        mark expired button
      </button>
      <button type="button" onClick={() => setMethodStatus("valid")}>
        set primary button
      </button>
      {methodStatus === "requires_action" ? (
        <div>requires action banner</div>
      ) : null}
      <p>save status: {saveStatus}</p>
    </section>
  );
}
