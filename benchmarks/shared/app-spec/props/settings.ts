import { always, and, eq, group, not, variable } from "modality-ts/properties";

const saveStatus = variable("zustand:useSettingsStore.saveStatus");
const permissionRole = variable("atom:permissionCacheAtom").at("role");

group("settings", () => {
  always(
    "settings.saveRequiresAdmin",
    not(and(eq(saveStatus, "submitting"), eq(permissionRole, "manager"))),
  );
});
