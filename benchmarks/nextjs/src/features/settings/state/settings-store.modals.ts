import { type Variable, variable } from "modality-ts/core";

export const useSettingsStore = {
  // state
  saveStatus: variable("zustand:useSettingsStore.saveStatus") as Variable<
    { readonly kind: "enum"; readonly values: readonly ["idle"] },
    "zustand:useSettingsStore.saveStatus"
  >,
  settingsDraft: variable("zustand:useSettingsStore.settingsDraft") as Variable<
    {
      readonly kind: "record";
      readonly fields: {
        readonly tenantName: {
          readonly kind: "enum";
          readonly values: readonly ["acme"];
        };
        readonly billingPolicyEnabled: { readonly kind: "bool" };
      };
    },
    "zustand:useSettingsStore.settingsDraft"
  >,
};
