"use client";

import { useParams } from "next/navigation";
import { useSupportStore } from "../../../../../features/support/state/support-store.js";
import { useSupportCase } from "../../../../../features/support/infra/support-queries.js";
import { supportEscalationSchema } from "../../../../../shared/features/support/domain/support.schema.js";
import { PrioritySelect } from "../../../../../features/support/_components/PrioritySelect.js";
import { api } from "../../../../../features/auth/infra/api.js";

export function SupportEscalationForm() {
  const { accountId = "acct-alpha" } = useParams();
  const priority = useSupportStore((s) => s.priority);
  const escalationStatus = useSupportStore((s) => s.escalationStatus);
  const enqueuedAccountId = useSupportStore((s) => s.enqueuedAccountId);
  const activeAccountId = useSupportStore((s) => s.activeAccountId);
  const setPriority = useSupportStore((s) => s.setPriority);
  const openEscalation = useSupportStore((s) => s.openEscalation);
  const assignOwner = useSupportStore((s) => s.assignOwner);
  useSupportCase(accountId);

  return (
    <section>
      <PrioritySelect value={priority} onChange={setPriority} />
      <p>escalation text bucket: some</p>
      <button
        type="button"
        onClick={() => {
          const parsed = supportEscalationSchema.safeParse({
            accountId,
            priority,
            escalationBucket: "some",
          });
          if (!parsed.success) return;
          openEscalation(accountId);
        }}
      >
        open escalation button
      </button>
      <button
        type="button"
        onClick={async () => {
          await api.openSupportEscalation({
            accountId: enqueuedAccountId ?? accountId,
            priority,
            escalationBucket: "some",
          });
          assignOwner(enqueuedAccountId ?? accountId);
        }}
      >
        assign owner button
      </button>
      <p>display account: {enqueuedAccountId ?? accountId}</p>
      <p>active account: {activeAccountId}</p>
      <p>escalation status: {escalationStatus}</p>
    </section>
  );
}
