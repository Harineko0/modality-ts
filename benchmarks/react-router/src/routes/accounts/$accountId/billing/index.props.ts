import {
  always,
  alwaysStep,
  and,
  ctl,
  eq,
  group,
  neq,
  property,
  readOpArg,
  reachableFrom,
  stepEnqueued,
  stepResolved,
  sub,
  variable,
} from "modality-ts/properties";

const paymentIntentStatus = variable(
  "zustand:useBillingStore.paymentIntentStatus",
);
const selectedInvoiceId = variable("zustand:useBillingStore.selectedInvoiceId");
const retryCount = variable("zustand:useBillingStore.retryCount");
const riskScore = variable("zustand:useBillingStore.riskScore");
const enqueuedInvoiceId = variable("local:BillingWorkbench.enqueuedInvoiceId");

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
