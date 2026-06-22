import { type Variable, variable } from "modality-ts/core";

export const auditActionFilterAtom: Variable<
  {
    readonly kind: "enum";
    readonly values: readonly [
      "all",
      "billing_capture",
      "bulk_suspend",
      "login",
      "role_assignment",
      "subscription_change",
      "support_escalation",
    ];
  },
  "atom:auditActionFilterAtom"
> = variable("atom:auditActionFilterAtom");

export const auditActorRoleFilterAtom: Variable<
  {
    readonly kind: "enum";
    readonly values: readonly ["admin", "all", "analyst", "guest", "manager"];
  },
  "atom:auditActorRoleFilterAtom"
> = variable("atom:auditActorRoleFilterAtom");

export const auditExportStatusAtom: Variable<
  {
    readonly kind: "enum";
    readonly values: readonly [
      "error",
      "idle",
      "loading",
      "submitting",
      "success",
    ];
  },
  "atom:auditExportStatusAtom"
> = variable("atom:auditExportStatusAtom");
