import { atom } from "jotai";
import type {
  PermissionCache,
  Session,
} from "../../../../shared/features/auth/domain/session.js";
import type {
  AsyncStatus,
  Role,
} from "../../../../shared/features/fixtures/domain/fixtures.js";

export const sessionAtom = atom<Session | null>(null);
export const permissionCacheAtom = atom<PermissionCache | null>(null);
export const returnToAtom = atom<string>("/settings/rbac");
export const loginStatusAtom = atom<AsyncStatus>("idle");
export const targetRoleAtom = atom<Role>("analyst");
export const roleSaveStatusAtom = atom<AsyncStatus>("idle");
