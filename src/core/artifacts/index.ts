import type {
  Model,
  Property,
  StepPredicateFlat,
  StepPredicateIR,
} from "../ir/types.js";
import type {
  CanaryFailureCategory,
  CanaryRunReport,
  CheckReport,
  ConformanceMatrixReport,
  ConformReport,
  ExtractionReport,
  PropertySliceManifest,
  PropertySliceManifestEntry,
  ReplayReport,
} from "../report/types.js";
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
  if (!Array.isArray(value.trustLedger.modelSlack))
    throw new Error("check report trustLedger missing modelSlack");
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
  if (!Array.isArray(value.modelSlack))
    throw new Error("extraction report artifact missing modelSlack");
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
  if (value.fixtureId !== undefined) {
    assertNonEmptyString(value.fixtureId, "conform report fixtureId");
  }
  if (value.featureIds !== undefined) {
    assertStringArray(value.featureIds, "conform report featureIds");
  }
  if (value.targetIds !== undefined) {
    assertStringArray(value.targetIds, "conform report targetIds");
  }
  if (value.thresholds !== undefined) {
    if (!isRecord(value.thresholds))
      throw new Error("conform report thresholds must be an object");
    if (value.thresholds.minPassRate !== undefined) {
      assertPassRate(
        value.thresholds.minPassRate,
        "conform report minPassRate",
      );
    }
    if (value.thresholds.minTransitionPassRate !== undefined) {
      assertPassRate(
        value.thresholds.minTransitionPassRate,
        "conform report minTransitionPassRate",
      );
    }
  }
  return value as unknown as ConformReport;
}

export function parseConformanceMatrixReportArtifact(
  json: string,
): ConformanceMatrixReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("conformance matrix report artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported conformance matrix report schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "conformance-matrix-report")
    throw new Error(
      "conformance matrix report artifact kind must be conformance-matrix-report",
    );
  assertNonEmptyString(value.matrixId, "conformance matrix report matrixId");
  if (!Array.isArray(value.fixtureResults))
    throw new Error(
      "conformance matrix report artifact missing fixtureResults",
    );
  for (const [index, entry] of value.fixtureResults.entries()) {
    assertConformanceFixtureResult(entry, `fixtureResults[${index}]`);
  }
  if (value.thresholdResults !== undefined) {
    assertThresholdResults(value.thresholdResults, "thresholdResults");
  }
  if (value.budgetResults !== undefined) {
    assertBudgetResults(value.budgetResults, "budgetResults");
  }
  if (value.classifications !== undefined) {
    assertFailureClassifications(value.classifications, "classifications");
  }
  return value as unknown as ConformanceMatrixReport;
}

export function parseCanaryRunReportArtifact(json: string): CanaryRunReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("canary run report artifact must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported canary run report schemaVersion ${String(value.schemaVersion)}`,
    );
  if (value.kind !== "canary-run-report")
    throw new Error(
      "canary run report artifact kind must be canary-run-report",
    );
  assertNonEmptyString(value.manifestId, "canary run report manifestId");
  if (!Array.isArray(value.canaryResults))
    throw new Error("canary run report artifact missing canaryResults");
  for (const [index, entry] of value.canaryResults.entries()) {
    assertCanaryResult(entry, `canaryResults[${index}]`);
  }
  if (value.thresholdResults !== undefined) {
    assertThresholdResults(value.thresholdResults, "thresholdResults");
  }
  if (value.budgetResults !== undefined) {
    assertBudgetResults(value.budgetResults, "budgetResults");
  }
  if (!Array.isArray(value.classifications))
    throw new Error("canary run report artifact missing classifications");
  assertFailureClassifications(value.classifications, "classifications");
  return value as unknown as CanaryRunReport;
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

export function parsePropertySliceManifestArtifact(
  json: string,
): PropertySliceManifest {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) {
    throw new Error("property slice manifest artifact must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error(
      `unsupported property slice manifest schemaVersion ${String(value.schemaVersion)}`,
    );
  }
  if (value.kind !== "property-slice-manifest") {
    throw new Error(
      "property slice manifest artifact kind must be property-slice-manifest",
    );
  }
  if (typeof value.modelId !== "string") {
    throw new Error("property slice manifest artifact missing modelId");
  }
  if (typeof value.sourceModelPath !== "string") {
    throw new Error("property slice manifest artifact missing sourceModelPath");
  }
  if (typeof value.sourceModelHash !== "string") {
    throw new Error("property slice manifest artifact missing sourceModelHash");
  }
  if (typeof value.generatedAt !== "string") {
    throw new Error("property slice manifest artifact missing generatedAt");
  }
  if (!Array.isArray(value.properties)) {
    throw new Error("property slice manifest artifact missing properties");
  }
  const properties = value.properties.map((entry, index) =>
    assertPropertySliceManifestEntry(entry, `properties[${index}]`),
  );
  return {
    schemaVersion: 1,
    kind: "property-slice-manifest",
    modelId: value.modelId,
    sourceModelPath: value.sourceModelPath,
    sourceModelHash: value.sourceModelHash,
    generatedAt: value.generatedAt,
    properties,
  };
}

function assertPropertySliceManifestEntry(
  value: unknown,
  path: string,
): PropertySliceManifestEntry {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (typeof value.property !== "string") {
    throw new Error(`${path} missing property`);
  }
  if (typeof value.propertyIndex !== "number") {
    throw new Error(`${path} missing propertyIndex`);
  }
  if (value.status === "skipped") {
    if (typeof value.reason !== "string") {
      throw new Error(`${path} missing reason`);
    }
    return {
      property: value.property,
      propertyIndex: value.propertyIndex,
      status: "skipped",
      reason: value.reason,
    };
  }
  if (value.status !== "emitted") {
    throw new Error(`${path} has unsupported status`);
  }
  if (
    value.mode !== "state" &&
    value.mode !== "targetedStep" &&
    value.mode !== "full"
  ) {
    throw new Error(`${path} missing mode`);
  }
  if (typeof value.path !== "string") throw new Error(`${path} missing path`);
  if (typeof value.fullVars !== "number") {
    throw new Error(`${path} missing fullVars`);
  }
  if (typeof value.fullTransitions !== "number") {
    throw new Error(`${path} missing fullTransitions`);
  }
  if (typeof value.vars !== "number") throw new Error(`${path} missing vars`);
  if (typeof value.transitions !== "number") {
    throw new Error(`${path} missing transitions`);
  }
  assertStringArray(value.varIds, `${path}.varIds`);
  assertStringArray(value.transitionIds, `${path}.transitionIds`);
  if (typeof value.retainedBits !== "number") {
    throw new Error(`${path} missing retainedBits`);
  }
  if (typeof value.prunedBits !== "number") {
    throw new Error(`${path} missing prunedBits`);
  }
  assertStateSpaceContributorArray(
    value.topRetainedContributors,
    `${path}.topRetainedContributors`,
  );
  assertStateSpaceContributorArray(
    value.topPrunedContributors,
    `${path}.topPrunedContributors`,
  );
  assertStringArray(value.retainedSystemVars, `${path}.retainedSystemVars`);
  assertStringArray(value.prunedSystemVars, `${path}.prunedSystemVars`);
  if (typeof value.sliceKey !== "string") {
    throw new Error(`${path} missing sliceKey`);
  }
  return value as unknown as PropertySliceManifestEntry;
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
    case "temporal":
      assertSerializableTemporalFormula(value.formula, `${path}.formula`);
      break;
    case "alwaysStep":
      assertSerializableStepPredicate(value.predicate, `${path}.predicate`);
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
  "changed",
  "changedTo",
  "opId",
  "continuation",
  "opArgs",
]);

const TEMPORAL_FORMULA_KINDS = new Set([
  "atom",
  "fnot",
  "fand",
  "for",
  "EX",
  "AX",
  "EF",
  "AF",
  "EG",
  "AG",
  "EU",
  "AU",
]);

function assertSerializableTemporalFormula(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  if (
    typeof value.kind !== "string" ||
    !TEMPORAL_FORMULA_KINDS.has(value.kind)
  ) {
    throw new Error(
      `${path} has unsupported formula kind ${String(value.kind)}`,
    );
  }
  switch (value.kind) {
    case "atom":
      if (
        !isRecord(value.predicate) ||
        typeof value.predicate.kind !== "string"
      ) {
        throw new Error(`${path}.predicate missing or invalid ExprIR`);
      }
      break;
    case "fnot":
      assertSerializableTemporalFormula(value.arg, `${path}.arg`);
      break;
    case "fand":
    case "for": {
      if (!Array.isArray(value.args)) {
        throw new Error(`${path}.args must be an array`);
      }
      for (let i = 0; i < value.args.length; i++) {
        assertSerializableTemporalFormula(value.args[i], `${path}.args[${i}]`);
      }
      break;
    }
    case "EX":
    case "AX":
    case "EF":
    case "AF":
    case "EG":
    case "AG":
      assertSerializableTemporalFormula(value.arg, `${path}.arg`);
      break;
    case "EU":
    case "AU":
      assertSerializableTemporalFormula(value.left, `${path}.left`);
      assertSerializableTemporalFormula(value.right, `${path}.right`);
      break;
  }
}

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
  if (
    value.transitionId !== undefined &&
    typeof value.transitionId !== "string"
  ) {
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
  if (value.changed !== undefined) {
    if (typeof value.changed !== "string" || value.changed.length === 0) {
      throw new Error(`${path}.changed must be a non-empty string`);
    }
  }
  if (value.changedTo !== undefined) {
    if (!isRecord(value.changedTo)) {
      throw new Error(`${path}.changedTo must be an object`);
    }
    if (
      typeof value.changedTo.var !== "string" ||
      value.changedTo.var.length === 0
    ) {
      throw new Error(`${path}.changedTo.var must be a non-empty string`);
    }
    assertJsonValue(value.changedTo.value, `${path}.changedTo.value`);
  }
  if (value.opId !== undefined && typeof value.opId !== "string") {
    throw new Error(`${path}.opId must be a string`);
  }
  if (
    value.continuation !== undefined &&
    typeof value.continuation !== "string"
  ) {
    throw new Error(`${path}.continuation must be a string`);
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
    case "transitionEnabledPrefix":
      if (typeof value.prefix !== "string") {
        throw new Error(`${path}.transitionEnabledPrefix must declare prefix`);
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
      throw new Error(
        `${path} has unsupported expression kind ${String(value.kind)}`,
      );
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

function assertJsonValue(value: unknown, path: string): void {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertJsonValue(entry, `${path}[${index}]`);
    }
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      assertJsonValue(entry, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`${path} must be a JSON-serializable value`);
}

function assertNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertPassRate(value: unknown, path: string): void {
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw new Error(`${path} must be a number between 0 and 1`);
  }
}

function assertPositiveInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
}

function assertStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    assertNonEmptyString(entry, `${path}[${index}]`);
  }
}

function assertStateSpaceContributorArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) throw new Error(`${entryPath} must be an object`);
    assertNonEmptyString(entry.varId, `${entryPath}.varId`);
    assertNonEmptyString(entry.domainKind, `${entryPath}.domainKind`);
    if (typeof entry.bits !== "number") {
      throw new Error(`${entryPath}.bits must be a number`);
    }
    assertNonEmptyString(entry.scope, `${entryPath}.scope`);
    assertNonEmptyString(entry.origin, `${entryPath}.origin`);
    if (entry.prunedFieldPaths !== undefined) {
      if (!Array.isArray(entry.prunedFieldPaths)) {
        throw new Error(`${entryPath}.prunedFieldPaths must be an array`);
      }
      for (const [pathIndex, pathEntry] of entry.prunedFieldPaths.entries()) {
        assertStringArray(
          pathEntry,
          `${entryPath}.prunedFieldPaths[${pathIndex}]`,
        );
      }
    }
  }
}

const REPORT_RESULT_STATUSES = new Set(["pass", "fail", "skipped", "error"]);

const REPORT_GATE_STATUSES = new Set(["pass", "fail", "skipped"]);

const CANARY_FAILURE_CATEGORIES = new Set<CanaryFailureCategory>([
  "missing-semantic-abstraction",
  "missing-adapter-capability",
  "syntax-recognition-gap",
  "incorrect-ir-or-checker",
  "state-space-budget",
  "environment-or-project-integration",
  "explicit-unsupported-behavior",
  "fixture-or-canary-invalid",
]);

const CANARY_FAILURE_SEVERITIES = new Set([
  "blocker",
  "action-required",
  "accepted",
]);

function assertReportResultStatus(value: unknown, path: string): void {
  if (typeof value !== "string" || !REPORT_RESULT_STATUSES.has(value)) {
    throw new Error(`${path} has unsupported status`);
  }
}

function assertGateStatus(value: unknown, path: string): void {
  if (typeof value !== "string" || !REPORT_GATE_STATUSES.has(value)) {
    throw new Error(`${path} has unsupported gate status`);
  }
}

function assertThresholdResults(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry))
      throw new Error(`${path}[${index}] must be an object`);
    assertNonEmptyString(entry.id, `${path}[${index}].id`);
    assertGateStatus(entry.status, `${path}[${index}].status`);
    if (entry.expected !== undefined) {
      assertPassRate(entry.expected, `${path}[${index}].expected`);
    }
    if (entry.actual !== undefined) {
      assertPassRate(entry.actual, `${path}[${index}].actual`);
    }
  }
}

function assertBudgetResults(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry))
      throw new Error(`${path}[${index}] must be an object`);
    assertNonEmptyString(entry.id, `${path}[${index}].id`);
    assertGateStatus(entry.status, `${path}[${index}].status`);
    if (entry.maxStates !== undefined) {
      assertPositiveInteger(entry.maxStates, `${path}[${index}].maxStates`);
    }
    if (entry.actualStates !== undefined) {
      assertNonNegativeInteger(
        entry.actualStates,
        `${path}[${index}].actualStates`,
      );
    }
    if (entry.maxEdges !== undefined) {
      assertPositiveInteger(entry.maxEdges, `${path}[${index}].maxEdges`);
    }
    if (entry.actualEdges !== undefined) {
      assertNonNegativeInteger(
        entry.actualEdges,
        `${path}[${index}].actualEdges`,
      );
    }
    if (entry.maxFrontier !== undefined) {
      assertPositiveInteger(entry.maxFrontier, `${path}[${index}].maxFrontier`);
    }
    if (entry.actualFrontier !== undefined) {
      assertNonNegativeInteger(
        entry.actualFrontier,
        `${path}[${index}].actualFrontier`,
      );
    }
  }
}

function assertFailureClassifications(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry))
      throw new Error(`${path}[${index}] must be an object`);
    assertNonEmptyString(entry.canaryId, `${path}[${index}].canaryId`);
    if (entry.fixtureId !== undefined) {
      assertNonEmptyString(entry.fixtureId, `${path}[${index}].fixtureId`);
    }
    if (
      typeof entry.category !== "string" ||
      !CANARY_FAILURE_CATEGORIES.has(entry.category as CanaryFailureCategory)
    ) {
      throw new Error(`${path}[${index}].category is unsupported`);
    }
    if (
      typeof entry.severity !== "string" ||
      !CANARY_FAILURE_SEVERITIES.has(entry.severity)
    ) {
      throw new Error(`${path}[${index}].severity is unsupported`);
    }
    assertStringArray(entry.evidence, `${path}[${index}].evidence`);
    assertNonEmptyString(
      entry.suggestedPlanFamily,
      `${path}[${index}].suggestedPlanFamily`,
    );
  }
}

function assertConformanceFixtureResult(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.fixtureId, `${path}.fixtureId`);
  assertReportResultStatus(value.status, `${path}.status`);
  assertStringArray(value.featureIds, `${path}.featureIds`);
  assertStringArray(value.targetIds, `${path}.targetIds`);
  if (value.thresholds !== undefined) {
    assertThresholdResults(value.thresholds, `${path}.thresholds`);
  }
  if (value.budgets !== undefined) {
    assertBudgetResults(value.budgets, `${path}.budgets`);
  }
}

function assertCanaryResult(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.canaryId, `${path}.canaryId`);
  assertReportResultStatus(value.status, `${path}.status`);
  if (value.thresholds !== undefined) {
    assertThresholdResults(value.thresholds, `${path}.thresholds`);
  }
  if (value.budgets !== undefined) {
    assertBudgetResults(value.budgets, `${path}.budgets`);
  }
}
