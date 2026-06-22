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
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { selectedAccountAtom } from "../../features/accounts/state/selection-atoms.modals";
import { useDashboardSummary } from "../../features/dashboard/infra/dashboard-queries.modals";

group("dashboard", () => {
  always(
    "dashboard.suspendedAccountCheckoutDisabled",
    not(
      and(
        eq(selectedAccountAtom, "acct-suspended"),
        enabledTransitionPrefix("DashboardSummary.onClick"),
      ),
    ),
  );

  reachable(
    "dashboard.summaryDataReachable",
    neq(useDashboardSummary.data, null),
  );

  inevitably(
    "dashboard.summaryFairProgress",
    ctl.eventually(
      ctl.holds(
        or(
          eq(useDashboardSummary.isValidating, false),
          neq(useDashboardSummary.data, null),
        ),
      ),
    ),
    {
      fairness: [
        ctl.fairlyOften(
          ctl.holds(eq(useDashboardSummary.isValidating, false)),
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
