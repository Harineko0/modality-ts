import { parseAuditExportRequest } from "../domain/audit.ark.js";
import type { AuditEvent, AuditExportRequest } from "../domain/audit.js";
import type { Role } from "../../fixtures/domain/fixtures.js";
import { canExportAudit } from "../../auth/application/auth-service.js";
import { seedAuditEvents } from "../../fixtures/domain/fixtures.js";

export function listAuditEvents(
  filter: AuditExportRequest,
): readonly AuditEvent[] {
  parseAuditExportRequest(filter);
  return seedAuditEvents.filter((event) => {
    const actionMatch =
      filter.actionFilter === "all" || event.action === filter.actionFilter;
    const roleMatch =
      filter.actorRoleFilter === "all" ||
      event.actorRole === filter.actorRoleFilter;
    return actionMatch && roleMatch;
  });
}

export function exportIncludesSupportEvents(
  events: readonly AuditEvent[],
): boolean {
  return events.some((event) => event.action === "support_escalation");
}

export function canExport(role: Role): boolean {
  return canExportAudit(role);
}
