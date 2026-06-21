import {
  ctl,
  eq,
  group,
  inevitably,
  property,
  reachableFrom,
} from "modality-ts/properties";
import { usePaymentMethodStore } from "../../../../features/billing/state/payment-method-store.modals";

const methodStatus = usePaymentMethodStore.methodStatus;
const saveStatus = usePaymentMethodStore.saveStatus;

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
