import { eq, group, reachableFrom, stepChanged } from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { accountDetailTabAtom } from "../../../features/accounts/state/selection-atoms.modals";

group("accounts", () => {
  reachableFrom(
    "accounts.detailTabReachable",
    eq(route, "/accounts/:accountId"),
    eq(accountDetailTabAtom, "subscription"),
  );

  stepChanged("atom:selectedAccountAtom");
});
