import type { ReportGateStatus } from "modality-ts/core";

export interface SharedThresholds {
  minCoverageExactOrOverlay?: number;
  maxUnextractable?: number;
  maxGlobalTaints?: number;
  maxUnhandledRejections?: number;
  maxStaleReads?: number;
  minRouteCoverage?: number;
  minConformPassRate?: number;
  minTransitionPassRate?: number;
}

export interface SharedBudgets {
  maxStates?: number;
  maxEdges?: number;
  maxDepth?: number;
  maxFrontier?: number;
  maxDominantVarValues?: number;
  maxStateSpaceBits?: number;
  maxTopContributorBits?: number;
  maxPendingQueueLen?: number;
  maxBoundHits?: number;
}

export interface AcceptedCaveatRef {
  id: string;
  kind: string;
  severity?: string;
  producer?: string;
  mustRemain?: boolean;
}

export interface GateThresholdResult {
  id: string;
  status: ReportGateStatus;
  expected?: number;
  actual?: number;
  evidence?: readonly string[];
  message?: string;
}

export interface GateBudgetResult {
  id: string;
  status: ReportGateStatus;
  maxStates?: number;
  actualStates?: number;
  maxEdges?: number;
  actualEdges?: number;
  maxFrontier?: number;
  actualFrontier?: number;
  maxDepth?: number;
  actualDepth?: number;
  expected?: number;
  actual?: number;
  evidence?: readonly string[];
  message?: string;
}

export interface CaveatGateOutcome {
  status: ReportGateStatus;
  acceptedCaveats: readonly string[];
  unacceptedCaveats: readonly string[];
  missingRequiredCaveats: readonly string[];
}
