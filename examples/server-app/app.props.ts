import {
  always,
  and,
  eq,
  leadsToWithin,
  neq,
  not,
  or,
  stepChangedTo,
  variable,
} from "modality-ts/properties";
import { pending } from "modality-ts/vars";
import { fileURLToPath } from "node:url";

const actionFile = fileURLToPath(new URL("./app/actions.ts", import.meta.url));
const saveAction = `ACTION ${actionFile}#saveDashboard`;

const dashboardData = variable(
  "route:loader:next-loader:_dashboard:DATA_getServerSideProps_dashboard:data",
);
const dashboardStale = variable(
  "route:loader:next-loader:_dashboard:DATA_getServerSideProps_dashboard:stale",
);

always(
  "guestCannotSeeGatedData",
  not(eq(dashboardData, "/dashboard:data")),
);

always(
  "actionNoDoubleSubmit",
  and(
    or(neq(pending.at("0", "opId"), saveAction), neq(pending.at("1", "opId"), saveAction)),
    or(neq(pending.at("0", "opId"), saveAction), neq(pending.at("2", "opId"), saveAction)),
    or(neq(pending.at("1", "opId"), saveAction), neq(pending.at("2", "opId"), saveAction)),
  ),
);

leadsToWithin(
  "dataRefreshesAfterAction",
  stepChangedTo(
    "route:loader:next-loader:_dashboard:DATA_getServerSideProps_dashboard:stale",
    true,
  ),
  eq(dashboardStale, false),
  { budget: { steps: 4, environment: 2 }, allowUserEvents: true },
);
