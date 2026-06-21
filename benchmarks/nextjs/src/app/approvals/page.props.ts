import {
  always,
  and,
  eq,
  group,
  not,
  stepChangedTo,
} from "modality-ts/properties";
import { useApprovalStore } from "../../features/subscription/state/approval-store.modals";

group("approvals", () => {
  always(
    "approvals.rejectedApprovalCannotApply",
    not(and(eq(useApprovalStore.approvalStatus, "rejected"), eq(useApprovalStore.decisionStatus, "success"))),
  );

  stepChangedTo("zustand:useApprovalStore.approvalStatus", "approved");
});
