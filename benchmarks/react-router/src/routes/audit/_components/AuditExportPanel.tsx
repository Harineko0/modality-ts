import { useAtom, useAtomValue } from "jotai";
import {
  auditActionFilterAtom,
  auditActorRoleFilterAtom,
  auditExportStatusAtom,
} from "../../../features/audit/state/audit-atoms.js";
import { useAuditEvents } from "../../../features/audit/infra/audit-queries.js";
import { parseAuditExportRequest } from "../../../../shared/features/audit/domain/audit.ark.js";
import { AuditFilterBar } from "../../../features/audit/_components/AuditFilterBar.js";
import { permissionCacheAtom } from "../../../features/auth/state/session-atoms.js";
import { canExportAudit } from "../../../../shared/features/auth/application/auth-service.js";
import { api } from "../../../features/auth/infra/api.js";

export function AuditExportPanel() {
  const [action, setAction] = useAtom(auditActionFilterAtom);
  const [actorRole, setActorRole] = useAtom(auditActorRoleFilterAtom);
  const [exportStatus, setExportStatus] = useAtom(auditExportStatusAtom);
  const sessionCache = useAtomValue(permissionCacheAtom);
  const { data } = useAuditEvents(action, actorRole);
  const request = parseAuditExportRequest({
    actionFilter: action,
    actorRoleFilter: actorRole,
  });

  return (
    <section>
      <AuditFilterBar
        action={action}
        actorRole={actorRole}
        onActionChange={setAction}
        onActorRoleChange={setActorRole}
      />
      <button
        type="button"
        disabled={!sessionCache || !canExportAudit(sessionCache.role)}
        onClick={async () => {
          setExportStatus("submitting");
          await api.exportAudit({
            role: sessionCache?.role ?? "guest",
            request,
          });
          setExportStatus("success");
        }}
      >
        export button
      </button>
      <p>export status: {exportStatus}</p>
      <p>
        results bucket:{" "}
        {data && data.length > 2
          ? "many"
          : data && data.length > 0
            ? "some"
            : "empty"}
      </p>
    </section>
  );
}
