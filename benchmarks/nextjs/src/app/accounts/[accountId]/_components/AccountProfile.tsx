"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { useAtom } from "jotai";
import {
  selectedAccountAtom,
  accountDetailTabAtom,
} from "../../../../features/accounts/state/selection-atoms.js";
import { useAccountDetail } from "../../../../features/accounts/infra/account-queries.js";
import { parseAccountRecord } from "../../../../../shared/features/accounts/domain/account.ark.js";
import { AccountStatusBadge } from "../../../../features/accounts/_components/AccountStatusBadge.js";

export function AccountProfile() {
  const { accountId = "acct-alpha" } = useParams();
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountAtom);
  const [tab, setTab] = useAtom(accountDetailTabAtom);
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
