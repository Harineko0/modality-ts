import type { TransitionRef } from "modality-ts/properties";

export const TenantSettingsForm = {
  // transitions
  onChange: {
    zustand: {
      useSettingsStore_setState: "TenantSettingsForm.onChange.zustand.useSettingsStore_setState" as TransitionRef<"TenantSettingsForm.onChange.zustand.useSettingsStore_setState">,
    },
  },
};
