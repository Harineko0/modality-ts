import type { TransitionRef } from "modality-ts/properties";

export const AccountProfile = {
  // transitions
  Link: {
    navigate: {
      _accounts_accountId_billing: "AccountProfile.Link.navigate._accounts_accountId_billing" as TransitionRef<"AccountProfile.Link.navigate._accounts_accountId_billing">,
      "_accounts_accountId_payment-methods": "AccountProfile.Link.navigate._accounts_accountId_payment-methods" as TransitionRef<"AccountProfile.Link.navigate._accounts_accountId_payment-methods">,
      _accounts_accountId_subscription: "AccountProfile.Link.navigate._accounts_accountId_subscription" as TransitionRef<"AccountProfile.Link.navigate._accounts_accountId_subscription">,
      _accounts_accountId_support: "AccountProfile.Link.navigate._accounts_accountId_support" as TransitionRef<"AccountProfile.Link.navigate._accounts_accountId_support">,
    },
  },
  onClick: {
    accountDetailTabAtom: {
      seq: {
        billing: "AccountProfile.onClick.accountDetailTabAtom.seq.billing" as TransitionRef<"AccountProfile.onClick.accountDetailTabAtom.seq.billing">,
        "payment-methods": "AccountProfile.onClick.accountDetailTabAtom.seq.payment-methods" as TransitionRef<"AccountProfile.onClick.accountDetailTabAtom.seq.payment-methods">,
        subscription: "AccountProfile.onClick.accountDetailTabAtom.seq.subscription" as TransitionRef<"AccountProfile.onClick.accountDetailTabAtom.seq.subscription">,
        support: "AccountProfile.onClick.accountDetailTabAtom.seq.support" as TransitionRef<"AccountProfile.onClick.accountDetailTabAtom.seq.support">,
      },
    },
  },
};
