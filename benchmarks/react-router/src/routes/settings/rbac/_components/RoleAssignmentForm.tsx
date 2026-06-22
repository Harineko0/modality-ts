import { useAtom, useAtomValue } from "jotai";
import { canAssignRole } from "../../../../../shared/features/auth/application/auth-service.js";
import { permissionsForRole } from "../../../../../shared/features/auth/domain/rbac.js";
import { parseRoleAssignment } from "../../../../../shared/features/auth/domain/session.ark.js";
import { roleAssignmentSchema } from "../../../../../shared/features/auth/domain/session.schema.js";
import { api } from "../../../../features/auth/infra/api.js";
import {
  permissionCacheAtom,
  roleSaveStatusAtom,
  targetRoleAtom,
} from "../../../../features/auth/state/session-atoms.js";
import { useRoleAssignments } from "../../../../features/settings/infra/settings-queries.js";

export function RoleAssignmentForm() {
  const [targetRole, setTargetRole] = useAtom(targetRoleAtom);
  const [roleSaveStatus, setRoleSaveStatus] = useAtom(roleSaveStatusAtom);
  const permissionCache = useAtomValue(permissionCacheAtom);
  const sessionRole = permissionCache?.role ?? "guest";
  useRoleAssignments();
  const preview = permissionsForRole(targetRole);

  return (
    <section>
      <label>
        user selector
        <select defaultValue="user-a">
          <option value="user-a">user-a</option>
          <option value="user-b">user-b</option>
          <option value="user-c">user-c</option>
        </select>
      </label>
      <label>
        target role selector
        <select
          value={targetRole}
          onChange={(e) => setTargetRole(e.target.value as typeof targetRole)}
        >
          <option value="analyst">analyst</option>
          <option value="manager">manager</option>
          <option value="admin">admin</option>
        </select>
      </label>
      <p>permission preview: {preview.join(", ")}</p>
      {permissionCache && permissionCache.role !== sessionRole ? (
        <div>stale cache warning</div>
      ) : null}
      <button
        type="button"
        disabled={!canAssignRole(sessionRole, { userId: "user-a", targetRole })}
        onClick={async () => {
          const parsed = roleAssignmentSchema.safeParse({
            userId: "user-a",
            targetRole,
          });
          if (!parsed.success) return;
          parseRoleAssignment(parsed.data);
          setRoleSaveStatus("submitting");
          await api.saveRoleAssignment(parsed.data);
          setRoleSaveStatus("success");
        }}
      >
        save role assignment button
      </button>
      <p>role save status: {roleSaveStatus}</p>
    </section>
  );
}
