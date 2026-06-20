import {
  alwaysStep,
  eq,
  group,
  reachable,
  stepChanged,
  variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";

group("accounts", () => {
  reachable("accounts.listReachable", eq(route, "/accounts"));

  alwaysStep("accounts.selectionTracksFilter", {
    step: stepChanged("atom:accountStatusFilterAtom"),
    post: eq(
      variable("atom:selectedAccountAtom"),
      variable("atom:selectedAccountAtom"),
    ),
  });
});
