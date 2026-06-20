import type { Permission, Role } from "../../fixtures/domain/fixtures.js";

export const permissionsByRole = {
  guest: [],
  analyst: ["view_dashboard", "view_accounts", "view_audit"],
  manager: [
    "view_dashboard",
    "view_accounts",
    "manage_subscription",
    "approve_changes",
    "view_audit",
    "use_management_dashboard",
  ],
  admin: [
    "view_dashboard",
    "view_accounts",
    "manage_subscription",
    "manage_billing",
    "manage_payment_methods",
    "approve_changes",
    "view_audit",
    "export_audit",
    "manage_settings",
    "manage_rbac",
    "use_management_dashboard",
    "bulk_suspend_accounts",
  ],
} as const satisfies Record<Role, readonly Permission[]>;

export function permissionsForRole(role: Role): readonly Permission[] {
  return permissionsByRole[role];
}

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return permissionsByRole[role].includes(permission);
}
