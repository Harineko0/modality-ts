import {
  always,
  and,
  eq,
  group,
  not,
  stepChangedTo,
  variable,
} from "modality-ts/properties";

const approvalStatus = variable("zustand:useApprovalStore.approvalStatus");
const decisionStatus = variable("zustand:useApprovalStore.decisionStatus");

group("approvals", () => {
  always(
    "approvals.rejectedApprovalCannotApply",
    not(and(eq(approvalStatus, "rejected"), eq(decisionStatus, "success"))),
  );

  stepChangedTo("zustand:useApprovalStore.approvalStatus", "approved");
});
