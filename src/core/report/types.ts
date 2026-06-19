import type {
  Bounds,
  ExtractionCaveat,
  FieldPruningEntry,
  FieldPruningMetadata,
  NumericReduction,
  PluginProvenance,
} from "../ir/types.js";
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
  modelSlack: readonly ExtractionCaveat[];
  domains: readonly DomainReportEntry[];
  manualTransitions: readonly string[];
  overApproxTransitions: readonly string[];
  boundHits: readonly string[];
  ignoredVars: readonly string[];
  numericReductions: readonly NumericReduction[];
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

export type { ExtractionCaveat, FieldPruningEntry, FieldPruningMetadata };

export type ReportVerdictStatus =
  | "verified-within-bounds"
  | "violated"
  | "reachable"
  | "vacuous-warning"
  | "error";

export type ReportPropertyConfidenceLevel =
  | "exact"
  | "property-preserving"
  | "over-approx"
  | "manual"
  | "bounded"
  | "heuristic";

export interface ReportPropertyConfidence {
  level: ReportPropertyConfidenceLevel;
  reasons: readonly string[];
  caveatIds: readonly string[];
  affectedTransitions: readonly string[];
  affectedVars: readonly string[];
}

export interface ReportPropertyVerdict {
  property: string;
  status: ReportVerdictStatus;
  message?: string;
  trace?: Trace;
  replayable?: boolean;
  replayBlockedReason?: string;
  confidence?: ReportPropertyConfidence;
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
      mode?: "state" | "targetedStep" | "full";
      retainedBits?: number;
      prunedBits?: number;
      topContributors?: readonly StateSpaceContributor[];
      prunedTopContributors?: readonly StateSpaceContributor[];
      retainedSystemVars?: readonly string[];
      prunedSystemVars?: readonly string[];
      pendingQueueDependencies?: readonly {
        varId: string;
        reasons: readonly string[];
        opIds?: readonly string[];
        continuations?: readonly string[];
      }[];
      mountScopeDependencies?: readonly {
        varId: string;
        guardReads: readonly string[];
        retainedBecause: readonly string[];
      }[];
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
  prunedFieldPaths?: readonly string[][];
}

export interface StateSpaceContributors {
  totalBits: number;
  topVars: readonly StateSpaceContributor[];
  bySource: readonly { source: string; bits: number }[];
}

export type RouteCoverageClassification =
  | "api"
  | "redirect-only"
  | "no-client-state"
  | "unsupported";

export interface RouteCoverageEntry {
  pattern: string;
  modeled: boolean;
  classification?: RouteCoverageClassification;
  reason?: string;
}

export interface RouteCoverage {
  configured: number;
  modeled: number;
  routes: readonly RouteCoverageEntry[];
}

export interface ExtractionPhaseTiming {
  id: string;
  label: string;
  elapsedMs: number;
}

export interface ExtractionSurfaceDiagnostics {
  rawEntries: number;
  reachableSources: number;
  includedSources: number;
  interactionSources: number;
  reportedSources: number;
  expandedSourceFiles?: readonly string[];
}

export interface ExtractionPipelineDiagnostics {
  discoveryFragments: number;
  relatedFragments: number;
  semanticProjectSourceFiles: number;
}

export interface PropertySliceManifestMountScopeDependency {
  varId: string;
  guardReads: readonly string[];
  retainedBecause: readonly string[];
}

export interface PropertySliceManifestPendingQueueDependency {
  varId: string;
  reasons: readonly string[];
  opIds?: readonly string[];
  continuations?: readonly string[];
}

export type PropertySliceManifestEntry =
  | {
      property: string;
      propertyIndex: number;
      status: "emitted";
      mode: "state" | "targetedStep" | "full";
      path: string;
      vars: number;
      transitions: number;
      varIds: readonly string[];
      transitionIds: readonly string[];
      retainedBits: number;
      prunedBits: number;
      topContributors: readonly StateSpaceContributor[];
      prunedTopContributors: readonly StateSpaceContributor[];
      retainedSystemVars: readonly string[];
      prunedSystemVars: readonly string[];
      pendingQueueDependencies?: readonly PropertySliceManifestPendingQueueDependency[];
      mountScopeDependencies?: readonly PropertySliceManifestMountScopeDependency[];
      closureFallback?: string;
      sliceKey: string;
    }
  | {
      property: string;
      propertyIndex: number;
      status: "skipped";
      reason: string;
    };

export interface PropertySliceManifest {
  schemaVersion: 1;
  kind: "property-slice-manifest";
  modelId: string;
  sourceModelPath: string;
  sourceModelHash: string;
  generatedAt: string;
  properties: readonly PropertySliceManifestEntry[];
}

export interface ExtractionPropertySliceDiagnosticsEntry {
  property: string;
  propertyIndex: number;
  status: "emitted" | "skipped";
  mode?: "state" | "targetedStep" | "full";
  path?: string;
  vars?: number;
  transitions?: number;
  retainedBits?: number;
  prunedBits?: number;
  sliceKey?: string;
  reason?: string;
}

export interface ExtractionPropertySliceDiagnostics {
  manifestPath: string;
  properties: number;
  emitted: number;
  skipped: number;
  slices: number;
  entries?: readonly ExtractionPropertySliceDiagnosticsEntry[];
}

export interface ExtractionDiagnostics {
  phaseTimings: readonly ExtractionPhaseTiming[];
  surface: ExtractionSurfaceDiagnostics;
  pipeline?: ExtractionPipelineDiagnostics;
  propertySlices?: ExtractionPropertySliceDiagnostics;
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
  modelSlack: readonly ExtractionCaveat[];
  domains: readonly DomainReportEntry[];
  coarseDomains?: readonly { varId: string; paths: readonly string[] }[];
  fieldPruning?: FieldPruningMetadata;
  stateContributors?: StateSpaceContributors;
  routeCoverage?: RouteCoverage;
  coverage: {
    handlersTotal: number;
    exactOrOverlay: number;
    unextractable: number;
    ignoredVars: number;
    percentExactOrOverlay: number;
  };
  warnings: readonly string[];
  assumptions?: readonly string[];
  numericReductions?: readonly NumericReduction[];
  effectOperations?: readonly {
    opId: string;
    source?: string;
    line?: number;
    column?: number;
    origin: "source" | "config" | "option";
  }[];
  diagnostics?: ExtractionDiagnostics;
}

export type CanaryFailureCategory =
  | "missing-semantic-abstraction"
  | "missing-adapter-capability"
  | "syntax-recognition-gap"
  | "incorrect-ir-or-checker"
  | "state-space-budget"
  | "environment-or-project-integration"
  | "explicit-unsupported-behavior"
  | "fixture-or-canary-invalid";

export interface CanaryFailureClassification {
  canaryId: string;
  fixtureId?: string;
  category: CanaryFailureCategory;
  severity: "blocker" | "action-required" | "accepted";
  evidence: readonly string[];
  suggestedPlanFamily: string;
}

export type ReportGateStatus = "pass" | "fail" | "skipped";

export interface ReportThresholdResult {
  id: string;
  status: ReportGateStatus;
  expected?: number;
  actual?: number;
  evidence?: readonly string[];
  message?: string;
}

export interface ReportStateSpaceBudgetResult {
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

export type ReportResultStatus = "pass" | "fail" | "skipped" | "error";

export interface ConformanceFixtureResult {
  fixtureId: string;
  status: ReportResultStatus;
  featureIds: readonly string[];
  targetIds: readonly string[];
  thresholds?: readonly ReportThresholdResult[];
  budgets?: readonly ReportStateSpaceBudgetResult[];
  acceptedCaveats?: readonly string[];
  unacceptedCaveats?: readonly string[];
  reportPaths?: Readonly<Record<string, string>>;
}

export interface ConformanceMatrixReport {
  schemaVersion: 1;
  kind: "conformance-matrix-report";
  generatedAt: string;
  matrixId: string;
  fixtureResults: readonly ConformanceFixtureResult[];
  thresholdResults?: readonly ReportThresholdResult[];
  budgetResults?: readonly ReportStateSpaceBudgetResult[];
  acceptedCaveats?: readonly string[];
  unacceptedCaveats?: readonly string[];
  classifications?: readonly CanaryFailureClassification[];
  reportPath?: string;
}

export interface CanaryResult {
  canaryId: string;
  status: ReportResultStatus;
  thresholds?: readonly ReportThresholdResult[];
  budgets?: readonly ReportStateSpaceBudgetResult[];
  acceptedCaveats?: readonly string[];
  unacceptedCaveats?: readonly string[];
  reportPaths?: Readonly<Record<string, string>>;
}

export interface CanaryRunReport {
  schemaVersion: 1;
  kind: "canary-run-report";
  generatedAt: string;
  manifestId: string;
  canaryResults: readonly CanaryResult[];
  thresholdResults?: readonly ReportThresholdResult[];
  budgetResults?: readonly ReportStateSpaceBudgetResult[];
  acceptedCaveats?: readonly string[];
  unacceptedCaveats?: readonly string[];
  classifications: readonly CanaryFailureClassification[];
  reportPath?: string;
}

export interface ConformReport {
  schemaVersion: 1;
  kind: "conform-report";
  generatedAt: string;
  mode?: "abstract" | "action";
  harnessPath?: string;
  fixtureId?: string;
  featureIds?: readonly string[];
  targetIds?: readonly string[];
  thresholds?: {
    minPassRate?: number;
    minTransitionPassRate?: number;
  };
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
