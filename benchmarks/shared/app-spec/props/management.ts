import {
  ctl,
  eq,
  group,
  inevitably,
  leadsToWithin,
  neq,
  property,
  reachable,
  stepEnqueued,
  variable,
} from "modality-ts/properties";
import { route } from "modality-ts/vars";

const summaryStatus = variable("zustand:useManagementStore.summaryStatus");
const managementSummary = variable("swr:management_summary:data");
const summaryValidating = variable("swr:management_summary:isValidating");

group("management", () => {
  reachable("management.summaryRouteReachable", eq(route, "/management"));

  leadsToWithin(
    "management.summaryLoadSettles",
    stepEnqueued("api.loadManagementSummary"),
    eq(summaryStatus, "success"),
    { budget: { environment: 3 } },
  );

  property(
    "management.dashboardCtlGuard",
    ctl.allOf(
      ctl.always(ctl.holds(eq(route, "/management"))),
      ctl.canReach(ctl.holds(neq(managementSummary, null))),
    ),
  );

  inevitably(
    "management.summaryEventuallyLoaded",
    ctl.eventually(ctl.holds(eq(summaryValidating, false))),
    {
      fairness: [
        ctl.fairlyOften(
          ctl.holds(eq(summaryValidating, false)),
          "managementSummaryRefresh",
        ),
      ],
    },
  );

  property(
    "management.summarySettlementPaths",
    ctl.anyOf(
      ctl.holds(eq(summaryStatus, "success")),
      ctl.holds(eq(summaryStatus, "error")),
    ),
  );
});
