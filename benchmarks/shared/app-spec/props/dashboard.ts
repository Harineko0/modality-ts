import {
  always,
  and,
  ctl,
  enabledTransitionPrefix,
  eq,
  group,
  inevitably,
  neq,
  not,
  or,
  property,
  reachable,
  variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";

const selectedAccount = variable("atom:selectedAccountAtom");
const dashboardSummary = variable("swr:dashboard_selectedAccount:data");
const summaryValidating = variable(
  "swr:dashboard_selectedAccount:isValidating",
);

group("dashboard", () => {
  always(
    "dashboard.suspendedAccountCheckoutDisabled",
    not(
      and(
        eq(selectedAccount, "acct-suspended"),
        enabledTransitionPrefix("DashboardSummary.onClick"),
      ),
    ),
  );

  reachable("dashboard.summaryDataReachable", neq(dashboardSummary, null));

  inevitably(
    "dashboard.summaryFairProgress",
    ctl.eventually(
      ctl.holds(or(eq(summaryValidating, false), neq(dashboardSummary, null))),
    ),
    {
      fairness: [
        ctl.fairlyOften(
          ctl.holds(eq(summaryValidating, false)),
          "dashboardSummarySettles",
        ),
      ],
    },
  );

  property(
    "dashboard.routeGuard",
    ctl.allOf(
      ctl.always(ctl.holds(or(eq(route, "/dashboard"), eq(route, "/login")))),
      ctl.canReach(ctl.holds(eq(route, "/dashboard"))),
    ),
  );
});
