import type { Model } from "../ir/types.js";
import type { CheckReport, ConformReport, ExtractionReport, ReplayReport } from "../report/types.js";
import type { Trace, TraceArtifact } from "../trace/types.js";

export function parseModelArtifact(json: string): Model {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("model artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported model schemaVersion ${String(value.schemaVersion)}`);
  if (typeof value.id !== "string") throw new Error("model artifact missing id");
  if (!Array.isArray(value.vars)) throw new Error("model artifact missing vars");
  if (!Array.isArray(value.transitions)) throw new Error("model artifact missing transitions");
  if (!isRecord(value.bounds)) throw new Error("model artifact missing bounds");
  return value as unknown as Model;
}

export function traceArtifact(trace: Trace): TraceArtifact {
  return { schemaVersion: 1, kind: "trace", steps: trace.steps };
}

export function parseTraceArtifact(json: string): TraceArtifact {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("trace artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported trace schemaVersion ${String(value.schemaVersion)}`);
  if (value.kind !== "trace") throw new Error("trace artifact kind must be trace");
  if (!Array.isArray(value.steps)) throw new Error("trace artifact missing steps");
  for (const [index, step] of value.steps.entries()) {
    if (!isRecord(step) || typeof step.transitionId !== "string" || !isRecord(step.pre) || !isRecord(step.post)) {
      throw new Error(`trace step ${index + 1} is malformed`);
    }
  }
  return value as unknown as TraceArtifact;
}

export function parseCheckReportArtifact(json: string): CheckReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("check report artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported check report schemaVersion ${String(value.schemaVersion)}`);
  if (value.kind !== "check-report") throw new Error("check report artifact kind must be check-report");
  if (!isRecord(value.trustLedger)) throw new Error("check report artifact missing trustLedger");
  if (!Array.isArray(value.trustLedger.globalTaints)) throw new Error("check report trustLedger missing globalTaints");
  if (!Array.isArray(value.trustLedger.staleReads)) throw new Error("check report trustLedger missing staleReads");
  if (!Array.isArray(value.trustLedger.unhandledRejections)) throw new Error("check report trustLedger missing unhandledRejections");
  if (!Array.isArray(value.trustLedger.unextractableHandlers)) throw new Error("check report trustLedger missing unextractableHandlers");
  if (!Array.isArray(value.verdicts)) throw new Error("check report artifact missing verdicts");
  if (!isRecord(value.stats)) throw new Error("check report artifact missing stats");
  if (!Array.isArray(value.vacuityWarnings)) throw new Error("check report artifact missing vacuityWarnings");
  return value as unknown as CheckReport;
}

export function parseExtractionReportArtifact(json: string): ExtractionReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("extraction report artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported extraction report schemaVersion ${String(value.schemaVersion)}`);
  if (value.kind !== "extraction-report") throw new Error("extraction report artifact kind must be extraction-report");
  if (!Array.isArray(value.sourceFiles)) throw new Error("extraction report artifact missing sourceFiles");
  if (!Array.isArray(value.plugins)) throw new Error("extraction report artifact missing plugins");
  if (!Array.isArray(value.handlers)) throw new Error("extraction report artifact missing handlers");
  if (!Array.isArray(value.globalTaints)) throw new Error("extraction report artifact missing globalTaints");
  if (!Array.isArray(value.staleReads)) throw new Error("extraction report artifact missing staleReads");
  if (!Array.isArray(value.unhandledRejections)) throw new Error("extraction report artifact missing unhandledRejections");
  if (!Array.isArray(value.domains)) throw new Error("extraction report artifact missing domains");
  if (!isRecord(value.coverage)) throw new Error("extraction report artifact missing coverage");
  if (!Array.isArray(value.warnings)) throw new Error("extraction report artifact missing warnings");
  return value as unknown as ExtractionReport;
}

export function parseReplayReportArtifact(json: string): ReplayReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("replay report artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported replay report schemaVersion ${String(value.schemaVersion)}`);
  if (value.kind !== "replay-report") throw new Error("replay report artifact kind must be replay-report");
  if (!isRecord(value.verdict)) throw new Error("replay report artifact missing verdict");
  if (value.verdict.status !== "reproduced" && value.verdict.status !== "not-reproduced" && value.verdict.status !== "inconclusive") {
    throw new Error("replay report verdict has unsupported status");
  }
  if (typeof value.verdict.stepsRun !== "number") throw new Error("replay report verdict missing stepsRun");
  return value as unknown as ReplayReport;
}

export function parseConformReportArtifact(json: string): ConformReport {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("conform report artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported conform report schemaVersion ${String(value.schemaVersion)}`);
  if (value.kind !== "conform-report") throw new Error("conform report artifact kind must be conform-report");
  if (!Array.isArray(value.walks)) throw new Error("conform report artifact missing walks");
  if (!isRecord(value.metrics)) throw new Error("conform report artifact missing metrics");
  if (!Array.isArray(value.transitionMetrics)) throw new Error("conform report artifact missing transitionMetrics");
  return value as unknown as ConformReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
