import type { CheckResult, PropertyVerdict } from "modality-ts/check";

export type CheckOutputMode = "plain" | "color";

export interface CheckOutputOptions {
  color?: boolean;
}

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
} as const;

function useColor(options: CheckOutputOptions): boolean {
  return options.color === true;
}

function colorize(
  text: string,
  color: string,
  options: CheckOutputOptions,
): string {
  if (!useColor(options)) return text;
  return `${color}${text}${ANSI.reset}`;
}

export function symbolForStatus(status: PropertyVerdict["status"]): string {
  switch (status) {
    case "verified-within-bounds":
      return "✓";
    case "reachable":
      return "✓";
    case "violated":
      return "×";
    case "error":
      return "×";
    case "vacuous-warning":
      return "⚠";
  }
}

function symbolColor(
  status: PropertyVerdict["status"],
): (typeof ANSI)[keyof typeof ANSI] {
  switch (status) {
    case "verified-within-bounds":
      return ANSI.green;
    case "reachable":
      return ANSI.cyan;
    case "violated":
    case "error":
      return ANSI.red;
    case "vacuous-warning":
      return ANSI.yellow;
  }
}

function formatSymbol(
  status: PropertyVerdict["status"],
  options: CheckOutputOptions,
): string {
  const symbol = symbolForStatus(status);
  return colorize(symbol, symbolColor(status), options);
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

export function renderHumanCheckResult(
  check: CheckResult,
  options: CheckOutputOptions = {},
): string[] {
  const lines: string[] = [];
  const section = (title: string) => colorize(title, `${ANSI.bold}`, options);

  lines.push(section("Properties"));
  for (const verdict of check.verdicts) {
    const symbol = formatSymbol(verdict.status, options);
    lines.push(`  ${symbol} ${verdict.property} ${verdict.status}`);
    if (verdict.status === "violated" || verdict.status === "reachable") {
      lines.push(`    trace: ${traceSteps(verdict)}`);
    }
    if (verdict.status === "error" || verdict.status === "vacuous-warning") {
      lines.push(`    ${verdict.message}`);
    }
  }

  lines.push("");
  lines.push(section("Stats"));
  lines.push(
    `  states=${check.stats.states} edges=${check.stats.edges} depth=${check.stats.depth}`,
  );

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
    lines.push(
      `  slicing slices=${slicing.slices ?? 0} vars=${totalVars} transitions=${totalTransitions} skipped=0`,
    );
  } else if (slicing?.skipped) {
    lines.push(`  slicing skipped reason=${slicing.skipReason ?? "unknown"}`);
  }

  const limits = check.diagnostics?.limits;
  if (limits) {
    const limitKind =
      limits.maxStates !== undefined
        ? "maxStates"
        : limits.maxFrontier !== undefined
          ? "maxFrontier"
          : limits.maxEdges !== undefined
            ? "maxEdges"
            : "memoryGuard";
    lines.push(
      `  search-limit=${limitKind} states=${check.stats.states} frontier=${check.diagnostics?.search?.finalFrontier ?? 0} depth=${check.stats.depth}`,
    );
  }

  const storage = check.diagnostics?.storage;
  if (storage) {
    lines.push(
      `  storage mode=${storage.edgeRecordingMode} recordedEdges=${storage.recordedEdges} storedStates=${storage.storedStates} parentEntries=${storage.parentEntries}`,
    );
  }

  const hotPath = check.diagnostics?.hotPath;
  if (hotPath) {
    lines.push(
      `  hotPath canonicalCache=${hotPath.canonicalCache} transitionIndex=${hotPath.transitionIndex} internalTransitionIndex=${hotPath.internalTransitionIndex}`,
    );
  }

  return lines;
}

export interface ArtifactPathEntry {
  kind: "trace" | "replayTest" | "actionReplayTest";
  path: string;
}

export function renderHumanCheckArtifacts(
  paths: readonly ArtifactPathEntry[],
  options: CheckOutputOptions = {},
): string[] {
  if (paths.length === 0) return [];
  const lines: string[] = [];
  lines.push(colorize("Artifacts", `${ANSI.bold}`, options));
  for (const entry of paths) {
    lines.push(`  ${entry.kind} ${entry.path}`);
  }
  return lines;
}

export function renderHumanCheckTargetHeader(
  modelPath: string,
  propsPath: string,
  options: CheckOutputOptions = {},
): string[] {
  const title = colorize(`Target ${modelPath}`, `${ANSI.bold}`, options);
  return [title, `  props ${propsPath}`];
}
