import { atom } from "jotai";
import type {
  AsyncStatus,
  Role,
} from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { AuditAction } from "../../../../shared/features/audit/domain/audit.js";

export const auditActionFilterAtom = atom<AuditAction | "all">("all");
export const auditActorRoleFilterAtom = atom<Role | "all">("all");
export const auditExportStatusAtom = atom<AsyncStatus>("idle");
