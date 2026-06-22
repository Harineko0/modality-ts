import { useAtom } from "jotai";
import { Link } from "react-router-dom";
import { parseManagementSummary } from "../../../../shared/features/management/domain/dashboard.ark.js";
import { api } from "../../../features/auth/infra/api.js";
import { DashboardCard } from "../../../features/dashboard/_components/DashboardCard.js";
import { ManagementTabs } from "../../../features/management/_components/ManagementTabs.js";
import { useManagementSummary } from "../../../features/management/infra/management-queries.js";
import { managementTabAtom } from "../../../features/management/state/management-atoms.js";

export function ManagementOverview() {
  const [tab, setTab] = useAtom(managementTabAtom);
  const { data, mutate } = useManagementSummary();
  if (data) parseManagementSummary(data);

  return (
    <section>
      <ManagementTabs value={tab} onChange={setTab} />
      <DashboardCard title="revenue" value={data?.revenueHealth ?? "healthy"} />
      <DashboardCard title="risk" value={data?.riskBucket ?? "low"} />
      <DashboardCard
        title="operations"
        value={data?.approvalQueue ?? "empty"}
      />
      <button
        type="button"
        onClick={async () => {
          await api.loadManagementSummary();
          await mutate();
        }}
      >
        refresh summary button
      </button>
      <Link to="/management/risk">risk drill-down</Link>
      <Link to="/management/revenue">revenue drill-down</Link>
      <Link to="/management/operations">operations drill-down</Link>
    </section>
  );
}
