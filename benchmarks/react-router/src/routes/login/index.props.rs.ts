import { always, eq, group, variable } from "modality-ts/properties";
group("auth", () => {
  always("p", eq(variable("atom:roleSaveStatusAtom"), "idle"));
});
