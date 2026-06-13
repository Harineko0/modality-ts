import { describe, expect, it } from "vitest";
import { parseCheckReportArtifact, parseModelArtifact, parseTraceArtifact, traceArtifact } from "../src/index.js";

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
});
