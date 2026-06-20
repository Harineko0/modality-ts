export interface OutputOptions {
  color?: boolean;
}

export const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  green: "\u001b[32m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
  gray: "\u001b[90m",
  white: "\u001b[37m",
} as const;

export function useColor(options: OutputOptions): boolean {
  return options.color === true;
}

export function colorize(
  text: string,
  color: string,
  options: OutputOptions,
): string {
  if (!useColor(options)) return text;
  return `${color}${text}${ANSI.reset}`;
}

export type StatusKind = "pass" | "fail" | "warn";

export function statusSymbol(kind: StatusKind): string {
  switch (kind) {
    case "pass":
      return "✓";
    case "fail":
      return "×";
    case "warn":
      return "⚠";
  }
}

export function statusColor(
  kind: StatusKind,
): (typeof ANSI)[keyof typeof ANSI] {
  switch (kind) {
    case "pass":
      return ANSI.green;
    case "fail":
      return ANSI.red;
    case "warn":
      return ANSI.yellow;
  }
}

export function formatStatusSymbol(
  kind: StatusKind,
  options: OutputOptions,
): string {
  return colorize(statusSymbol(kind), statusColor(kind), options);
}

export function formatMs(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 100) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

const SUMMARY_LABEL_WIDTH = 11;

export function formatSummaryLabel(label: string, value: string): string {
  return `${label.padStart(SUMMARY_LABEL_WIDTH)}  ${value}`;
}

export function formatSummaryRow(
  label: string,
  value: string,
  options: OutputOptions,
): string {
  const paddedLabel = label.padStart(SUMMARY_LABEL_WIDTH);
  return `${colorize(paddedLabel, ANSI.gray, options)}  ${value}`;
}

export interface FormatCountValueOptions extends OutputOptions {
  leadFailed?: boolean;
}

function formatCountSegment(
  count: number,
  kind: "passed" | "failed" | "errors" | "warnings",
  options: OutputOptions,
): string {
  const text = `${count} ${kind === "passed" ? "passed" : kind === "failed" ? "failed" : kind === "errors" ? "errors" : "warnings"}`;
  const color =
    kind === "passed"
      ? ANSI.green
      : kind === "warnings"
        ? ANSI.yellow
        : ANSI.red;
  return colorize(text, color, options);
}

function formatTotalParen(total: number, options: OutputOptions): string {
  return colorize(`(${total})`, ANSI.gray, options);
}

export function formatCountValue(
  counts: {
    passed: number;
    failed?: number;
    errors?: number;
    warnings?: number;
  },
  total: number,
  options: FormatCountValueOptions,
): string {
  const { passed, failed = 0, errors = 0, warnings = 0 } = counts;
  const { leadFailed = false } = options;

  if (!useColor(options)) {
    if (leadFailed && failed > 0) {
      return `${failed} failed | ${passed} passed (${total})`;
    }
    if (failed > 0 || errors > 0 || warnings > 0) {
      const parts = [`${passed} passed`];
      if (failed > 0) parts.push(`${failed} failed`);
      if (errors > 0) parts.push(`${errors} errors`);
      if (warnings > 0) parts.push(`${warnings} warnings`);
      parts.push(`(${total})`);
      return parts.join(", ");
    }
    return `${passed} passed (${total})`;
  }

  if (leadFailed && failed > 0) {
    return `${formatCountSegment(failed, "failed", options)} | ${formatCountSegment(passed, "passed", options)} ${formatTotalParen(total, options)}`;
  }
  if (failed > 0 || errors > 0 || warnings > 0) {
    const parts = [formatCountSegment(passed, "passed", options)];
    if (failed > 0) parts.push(formatCountSegment(failed, "failed", options));
    if (errors > 0) parts.push(formatCountSegment(errors, "errors", options));
    if (warnings > 0)
      parts.push(formatCountSegment(warnings, "warnings", options));
    parts.push(formatTotalParen(total, options));
    return parts.join(", ");
  }
  return `${formatCountSegment(passed, "passed", options)} ${formatTotalParen(total, options)}`;
}

export function formatTimeValue(text: string, options: OutputOptions): string {
  return colorize(text, ANSI.white, options);
}

export function formatDurationValue(
  text: string,
  paren: string | undefined,
  options: OutputOptions,
): string {
  if (!paren) {
    return formatTimeValue(text, options);
  }
  const plain = `${text} (${paren})`;
  if (!useColor(options)) return plain;
  return `${colorize(text, ANSI.white, options)} ${colorize(`(${paren})`, ANSI.gray, options)}`;
}

export interface ArtifactLineEntry {
  kind: string;
  path: string;
}

export function formatArtifactLine(
  kind: string,
  path: string,
  options: OutputOptions = {},
): string {
  const line = `     - (${kind}) ${path}`;
  return colorize(line, ANSI.dim, options);
}

export interface RunProgress {
  start(label: string): void;
  done(): void;
}

export function createRunProgress(options: OutputOptions): RunProgress {
  const enabled = process.stderr.isTTY === true && useColor(options);
  if (!enabled) {
    return {
      start() {},
      done() {},
    };
  }
  return {
    start(label: string) {
      process.stderr.write(`◌ ${label} running…\r`);
    },
    done() {
      process.stderr.write("\r\x1b[K");
    },
  };
}
