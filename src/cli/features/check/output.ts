import type { CheckResult, PropertyVerdict } from "modality-ts/check";
import type {
  ReportPropertyConfidence,
  ReportPropertyVerdict,
} from "modality-ts/core";
import {
  colorize,
  formatArtifactLine,
  formatCountValue,
  formatDuration,
  formatDurationValue,
  formatMs,
  formatStatusSymbol,
  formatSummaryRow,
  formatTime,
  formatTimeValue,
  type OutputOptions,
  statusSymbol,
  ANSI,
} from "../../output.js";

export type CheckOutputOptions = OutputOptions;

export interface ArtifactPathEntry {
  kind: "report" | "trace" | "replayTest" | "actionReplayTest";
  path: string;
}

export interface HumanCheckTargetResult {
  modelPath: string;
  propsPath: string;
  check: CheckResult;
  reportVerdicts?: readonly ReportPropertyVerdict[];
  reportPath?: string;
  artifacts: readonly ArtifactPathEntry[];
  durationMs?: number;
}

export interface HumanCheckRenderOptions extends OutputOptions {
  startedAt: Date;
  totalDurationMs: number;
  showArtifacts?: boolean;
}

export function symbolForStatus(status: PropertyVerdict["status"]): string {
  switch (status) {
    case "verified":
    case "verified-within-bounds":
    case "reachable":
      return statusSymbol("pass");
    case "violated":
    case "error":
      return statusSymbol("fail");
    case "vacuous-warning":
      return statusSymbol("warn");
  }
}

function verdictStatusKind(
  status: PropertyVerdict["status"],
): "pass" | "fail" | "warn" {
  switch (status) {
    case "verified":
    case "verified-within-bounds":
    case "reachable":
      return "pass";
    case "violated":
    case "error":
      return "fail";
    case "vacuous-warning":
      return "warn";
  }
}

function targetStatusKind(check: CheckResult): "pass" | "fail" | "warn" {
  if (
    check.verdicts.some(
      (verdict) => verdict.status === "violated" || verdict.status === "error",
    )
  ) {
    return "fail";
  }
  if (check.verdicts.some((verdict) => verdict.status === "vacuous-warning")) {
    return "warn";
  }
  return "pass";
}

function verdictCounts(check: CheckResult) {
  const tests = check.verdicts.length;
  const passed = check.verdicts.filter(
    (verdict) =>
      verdict.status === "verified" ||
      verdict.status === "verified-within-bounds" ||
      verdict.status === "reachable",
  ).length;
  const failed = check.verdicts.filter(
    (verdict) => verdict.status === "violated",
  ).length;
  const errors = check.verdicts.filter(
    (verdict) => verdict.status === "error",
  ).length;
  const warnings = check.verdicts.filter(
    (verdict) => verdict.status === "vacuous-warning",
  ).length;
  return { tests, passed, failed, errors, warnings };
}

function slicingStats(check: CheckResult): {
  slices: number;
  vars: number;
  transitions: number;
  skipped: number;
} {
  const slicing = check.diagnostics?.slicing;
  if (slicing?.enabled) {
    const totalVars =
      slicing.sliceSummaries?.reduce((sum, summary) => sum + summary.vars, 0) ??
      0;
    const totalTransitions =
      slicing.sliceSummaries?.reduce(
        (sum, summary) => sum + summary.transitions,
        0,
      ) ?? 0;
    return {
      slices: slicing.slices ?? 0,
      vars: totalVars,
      transitions: totalTransitions,
      skipped: 0,
    };
  }
  if (slicing?.skipped) {
    return { slices: 0, vars: 0, transitions: 0, skipped: 1 };
  }
  return { slices: 1, vars: 0, transitions: 0, skipped: 0 };
}

function formatTargetStats(check: CheckResult): string {
  const { tests, passed, failed, errors, warnings } = verdictCounts(check);
  const { slices, vars, transitions, skipped } = slicingStats(check);
  const parts = [
    `${tests} tests`,
    `${passed} passed`,
    `${failed} failed`,
    `${errors} errors`,
    `states ${check.stats.states}`,
    `edges ${check.stats.edges}`,
    `depth ${check.stats.depth}`,
    `slices ${slices}`,
    `vars ${vars}`,
    `transitions ${transitions}`,
    `skipped ${skipped}`,
  ];
  if (warnings > 0) parts.push(`warnings ${warnings}`);
  return `(${parts.join(", ")})`;
}

function traceSteps(verdict: PropertyVerdict): string {
  if (verdict.status !== "violated" && verdict.status !== "reachable") {
    return "";
  }
  return (
    verdict.trace.steps.map((step) => step.transitionId).join(" -> ") ||
    "(initial)"
  );
}

export function renderHumanCheckTarget(
  target: HumanCheckTargetResult,
  options: OutputOptions,
): string[] {
  const lines: string[] = [];
  const kind = targetStatusKind(target.check);
  const symbol = formatStatusSymbol(kind, options);
  const duration =
    target.durationMs !== undefined ? ` ${formatMs(target.durationMs)}` : "";
  const confidenceByProperty = new Map(
    (target.reportVerdicts ?? []).map((verdict) => [
      verdict.property,
      verdict.confidence,
    ]),
  );
  lines.push(` ${symbol} ${target.propsPath}${duration}`);
  lines.push(`  ${formatTargetStats(target.check)}`);
  const por = target.check.diagnostics?.partialOrderReduction;
  if (por?.requested || por?.enabled) {
    if (por.enabled) {
      lines.push(
        `  por=enabled reducedStates:${por.reducedStates} skippedTransitions:${por.skippedTransitions} cycleFallbacks:${por.cycleFallbackStates}`,
      );
    } else if (por.skipped) {
      lines.push(`  por=skipped reason:${por.skipReason ?? "unknown"}`);
    }
  }
  for (const verdict of target.check.verdicts) {
    lines.push(
      `  ${formatStatusSymbol(verdictStatusKind(verdict.status), options)} ${verdict.property} ${verdict.status}`,
    );
    const confidence = confidenceByProperty.get(verdict.property);
    if (confidence && confidence.level !== "exact") {
      lines.push(`    ${formatCompactConfidence(confidence)}`);
    }
    if (verdict.status === "violated" || verdict.status === "reachable") {
      lines.push(`    trace: ${traceSteps(verdict)}`);
    }
    if (verdict.status === "error" || verdict.status === "vacuous-warning") {
      lines.push(`    ${verdict.message}`);
    }
  }
  return lines;
}

export function renderCheckSummary(
  results: readonly HumanCheckTargetResult[],
  options: HumanCheckRenderOptions,
): string[] {
  if (results.length === 0) return [];
  const lines: string[] = [];
  lines.push("");

  const totalTargets = results.length;
  const passedTargets = results.filter(
    (target) => targetStatusKind(target.check) === "pass",
  ).length;
  const failedTargets = totalTargets - passedTargets;
  lines.push(
    formatSummaryRow(
      "Test Files",
      formatCountValue(
        { passed: passedTargets, failed: failedTargets },
        totalTargets,
        { ...options, leadFailed: true },
      ),
      options,
    ),
  );

  const totalTests = results.reduce(
    (sum, target) => sum + target.check.verdicts.length,
    0,
  );
  const passedTests = results.reduce(
    (sum, target) => sum + verdictCounts(target.check).passed,
    0,
  );
  const failedTests = results.reduce(
    (sum, target) => sum + verdictCounts(target.check).failed,
    0,
  );
  const errorTests = results.reduce(
    (sum, target) => sum + verdictCounts(target.check).errors,
    0,
  );
  const warningTests = results.reduce(
    (sum, target) => sum + verdictCounts(target.check).warnings,
    0,
  );
  lines.push(
    formatSummaryRow(
      "Tests",
      formatCountValue(
        {
          passed: passedTests,
          failed: failedTests,
          errors: errorTests,
          warnings: warningTests,
        },
        totalTests,
        options,
      ),
      options,
    ),
  );
  lines.push(
    formatSummaryRow(
      "Start at",
      formatTimeValue(formatTime(options.startedAt), options),
      options,
    ),
  );
  lines.push(
    formatSummaryRow(
      "Duration",
      formatDurationValue(
        formatDuration(options.totalDurationMs),
        undefined,
        options,
      ),
      options,
    ),
  );

  const artifacts: ArtifactPathEntry[] = [];
  for (const target of results) {
    if (target.reportPath) {
      artifacts.push({ kind: "report", path: target.reportPath });
    }
    for (const entry of target.artifacts) {
      artifacts.push(entry);
    }
  }
  if (options.showArtifacts === true && artifacts.length > 0) {
    lines.push(formatSummaryRow("Artifacts", "", options));
    for (const entry of artifacts) {
      lines.push(formatArtifactLine(entry.kind, entry.path, options));
    }
  }

  return lines;
}

export function renderHumanCheckTargets(
  results: readonly HumanCheckTargetResult[],
  options: HumanCheckRenderOptions,
): string[] {
  return results
    .flatMap((target) => renderHumanCheckTarget(target, options))
    .concat(renderCheckSummary(results, options));
}

/** @deprecated Use renderHumanCheckTargets for CLI output */
export function renderHumanCheckResult(
  check: CheckResult,
  options: CheckOutputOptions = {},
): string[] {
  return renderHumanCheckTargets(
    [
      {
        modelPath: "",
        propsPath: "",
        check,
        artifacts: [],
      },
    ],
    {
      ...options,
      startedAt: new Date(0),
      totalDurationMs: 0,
    },
  );
}

/** @deprecated Use renderHumanCheckTargets artifact block */
export function renderHumanCheckArtifacts(
  paths: readonly ArtifactPathEntry[],
  options: CheckOutputOptions = {},
): string[] {
  if (paths.length === 0) return [];
  return [
    colorize("Artifacts", `${ANSI.bold}`, options),
    ...paths.map((entry) => `  ${entry.kind} ${entry.path}`),
  ];
}

/** @deprecated No longer used in CLI output */
export function renderHumanCheckTargetHeader(
  modelPath: string,
  propsPath: string,
  options: CheckOutputOptions = {},
): string[] {
  const title = colorize(`Target ${modelPath}`, `${ANSI.bold}`, options);
  return [title, `  props ${propsPath}`];
}

export type CheckOutputMode = "plain" | "color";

export function formatCompactConfidence(
  confidence: ReportPropertyConfidence,
): string {
  return `confidence=${confidence.level} reasons:${confidence.reasons.length}`;
}
