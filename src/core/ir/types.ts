export type PrimitiveValue = null | boolean | number | string;

export type Value =
  | PrimitiveValue
  | readonly Value[]
  | { readonly [key: string]: Value };

export type NumericOverflowPolicy = "forbid" | "wrap" | "saturate";

export type AbstractDomain =
  | { kind: "bool" }
  | { kind: "enum"; values: readonly string[] }
  | {
      kind: "boundedInt";
      min: number;
      max: number;
      overflow?: NumericOverflowPolicy;
    }
  | {
      kind: "intSet";
      values: readonly number[];
      overflow?: NumericOverflowPolicy;
    }
  | { kind: "option"; inner: AbstractDomain }
  | { kind: "record"; fields: Record<string, AbstractDomain> }
  | { kind: "tagged"; tag: string; variants: Record<string, AbstractDomain> }
  | { kind: "tokens"; count: number; names?: readonly string[] }
  | { kind: "lengthCat" }
  | { kind: "boundedList"; inner: AbstractDomain; maxLen: number };

export interface SourceAnchor {
  file: string;
  line?: number;
  column?: number;
}

export type StateVarScope =
  | { kind: "global" }
  | { kind: "mount-local"; id: string; when: ExprIR };

export interface SystemVarRole {
  kind:
    | "pending-queue"
    | "location-current"
    | "location-history"
    | "tree-slot"
    | "boundary-phase"
    | "cache-entry"
    | "environment";
  group?: string;
}

export interface StateVarDecl {
  id: string;
  domain: AbstractDomain;
  origin: SourceAnchor | "system" | "library-template";
  scope: StateVarScope;
  initial: Value | readonly Value[];
  role?: SystemVarRole;
}

export type ExprIR =
  | { kind: "lit"; value: Value }
  | { kind: "read"; var: string; path?: readonly string[] }
  | { kind: "eq" | "neq" | "and" | "or"; args: readonly ExprIR[] }
  | { kind: "not"; args: readonly [ExprIR] }
  | { kind: "cond"; args: readonly [ExprIR, ExprIR, ExprIR] }
  | {
      kind: "updateField";
      target: ExprIR;
      path: readonly string[];
      value: ExprIR;
    }
  | { kind: "tagIs"; arg: ExprIR; tag: string }
  | { kind: "lenCat"; arg: ExprIR }
  | { kind: "freshToken"; domainOf: string }
  | { kind: "transitionEnabled"; transitionId: string }
  | { kind: "transitionEnabledPrefix"; prefix: string }
  | { kind: "readPre"; var: string; path?: readonly string[] }
  | { kind: "readOpArg"; key: string }
  | { kind: "lt" | "lte" | "gt" | "gte"; args: readonly [ExprIR, ExprIR] }
  | { kind: "add" | "sub" | "mod"; args: readonly [ExprIR, ExprIR] };

export type GuardIR = ExprIR;

export type EffectIR =
  | { kind: "assign"; var: string; expr: ExprIR }
  | { kind: "havoc"; var: string }
  | { kind: "choose"; var: string; among: readonly ExprIR[] }
  | { kind: "if"; cond: ExprIR; then: EffectIR; else: EffectIR }
  | { kind: "seq"; effects: readonly EffectIR[] }
  | {
      kind: "enqueue";
      queue?: string;
      op: string;
      continuation: string;
      args: Record<string, ExprIR>;
    }
  | { kind: "dequeue"; queue?: string; index: number }
  | { kind: "opaque"; ref: OpaqueRef };

export interface OpaqueRef {
  module: string;
  export: string;
  declaredReads: readonly string[];
  declaredWrites: readonly string[];
}

export type Locator =
  | { kind: "testId"; value: string }
  | { kind: "role"; role: string; name?: string }
  | { kind: "positional"; base: Locator; index: number };

export type EventLabel =
  | { kind: "click" | "submit"; locator?: Locator; text?: string }
  | { kind: "input"; locator?: Locator; valueClass: string }
  | { kind: "navigate"; mode: "push" | "back"; to?: string }
  | { kind: "resolve"; op: string; outcome: string }
  | { kind: "focus-revalidate" | "timer"; key?: string }
  | { kind: "env"; key: string; outcome?: string }
  | { kind: "internal"; text: string };

export interface Transition {
  id: string;
  cls: "user" | "nav" | "env" | "internal" | "library";
  label: EventLabel;
  source: readonly SourceAnchor[];
  guard: GuardIR;
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
  confidence: "exact" | "over-approx" | "manual";
  triggeredBy?: readonly string[];
  /** Commit ordinal for internal stabilization transitions; lower ordinals run before higher ordinals when write conflicts exist. */
  phase?: number;
}

export interface Bounds {
  maxDepth: number;
  maxPending: number;
  maxInternalSteps: number;
}

export interface PluginProvenance {
  id: string;
  version: string;
  kind:
    | "navigation"
    | "module-roles"
    | "effect-api"
    | "route-execution"
    | "cache-storage"
    | "observation"
    | "state-source"
    | "domain-refinement"
    | "framework";
  packageNames: readonly string[];
}

export type CaveatKind =
  | "global-taint"
  | "stale-read"
  | "unhandled-rejection"
  | "unextractable"
  | "model-slack";

export interface ExtractionCaveat {
  kind: CaveatKind;
  id: string;
  reason: string;
  source?: SourceAnchor;
  severity: "info" | "over-approx" | "unsound-risk";
}

export interface ExtractionCaveats {
  entries: readonly ExtractionCaveat[];
}

export type NumericReductionClaim =
  | "exact"
  | "property-preserving"
  | "heuristic";

export type NumericReductionKind =
  | "exact"
  | "lazy-range"
  | "saturation"
  | "interval"
  | "predicate"
  | "input-class"
  | "dropped";

export interface NumericReduction {
  varId: string;
  kind: NumericReductionKind;
  claim: NumericReductionClaim;
  reason: string;
  source?: SourceAnchor;
}

export interface NumericReductions {
  entries: readonly NumericReduction[];
}

export interface FieldPruningEntry {
  varId: string;
  keptPaths: readonly string[][];
  prunedPaths: readonly string[][];
  reason: "unread" | "property-unrelated" | "bounded-record";
  source?: SourceAnchor;
  confidence: "exact" | "over-approx";
}

export interface FieldPruningMetadata {
  entries: readonly FieldPruningEntry[];
}

export interface Model {
  schemaVersion: 1;
  id: string;
  vars: readonly StateVarDecl[];
  transitions: readonly Transition[];
  bounds: Bounds;
  metadata?: {
    sourceHashes?: Record<string, string>;
    plugins?: readonly PluginProvenance[];
    domainProvenance?: Record<string, "overlay-refined">;
    extractionCaveats?: ExtractionCaveats;
    numericReductions?: NumericReductions;
    fieldPruning?: FieldPruningMetadata;
    varAnchors?: Record<string, SourceAnchor>;
  };
}

export type ModelState = Record<string, Value>;

export interface TemplateFragment {
  vars: readonly StateVarDecl[];
  transitions: readonly Transition[];
}

export type StatePredicateIR = ExprIR;

// ---------------------------------------------------------------------------
// Temporal formula IR (CTL)
// ---------------------------------------------------------------------------

/**
 * A CTL temporal formula over state predicates.
 *
 * The eight standard CTL operators are represented on a minimal EX/EU/EG
 * basis; AX, AF, AG, AU are either syntactic sugar or derived in the checker.
 * Boolean connectives compose formulas; `atom` wraps a state predicate leaf.
 */
export type TemporalFormula =
  | { kind: "atom"; predicate: StatePredicateIR }
  | { kind: "fnot"; arg: TemporalFormula }
  | { kind: "fand" | "for"; args: readonly TemporalFormula[] }
  | { kind: "EX" | "AX" | "EF" | "AF" | "EG" | "AG"; arg: TemporalFormula }
  | { kind: "EU" | "AU"; left: TemporalFormula; right: TemporalFormula };

/**
 * A fairness constraint: the formula must hold in infinitely many states on
 * every fair path (Emerson–Lei generalized fairness).
 */
export interface FairnessConstraint {
  name?: string;
  condition: TemporalFormula;
}

export interface StepPredicateFlat {
  transitionId?: string;
  transitionClass?: string;
  labelKind?: string;
  enqueued?: string;
  resolved?: readonly [string, string?];
  changed?: string;
  changedTo?: { var: string; value: Value };
  opId?: string;
  continuation?: string;
  opArgs?: Record<string, unknown>;
}

export interface StepPredicateComposite {
  pre?: ExprIR;
  step: StepPredicateFlat;
  post?: ExprIR;
  negate?: boolean;
}

export type StepPredicateIR = StepPredicateFlat | StepPredicateComposite;

export interface PropertyOptions {
  name?: string;
  reads?: readonly string[];
  enabledTransitions?: readonly string[];
  includeUnmounted?: boolean;
  fairness?: readonly FairnessConstraint[];
}

export type Property =
  | {
      kind: "temporal";
      name: string;
      formula: TemporalFormula;
      reads?: readonly string[];
      enabledTransitions?: readonly string[];
      includeUnmounted?: boolean;
      fairness?: readonly FairnessConstraint[];
    }
  | {
      kind: "alwaysStep";
      name: string;
      predicate: StepPredicateIR;
      reads?: readonly string[];
      enabledTransitions?: readonly string[];
      includeUnmounted?: boolean;
    }
  | {
      kind: "leadsToWithin";
      name: string;
      trigger: StepPredicateFlat;
      goal: StatePredicateIR;
      budget: { steps?: number; environment?: number };
      allowUserEvents?: boolean;
      reads?: readonly string[];
      enabledTransitions?: readonly string[];
      includeUnmounted?: boolean;
    };

export interface PropertyArtifact {
  schemaVersion: 1;
  properties: readonly Property[];
}
