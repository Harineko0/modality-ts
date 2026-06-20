import { useApprovalStore } from "../../../features/subscription/state/approval-store.js";
import { useApprovals } from "../../../features/subscription/infra/subscription-queries.js";
import { approvalStatusSchema } from "../../../../shared/features/subscription/domain/subscription.ark.js";
import { api } from "../../../features/auth/infra/api.js";

export function ApprovalQueue() {
  const queueFilter = useApprovalStore((s) => s.queueFilter);
  const decisionStatus = useApprovalStore((s) => s.decisionStatus);
  const approvalStatus = useApprovalStore((s) => s.approvalStatus);
  const setQueueFilter = useApprovalStore((s) => s.setQueueFilter);
  const approve = useApprovalStore((s) => s.approve);
  const reject = useApprovalStore((s) => s.reject);
  const applyApproved = useApprovalStore((s) => s.applyApproved);
  const { data } = useApprovals();
  if (approvalStatus) approvalStatusSchema(approvalStatus);

  return (
    <section>
      <select
        value={queueFilter}
        onChange={(e) => setQueueFilter(e.target.value as typeof queueFilter)}
      >
        <option value="all">all</option>
        <option value="requested">requested</option>
        <option value="approved">approved</option>
        <option value="rejected">rejected</option>
      </select>
      <p>approval detail card: {data?.[0]?.accountId ?? "none"}</p>
      <button type="button" onClick={approve}>
        approve button
      </button>
      <button type="button" onClick={reject}>
        reject button
      </button>
      <button
        type="button"
        disabled={approvalStatus === "rejected"}
        onClick={async () => {
          applyApproved();
          const request = data?.[0];
          if (request) await api.applyApproval(request);
        }}
      >
        apply approved change button
      </button>
      <p>decision status: {decisionStatus}</p>
    </section>
  );
}
