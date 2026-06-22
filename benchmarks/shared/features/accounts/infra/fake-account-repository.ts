import type { AccountStatus } from "../../fixtures/domain/fixtures.js";
import { getAccount, listAccounts } from "../application/account-service.js";
import type { Account, AccountId } from "../domain/account.js";

export async function loadAccount(
  accountId: AccountId,
): Promise<Account | null> {
  return getAccount(accountId) ?? null;
}

export async function loadAccounts(
  status?: AccountStatus,
): Promise<readonly Account[]> {
  return listAccounts(status);
}

export async function loadDashboardSummary(): Promise<{
  accounts: readonly Account[];
  supportBadge: "open" | "clear";
  auditShortcutEnabled: boolean;
}> {
  const accounts = listAccounts();
  return {
    accounts,
    supportBadge: "open",
    auditShortcutEnabled: true,
  };
}
