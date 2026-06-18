import type {
  CheckReport,
  ConformReport,
  ExtractionReport,
  ReportGateStatus,
} from "modality-ts/core";

export interface CanaryThresholds {
  minCoverageExactOrOverlay?: number;
  minConformPassRate?: number;
  minTransitionPassRate?: number;
}

export interface CanaryBudgets {
  maxStates?: number;
  maxEdges?: number;
  maxFrontier?: number;
  memoryGuardMb?: number;
}

export interface CanarySeededBugExpectations {
  violatedPropertyCount?: number;
  violatedPropertyNames?: readonly string[];
  minReproducedReplayCount?: number;
  maxOverlayLines?: number;
  expectedCiExitCode?: number;
  ciOutputMustInclude?: readonly string[];
}

export interface ThresholdAssertionResult {
  id: string;
  status: ReportGateStatus;
  expected?: number;
  actual?: number;
  message?: string;
}

export interface BudgetAssertionResult {
  id: string;
  status: ReportGateStatus;
  maxStates?: number;
  actualStates?: number;
  maxEdges?: number;
  actualEdges?: number;
  maxFrontier?: number;
  actualFrontier?: number;
  message?: string;
}

export interface ExpectationFailure {
  id: string;
  message: string;
}

export function assertCoverageThreshold(
  report: ExtractionReport,
  threshold: number | undefined,
): ThresholdAssertionResult {
  const id = "minCoverageExactOrOverlay";
  if (threshold === undefined) {
    return { id, status: "skipped" };
  }
  const actual = report.coverage.percentExactOrOverlay;
  const status = actual >= threshold ? "pass" : "fail";
  return {
    id,
    status,
    expected: threshold,
    actual,
    ...(status === "fail"
      ? {
          message: `coverage ${actual} below threshold ${threshold}`,
        }
      : {}),
  };
}

export function assertConformPassRate(
  report: ConformReport | undefined,
  threshold: number | undefined,
): ThresholdAssertionResult {
  const id = "minConformPassRate";
  if (threshold === undefined) {
    return { id, status: "skipped" };
  }
  if (!report) {
    return {
      id,
      status: "fail",
      expected: threshold,
      message: "conform report missing",
    };
  }
  const actual = report.metrics.passRate;
  const status = actual >= threshold ? "pass" : "fail";
  return {
    id,
    status,
    expected: threshold,
    actual,
    ...(status === "fail"
      ? {
          message: `conform pass rate ${actual} below threshold ${threshold}`,
        }
      : {}),
  };
}

export function assertTransitionPassRates(
  report: ConformReport | undefined,
  threshold: number | undefined,
): ThresholdAssertionResult {
  const id = "minTransitionPassRate";
  if (threshold === undefined) {
    return { id, status: "skipped" };
  }
  if (!report) {
    return {
      id,
      status: "fail",
      expected: threshold,
      message: "conform report missing",
    };
  }
  const actual = report.transitionMetrics.length
    ? Math.min(...report.transitionMetrics.map((entry) => entry.passRate))
    : 1;
  const status = actual >= threshold ? "pass" : "fail";
  return {
    id,
    status,
    expected: threshold,
    actual,
    ...(status === "fail"
      ? {
          message: `minimum transition pass rate ${actual} below threshold ${threshold}`,
        }
      : {}),
  };
}

export function assertStateSpaceBudget(
  checkReport: CheckReport | undefined,
  budgets: CanaryBudgets | undefined,
): BudgetAssertionResult[] {
  if (!budgets) return [];
  const stats = checkReport?.stats;
  const search = checkReport?.diagnostics?.search;
  const results: BudgetAssertionResult[] = [];
  if (budgets.maxStates !== undefined) {
    const actualStates = stats?.states ?? 0;
    results.push({
      id: "maxStates",
      status: actualStates <= budgets.maxStates ? "pass" : "fail",
      maxStates: budgets.maxStates,
      actualStates,
      ...(actualStates > budgets.maxStates
        ? {
            message: `state count ${actualStates} exceeds budget ${budgets.maxStates}`,
          }
        : {}),
    });
  }
  if (budgets.maxEdges !== undefined) {
    const actualEdges = stats?.edges ?? 0;
    results.push({
      id: "maxEdges",
      status: actualEdges <= budgets.maxEdges ? "pass" : "fail",
      maxEdges: budgets.maxEdges,
      actualEdges,
      ...(actualEdges > budgets.maxEdges
        ? {
            message: `edge count ${actualEdges} exceeds budget ${budgets.maxEdges}`,
          }
        : {}),
    });
  }
  if (budgets.maxFrontier !== undefined) {
    const actualFrontier = search?.maxFrontier ?? 0;
    results.push({
      id: "maxFrontier",
      status: actualFrontier <= budgets.maxFrontier ? "pass" : "fail",
      maxFrontier: budgets.maxFrontier,
      actualFrontier,
      ...(actualFrontier > budgets.maxFrontier
        ? {
            message: `frontier ${actualFrontier} exceeds budget ${budgets.maxFrontier}`,
          }
        : {}),
    });
  }
  return results;
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
      checkReport?.verdicts.filter((verdict) => verdict.status === "violated") ??
      [];
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
