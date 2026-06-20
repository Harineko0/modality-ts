"use client";

import { useManagementStore } from "../../../../features/management/state/management-store.js";
import { useOperationsQueue } from "../../../../features/management/infra/management-queries.js";
import { queueBucketSchema } from "../../../../shared/features/management/domain/dashboard.ark.js";

export function OperationsQueuePanel() {
  const opsQueue = useManagementStore((state) => state.opsQueue);
  const assignmentStatus = useManagementStore(
    (state) => state.assignmentStatus,
  );
  const { data } = useOperationsQueue();
  if (data) queueBucketSchema(data.approvals);

  return (
    <section>
      <p>approval queue: {opsQueue}</p>
      <p>support breach queue: {data?.supportBreaches ?? "empty"}</p>
      <button
        type="button"
        onClick={() =>
          useManagementStore.setState({ assignmentStatus: "success" })
        }
      >
        assign reviewer button
      </button>
      <button
        type="button"
        onClick={() => useManagementStore.setState({ opsQueue: "many" })}
      >
        bulk request approvals button
      </button>
      <p>assignment status: {assignmentStatus}</p>
    </section>
  );
}
