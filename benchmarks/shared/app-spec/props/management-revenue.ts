import {
  ctl,
  eq,
  group,
  lessThanOrEqual,
  neq,
  property,
  variable,
} from "modality-ts/properties";

const revenueHealth = variable("zustand:useManagementStore.revenueHealth");
const failedPaymentQueue = variable(
  "zustand:useManagementStore.failedPaymentQueue",
);

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
