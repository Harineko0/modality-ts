import { useSetAtom } from "jotai";
import {
  auditActionFilterAtom,
  auditActorRoleFilterAtom,
  auditExportStatusAtom,
} from "../state/audit-atoms.js";

export function useAuditActions() {
  const setAction = useSetAtom(auditActionFilterAtom);
  const setActorRole = useSetAtom(auditActorRoleFilterAtom);
  const setExportStatus = useSetAtom(auditExportStatusAtom);
  return { setAction, setActorRole, setExportStatus };
}
