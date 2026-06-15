import type { Model } from "../ir/types.js";
import type {
  CheckReport,
  ConformReport,
  ExtractionReport,
  ReplayReport,
} from "../report/types.js";
import type {
  Property,
  StepPredicateFlat,
  StepPredicateIR,
} from "../ir/types.js";
import type { Trace, TraceArtifact } from "../trace/types.js";

export function parseModelArtifact(json: string): Model {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("model artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported model schemaVersion ${String(value.schemaVersion)}`,
    );
  if (typeof value.id !== "string")
    throw new Error("model artifact missing id");
  if (!Array.isArray(value.vars))
    throw new Error("model artifact missing vars");
  if (!Array.isArray(value.transitions))
    throw new Error("model artifact missing transitions");
  if (!isRecord(value.bounds)) throw new Error("model artifact missing bounds");
  return value as unknown as Model;
}

export function traceArtifact(trace: Trace): TraceArtifact {
  return { schemaVersion: 1, kind: "trace", steps: trace.steps };
}

export function parseTraceArtifact(json: string): TraceArtifact {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("trace artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported trace schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "trace")
    throw new Error("trace artifact kind must be trace");
  if (!Array.isArray(value.steps))
    throw new Error("trace artifact missing steps");
  for (const [index, step] of value.steps.entries()) {
    if (
      !isRecord(step) ||
      typeof step.transitionId !== "string" ||
      !isRecord(step.pre) ||
      !isRecord(step.post)
    ) {
      throw new Error(`trace step ${index + 1} is malformed`);
    }
  }
  return value as unknown as TraceArtifact;
}

export function parseCheckReportArtifact(json: string): CheckReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("check report artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported check report schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "check-report")
    throw new Error("check report artifact kind must be check-report");
  if (!isRecord(value.trustLedger))
    throw new Error("check report artifact missing trustLedger");
  if (!Array.isArray(value.trustLedger.globalTaints))
    throw new Error("check report trustLedger missing globalTaints");
  if (!Array.isArray(value.trustLedger.staleReads))
    throw new Error("check report trustLedger missing staleReads");
  if (!Array.isArray(value.trustLedger.unhandledRejections))
    throw new Error("check report trustLedger missing unhandledRejections");
  if (!Array.isArray(value.trustLedger.unextractableHandlers))
    throw new Error("check report trustLedger missing unextractableHandlers");
  if (!Array.isArray(value.verdicts))
    throw new Error("check report artifact missing verdicts");
  if (!isRecord(value.stats))
    throw new Error("check report artifact missing stats");
  if (!Array.isArray(value.vacuityWarnings))
    throw new Error("check report artifact missing vacuityWarnings");
  return value as unknown as CheckReport;
}

export function parseExtractionReportArtifact(json: string): ExtractionReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("extraction report artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported extraction report schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "extraction-report")
    throw new Error(
      "extraction report artifact kind must be extraction-report",
    );
  if (!Array.isArray(value.sourceFiles))
    throw new Error("extraction report artifact missing sourceFiles");
  if (!Array.isArray(value.plugins))
    throw new Error("extraction report artifact missing plugins");
  if (!Array.isArray(value.handlers))
    throw new Error("extraction report artifact missing handlers");
  if (!Array.isArray(value.globalTaints))
    throw new Error("extraction report artifact missing globalTaints");
  if (!Array.isArray(value.staleReads))
    throw new Error("extraction report artifact missing staleReads");
  if (!Array.isArray(value.unhandledRejections))
    throw new Error("extraction report artifact missing unhandledRejections");
  if (!Array.isArray(value.domains))
    throw new Error("extraction report artifact missing domains");
  if (!isRecord(value.coverage))
    throw new Error("extraction report artifact missing coverage");
  if (!Array.isArray(value.warnings))
    throw new Error("extraction report artifact missing warnings");
  return value as unknown as ExtractionReport;
}

export function parseReplayReportArtifact(json: string): ReplayReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("replay report artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported replay report schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "replay-report")
    throw new Error("replay report artifact kind must be replay-report");
  if (!isRecord(value.verdict))
    throw new Error("replay report artifact missing verdict");
  if (
    value.verdict.status !== "reproduced" &&
    value.verdict.status !== "not-reproduced" &&
    value.verdict.status !== "inconclusive"
  ) {
    throw new Error("replay report verdict has unsupported status");
  }
  if (typeof value.verdict.stepsRun !== "number")
    throw new Error("replay report verdict missing stepsRun");
  return value as unknown as ReplayReport;
}

export function parseConformReportArtifact(json: string): ConformReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("conform report artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported conform report schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "conform-report")
    throw new Error("conform report artifact kind must be conform-report");
  if (!Array.isArray(value.walks))
    throw new Error("conform report artifact missing walks");
  if (!isRecord(value.metrics))
    throw new Error("conform report artifact missing metrics");
  if (!Array.isArray(value.transitionMetrics))
    throw new Error("conform report artifact missing transitionMetrics");
  return value as unknown as ConformReport;
}

export function parsePropertyArtifact(json: string): Property[] {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("property artifact must be an object");
  if (value.schemaVersion !== 1) {
    throw new Error(
      `unsupported property schemaVersion ${String(value.schemaVersion)}`,
    );
  }
  if (!Array.isArray(value.properties)) {
    throw new Error("property artifact missing properties");
  }
  return value.properties.map((property, index) =>
    assertSerializableProperty(property, `properties[${index}]`),
  );
}

export function assertSerializableProperty(
  value: unknown,
  path = "property",
): Property {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  if (typeof value.kind !== "string") {
    throw new Error(`${path} missing kind`);
  }
  if (typeof value.name !== "string") {
    throw new Error(`${path} missing name`);
  }
  assertNoFunctions(value, path);
  switch (value.kind) {
    case "always":
    case "reachable":
      if (
        !isRecord(value.predicate) ||
        typeof value.predicate.kind !== "string"
      ) {
        throw new Error(`${path} missing predicate IR`);
      }
      break;
    case "alwaysStep":
      assertSerializableStepPredicate(value.predicate, `${path}.predicate`);
      break;
    case "reachableFrom":
      if (!isRecord(value.when) || typeof value.when.kind !== "string") {
        throw new Error(`${path} missing when predicate IR`);
      }
      if (!isRecord(value.goal) || typeof value.goal.kind !== "string") {
        throw new Error(`${path} missing goal predicate IR`);
      }
      break;
    case "leadsToWithin":
      assertSerializableStepPredicate(value.trigger, `${path}.trigger`);
      if (!isRecord(value.goal) || typeof value.goal.kind !== "string") {
        throw new Error(`${path} missing goal predicate IR`);
      }
      if (!isRecord(value.budget)) {
        throw new Error(`${path} missing budget`);
      }
      break;
    default:
      throw new Error(`${path} has unsupported kind ${String(value.kind)}`);
  }
  return value as unknown as Property;
}

const STEP_PREDICATE_FLAT_KEYS = new Set<keyof StepPredicateFlat>([
  "transitionId",
  "transitionClass",
  "labelKind",
  "enqueued",
  "resolved",
  "navigated",
  "navigatedTo",
  "opId",
  "continuation",
  "opArgs",
]);

const STEP_PREDICATE_COMPOSITE_KEYS = new Set([
  "pre",
  "step",
  "post",
  "negate",
]);

function assertSerializableStepPredicate(
  value: unknown,
  path: string,
): StepPredicateIR {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  if ("step" in value) {
    for (const key of Object.keys(value)) {
      if (!STEP_PREDICATE_COMPOSITE_KEYS.has(key)) {
        throw new Error(`${path} has unknown step predicate key ${key}`);
      }
    }
    if (!isRecord(value.step)) {
      throw new Error(`${path}.step must be an object`);
    }
    assertSerializableStepPredicateFlat(value.step, `${path}.step`);
    if (value.pre !== undefined) {
      assertSerializableExpr(value.pre, `${path}.pre`);
    }
    if (value.post !== undefined) {
      assertSerializableExpr(value.post, `${path}.post`);
    }
    if (value.negate !== undefined && typeof value.negate !== "boolean") {
      throw new Error(`${path}.negate must be a boolean`);
    }
    return value as unknown as StepPredicateIR;
  }
  assertSerializableStepPredicateFlat(value, path);
  return value as unknown as StepPredicateIR;
}

function assertSerializableStepPredicateFlat(
  value: Record<string, unknown>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!STEP_PREDICATE_FLAT_KEYS.has(key as keyof StepPredicateFlat)) {
      throw new Error(`${path} has unknown step predicate key ${key}`);
    }
  }
  if (value.transitionId !== undefined && typeof value.transitionId !== "string") {
    throw new Error(`${path}.transitionId must be a string`);
  }
  if (
    value.transitionClass !== undefined &&
    typeof value.transitionClass !== "string"
  ) {
    throw new Error(`${path}.transitionClass must be a string`);
  }
  if (value.labelKind !== undefined && typeof value.labelKind !== "string") {
    throw new Error(`${path}.labelKind must be a string`);
  }
  if (value.enqueued !== undefined && typeof value.enqueued !== "string") {
    throw new Error(`${path}.enqueued must be a string`);
  }
  if (value.navigatedTo !== undefined && typeof value.navigatedTo !== "string") {
    throw new Error(`${path}.navigatedTo must be a string`);
  }
  if (value.opId !== undefined && typeof value.opId !== "string") {
    throw new Error(`${path}.opId must be a string`);
  }
  if (value.continuation !== undefined && typeof value.continuation !== "string") {
    throw new Error(`${path}.continuation must be a string`);
  }
  if (value.navigated !== undefined && typeof value.navigated !== "boolean") {
    throw new Error(`${path}.navigated must be a boolean`);
  }
  if (value.resolved !== undefined) {
    if (!Array.isArray(value.resolved)) {
      throw new Error(`${path}.resolved must be a one- or two-string tuple`);
    }
    if (
      value.resolved.length < 1 ||
      value.resolved.length > 2 ||
      !value.resolved.every((entry) => typeof entry === "string")
    ) {
      throw new Error(`${path}.resolved must be a one- or two-string tuple`);
    }
  }
  if (value.opArgs !== undefined) {
    if (!isRecord(value.opArgs)) {
      throw new Error(`${path}.opArgs must be a JSON object`);
    }
  }
}

function assertSerializableExpr(value: unknown, path: string): void {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error(`${path} must be predicate IR`);
  }
  switch (value.kind) {
    case "lit":
      break;
    case "read":
    case "readPre":
      if (typeof value.var !== "string") {
        throw new Error(`${path}.${value.kind} must declare var`);
      }
      break;
    case "readOpArg":
      if (typeof value.key !== "string") {
        throw new Error(`${path}.readOpArg must declare key`);
      }
      break;
    case "freshToken":
      if (typeof value.domainOf !== "string") {
        throw new Error(`${path}.freshToken must declare domainOf`);
      }
      break;
    case "transitionEnabled":
      if (typeof value.transitionId !== "string") {
        throw new Error(`${path}.transitionEnabled must declare transitionId`);
      }
      break;
    case "tagIs":
      if (typeof value.tag !== "string") {
        throw new Error(`${path}.tagIs must declare tag`);
      }
      assertSerializableExpr(value.arg, `${path}.tagIs.arg`);
      break;
    case "lenCat":
      assertSerializableExpr(value.arg, `${path}.lenCat.arg`);
      break;
    case "not":
      if (!Array.isArray(value.args) || value.args.length !== 1) {
        throw new Error(`${path}.not must have exactly one arg`);
      }
      assertSerializableExpr(value.args[0], `${path}.not.args[0]`);
      break;
    case "cond":
      if (!Array.isArray(value.args) || value.args.length !== 3) {
        throw new Error(`${path}.cond must have exactly three args`);
      }
      for (const [index, arg] of value.args.entries()) {
        assertSerializableExpr(arg, `${path}.cond.args[${index}]`);
      }
      break;
    case "updateField":
      if (!Array.isArray(value.path)) {
        throw new Error(`${path}.updateField must declare path`);
      }
      assertSerializableExpr(value.target, `${path}.updateField.target`);
      assertSerializableExpr(value.value, `${path}.updateField.value`);
      break;
    case "eq":
    case "neq":
    case "and":
    case "or":
      if (!Array.isArray(value.args)) {
        throw new Error(`${path}.${value.kind} must declare args`);
      }
      for (const [index, arg] of value.args.entries()) {
        assertSerializableExpr(arg, `${path}.${value.kind}.args[${index}]`);
      }
      break;
    default:
      throw new Error(`${path} has unsupported expression kind ${String(value.kind)}`);
  }
}

function assertNoFunctions(value: unknown, path: string): void {
  if (typeof value === "function") {
    throw new Error(
      `${path}: property predicates must be serializable IR, not functions. Migrate .props modules to predicate IR builders from modality-ts/core.`,
    );
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertNoFunctions(entry, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoFunctions(entry, `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
