import {
  always,
  and,
  eq,
  group,
  not,
  type Variable,
  variable,
} from "modality-ts/properties";
import { permissionCacheAtom } from "../../features/auth/state/session-atoms.js";

const saveStatus = variable("zustand:useSettingsStore.saveStatus");
const permissionRole = (permissionCacheAtom as unknown as Variable).at("role");

group("settings", () => {
  always(
    "settings.saveRequiresAdmin",
    not(and(eq(saveStatus, "submitting"), eq(permissionRole, "manager"))),
  );
});
