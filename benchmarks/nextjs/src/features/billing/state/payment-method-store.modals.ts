import { variable, type Variable } from "modality-ts/core";

export const usePaymentMethodStore = {
  // state
  methodStatus: variable("zustand:usePaymentMethodStore.methodStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["valid"] }, "zustand:usePaymentMethodStore.methodStatus">,
  saveStatus: variable("zustand:usePaymentMethodStore.saveStatus") as Variable<{ readonly kind: "enum"; readonly values: readonly ["idle"] }, "zustand:usePaymentMethodStore.saveStatus">,
};
