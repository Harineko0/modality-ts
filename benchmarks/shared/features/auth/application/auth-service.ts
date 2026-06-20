import { permissionsForRole, roleHasPermission } from "../domain/rbac.js";
import { loginFormSchema } from "../domain/session.schema.js";
import type {
  LoginCredentials,
  PermissionCache,
  RoleAssignment,
  Session,
} from "../domain/session.js";
import type { Role } from "../../fixtures/domain/fixtures.js";
import { seedSessions } from "../../fixtures/domain/fixtures.js";

export type AuthResult =
  | { ok: true; session: Session; permissions: PermissionCache }
  | { ok: false; reason: "invalid_credentials" | "guest_login_blocked" };

export function validateLoginInput(input: unknown): LoginCredentials | null {
  const parsed = loginFormSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function authenticate(credentials: LoginCredentials): AuthResult {
  if (credentials.role === "guest") {
    return { ok: false, reason: "guest_login_blocked" };
  }
  if (credentials.password !== "ledger-pass") {
    return { ok: false, reason: "invalid_credentials" };
  }
  const session = seedSessions[credentials.role];
  return {
    ok: true,
    session,
    permissions: {
      role: session.role,
      permissions: permissionsForRole(session.role),
    },
  };
}

export function canAssignRole(
  actorRole: Role,
  _assignment: RoleAssignment,
): boolean {
  return roleHasPermission(actorRole, "manage_rbac");
}

export function canExportAudit(role: Role): boolean {
  return roleHasPermission(role, "export_audit");
}
