export { loadAccount } from "../../../../shared/features/accounts/infra/fake-account-repository.js";

import useSWR from "swr";
import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";
import {
  loadAccount,
  loadAccounts,
} from "../../../../shared/features/accounts/infra/fake-account-repository.js";
import type { AccountStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";

export function useAccounts(status: AccountStatus | "all") {
  const key = status === "all" ? "accounts-all" : ["accounts", status];
  return useSWR(key, () => loadAccounts(status === "all" ? undefined : status));
}

export function useAccountDetail(accountId: AccountId) {
  return useSWR(["account", accountId], () => loadAccount(accountId));
}
