import { always, eq, group } from "modality-ts/properties";
import { permissionCacheAtom } from "../../features/auth/state/session-atoms.modals";
const role = permissionCacheAtom.at("role");
group("auth", () => {
  always("p", eq(role, "guest"));
});
