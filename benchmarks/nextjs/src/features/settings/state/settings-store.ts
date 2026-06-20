import { create } from "zustand";
import type { AsyncStatus } from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { TenantSettings } from "../../../../shared/features/settings/domain/settings.js";

type SettingsState = {
  settingsDraft: TenantSettings;
  saveStatus: AsyncStatus;
  setBillingPolicy: (enabled: boolean) => void;
  markSettingsSaved: () => void;
};

export const useSettingsStore = create<SettingsState>((set) => ({
  settingsDraft: { tenantName: "acme", billingPolicyEnabled: true },
  saveStatus: "idle",
  setBillingPolicy: (enabled) =>
    set((state) => ({
      settingsDraft: { ...state.settingsDraft, billingPolicyEnabled: enabled },
    })),
  markSettingsSaved: () => set({ saveStatus: "success" }),
}));
