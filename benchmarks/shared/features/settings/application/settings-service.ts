import { seedSettings } from "../../fixtures/domain/fixtures.js";
import type { TenantSettings } from "../domain/settings.js";
import { settingsDraftSchema } from "../domain/settings.schema.js";

export function validateSettingsDraft(input: unknown) {
  return settingsDraftSchema.safeParse(input);
}

export function loadSettings(): TenantSettings {
  return seedSettings;
}
