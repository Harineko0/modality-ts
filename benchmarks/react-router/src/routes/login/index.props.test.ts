import { always, and, eq, group, not } from "modality-ts/properties";
import { route } from "modality-ts/vars";
import {
  loginStatusAtom,
  sessionAtom,
} from "../../features/auth/state/session-atoms.modals";

group("auth", () => {
  always("auth.failedLoginKeepsGuest", eq(loginStatusAtom, "idle"));
  always(
    "auth.managerCannotLandOnAdminReturnTo",
    not(and(eq(route, "/settings/rbac"), eq(sessionAtom, null))),
  );
});
