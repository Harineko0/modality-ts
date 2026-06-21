import type { TransitionRef } from "modality-ts/properties";

export const DashboardSummary = {
  // transitions
  Link: {
    navigate: {
      _audit: "DashboardSummary.Link.navigate._audit" as TransitionRef<"DashboardSummary.Link.navigate._audit">,
    },
  },
  onClick: {
    navigate: {
      "_accounts_acct-alpha_billing": "DashboardSummary.onClick.navigate._accounts_acct-alpha_billing" as TransitionRef<"DashboardSummary.onClick.navigate._accounts_acct-alpha_billing">,
    },
  },
};
