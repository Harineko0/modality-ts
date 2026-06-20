export { openSupportEscalation } from "../../../../shared/features/support/infra/fake-support-api.js";
import useSWR from "swr";
import { loadSupportCase } from "../../../../shared/features/support/infra/fake-support-api.js";

export function useSupportCase(accountId: string) {
  return useSWR(["support", accountId], () => loadSupportCase(accountId));
}
