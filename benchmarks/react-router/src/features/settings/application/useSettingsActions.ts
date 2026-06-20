import { useSettingsStore } from "../state/settings-store.js";

export function useSettingsActions() {
  const setBillingPolicy = useSettingsStore((state) => state.setBillingPolicy);
  const markSettingsSaved = useSettingsStore(
    (state) => state.markSettingsSaved,
  );
  return { setBillingPolicy, markSettingsSaved };
}
