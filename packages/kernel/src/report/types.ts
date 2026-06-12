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
  trustLedger: ReportTrustLedger;
}
