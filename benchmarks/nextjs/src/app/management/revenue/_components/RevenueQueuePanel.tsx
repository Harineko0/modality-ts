"use client";

import { useManagementStore } from "../../../../features/management/state/management-store.js";
import { useRevenueQueue } from "../../../../features/management/infra/management-queries.js";
import { revenueHealthSchema } from "../../../../shared/features/management/domain/dashboard.ark.js";
import { DashboardCard } from "../../../../features/dashboard/_components/DashboardCard.js";

export function RevenueQueuePanel() {
  const revenueHealth = useManagementStore((state) => state.revenueHealth);
  const failedPaymentQueue = useManagementStore(
    (state) => state.failedPaymentQueue,
  );
  const { data } = useRevenueQueue();
  if (data) revenueHealthSchema(data.health);

  return (
    <section>
      <DashboardCard title="revenue health cards" value={revenueHealth} />
      <p>failed payment queue: {failedPaymentQueue}</p>
      <button
        type="button"
        onClick={() =>
          useManagementStore.setState({ exportStatus: "submitting" })
        }
      >
        retry all draft button
      </button>
      <button
        type="button"
        onClick={() => useManagementStore.setState({ exportStatus: "success" })}
      >
        export CSV button
      </button>
      <p>loaded health: {data?.health ?? "healthy"}</p>
    </section>
  );
}
