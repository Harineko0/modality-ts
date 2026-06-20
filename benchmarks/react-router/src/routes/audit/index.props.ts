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
  type Variable,
} from "modality-ts/properties";
import { auditActionFilterAtom } from "../../features/audit/state/audit-atoms.js";
import { permissionCacheAtom } from "../../features/auth/state/session-atoms.js";

const permissionRole = (permissionCacheAtom as unknown as Variable).at("role");
const actionFilter = auditActionFilterAtom as unknown as Variable;

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
