import { always, eq, group } from "modality-ts/properties";
import { auditExportStatusAtom } from "../../features/audit/state/audit-atoms.modals";
group("auth", () => {
  always("p", eq(auditExportStatusAtom, "idle"));
});
