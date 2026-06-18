import type {
  CheckReport,
  ExtractionCaveat,
  ExtractionReport,
} from "modality-ts/core";
import type { AcceptedCaveatRef, CaveatGateOutcome } from "./types.js";

export interface ReportCaveat {
  kind: string;
  id: string;
  severity?: string;
  producer?: string;
}

export function evaluateAcceptedCaveats(input: {
  extractionReport: ExtractionReport;
  checkReport?: CheckReport;
  acceptedCaveats: readonly AcceptedCaveatRef[];
  knownUnsupported?: readonly string[];
  allowUnaccepted?: boolean;
}): CaveatGateOutcome {
  const observed = collectReportCaveats(
    input.extractionReport,
    input.checkReport,
  );
  const acceptedKeys = new Set<string>();
  const acceptedCaveats: string[] = [];
  const unacceptedCaveats: string[] = [];
  const missingRequiredCaveats: string[] = [];

  for (const caveat of observed) {
    const key = caveatIdentity(caveat);
    const accepted = input.acceptedCaveats.some((entry) =>
      matchesAcceptedCaveat(caveat, entry),
    );
    const knownUnsupported = (input.knownUnsupported ?? []).some(
      (entry) => entry === key || entry === `${caveat.kind}:${caveat.id}`,
    );
    if (accepted || knownUnsupported) {
      acceptedCaveats.push(key);
      acceptedKeys.add(key);
      continue;
    }
    if (!input.allowUnaccepted) {
      unacceptedCaveats.push(key);
    }
  }

  for (const accepted of input.acceptedCaveats) {
    if (!accepted.mustRemain) continue;
    const key = caveatIdentity(accepted);
    if (!acceptedKeys.has(key)) {
      missingRequiredCaveats.push(key);
    }
  }

  const status =
    unacceptedCaveats.length > 0 || missingRequiredCaveats.length > 0
      ? "fail"
      : "pass";

  return {
    status,
    acceptedCaveats,
    unacceptedCaveats,
    missingRequiredCaveats,
  };
}

export function collectReportCaveats(
  extractionReport: ExtractionReport,
  checkReport?: CheckReport,
): ReportCaveat[] {
  const caveats: ReportCaveat[] = [];
  const push = (entries: readonly ExtractionCaveat[]) => {
    for (const entry of entries) {
      caveats.push({
        kind: entry.kind,
        id: entry.id,
        severity: entry.severity,
      });
    }
  };

  push(extractionReport.globalTaints);
  push(extractionReport.staleReads);
  push(extractionReport.unhandledRejections);

  if (checkReport) {
    push(checkReport.trustLedger.globalTaints);
    push(checkReport.trustLedger.staleReads);
    push(checkReport.trustLedger.unhandledRejections);
    push(checkReport.trustLedger.unextractableHandlers);
  }

  return dedupeCaveats(caveats);
}

export function matchesAcceptedCaveat(
  caveat: ReportCaveat,
  accepted: AcceptedCaveatRef,
): boolean {
  if (caveat.kind !== accepted.kind || caveat.id !== accepted.id) {
    return false;
  }
  if (
    accepted.severity !== undefined &&
    caveat.severity !== accepted.severity
  ) {
    return false;
  }
  if (
    accepted.producer !== undefined &&
    caveat.producer !== accepted.producer
  ) {
    return false;
  }
  return true;
}

export function caveatIdentity(caveat: { kind: string; id: string }): string {
  return `${caveat.kind}:${caveat.id}`;
}

function dedupeCaveats(caveats: readonly ReportCaveat[]): ReportCaveat[] {
  const seen = new Set<string>();
  const unique: ReportCaveat[] = [];
  for (const caveat of caveats) {
    const key = caveatIdentity(caveat);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(caveat);
  }
  return unique;
}
