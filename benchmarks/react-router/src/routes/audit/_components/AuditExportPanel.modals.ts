import type { TransitionRef } from "modality-ts/properties";

export const AuditExportPanel = {
  // transitions
  onClick: {
    "export button":
      "AuditExportPanel.onClick.export button" as TransitionRef<"AuditExportPanel.onClick.export button">,
  },
};
