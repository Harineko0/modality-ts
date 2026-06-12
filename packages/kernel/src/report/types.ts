import type { Bounds } from "../ir/types.js";
import type { Trace } from "../trace/types.js";

export interface ReportTrustLedger {
  bounds: Bounds;
  assumptions: readonly string[];
  abstractions: readonly string[];
  manualTransitions: readonly string[];
  overApproxTransitions: readonly string[];
  boundHits: readonly string[];
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
  trustLedger: ReportTrustLedger;
}

export type ReplayVerdictStatus = "reproduced" | "not-reproduced" | "inconclusive";

export interface ReplayReport {
  schemaVersion: 1;
  kind: "replay-report";
  generatedAt: string;
  verdict: {
    status: ReplayVerdictStatus;
    stepsRun: number;
    divergenceStep?: number;
    reason?: string;
  };
}

export interface ExtractionReport {
  schemaVersion: 1;
  kind: "extraction-report";
  generatedAt: string;
  sourceFiles: readonly string[];
  handlers: readonly {
    id: string;
    classification: "exact" | "over-approx" | "unextractable" | "overlay";
    reasons: readonly string[];
  }[];
  domains: readonly {
    varId: string;
    domainKind: string;
    provenance: "type-derived" | "default-token" | "template" | "system";
  }[];
  warnings: readonly string[];
}

export interface ConformReport {
  schemaVersion: 1;
  kind: "conform-report";
  generatedAt: string;
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
}
