import {
  ctl,
  eq,
  group,
  lessThanOrEqual,
  neq,
  property,
} from "modality-ts/properties";
import { useManagementStore } from "../../../features/management/state/management-store.modals";

const revenueHealth = useManagementStore.revenueHealth;
const failedPaymentQueue = useManagementStore.failedPaymentQueue;

group("management", () => {
  property(
    "management.criticalRevenueRequiresFailedPayments",
    ctl.implies(
      ctl.holds(eq(revenueHealth, "critical")),
      ctl.holds(neq(failedPaymentQueue, "empty")),
    ),
  );

  property(
    "management.revenueQueueBounded",
    ctl.holds(lessThanOrEqual(failedPaymentQueue, "many")),
  );
});
