import { eq, group, reachableFrom, stepChanged } from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { accountDetailTabAtom } from "../../../features/accounts/state/selection-atoms.modals";

const accountTab = accountDetailTabAtom;

group("accounts", () => {
  reachableFrom(
    "accounts.detailTabReachable",
    eq(route, "/accounts/:accountId"),
    eq(accountTab, "subscription"),
  );

  stepChanged("atom:selectedAccountAtom");
});
