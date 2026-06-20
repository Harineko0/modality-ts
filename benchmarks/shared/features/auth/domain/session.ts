import type { Role } from "../../fixtures/domain/fixtures.js";
import type { Permission } from "../../fixtures/domain/fixtures.js";

export type Session = {
  userId: string;
  email: string;
  role: Role;
};

export type LoginCredentials = {
  role: Role;
  email: string;
  password: string;
};

export type PermissionCache = {
  role: Role;
  permissions: readonly Permission[];
};

export type RoleAssignment = {
  userId: string;
  targetRole: Role;
};
