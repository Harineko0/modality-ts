import {
  eq,
  group,
  reachableFrom,
  stepChanged,
  type Variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { accountDetailTabAtom } from "../../../features/accounts/state/selection-atoms.js";

const accountTab = accountDetailTabAtom as unknown as Variable;

group("accounts", () => {
  reachableFrom(
    "accounts.detailTabReachable",
    eq(route, "/accounts/:accountId"),
    eq(accountTab, "subscription"),
  );

  stepChanged("atom:selectedAccountAtom");
});
