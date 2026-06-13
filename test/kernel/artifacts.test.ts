import { describe, expect, it } from "vitest";
import {
  parseCheckReportArtifact,
  parseConformReportArtifact,
  parseExtractionReportArtifact,
  parseModelArtifact,
  parseReplayReportArtifact,
  parseTraceArtifact,
  traceArtifact
} from "modality-ts/kernel";

describe("artifact parsers", () => {
  const checkReport = {
    schemaVersion: 1,
    kind: "check-report",
    modelId: "m",
    generatedAt: "2026-06-12T00:00:00.000Z",
    verdicts: [],
    stats: { states: 0, edges: 0, depth: 0 },
    vacuityWarnings: [],
    trustLedger: {
      bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 1 },
      plugins: [],
      assumptions: [],
      abstractions: [],
      globalTaints: [],
      staleReads: [],
      unhandledRejections: [],
      unextractableHandlers: [],
      domains: [],
      manualTransitions: [],
      overApproxTransitions: [],
      boundHits: [],
      ignoredVars: []
    }
  };

  it("accepts minimal valid model and trace artifacts", () => {
    expect(parseModelArtifact(JSON.stringify({ schemaVersion: 1, id: "m", vars: [], transitions: [], bounds: { maxDepth: 1, maxPending: 1, maxInternalSteps: 1 } })).id).toBe("m");
    expect(parseTraceArtifact(JSON.stringify({ schemaVersion: 1, kind: "trace", steps: [{ transitionId: "t", label: { kind: "click" }, pre: {}, post: {}, diff: {} }] }))).toMatchObject({
      schemaVersion: 1,
      kind: "trace",
      steps: [{ transitionId: "t" }]
    });
    expect(traceArtifact({ steps: [] })).toEqual({ schemaVersion: 1, kind: "trace", steps: [] });
    expect(parseCheckReportArtifact(JSON.stringify(checkReport))).toMatchObject({
      schemaVersion: 1,
      kind: "check-report",
      modelId: "m"
    });
  });

  it("accepts report artifacts for every phase-6 feature output", () => {
    expect(parseExtractionReportArtifact(JSON.stringify({
      schemaVersion: 1,
      kind: "extraction-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      sourceFiles: ["App.tsx"],
      plugins: [],
      handlers: [],
      globalTaints: [],
      staleReads: [],
      unhandledRejections: [],
      domains: [],
      coverage: { handlersTotal: 0, exactOrOverlay: 0, unextractable: 0, ignoredVars: 0, percentExactOrOverlay: 1 },
      warnings: []
    }))).toMatchObject({ kind: "extraction-report", sourceFiles: ["App.tsx"] });
    expect(parseReplayReportArtifact(JSON.stringify({
      schemaVersion: 1,
      kind: "replay-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      verdict: { status: "reproduced", stepsRun: 0 }
    }))).toMatchObject({ kind: "replay-report", verdict: { status: "reproduced" } });
    expect(parseConformReportArtifact(JSON.stringify({
      schemaVersion: 1,
      kind: "conform-report",
      generatedAt: "2026-06-12T00:00:00.000Z",
      walks: [],
      metrics: { total: 0, reproduced: 0, notReproduced: 0, inconclusive: 0, passRate: 1 },
      transitionMetrics: []
    }))).toMatchObject({ kind: "conform-report", metrics: { passRate: 1 } });
  });

  it("rejects newer model schemas and malformed traces", () => {
    expect(() => parseModelArtifact(JSON.stringify({ schemaVersion: 2, id: "m", vars: [], transitions: [], bounds: {} }))).toThrow("unsupported model schemaVersion 2");
    expect(() => parseTraceArtifact(JSON.stringify({ schemaVersion: 2, kind: "trace", steps: [] }))).toThrow("unsupported trace schemaVersion 2");
    expect(() => parseTraceArtifact(JSON.stringify({ schemaVersion: 1, kind: "not-trace", steps: [] }))).toThrow("trace artifact kind must be trace");
    expect(() => parseTraceArtifact(JSON.stringify({ schemaVersion: 1, kind: "trace", steps: [{ transitionId: "t", pre: {} }] }))).toThrow("trace step 1 is malformed");
    expect(() => parseCheckReportArtifact(JSON.stringify({ ...checkReport, schemaVersion: 2 }))).toThrow("unsupported check report schemaVersion 2");
    expect(() => parseCheckReportArtifact(JSON.stringify({ ...checkReport, kind: "extraction-report" }))).toThrow("check report artifact kind must be check-report");
    const { trustLedger: _trustLedger, ...missingTrustLedger } = checkReport;
    expect(() => parseCheckReportArtifact(JSON.stringify(missingTrustLedger))).toThrow("check report artifact missing trustLedger");
    const missingCaveats = {
      ...checkReport,
      trustLedger: {
        ...checkReport.trustLedger,
        globalTaints: undefined
      }
    };
    expect(() => parseCheckReportArtifact(JSON.stringify(missingCaveats))).toThrow("check report trustLedger missing globalTaints");
  });

  it("rejects malformed phase-6 report artifacts", () => {
    expect(() => parseExtractionReportArtifact(JSON.stringify({ schemaVersion: 2, kind: "extraction-report" }))).toThrow("unsupported extraction report schemaVersion 2");
    expect(() => parseExtractionReportArtifact(JSON.stringify({ schemaVersion: 1, kind: "check-report" }))).toThrow("extraction report artifact kind must be extraction-report");
    expect(() => parseExtractionReportArtifact(JSON.stringify({ schemaVersion: 1, kind: "extraction-report", sourceFiles: [] }))).toThrow("extraction report artifact missing plugins");
    expect(() => parseReplayReportArtifact(JSON.stringify({ schemaVersion: 2, kind: "replay-report", verdict: { status: "reproduced", stepsRun: 0 } }))).toThrow("unsupported replay report schemaVersion 2");
    expect(() => parseReplayReportArtifact(JSON.stringify({ schemaVersion: 1, kind: "replay-report", verdict: { status: "unknown", stepsRun: 0 } }))).toThrow("replay report verdict has unsupported status");
    expect(() => parseReplayReportArtifact(JSON.stringify({ schemaVersion: 1, kind: "replay-report", verdict: { status: "reproduced" } }))).toThrow("replay report verdict missing stepsRun");
    expect(() => parseConformReportArtifact(JSON.stringify({ schemaVersion: 2, kind: "conform-report" }))).toThrow("unsupported conform report schemaVersion 2");
    expect(() => parseConformReportArtifact(JSON.stringify({ schemaVersion: 1, kind: "replay-report" }))).toThrow("conform report artifact kind must be conform-report");
    expect(() => parseConformReportArtifact(JSON.stringify({ schemaVersion: 1, kind: "conform-report", walks: [], metrics: {} }))).toThrow("conform report artifact missing transitionMetrics");
  });
});
