"use client";

import { useAtom } from "jotai";
import Link from "next/link";
import { useParams } from "next/navigation";
import { parseAccountRecord } from "../../../../../shared/features/accounts/domain/account.ark.js";
import { AccountStatusBadge } from "../../../../features/accounts/_components/AccountStatusBadge.js";
import { useAccountDetail } from "../../../../features/accounts/infra/account-queries.js";
import {
  accountDetailTabAtom,
  selectedAccountAtom,
} from "../../../../features/accounts/state/selection-atoms.js";

export function AccountProfile() {
  const { accountId: rawAccountId = "acct-alpha" } = useParams();
  const accountId = Array.isArray(rawAccountId)
    ? rawAccountId[0]
    : rawAccountId;
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountAtom);
  const [_tab, setTab] = useAtom(accountDetailTabAtom);
  const { data } = useAccountDetail(accountId as typeof selectedAccount);
  if (data) parseAccountRecord(data);
  if (accountId !== selectedAccount)
    setSelectedAccount(accountId as typeof selectedAccount);

  return (
    <section>
      <h1>account profile panel: {data?.name ?? accountId}</h1>
      <AccountStatusBadge status={data?.status ?? "active"} />
      <span>plan badge: {data?.plan ?? "starter"}</span>
      <div role="tablist">
        {(
          ["subscription", "billing", "payment-methods", "support"] as const
        ).map((entry) => (
          <button key={entry} type="button" onClick={() => setTab(entry)}>
            {entry}
          </button>
        ))}
      </div>
      <Link href={`/accounts/${accountId}/subscription`}>subscription</Link>
      <Link href={`/accounts/${accountId}/billing`}>billing</Link>
      <Link href={`/accounts/${accountId}/payment-methods`}>
        payment methods
      </Link>
      <Link href={`/accounts/${accountId}/support`}>support</Link>
    </section>
  );
}
