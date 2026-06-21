import { type } from "arktype";
import type { AuditExportRequest } from "./audit.js";

export const auditActionSchema = type(
  "'login' | 'subscription_change' | 'billing_capture' | 'support_escalation' | 'role_assignment' | 'bulk_suspend'",
);
export const auditActorRoleFilterSchema = type(
  "'all' | 'guest' | 'analyst' | 'manager' | 'admin'",
);
export const auditActionFilterSchema = type(
  "'all' | 'login' | 'subscription_change' | 'billing_capture' | 'support_escalation' | 'role_assignment' | 'bulk_suspend'",
);
export const auditExportRequestSchema = type({
  actionFilter: auditActionFilterSchema,
  actorRoleFilter: auditActorRoleFilterSchema,
});

export function parseAuditExportRequest(value: unknown): AuditExportRequest {
  return auditExportRequestSchema.assert(value);
}
