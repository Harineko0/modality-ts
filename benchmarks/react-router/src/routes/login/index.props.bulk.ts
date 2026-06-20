import { always, eq, group, variable } from "modality-ts/properties";
group("auth", () => {
  always("p", eq(variable("zustand:useManagementStore.bulkStatus"), "idle"));
});
