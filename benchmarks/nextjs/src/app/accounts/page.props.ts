import {
  alwaysStep,
  eq,
  group,
  reachable,
  stepChanged,
  type Variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { selectedAccountAtom } from "../../features/accounts/state/selection-atoms.js";

const selectedAccount = selectedAccountAtom as unknown as Variable;

group("accounts", () => {
  reachable("accounts.listReachable", eq(route, "/accounts"));

  alwaysStep("accounts.selectionTracksFilter", {
    step: stepChanged("atom:accountStatusFilterAtom"),
    post: eq(selectedAccount, selectedAccount),
  });
});
