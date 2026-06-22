import { authenticate } from "../application/auth-service.js";
import type {
  LoginCredentials,
  PermissionCache,
  RoleAssignment,
  Session,
} from "../domain/session.js";

export type LoginEffectResult =
  | { status: "success"; session: Session; permissions: PermissionCache }
  | { status: "error"; code: "invalid_credentials" | "guest_login_blocked" };

export async function login(
  credentials: LoginCredentials,
): Promise<LoginEffectResult> {
  const result = authenticate(credentials);
  if (!result.ok) {
    return { status: "error", code: result.reason };
  }
  return {
    status: "success",
    session: result.session,
    permissions: result.permissions,
  };
}

export async function refreshSession(
  session: Session,
): Promise<{ session: Session; permissions: PermissionCache }> {
  const result = authenticate({
    role: session.role,
    email: session.email,
    password: "ledger-pass",
  });
  if (!result.ok) {
    throw new Error("refresh failed");
  }
  return {
    session: result.session,
    permissions: result.permissions,
  };
}

export async function saveRoleAssignment(
  assignment: RoleAssignment,
): Promise<{ assignment: RoleAssignment; savedAt: string }> {
  return { assignment, savedAt: "2026-06-21T00:00:00.000Z" };
}
