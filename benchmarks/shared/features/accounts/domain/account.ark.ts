import { type } from "arktype";

export const accountIdSchema = type(
  "'acct-alpha' | 'acct-beta' | 'acct-gamma'",
);
export const accountStatusSchema = type(
  "'trial' | 'active' | 'past_due' | 'suspended'",
);
export const planSchema = type("'starter' | 'growth' | 'enterprise'");
export const accountBucketSchema = type("'empty' | 'some' | 'many'");

export const accountRecordSchema = type({
  id: accountIdSchema,
  name: "string",
  status: accountStatusSchema,
  plan: planSchema,
  "seatCount?": "1 <= number.integer <= 500",
});

export function parseAccountRecord(
  value: unknown,
): ReturnType<typeof accountRecordSchema> {
  return accountRecordSchema(value);
}
