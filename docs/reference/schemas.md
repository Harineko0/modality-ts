---
id: schemas
title: Artifact schemas
sidebar_label: Schemas
---

The three artifacts that flow between [feature slices](../architecture/index.md). All
carry `schemaVersion: 1`; a reader rejects a newer major version with a "re-run extract"
message. Types live in `src/core/`.

## `model.json` — the model

```ts
interface Model {
  schemaVersion: 1;
  id: string;
  vars: StateVarDecl[];          // id, domain, origin, scope, initial
  transitions: Transition[];     // id, cls, label, guard, effect, reads, writes, confidence, …
  bounds: { maxDepth; maxPending; maxInternalSteps };
  metadata?: {
    sourceHashes?: Record<string, string>;       // staleness detection
    plugins?: PluginProvenance[];                 // id + version + kind + packageNames
    domainProvenance?: Record<string, "overlay-refined">;
    extractionCaveats?: { entries: ExtractionCaveat[] };
    numericReductions?: { entries: NumericReduction[] };
    fieldPruning?: FieldPruningMetadata;
  };
}

interface FieldPruningEntry {
  varId: string;
  keptPaths: string[][];
  prunedPaths: string[][];
  reason: "unread" | "property-unrelated" | "bounded-record";
  source?: SourceAnchor;
  confidence: "exact" | "over-approx";
}

interface FieldPruningMetadata {
  entries: FieldPruningEntry[];
}
```

`PluginProvenance.kind` distinguishes active adapter capabilities:

| Kind | Provider |
| --- | --- |
| `navigation` | active `NavigationAdapter` |
| `module-roles` | `ModuleRoleAdapter` |
| `effect-api` | `EffectApiProvider` |
| `cache-storage` | `CacheStorageProvider` |
| `observation` | synthesized `ObservationProvider` |
| `state-source` | `StateSourcePlugin` |
| `domain-refinement` | `DomainRefinementProvider` |

A `Transition` is `{ id, cls, label, source, guard, effect, reads, writes, confidence,
triggeredBy?, phase? }`. See the [IR](../architecture/ir.md) and
[Transitions](../concepts/transitions.md). Serialization is canonically ordered so the
diff is reviewable in a pull request.

## `trace.json` — a counterexample

```ts
interface TraceArtifact {
  schemaVersion: 1;
  kind: "trace";
  steps: TraceStep[];
}

interface TraceStep {
  transitionId: string;
  label: EventLabel;
  pre: ModelState;
  post: ModelState;
  diff: Record<string, { before: Value | undefined; after: Value | undefined }>;
}
```

Each step carries the [event label](../architecture/ir.md#event-labels-the-replay-contract)
needed to drive the real app during [replay](../guides/debugging-counterexamples.md).

## `report.json` — a check report

```ts
interface CheckReport {
  schemaVersion: 1;
  kind: "check-report";
  modelId: string;
  generatedAt: string;
  verdicts: ReportPropertyVerdict[];
  stats: { states: number; edges: number; depth: number };
  vacuityWarnings: string[];
  diagnostics?: CheckReportDiagnostics;   // slicing, search, limits, dominantVars
  trustLedger: ReportTrustLedger;
}

type ReportVerdictStatus =
  | "verified-within-bounds" | "violated" | "reachable" | "vacuous-warning" | "error";

interface ReportPropertyVerdict {
  property: string;
  status: ReportVerdictStatus;
  message?: string;
  trace?: Trace;
  replayable?: boolean;
  replayBlockedReason?: string;
  confidence?: ReportPropertyConfidence;
}

type ReportPropertyConfidenceLevel =
  | "exact" | "property-preserving" | "over-approx"
  | "manual" | "bounded" | "heuristic";

interface ReportPropertyConfidence {
  level: ReportPropertyConfidenceLevel;
  reasons: string[];
  caveatIds: string[];
  affectedTransitions: string[];
  affectedVars: string[];
}
```

### The trust ledger field

```ts
interface ReportTrustLedger {
  bounds; plugins; assumptions; abstractions;
  globalTaints; staleReads; unhandledRejections; unextractableHandlers;
  modelSlack;                    // typed caveats for wide domains, field pruning, etc.
  domains;                       // per-var kind + provenance
  manualTransitions; overApproxTransitions;
  boundHits;                     // which bounds actually bit this run
  ignoredVars;
  numericReductions;             // each with a soundness claim
}
```

`boundHits` lists bounds that **actually bit** during the run (for example
`maxPending reached`, token exhaustion). Configured bounds in `model.bounds` that
never bound are omitted — they are assumptions, not events.

### Check diagnostics (`diagnostics`)

```ts
interface CheckReportDiagnostics {
  slicing?: {
    enabled: boolean;
    slices?: number;
    skipped?: boolean;
    skipReason?: string;
    sliceSummaries?: {
      index: number;
      properties: string[];
      vars: number;
      transitions: number;
      states: number;
      edges: number;
      depth: number;
      mode?: "state" | "targetedStep" | "full";
      retainedBits?: number;
      prunedBits?: number;
      topContributors?: StateSpaceContributor[];
      prunedTopContributors?: StateSpaceContributor[];
      retainedSystemVars?: string[];
      prunedSystemVars?: string[];
      pendingQueueDependencies?: {
        varId: string;
        reasons: string[];
        opIds?: string[];
        continuations?: string[];
      }[];
      mountScopeDependencies?: {
        varId: string;
        guardReads: string[];
        retainedBecause: string[];
      }[];
    }[];
  };
  search?: { maxFrontier; finalFrontier; expandedDepths; elapsedMs? };
  limits?: { reason; maxStates?; maxEdges?; maxFrontier?; memoryGuardBytes? };
  dominantVars?: { varId: string; distinctValues: number }[];
}

interface StateSpaceContributor {
  varId: string;
  domainKind: string;
  bits: number;                  // log₂(domain cardinality), rounded
  scope: string;                 // "global" or "mount:<id>"
  origin: string;
  prunedFieldPaths?: string[][];
}
```

See [The trust ledger](../soundness/trust-ledger.md). Slice economics and
confidence output are documented in
[Diagnostics & search limits](../guides/diagnostics-and-search-limits.md).

## `extraction-report.json`

Emitted by `modality extract`:

```ts
interface ExtractionReport {
  schemaVersion: 1;
  kind: "extraction-report";
  generatedAt: string;
  sourceFiles: string[];
  plugins: PluginProvenance[];
  handlers: {
    id: string;
    classification: "exact" | "over-approx" | "unextractable" | "overlay";
    reasons: string[];
  }[];
  globalTaints: ExtractionCaveat[];
  staleReads: ExtractionCaveat[];
  unhandledRejections: ExtractionCaveat[];
  modelSlack: ExtractionCaveat[];
  domains: DomainReportEntry[];
  coarseDomains?: { varId: string; paths: string[] }[];
  fieldPruning?: FieldPruningMetadata;
  stateContributors?: StateSpaceContributors;
  routeCoverage?: RouteCoverage;
  coverage: {
    handlersTotal; exactOrOverlay; unextractable; ignoredVars;
    percentExactOrOverlay;
  };
  warnings: string[];            // human-readable mirror of structured caveats
  assumptions?: string[];
  numericReductions?: NumericReduction[];
  effectOperations?: { opId; source?; line?; column?; origin }[];
}

interface StateSpaceContributors {
  totalBits: number;
  topVars: StateSpaceContributor[];
  bySource: { source: string; bits: number }[];
}
```

Structured caveats in `globalTaints`, `modelSlack`, and related arrays are the
machine-readable trust data. The parallel `warnings` strings are for terminal
display only — production code must not parse them to recover caveat identity.
See [the E1 invariant](../soundness/e1-invariant.md).

## `conformance-matrix-report.json`

Emitted by `pnpm ci:conformance` (`tools/conformance/runner.ts`):

```ts
interface ConformanceMatrixReport {
  schemaVersion: 1;
  kind: "conformance-matrix-report";
  generatedAt: string;
  matrixId: string;
  fixtureResults: readonly {
    fixtureId: string;
    status: "pass" | "fail" | "skipped" | "error";
    featureIds: readonly string[];
    targetIds: readonly string[];
    thresholds?: readonly ReportThresholdResult[];
    budgets?: readonly ReportStateSpaceBudgetResult[];
    acceptedCaveats?: readonly string[];
    unacceptedCaveats?: readonly string[];
    reportPaths?: Readonly<Record<string, string>>;
  }[];
  classifications?: readonly CanaryFailureClassification[];
  reportPath?: string;
}
```

Reports are written to a temp directory by default. Pass `--report <path>` to
`ci:conformance` to pin the output location.

## `canary-run-report.json`

Emitted by `pnpm ci:canaries` and `pnpm ci:examples` (`tools/canary/runner.ts`):

```ts
interface CanaryRunReport {
  schemaVersion: 1;
  kind: "canary-run-report";
  generatedAt: string;
  manifestId: string;
  canaryResults: readonly {
    canaryId: string;
    status: "pass" | "fail" | "skipped" | "error";
    thresholds?: readonly ReportThresholdResult[];
    budgets?: readonly ReportStateSpaceBudgetResult[];
    acceptedCaveats?: readonly string[];
    unacceptedCaveats?: readonly string[];
    reportPaths?: Readonly<Record<string, string>>;
  }[];
  classifications: readonly CanaryFailureClassification[];
  reportPath?: string;
}
```

`CanaryFailureClassification` records `category`, `severity`, `evidence`, and
`suggestedPlanFamily` for failed canaries and fixtures. See
[Conformance & replay](../architecture/conformance-and-replay.md#thresholds-budgets-and-failure-classifications).

## Replay report

`modality replay` emits a `ReplayReport` with a verdict status of
`reproduced` / `not-reproduced` / `inconclusive`, the number of steps run, and the
diverging step index when applicable. See
[Conformance & replay](../architecture/conformance-and-replay.md).

## Extraction caveats

```ts
interface ExtractionCaveat {
  kind: "global-taint" | "stale-read" | "unhandled-rejection" | "unextractable" | "model-slack";
  id: string;
  reason: string;
  source?: SourceAnchor;
  severity: "info" | "over-approx" | "unsound-risk";
}
```

Typed and severity-tagged so CI can gate on *changes* — see
[the E1 invariant](../soundness/e1-invariant.md#caveats-are-typed).
