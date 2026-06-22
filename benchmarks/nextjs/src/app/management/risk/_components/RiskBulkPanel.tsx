"use client";

import { PermissionGate } from "../../../../features/auth/_components/PermissionGate.js";
import { api } from "../../../../features/auth/infra/api.js";
import { BucketSelect } from "../../../../features/common/_components/BucketSelect.js";
import { BulkActionButton } from "../../../../features/management/_components/BulkActionButton.js";
import { useRiskQueue } from "../../../../features/management/infra/management-queries.js";
import { useManagementStore } from "../../../../features/management/state/management-store.js";
import { riskBucketSchema } from "../../../../shared/features/management/domain/dashboard.ark.js";

export function RiskBulkPanel() {
  const riskFilter = useManagementStore((state) => state.riskFilter);
  const selectedRiskBucket = useManagementStore(
    (state) => state.selectedRiskBucket,
  );
  const setRiskFilter = useManagementStore((state) => state.setRiskFilter);
  const enqueueBulkSuspend = useManagementStore(
    (state) => state.enqueueBulkSuspend,
  );
  const resolveBulkSuspend = useManagementStore(
    (state) => state.resolveBulkSuspend,
  );
  const { data } = useRiskQueue(riskFilter);
  if (data) riskBucketSchema(data.bucket);

  return (
    <section>
      <BucketSelect
        label="risk filter"
        value={riskFilter}
        options={["low", "medium", "high"] as const}
        onChange={setRiskFilter}
      />
      <p>high-risk account bucket: {selectedRiskBucket}</p>
      <button type="button" onClick={() => setRiskFilter(selectedRiskBucket)}>
        select bucket button
      </button>
      <PermissionGate
        permission="bulk_suspend_accounts"
        fallback={<div>warning banner</div>}
      >
        <BulkActionButton
          label="bulk suspend button"
          onClick={async () => {
            enqueueBulkSuspend(selectedRiskBucket);
            await api.bulkSuspendAccounts({ riskBucket: riskFilter });
            resolveBulkSuspend(selectedRiskBucket);
          }}
        />
      </PermissionGate>
      <p>queue bucket: {data?.accountCount ?? "empty"}</p>
    </section>
  );
}
