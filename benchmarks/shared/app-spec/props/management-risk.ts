import {
  add,
  always,
  alwaysStep,
  and,
  ctl,
  enabledTransitionPrefix,
  eq,
  greaterThanOrEqual,
  group,
  mod,
  neq,
  not,
  property,
  readOpArg,
  stepResolved,
  variable,
} from "modality-ts/properties";

const selectedRiskBucket = variable(
  "zustand:useManagementStore.selectedRiskBucket",
);
const bulkStatus = variable("zustand:useManagementStore.bulkStatus");
const riskFilter = variable("zustand:useManagementStore.riskFilter");
const permissionRole = variable("atom:permissionCacheAtom").at("role");

group("management", () => {
  always(
    "management.bulkSuspendRequiresAdmin",
    not(and(eq(bulkStatus, "submitting"), eq(permissionRole, "manager"))),
  );

  alwaysStep("management.bulkSuspendUsesEnqueuedRiskBucket", {
    negate: true,
    step: stepResolved("api.bulkSuspendAccounts"),
    post: neq(readOpArg("riskBucket"), selectedRiskBucket),
  });

  property(
    "management.riskBucketNumericGuard",
    ctl.holds(greaterThanOrEqual(mod(add(riskFilter, riskFilter), 3), 0)),
  );

  property(
    "management.bulkActionEnabledWhenIdle",
    ctl.implies(
      ctl.holds(eq(bulkStatus, "idle")),
      ctl.holds(enabledTransitionPrefix("RiskBulkPanel.onClick")),
    ),
  );
});
