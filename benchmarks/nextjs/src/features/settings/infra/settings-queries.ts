export { saveSettings } from "../../../../shared/features/settings/infra/fake-settings-api.js";

import useSWR from "swr";
import { fetchSettings } from "../../../../shared/features/settings/infra/fake-settings-api.js";

export function useSettings() {
  return useSWR("settings", () => fetchSettings());
}

export function useRoleAssignments() {
  return useSWR("role-assignments", async () => [
    { userId: "user-a", targetRole: "analyst" },
  ]);
}
