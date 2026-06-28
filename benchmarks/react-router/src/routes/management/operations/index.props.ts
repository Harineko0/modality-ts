import { and, eq, group, neq, reachableFrom } from "modality-ts/properties";
import { route } from "modality-ts/vars";
import { useManagementStore } from "../../../features/management/state/management-store.modals";

const assignmentStatus = useManagementStore.assignmentStatus;
const opsQueue = useManagementStore.opsQueue;

group("management", () => {
  // The operations action is taken from the operations route, so the
  // reachability is scoped to that route: once there, an admin can drive the
  // queue to a successful, non-empty state.
  reachableFrom(
    "management.adminCanTakeOperationsAction",
    eq(route, "/management/operations"),
    and(eq(assignmentStatus, "success"), neq(opsQueue, "empty")),
  );
});
