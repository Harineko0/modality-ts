import { always, eq, group } from "modality-ts/properties";
import { useManagementStore } from "../../features/management/state/management-store.modals";
group("auth", () => {
  always("p", eq(useManagementStore.bulkStatus, "idle"));
});
