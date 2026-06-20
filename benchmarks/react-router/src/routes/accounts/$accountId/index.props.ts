import {
  eq,
  group,
  reachableFrom,
  stepChanged,
  variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";

const accountTab = variable("atom:accountDetailTabAtom");

group("accounts", () => {
  reachableFrom(
    "accounts.detailTabReachable",
    eq(route, "/accounts/:accountId"),
    eq(accountTab, "subscription"),
  );

  stepChanged("atom:selectedAccountAtom");
});
