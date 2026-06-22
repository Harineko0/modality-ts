import { always, eq, group } from "modality-ts/properties";
import { roleSaveStatusAtom } from "../../features/auth/state/session-atoms.modals";

group("auth", () => {
  always("p", eq(roleSaveStatusAtom, "idle"));
});
