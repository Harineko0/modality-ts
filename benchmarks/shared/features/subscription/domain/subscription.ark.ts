import { type } from "arktype";

export const approvalStatusSchema = type(
  "'none' | 'requested' | 'approved' | 'rejected'",
);
export const subscriptionDraftSchema = type({
  plan: "'starter' | 'growth' | 'enterprise'",
  "seatCount?": "1 <= number.integer <= 500",
});
export const approvalQueueFilterSchema = type(
  "'all' | 'requested' | 'approved' | 'rejected'",
);

export function parseSubscriptionDraft(
  value: unknown,
): ReturnType<typeof subscriptionDraftSchema> {
  return subscriptionDraftSchema(value);
}
