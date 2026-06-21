import { variable, type Variable } from "modality-ts/core";

export const useApprovalStore = {
  // state
  approvalStatus: variable("zustand:useApprovalStore.approvalStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["requested"] }, "zustand:useApprovalStore.approvalStatus">,
  decisionStatus: variable("zustand:useApprovalStore.decisionStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useApprovalStore.decisionStatus">,
  queueFilter: variable("zustand:useApprovalStore.queueFilter") as Variable<{ readonly kind: "enum"; readonly values: readonly ["requested"] }, "zustand:useApprovalStore.queueFilter">,
};
