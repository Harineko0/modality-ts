import { variable, type Variable } from "modality-ts/core";

export const useSupportStore = {
  // state
  activeAccountId: variable("zustand:useSupportStore.activeAccountId") as Variable<{ readonly kind: "enum"; readonly values: readonly ["acct-alpha"] }, "zustand:useSupportStore.activeAccountId">,
  enqueuedAccountId: variable("zustand:useSupportStore.enqueuedAccountId") as Variable<{ readonly kind: "option"; readonly inner: { readonly kind: "tokens"; readonly count: 1 } }, "zustand:useSupportStore.enqueuedAccountId">,
  escalationStatus: variable("zustand:useSupportStore.escalationStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:useSupportStore.escalationStatus">,
  priority: variable("zustand:useSupportStore.priority") as Variable<{ readonly kind: "enum"; readonly values: readonly ["normal"] }, "zustand:useSupportStore.priority">,
};
