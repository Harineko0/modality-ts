import type { Bounds } from "../ir/types.js";
import type { PluginProvenance } from "../ir/types.js";
import type { Trace } from "../trace/types.js";

export interface ReportTrustLedger {
  bounds: Bounds;
  plugins: readonly PluginProvenance[];
  assumptions: readonly string[];
  abstractions: readonly string[];
  globalTaints: readonly ExtractionCaveat[];
  staleReads: readonly ExtractionCaveat[];
  unhandledRejections: readonly ExtractionCaveat[];
  unextractableHandlers: readonly ExtractionCaveat[];
  domains: readonly DomainReportEntry[];
  manualTransitions: readonly string[];
  overApproxTransitions: readonly string[];
  boundHits: readonly string[];
  ignoredVars: readonly string[];
}

export interface DomainReportEntry {
  varId: string;
  domainKind: string;
  provenance:
    | "type-derived"
    | "default-token"
    | "overlay-refined"
    | "template"
    | "system";
}

export interface ExtractionCaveat {
  id: string;
  reason: string;
  source?: string;
}

export type ReportVerdictStatus =
  | "verified-within-bounds"
  | "violated"
  | "reachable"
  | "vacuous-warning"
  | "error";

export interface ReportPropertyVerdict {
  property: string;
  status: ReportVerdictStatus;
  message?: string;
  trace?: Trace;
  replayable?: boolean;
  replayBlockedReason?: string;
}

export interface CheckReportDiagnostics {
  slicing?: {
    enabled: boolean;
    slices?: number;
    skipped?: boolean;
    skipReason?: string;
    sliceSummaries?: readonly {
      index: number;
      properties: readonly string[];
      vars: number;
      transitions: number;
      states: number;
      edges: number;
      depth: number;
    }[];
  };
  search?: {
    maxFrontier: number;
    finalFrontier: number;
    expandedDepths: number;
    elapsedMs?: number;
  };
  limits?: {
    reason: string;
    maxStates?: number;
    maxEdges?: number;
    maxFrontier?: number;
    memoryGuardBytes?: number;
  };
  dominantVars?: readonly { varId: string; distinctValues: number }[];
}

export interface CheckReport {
  schemaVersion: 1;
  kind: "check-report";
  modelId: string;
  generatedAt: string;
  verdicts: readonly ReportPropertyVerdict[];
  stats: {
    states: number;
    edges: number;
    depth: number;
  };
  vacuityWarnings: readonly string[];
  diagnostics?: CheckReportDiagnostics;
  trustLedger: ReportTrustLedger;
}

export type ReplayVerdictStatus =
  | "reproduced"
  | "not-reproduced"
  | "inconclusive";

export interface ReplayReport {
  schemaVersion: 1;
  kind: "replay-report";
  generatedAt: string;
  mode?: "abstract" | "action";
  harnessPath?: string;
  verdict: {
    status: ReplayVerdictStatus;
    stepsRun: number;
    divergenceStep?: number;
    reason?: string;
  };
}

export interface StateSpaceContributor {
  varId: string;
  domainKind: string;
  bits: number;
  scope: string;
  origin: string;
}

export interface StateSpaceContributors {
  totalBits: number;
  topVars: readonly StateSpaceContributor[];
  bySource: readonly { source: string; bits: number }[];
}

export interface ExtractionReport {
  schemaVersion: 1;
  kind: "extraction-report";
  generatedAt: string;
  sourceFiles: readonly string[];
  plugins: readonly PluginProvenance[];
  handlers: readonly {
    id: string;
    classification: "exact" | "over-approx" | "unextractable" | "overlay";
    reasons: readonly string[];
  }[];
  globalTaints: readonly ExtractionCaveat[];
  staleReads: readonly ExtractionCaveat[];
  unhandledRejections: readonly ExtractionCaveat[];
  domains: readonly DomainReportEntry[];
  stateContributors?: StateSpaceContributors;
  coverage: {
    handlersTotal: number;
    exactOrOverlay: number;
    unextractable: number;
    ignoredVars: number;
    percentExactOrOverlay: number;
  };
  warnings: readonly string[];
}

export interface ConformReport {
  schemaVersion: 1;
  kind: "conform-report";
  generatedAt: string;
  mode?: "abstract" | "action";
  harnessPath?: string;
  walks: readonly {
    id: string;
    status: ReplayVerdictStatus;
    stepsRun: number;
    divergenceStep?: number;
    reason?: string;
  }[];
  metrics: {
    total: number;
    reproduced: number;
    notReproduced: number;
    inconclusive: number;
    passRate: number;
  };
  transitionMetrics: readonly {
    transitionId: string;
    walks: number;
    reproduced: number;
    notReproduced: number;
    inconclusive: number;
    passRate: number;
  }[];
}
