import {
  ctl,
  eq,
  group,
  inevitably,
  property,
  reachableFrom,
  variable,
} from "modality-ts/properties";

const methodStatus = variable("zustand:usePaymentMethodStore.methodStatus");
const saveStatus = variable("zustand:usePaymentMethodStore.saveStatus");

group("billing", () => {
  reachableFrom(
    "billing.validPaymentMethodReachable",
    eq(methodStatus, "valid"),
    eq(saveStatus, "success"),
  );

  property(
    "billing.requiresActionEventuallySettles",
    ctl.eventually(ctl.holds(eq(methodStatus, "valid"))),
  );

  inevitably(
    "billing.requiresActionBranchProbe",
    ctl.canHoldUntil(
      ctl.holds(eq(methodStatus, "requires_action")),
      ctl.holds(eq(methodStatus, "valid")),
    ),
  );
});
