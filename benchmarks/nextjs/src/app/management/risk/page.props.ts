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
} from "modality-ts/properties";
import { permissionCacheAtom } from "../../../features/auth/state/session-atoms.modals";
import { useManagementStore } from "../../../features/management/state/management-store.modals";

const selectedRiskBucket = useManagementStore.selectedRiskBucket;
const bulkStatus = useManagementStore.bulkStatus;
const riskFilter = useManagementStore.riskFilter;
const permissionRole = permissionCacheAtom.at("role");

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
