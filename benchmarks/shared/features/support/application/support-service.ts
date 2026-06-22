import { seedSupportCases } from "../../fixtures/domain/fixtures.js";
import type { SupportCase } from "../domain/escalation.js";
import { supportEscalationSchema } from "../domain/support.schema.js";

export function validateSupportEscalation(input: unknown) {
  return supportEscalationSchema.safeParse(input);
}

export function getSupportCase(accountId: string): SupportCase | undefined {
  return seedSupportCases.find(
    (supportCase) => supportCase.accountId === accountId,
  );
}
