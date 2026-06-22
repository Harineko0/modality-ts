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
} from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { useManagementSummary } from "../../features/management/infra/management-queries.modals";
import { useManagementStore } from "../../features/management/state/management-store.modals";

const summaryStatus = useManagementStore.summaryStatus;
const managementSummary = useManagementSummary.data;
const summaryValidating = useManagementSummary.isValidating;

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
