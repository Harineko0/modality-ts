import { useParams } from "react-router-dom";
import { useSupportStore } from "../../../../../features/support/state/support-store.js";
import { useSupportCase } from "../../../../../features/support/infra/support-queries.js";
import { supportEscalationSchema } from "../../../../../shared/features/support/domain/support.schema.js";
import type { AccountId } from "../../../../../shared/features/accounts/domain/account.js";
import { PrioritySelect } from "../../../../../features/support/_components/PrioritySelect.js";
import { api } from "../../../../../features/auth/infra/api.js";

export function SupportEscalationForm() {
  const { accountId = "acct-alpha" } = useParams();
  const typedAccountId = accountId as AccountId;
  const priority = useSupportStore((s) => s.priority);
  const escalationStatus = useSupportStore((s) => s.escalationStatus);
  const enqueuedAccountId = useSupportStore((s) => s.enqueuedAccountId);
  const activeAccountId = useSupportStore((s) => s.activeAccountId);
  const setPriority = useSupportStore((s) => s.setPriority);
  const openEscalation = useSupportStore((s) => s.openEscalation);
  const assignOwner = useSupportStore((s) => s.assignOwner);
  useSupportCase(typedAccountId);

  return (
    <section>
      <PrioritySelect value={priority} onChange={setPriority} />
      <p>escalation text bucket: some</p>
      <button
        type="button"
        onClick={() => {
          const parsed = supportEscalationSchema.safeParse({
            accountId: typedAccountId,
            priority,
            escalationBucket: "some",
          });
          if (!parsed.success) return;
          openEscalation(typedAccountId);
        }}
      >
        open escalation button
      </button>
      <button
        type="button"
        onClick={async () => {
          await api.openSupportEscalation({
            accountId: enqueuedAccountId ?? typedAccountId,
            priority,
            escalationBucket: "some",
          });
          assignOwner(enqueuedAccountId ?? typedAccountId);
        }}
      >
        assign owner button
      </button>
      <p>display account: {enqueuedAccountId ?? typedAccountId}</p>
      <p>active account: {activeAccountId}</p>
      <p>escalation status: {escalationStatus}</p>
    </section>
  );
}
