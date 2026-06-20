import type { TenantSettings } from "../domain/settings.js";
import { loadSettings } from "../application/settings-service.js";

export async function saveSettings(
  settings: TenantSettings,
): Promise<{ saved: true; settings: TenantSettings }> {
  return { saved: true, settings };
}

export async function fetchSettings(): Promise<TenantSettings> {
  return loadSettings();
}
