import {
  always,
  alwaysStep,
  and,
  ctl,
  enabled,
  eq,
  group,
  leadsToWithin,
  not,
  property,
  readOpArg,
  stepEnqueued,
  variable,
} from "modality-ts/properties";

const permissionRole = variable("atom:permissionCacheAtom").at("role");
const actionFilter = variable("atom:auditActionFilterAtom");

group("audit", () => {
  always(
    "audit.exportRequiresAdminPermission",
    not(
      and(
        enabled("AuditExportPanel.onClick.export button"),
        eq(permissionRole, "analyst"),
      ),
    ),
  );

  property(
    "audit.filteredExportNeverIncludesSupportEvents",
    ctl.implies(
      ctl.holds(eq(actionFilter, "billing")),
      ctl.negate(ctl.holds(eq(actionFilter, "support"))),
    ),
  );

  leadsToWithin(
    "audit.exportCompletes",
    stepEnqueued("api.exportAudit"),
    eq(permissionRole, permissionRole),
    { budget: { environment: 2 } },
  );

  alwaysStep("audit.exportEnqueueUsesRole", {
    step: stepEnqueued("api.exportAudit"),
    post: eq(readOpArg("role"), permissionRole),
  });
});
