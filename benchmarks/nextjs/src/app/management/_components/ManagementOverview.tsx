"use client";

import Link from "next/link";
import { useAtom } from "jotai";
import { managementTabAtom } from "../../../features/management/state/management-atoms.js";
import { useManagementSummary } from "../../../features/management/infra/management-queries.js";
import { parseManagementSummary } from "../../../../shared/features/management/domain/dashboard.ark.js";
import { ManagementTabs } from "../../../features/management/_components/ManagementTabs.js";
import { DashboardCard } from "../../../features/dashboard/_components/DashboardCard.js";
import { api } from "../../../features/auth/infra/api.js";

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
      <Link href="/management/risk">risk drill-down</Link>
      <Link href="/management/revenue">revenue drill-down</Link>
      <Link href="/management/operations">operations drill-down</Link>
    </section>
  );
}
