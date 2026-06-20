import type { AuditAction } from "../../../../shared/features/audit/domain/audit.js";
import type { Role } from "../../../../shared/features/fixtures/domain/fixtures.js";

type Props = {
  action: AuditAction | "all";
  actorRole: Role | "all";
  onActionChange: (action: AuditAction | "all") => void;
  onActorRoleChange: (role: Role | "all") => void;
};

export function AuditFilterBar({
  action,
  actorRole,
  onActionChange,
  onActorRoleChange,
}: Props) {
  return (
    <div>
      <label>
        action filter
        <select
          value={action}
          onChange={(e) =>
            onActionChange(e.target.value as AuditAction | "all")
          }
        >
          <option value="all">all</option>
          <option value="login">login</option>
          <option value="support_escalation">support_escalation</option>
        </select>
      </label>
      <label>
        actor role filter
        <select
          value={actorRole}
          onChange={(e) => onActorRoleChange(e.target.value as Role | "all")}
        >
          <option value="all">all</option>
          <option value="analyst">analyst</option>
          <option value="manager">manager</option>
          <option value="admin">admin</option>
        </select>
      </label>
    </div>
  );
}
