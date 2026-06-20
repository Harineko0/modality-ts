import { type } from "arktype";

export const managementTabSchema = type(
  "'overview' | 'risk' | 'revenue' | 'operations'",
);
export const riskBucketSchema = type("'low' | 'medium' | 'high'");
export const queueBucketSchema = type("'empty' | 'some' | 'many'");
export const revenueHealthSchema = type("'healthy' | 'watch' | 'critical'");

export const managementSummarySchema = type({
  riskBucket: riskBucketSchema,
  revenueHealth: revenueHealthSchema,
  approvalQueue: queueBucketSchema,
  supportBreachQueue: queueBucketSchema,
});

export function parseManagementSummary(
  value: unknown,
): ReturnType<typeof managementSummarySchema> {
  return managementSummarySchema(value);
}
