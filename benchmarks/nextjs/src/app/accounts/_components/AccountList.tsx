"use client";

import { useAtom } from "jotai";
import { useRouter } from "next/navigation";
import { accountStatusSchema } from "../../../../shared/features/accounts/domain/account.ark.js";
import { useAccounts } from "../../../features/accounts/infra/account-queries.js";
import {
  accountStatusFilterAtom,
  selectedAccountAtom,
} from "../../../features/accounts/state/selection-atoms.js";
import { BucketSelect } from "../../../features/common/_components/BucketSelect.js";

export function AccountList() {
  const [statusFilter, setStatusFilter] = useAtom(accountStatusFilterAtom);
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountAtom);
  const { data } = useAccounts(statusFilter);
  const router = useRouter();
  const bucket =
    data && data.length > 2
      ? "many"
      : data && data.length > 0
        ? "some"
        : "empty";
  if (statusFilter !== "all") accountStatusSchema(statusFilter);

  return (
    <section>
      <BucketSelect
        label="account status filter"
        value={statusFilter}
        options={["all", "trial", "active", "past_due", "suspended"] as const}
        onChange={setStatusFilter}
      />
      <p>account list bucket: {bucket}</p>
      <select
        value={selectedAccount}
        onChange={(event) =>
          setSelectedAccount(event.target.value as typeof selectedAccount)
        }
      >
        {(data ?? []).map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          if (selectedAccount === "acct-alpha")
            router.push("/accounts/acct-alpha");
          else if (selectedAccount === "acct-beta")
            router.push("/accounts/acct-beta");
          else router.push("/accounts/acct-gamma");
        }}
      >
        open account button
      </button>
      {statusFilter === "suspended" ? (
        <div>suspended account warning</div>
      ) : null}
    </section>
  );
}
