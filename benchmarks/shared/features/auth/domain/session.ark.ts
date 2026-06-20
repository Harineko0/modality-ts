import { type } from "arktype";

export const roleSchema = type("'guest' | 'analyst' | 'manager' | 'admin'");
export const permissionSchema = type(
  "'view_dashboard' | 'view_accounts' | 'manage_subscription' | 'manage_billing' | 'manage_payment_methods' | 'approve_changes' | 'view_audit' | 'export_audit' | 'manage_settings' | 'manage_rbac' | 'use_management_dashboard' | 'bulk_suspend_accounts'",
);
export const roleAssignmentRecordSchema = type({
  userId: "'user-a' | 'user-b' | 'user-c'",
  targetRole: roleSchema,
});

export function parseRoleAssignment(
  value: unknown,
): ReturnType<typeof roleAssignmentRecordSchema> {
  return roleAssignmentRecordSchema(value);
}
