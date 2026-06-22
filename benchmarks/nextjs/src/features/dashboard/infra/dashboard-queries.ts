export { loadDashboardSummary } from "../../../../shared/features/accounts/infra/fake-account-repository.js";

import useSWR from "swr";
import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";
import { loadDashboardSummary } from "../../../../shared/features/accounts/infra/fake-account-repository.js";

export function useDashboardSummary(selectedAccount: AccountId) {
  return useSWR(["dashboard", selectedAccount], () => loadDashboardSummary());
}
