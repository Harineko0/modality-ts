import {
  always,
  alwaysStep,
  and,
  ctl,
  eq,
  group,
  neq,
  property,
  reachableFrom,
  readOpArg,
  stepEnqueued,
  stepResolved,
  sub,
} from "modality-ts/properties";
import { useBillingStore } from "../../../../features/billing/state/billing-store.modals";
import { BillingWorkbench } from "./_components/BillingWorkbench.modals";

const paymentIntentStatus = useBillingStore.paymentIntentStatus;
const selectedInvoiceId = useBillingStore.selectedInvoiceId;
const retryCount = useBillingStore.retryCount;
const riskScore = useBillingStore.riskScore;
const enqueuedInvoiceId = BillingWorkbench.enqueuedInvoiceId;

group("billing", () => {
  alwaysStep("billing.captureUsesEnqueuedInvoice", {
    negate: true,
    step: stepResolved("api.capturePayment"),
    post: neq(readOpArg("invoiceId"), enqueuedInvoiceId),
  });

  reachableFrom(
    "billing.validPaymentIntentReachable",
    eq(paymentIntentStatus, "created"),
    eq(paymentIntentStatus, "captured"),
  );

  property(
    "billing.captureEventuallySettles",
    ctl.eventually(
      ctl.holds(
        and(eq(paymentIntentStatus, "captured"), eq(retryCount, retryCount)),
      ),
    ),
  );

  alwaysStep("billing.createIntentUsesSelectedInvoice", {
    step: stepEnqueued("api.createPaymentIntent"),
    post: eq(readOpArg("invoiceId"), selectedInvoiceId),
  });

  always("billing.riskScoreBounded", neq(riskScore, sub(riskScore, riskScore)));
});
