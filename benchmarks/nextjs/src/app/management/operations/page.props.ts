import {
  and,
  ctl,
  eq,
  group,
  neq,
  property,
  variable,
} from "modality-ts/properties";

const assignmentStatus = variable(
  "zustand:useManagementStore.assignmentStatus",
);
const opsQueue = variable("zustand:useManagementStore.opsQueue");

group("management", () => {
  property(
    "management.adminCanTakeOperationsAction",
    ctl.afterSomeStep(
      ctl.holds(and(eq(assignmentStatus, "success"), neq(opsQueue, "empty"))),
    ),
  );
});
