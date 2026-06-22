import { useAtom } from "jotai";
import { Link, useNavigate } from "react-router-dom";
import { parseAccountRecord } from "../../../../shared/features/accounts/domain/account.ark.js";
import { accountById } from "../../../../shared/features/fixtures/domain/fixtures.js";
import { AccountBucketSelect } from "../../../features/accounts/_components/AccountBucketSelect.js";
import { selectedAccountAtom } from "../../../features/accounts/state/selection-atoms.js";
import { DashboardCard } from "../../../features/dashboard/_components/DashboardCard.js";
import { useDashboardSummary } from "../../../features/dashboard/infra/dashboard-queries.js";

export function DashboardSummary() {
  const [selectedAccount, setSelectedAccount] = useAtom(selectedAccountAtom);
  const { data } = useDashboardSummary(selectedAccount);
  const navigate = useNavigate();
  const account = accountById(selectedAccount);
  if (account) parseAccountRecord(account);

  const checkoutDisabled = account?.status === "suspended";

  return (
    <section>
      <DashboardCard
        title="Account status"
        value={account?.status ?? "unknown"}
      />
      <DashboardCard title="Plan" value={account?.plan ?? "unknown"} />
      <DashboardCard title="Invoice" value="open" />
      <DashboardCard title="Support" value={data?.supportBadge ?? "clear"} />
      <DashboardCard
        title="Audit"
        value={data?.auditShortcutEnabled ? "enabled" : "disabled"}
      />
      <AccountBucketSelect
        value={selectedAccount}
        onChange={setSelectedAccount}
        label="selected account switcher"
      />
      <button
        type="button"
        disabled={checkoutDisabled}
        onClick={() => navigate("/accounts/acct-alpha/billing")}
      >
        start checkout button
      </button>
      <Link to="/audit">audit shortcut</Link>
    </section>
  );
}
