import { useBillingStore } from "../state/billing-store.js";

export function useBillingActions() {
  const markPaymentIntentCreated = useBillingStore(
    (state) => state.markPaymentIntentCreated,
  );
  const markCaptureSucceeded = useBillingStore(
    (state) => state.markCaptureSucceeded,
  );
  const markRetryFailed = useBillingStore((state) => state.markRetryFailed);
  return { markPaymentIntentCreated, markCaptureSucceeded, markRetryFailed };
}
