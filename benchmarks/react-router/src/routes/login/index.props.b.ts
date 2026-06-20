import { always, eq, group, variable } from "modality-ts/properties";
const role = variable("atom:permissionCacheAtom").at("role");
group("auth", () => {
  always("p", eq(role, "guest"));
});
