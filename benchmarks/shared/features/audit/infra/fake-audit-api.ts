import type { Role } from "../../fixtures/domain/fixtures.js";
import { listAuditEvents } from "../application/audit-service.js";
import type { AuditExportRequest } from "../domain/audit.js";

export async function exportAudit(input: {
  role: Role;
  request: AuditExportRequest;
}): Promise<{ exported: boolean; eventCount: number }> {
  const events = listAuditEvents(input.request);
  return { exported: true, eventCount: events.length };
}

export async function loadAuditEvents(request: AuditExportRequest) {
  return listAuditEvents(request);
}
