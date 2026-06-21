export { exportAudit } from "../../../../shared/features/audit/infra/fake-audit-api.js";
import useSWR from "swr";
import { loadAuditEvents } from "../../../../shared/features/audit/infra/fake-audit-api.js";
import type { Role } from "../../../../shared/features/fixtures/domain/fixtures.js";
import type { AuditAction } from "../../../../shared/features/audit/domain/audit.js";

export function useAuditEvents(
  action: AuditAction | "all",
  actorRole: Role | "all",
) {
  return useSWR(["audit", action, actorRole], () =>
    loadAuditEvents({ actionFilter: action, actorRoleFilter: actorRole }),
  );
}
