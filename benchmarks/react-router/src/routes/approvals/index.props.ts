import {
  always,
  and,
  eq,
  group,
  not,
  stepChangedTo,
} from "modality-ts/properties";
import { useApprovalStore } from "../../features/subscription/state/approval-store.modals";

const approvalStatus = useApprovalStore.approvalStatus;
const decisionStatus = useApprovalStore.decisionStatus;

group("approvals", () => {
  always(
    "approvals.rejectedApprovalCannotApply",
    not(and(eq(approvalStatus, "rejected"), eq(decisionStatus, "success"))),
  );

  stepChangedTo("zustand:useApprovalStore.approvalStatus", "approved");
});
