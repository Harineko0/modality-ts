import { always, eq, group } from "modality-ts/properties";
import { sessionAtom } from "../../features/auth/state/session-atoms.modals";

group("auth", () => {
  always("p", eq(sessionAtom, null));
});
