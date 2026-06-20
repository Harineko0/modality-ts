import type { Permission, Role } from "../../fixtures/domain/fixtures.js";

export type AuditAction =
  | "login"
  | "subscription_change"
  | "billing_capture"
  | "support_escalation"
  | "role_assignment"
  | "bulk_suspend";

export type AuditEvent = {
  id: string;
  action: AuditAction;
  actorRole: Role;
  permissionRequired: Permission | null;
};

export type AuditExportRequest = {
  actionFilter: AuditAction | "all";
  actorRoleFilter: Role | "all";
};
