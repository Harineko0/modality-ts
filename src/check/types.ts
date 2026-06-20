import type {
  ModelState,
  StateSpaceContributor,
  StepFacts,
  Trace,
  Transition,
} from "modality-ts/core";

/** How much of the state space was covered when this verdict was produced. */
export type VerificationBoundedness = "exhaustive" | "bounded";

export type PropertyVerdict =
  | {
      /** Property holds over the exhaustively explored state space. */
      status: "verified";
      property: string;
      boundedness: "exhaustive";
    }
  | {
      /** Property holds within the explored bounds but the exploration was truncated. */
      status: "verified-within-bounds";
      property: string;
      boundedness?: VerificationBoundedness;
    }
  | {
      status: "violated";
      property: string;
      trace: Trace;
      replayable?: boolean;
      replayBlockedReason?: string;
      boundedness?: VerificationBoundedness;
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

export interface PendingQueueDependency {
  varId: string;
  reasons: readonly string[];
  opIds?: readonly string[];
  continuations?: readonly string[];
}

export interface MountScopeDependency {
  varId: string;
  guardReads: readonly string[];
  retainedBecause: readonly string[];
}

export interface SliceSummary {
  index: number;
  properties: readonly string[];
  vars: number;
  transitions: number;
  states: number;
  edges: number;
  depth: number;
  mode?: "state" | "targetedStep" | "full";
  retainedBits?: number;
  prunedBits?: number;
  topContributors?: readonly StateSpaceContributor[];
  prunedTopContributors?: readonly StateSpaceContributor[];
  retainedSystemVars?: readonly string[];
  prunedSystemVars?: readonly string[];
  pendingQueueDependencies?: readonly PendingQueueDependency[];
  mountScopeDependencies?: readonly MountScopeDependency[];
}

export type EdgeRecordingMode =
  | "none"
  | "compact"
  | "reverse"
  | "full"
  | "property-specific";

export interface StorageDiagnostics {
  recordedEdges: number;
  storedStates: number;
  parentEntries: number;
  edgeRecordingMode: EdgeRecordingMode;
}

export interface HotPathDiagnostics {
  canonicalCache: boolean;
  transitionIndex: boolean;
  internalTransitionIndex: boolean;
}

export interface PartialOrderReductionDiagnostics {
  requested: boolean;
  enabled: boolean;
  skipped?: boolean;
  skipReason?: string;
  supportedPropertyKinds?: readonly string[];
  fullExplorationStates: number;
  reducedStates: number;
  fullEnabledTransitions: number;
  exploredTransitions: number;
  skippedTransitions: number;
  cycleFallbackStates: number;
  violationRerun?: boolean;
  reasonCounts: readonly { reason: string; count: number }[];
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
    phase?: string;
  };
  dominantVars?: readonly { varId: string; distinctValues: number }[];
  storage?: StorageDiagnostics;
  hotPath?: HotPathDiagnostics;
  partialOrderReduction?: PartialOrderReductionDiagnostics;
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
  partialOrderReduction?: boolean;
  maxStates?: number;
  maxEdges?: number;
  maxFrontier?: number;
  memoryGuard?: { maxHeapUsedBytes?: number };
  onProgress?: (snapshot: CheckProgress) => void;
  trackElapsed?: boolean;
}

export interface Parent {
  parent: string | null;
  transitionId: string | null;
}

export interface ReverseEdge {
  preCanon: string;
  postCanon: string;
}

export interface CompactEdge {
  preCanon: string;
  postCanon: string;
  transitionId: string;
  triggeredProperties: readonly string[];
}

export interface Edge {
  preCanon: string;
  postCanon: string;
  pre: ModelState;
  post: ModelState;
  transition: Transition;
  step: StepFacts;
}

export interface GraphRecording {
  mode: EdgeRecordingMode;
  compactEdges: CompactEdge[];
  reverseEdges: ReverseEdge[];
  fullEdges: Edge[];
}
