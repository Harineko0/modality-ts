import type {
  ModelState,
  StepFacts,
  Trace,
  Transition,
} from "modality-ts/core";

export type PropertyVerdict =
  | { status: "verified-within-bounds"; property: string }
  | {
      status: "violated";
      property: string;
      trace: Trace;
      replayable?: boolean;
      replayBlockedReason?: string;
    }
  | {
      status: "reachable";
      property: string;
      trace: Trace;
      replayable?: boolean;
      replayBlockedReason?: string;
    }
  | { status: "vacuous-warning"; property: string; message: string }
  | { status: "error"; property: string; message: string };

export interface CheckProgress {
  depth: number;
  frontier: number;
  nextFrontier: number;
  states: number;
  edges: number;
}

export interface SliceSummary {
  index: number;
  properties: readonly string[];
  vars: number;
  transitions: number;
  states: number;
  edges: number;
  depth: number;
}

export interface CheckDiagnostics {
  slicing?: {
    enabled: boolean;
    slices?: number;
    skipped?: boolean;
    skipReason?: string;
    sliceSummaries?: readonly SliceSummary[];
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

export interface CheckResult {
  verdicts: PropertyVerdict[];
  stats: { states: number; edges: number; depth: number };
  vacuityWarnings: string[];
  boundHits: string[];
  diagnostics?: CheckDiagnostics;
}

export interface CheckOptions {
  slicing?: boolean;
  slicedModel?: boolean;
  maxStates?: number;
  maxEdges?: number;
  maxFrontier?: number;
  memoryGuard?: { maxHeapUsedBytes?: number };
  onProgress?: (snapshot: CheckProgress) => void;
  trackElapsed?: boolean;
}

export interface Parent {
  parent: string | null;
  transition: Transition | null;
  pre: ModelState | null;
  post: ModelState;
}

export interface Edge {
  preCanon: string;
  postCanon: string;
  pre: ModelState;
  post: ModelState;
  transition: Transition;
  step: StepFacts;
}
