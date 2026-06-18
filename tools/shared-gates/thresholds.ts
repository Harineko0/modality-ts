import type { ConformReport, ExtractionReport } from "modality-ts/core";
import type { GateThresholdResult, SharedThresholds } from "./types.js";

export function evaluateCoverageThresholds(
  report: ExtractionReport,
  thresholds: SharedThresholds | undefined,
): GateThresholdResult[] {
  if (!thresholds) return [];
  const results: GateThresholdResult[] = [];

  if (thresholds.minCoverageExactOrOverlay !== undefined) {
    results.push(
      compareMin(
        "minCoverageExactOrOverlay",
        report.coverage.percentExactOrOverlay,
        thresholds.minCoverageExactOrOverlay,
        "extractionReport.coverage.percentExactOrOverlay",
      ),
    );
  }

  if (thresholds.maxUnextractable !== undefined) {
    results.push(
      compareMax(
        "maxUnextractable",
        report.coverage.unextractable,
        thresholds.maxUnextractable,
        "extractionReport.coverage.unextractable",
      ),
    );
  }

  if (thresholds.maxGlobalTaints !== undefined) {
    results.push(
      compareMax(
        "maxGlobalTaints",
        report.globalTaints.length,
        thresholds.maxGlobalTaints,
        "extractionReport.globalTaints",
      ),
    );
  }

  if (thresholds.maxUnhandledRejections !== undefined) {
    results.push(
      compareMax(
        "maxUnhandledRejections",
        report.unhandledRejections.length,
        thresholds.maxUnhandledRejections,
        "extractionReport.unhandledRejections",
      ),
    );
  }

  if (thresholds.maxStaleReads !== undefined) {
    results.push(
      compareMax(
        "maxStaleReads",
        report.staleReads.length,
        thresholds.maxStaleReads,
        "extractionReport.staleReads",
      ),
    );
  }

  if (thresholds.minRouteCoverage !== undefined) {
    const configured = report.routeCoverage?.configured ?? 0;
    const modeled = report.routeCoverage?.modeled ?? 0;
    const actual = configured === 0 ? 1 : modeled / configured;
    results.push(
      compareMin(
        "minRouteCoverage",
        actual,
        thresholds.minRouteCoverage,
        "extractionReport.routeCoverage",
      ),
    );
  }

  return results;
}

export function evaluateConformThresholds(
  report: ConformReport | undefined,
  thresholds: SharedThresholds | undefined,
): GateThresholdResult[] {
  if (!thresholds) return [];
  const results: GateThresholdResult[] = [];

  if (thresholds.minConformPassRate !== undefined) {
    results.push(evaluateConformPassRate(report, thresholds.minConformPassRate));
  }

  if (thresholds.minTransitionPassRate !== undefined) {
    results.push(
      ...evaluateTransitionPassRates(report, thresholds.minTransitionPassRate),
    );
  }

  return results;
}

export function evaluateThresholds(input: {
  extractionReport: ExtractionReport;
  conformReport?: ConformReport;
  thresholds?: SharedThresholds;
}): GateThresholdResult[] {
  return [
    ...evaluateCoverageThresholds(input.extractionReport, input.thresholds),
    ...evaluateConformThresholds(input.conformReport, input.thresholds),
  ];
}

function evaluateConformPassRate(
  report: ConformReport | undefined,
  threshold: number,
): GateThresholdResult {
  const id = "minConformPassRate";
  if (!report) {
    return {
      id,
      status: "fail",
      expected: threshold,
      evidence: ["conformReport: missing"],
      message: "conform report missing",
    };
  }
  return compareMin(
    id,
    report.metrics.passRate,
    threshold,
    "conformReport.metrics.passRate",
  );
}

function evaluateTransitionPassRates(
  report: ConformReport | undefined,
  threshold: number,
): GateThresholdResult[] {
  const id = "minTransitionPassRate";
  if (!report) {
    return [
      {
        id,
        status: "fail",
        expected: threshold,
        evidence: ["conformReport: missing"],
        message: "conform report missing",
      },
    ];
  }

  const failing = report.transitionMetrics.filter(
    (entry) => entry.passRate < threshold,
  );
  if (failing.length === 0) {
    const actual = report.transitionMetrics.length
      ? Math.min(...report.transitionMetrics.map((entry) => entry.passRate))
      : 1;
    return [
      {
        id,
        status: "pass",
        expected: threshold,
        actual,
      },
    ];
  }

  return failing.map((entry) => ({
    id: `${id}:${entry.transitionId}`,
    status: "fail" as const,
    expected: threshold,
    actual: entry.passRate,
    evidence: [
      `conformReport.transitionMetrics.${entry.transitionId}.passRate`,
      `transitionId: ${entry.transitionId}`,
    ],
    message: `transition ${entry.transitionId} pass rate ${entry.passRate} below threshold ${threshold}`,
  }));
}

function compareMin(
  id: string,
  actual: number,
  expected: number,
  reportField: string,
): GateThresholdResult {
  const status = actual >= expected ? "pass" : "fail";
  return {
    id,
    status,
    expected,
    actual,
    ...(status === "fail"
      ? {
          evidence: [
            `${reportField}: ${actual}`,
            `threshold.${id}: ${expected}`,
          ],
          message: `${reportField} ${actual} below threshold ${expected}`,
        }
      : {}),
  };
}

function compareMax(
  id: string,
  actual: number,
  expected: number,
  reportField: string,
): GateThresholdResult {
  const status = actual <= expected ? "pass" : "fail";
  return {
    id,
    status,
    expected,
    actual,
    ...(status === "fail"
      ? {
          evidence: [
            `${reportField}: ${actual}`,
            `threshold.${id}: ${expected}`,
          ],
          message: `${reportField} ${actual} above threshold ${expected}`,
        }
      : {}),
  };
}
