import type { TransitionRef } from "modality-ts/properties";

export const AccountProfile = {
  // transitions
  Link: {
    navigate: {
      _accounts_id_billing: "AccountProfile.Link.navigate._accounts_id_billing" as TransitionRef<"AccountProfile.Link.navigate._accounts_id_billing">,
      "_accounts_id_payment-methods": "AccountProfile.Link.navigate._accounts_id_payment-methods" as TransitionRef<"AccountProfile.Link.navigate._accounts_id_payment-methods">,
      _accounts_id_subscription: "AccountProfile.Link.navigate._accounts_id_subscription" as TransitionRef<"AccountProfile.Link.navigate._accounts_id_subscription">,
      _accounts_id_support: "AccountProfile.Link.navigate._accounts_id_support" as TransitionRef<"AccountProfile.Link.navigate._accounts_id_support">,
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
