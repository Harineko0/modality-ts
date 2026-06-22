import { type Variable, variable } from "modality-ts/core";

export const managementFilterAtom: Variable<
  {
    readonly kind: "enum";
    readonly values: readonly ["all", "revenue", "risk"];
  },
  "atom:managementFilterAtom"
> = variable("atom:managementFilterAtom");

export const managementTabAtom: Variable<
  {
    readonly kind: "enum";
    readonly values: readonly ["operations", "overview", "revenue", "risk"];
  },
  "atom:managementTabAtom"
> = variable("atom:managementTabAtom");
