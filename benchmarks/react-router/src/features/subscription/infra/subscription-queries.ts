export {
  requestApproval,
  applyApproval,
} from "../../../../shared/features/subscription/infra/fake-subscription-api.js";
import useSWR from "swr";
import { seedApprovalRequests } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function useSubscription(accountId: string) {
  return useSWR(["subscription", accountId], async () => ({
    accountId,
    plan: "growth",
    seats: 12,
  }));
}

export function useApprovals() {
  return useSWR("approvals", async () => seedApprovalRequests);
}
