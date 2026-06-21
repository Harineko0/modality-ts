import { and, ctl, eq, group, neq, property } from "modality-ts/properties";
import { useManagementStore } from "../../../features/management/state/management-store.modals";

const assignmentStatus = useManagementStore.assignmentStatus;
const opsQueue = useManagementStore.opsQueue;

group("management", () => {
  property(
    "management.adminCanTakeOperationsAction",
    ctl.afterSomeStep(
      ctl.holds(and(eq(assignmentStatus, "success"), neq(opsQueue, "empty"))),
    ),
  );
});
