import { atom } from "jotai";
import type { AccountId } from "../../../../shared/features/accounts/domain/account.js";
import type { AccountStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";

export const selectedAccountAtom = atom<AccountId>("acct-alpha");
export const selectedInvoiceAtom = atom<"inv-100" | "inv-200" | "inv-300">(
  "inv-100",
);
export const accountStatusFilterAtom = atom<AccountStatus | "all">("all");
export const accountDetailTabAtom = atom<
  "subscription" | "billing" | "payment-methods" | "support"
>("subscription");
