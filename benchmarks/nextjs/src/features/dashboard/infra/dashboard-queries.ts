export { loadDashboardSummary } from "../../../../shared/features/accounts/infra/fake-account-repository.js";
import useSWR from "swr";
import { loadDashboardSummary } from "../../../../shared/features/accounts/infra/fake-account-repository.js";
import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";

export function useDashboardSummary(selectedAccount: AccountId) {
  return useSWR(["dashboard", selectedAccount], () => loadDashboardSummary());
}
