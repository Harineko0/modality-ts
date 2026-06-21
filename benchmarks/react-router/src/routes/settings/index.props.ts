import { always, and, eq, group, not } from "modality-ts/properties";
import { permissionCacheAtom } from "../../features/auth/state/session-atoms.modals";
import { useSettingsStore } from "../../features/settings/state/settings-store.modals";

const saveStatus = useSettingsStore.saveStatus;
const permissionRole = permissionCacheAtom.at("role");

group("settings", () => {
  always(
    "settings.saveRequiresAdmin",
    not(and(eq(saveStatus, "submitting"), eq(permissionRole, "manager"))),
  );
});
