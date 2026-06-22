import type { AccountStatus } from "../../fixtures/domain/fixtures.js";
import {
  accountById,
  accountsByStatus,
  seedAccounts,
} from "../../fixtures/domain/fixtures.js";
import { parseAccountRecord } from "../domain/account.ark.js";
import type { Account, AccountId } from "../domain/account.js";

export function listAccounts(status?: AccountStatus): readonly Account[] {
  return status ? accountsByStatus(status) : seedAccounts;
}

export function getAccount(accountId: AccountId): Account | undefined {
  const account = accountById(accountId);
  if (!account) return undefined;
  parseAccountRecord(account);
  return account;
}

export function canStartCheckout(account: Account): boolean {
  return account.status !== "suspended";
}
