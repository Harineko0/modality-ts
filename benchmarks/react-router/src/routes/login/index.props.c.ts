import { always, eq, group } from "modality-ts/properties";
import { loginStatusAtom } from "../../features/auth/state/session-atoms.modals";

group("auth", () => {
  always("p", eq(loginStatusAtom, "idle"));
});
