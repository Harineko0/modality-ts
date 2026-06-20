import type { Plan } from "../../fixtures/domain/fixtures.js";

export type { Plan };

export const planSeatBounds: Record<Plan, { min: number; max: number }> = {
  starter: { min: 1, max: 10 },
  growth: { min: 5, max: 50 },
  enterprise: { min: 25, max: 500 },
};

export function isSeatCountValidForPlan(plan: Plan, seats: number): boolean {
  const bounds = planSeatBounds[plan];
  return seats >= bounds.min && seats <= bounds.max;
}
