import type {
  CheckReport,
  ConformReport,
  ExtractionReport,
} from "modality-ts/core";
import { evaluateStateSpaceBudgets } from "../shared-gates/budgets.js";
import {
  evaluateConformThresholds,
  evaluateCoverageThresholds,
} from "../shared-gates/thresholds.js";
import type {
  GateBudgetResult,
  GateThresholdResult,
  SharedBudgets,
  SharedThresholds,
} from "../shared-gates/types.js";

export type CanaryThresholds = SharedThresholds;
export type CanaryBudgets = SharedBudgets;

export interface CanarySeededBugExpectations {
  violatedPropertyCount?: number;
  violatedPropertyNames?: readonly string[];
  minReproducedReplayCount?: number;
  maxOverlayLines?: number;
  expectedCiExitCode?: number;
  ciOutputMustInclude?: readonly string[];
}

export type ThresholdAssertionResult = GateThresholdResult;
export type BudgetAssertionResult = GateBudgetResult;

export interface ExpectationFailure {
  id: string;
  message: string;
}

export function assertCoverageThreshold(
  report: ExtractionReport,
  threshold: number | undefined,
): ThresholdAssertionResult {
  if (threshold === undefined) {
    return { id: "minCoverageExactOrOverlay", status: "skipped" };
  }
  return (
    evaluateCoverageThresholds(report, {
      minCoverageExactOrOverlay: threshold,
    })[0] ?? { id: "minCoverageExactOrOverlay", status: "skipped" }
  );
}

export function assertConformPassRate(
  report: ConformReport | undefined,
  threshold: number | undefined,
): ThresholdAssertionResult {
  if (threshold === undefined) {
    return { id: "minConformPassRate", status: "skipped" };
  }
  return (
    evaluateConformThresholds(report, { minConformPassRate: threshold })[0] ?? {
      id: "minConformPassRate",
      status: "skipped",
    }
  );
}

export function assertTransitionPassRates(
  report: ConformReport | undefined,
  threshold: number | undefined,
): ThresholdAssertionResult[] {
  if (threshold === undefined) return [];
  return evaluateConformThresholds(report, {
    minTransitionPassRate: threshold,
  });
}

export function assertThresholds(input: {
  extractionReport: ExtractionReport;
  conformReport?: ConformReport;
  thresholds?: CanaryThresholds;
}): ThresholdAssertionResult[] {
  return [
    ...evaluateCoverageThresholds(input.extractionReport, input.thresholds),
    ...evaluateConformThresholds(input.conformReport, input.thresholds),
  ];
}

export function assertStateSpaceBudget(
  checkReport: CheckReport | undefined,
  budgets: CanaryBudgets | undefined,
  extractionReport?: ExtractionReport,
): BudgetAssertionResult[] {
  return evaluateStateSpaceBudgets({
    checkReport,
    extractionReport,
    budgets,
  });
}

export function assertSeededBugExpectations(input: {
  checkReport: CheckReport | undefined;
  reproducedReplayCount: number;
  overlayLines: number;
  ciExitCode?: number;
  ciLines?: readonly string[];
  expectations: CanarySeededBugExpectations | undefined;
}): ExpectationFailure[] {
  if (!input.expectations) return [];
  const failures: ExpectationFailure[] = [];
  const {
    checkReport,
    reproducedReplayCount,
    overlayLines,
    ciExitCode,
    ciLines,
    expectations,
  } = input;

  if (expectations.violatedPropertyCount !== undefined) {
    const violations =
      checkReport?.verdicts.filter(
        (verdict) => verdict.status === "violated",
      ) ?? [];
    if (violations.length !== expectations.violatedPropertyCount) {
      failures.push({
        id: "violatedPropertyCount",
        message: `expected ${expectations.violatedPropertyCount} seeded violations, got ${violations.length}`,
      });
    }
  }

  if (expectations.violatedPropertyNames !== undefined) {
    const actualNames =
      checkReport?.verdicts.map((verdict) => verdict.property).join(",") ?? "";
    const expectedNames = expectations.violatedPropertyNames.join(",");
    if (actualNames !== expectedNames) {
      failures.push({
        id: "violatedPropertyNames",
        message: `unexpected property set: ${actualNames}`,
      });
    }
  }

  if (expectations.minReproducedReplayCount !== undefined) {
    if (reproducedReplayCount < expectations.minReproducedReplayCount) {
      failures.push({
        id: "minReproducedReplayCount",
        message: `expected at least ${expectations.minReproducedReplayCount} reproduced replays, got ${reproducedReplayCount}`,
      });
    }
  }

  if (expectations.maxOverlayLines !== undefined) {
    if (overlayLines > expectations.maxOverlayLines) {
      failures.push({
        id: "maxOverlayLines",
        message: `overlay line budget exceeded: ${overlayLines}`,
      });
    }
  }

  if (expectations.expectedCiExitCode !== undefined) {
    if (ciExitCode !== expectations.expectedCiExitCode) {
      failures.push({
        id: "expectedCiExitCode",
        message: `expected CI exit ${expectations.expectedCiExitCode}, got ${String(ciExitCode)}`,
      });
    }
  }

  for (const requiredLine of expectations.ciOutputMustInclude ?? []) {
    if (!ciLines?.some((line) => line.includes(requiredLine))) {
      failures.push({
        id: `ciOutput:${requiredLine}`,
        message: `CI output missing ${requiredLine}`,
      });
    }
  }

  return failures;
}
