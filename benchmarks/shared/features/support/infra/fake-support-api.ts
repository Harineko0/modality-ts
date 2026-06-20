import type { SupportEscalationInput } from "../domain/support.schema.js";
import { getSupportCase } from "../application/support-service.js";

export async function openSupportEscalation(
  input: SupportEscalationInput,
): Promise<{ accountId: string; opened: true }> {
  return { accountId: input.accountId, opened: true };
}

export async function loadSupportCase(accountId: string) {
  return getSupportCase(accountId) ?? null;
}
