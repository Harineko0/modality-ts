import { settingsDraftSchema } from "../../../../shared/features/settings/domain/settings.schema.js";
import { api } from "../../../features/auth/infra/api.js";
import { SettingsSaveBar } from "../../../features/settings/_components/SettingsSaveBar.js";
import { useSettings } from "../../../features/settings/infra/settings-queries.js";
import { useSettingsStore } from "../../../features/settings/state/settings-store.js";

export function TenantSettingsForm() {
  const settingsDraft = useSettingsStore((s) => s.settingsDraft);
  const saveStatus = useSettingsStore((s) => s.saveStatus);
  const setBillingPolicy = useSettingsStore((s) => s.setBillingPolicy);
  const markSettingsSaved = useSettingsStore((s) => s.markSettingsSaved);
  useSettings();

  return (
    <section>
      <label>
        tenant name field
        <select
          value={settingsDraft.tenantName}
          onChange={(event) =>
            useSettingsStore.setState({
              settingsDraft: {
                ...settingsDraft,
                tenantName: event.target
                  .value as typeof settingsDraft.tenantName,
              },
            })
          }
        >
          <option value="acme">acme</option>
          <option value="globex">globex</option>
          <option value="initech">initech</option>
        </select>
      </label>
      <label>
        billing policy toggle
        <input
          type="checkbox"
          checked={settingsDraft.billingPolicyEnabled}
          onChange={(event) => setBillingPolicy(event.target.checked)}
        />
      </label>
      <SettingsSaveBar
        status={saveStatus}
        onSave={async () => {
          const parsed = settingsDraftSchema.safeParse(settingsDraft);
          if (!parsed.success) return;
          await api.saveSettings(parsed.data);
          markSettingsSaved();
        }}
      />
    </section>
  );
}
