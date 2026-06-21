import { variable, type Variable } from "modality-ts/core";

export const useManagementStore = {
  // state
  assignmentStatus: variable("zustand:useManagementStore.assignmentStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useManagementStore.assignmentStatus">,
  bulkDraft: variable("zustand:useManagementStore.bulkDraft") as Variable<{ readonly kind: "enum"; readonly values: readonly ["some"] }, "zustand:useManagementStore.bulkDraft">,
  bulkStatus: variable("zustand:useManagementStore.bulkStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useManagementStore.bulkStatus">,
  exportStatus: variable("zustand:useManagementStore.exportStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useManagementStore.exportStatus">,
  failedPaymentQueue: variable("zustand:useManagementStore.failedPaymentQueue") as Variable<{ readonly kind: "enum"; readonly values: readonly ["some"] }, "zustand:useManagementStore.failedPaymentQueue">,
  opsQueue: variable("zustand:useManagementStore.opsQueue") as Variable<{ readonly kind: "enum"; readonly values: readonly ["some"] }, "zustand:useManagementStore.opsQueue">,
  revenueHealth: variable("zustand:useManagementStore.revenueHealth") as Variable<{ readonly kind: "enum"; readonly values: readonly ["watch"] }, "zustand:useManagementStore.revenueHealth">,
  riskFilter: variable("zustand:useManagementStore.riskFilter") as Variable<{ readonly kind: "enum"; readonly values: readonly ["medium"] }, "zustand:useManagementStore.riskFilter">,
  selectedRiskBucket: variable("zustand:useManagementStore.selectedRiskBucket") as Variable<{ readonly kind: "enum"; readonly values: readonly ["high"] }, "zustand:useManagementStore.selectedRiskBucket">,
  summaryStatus: variable("zustand:useManagementStore.summaryStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useManagementStore.summaryStatus">,
};
