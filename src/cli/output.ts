import { createColors } from "picocolors";

export interface OutputOptions {
  color?: boolean;
}

export const ANSI = {
  reset: "[0m",
  bold: "[1m",
  green: "[32m",
  red: "[31m",
  yellow: "[33m",
  cyan: "[36m",
  dim: "[2m",
  gray: "[90m",
  white: "[37m",
} as const;

const pcOn = createColors(true);
const pcOff = createColors(false);
type Colors = typeof pcOn;

export function useColor(options: OutputOptions): boolean {
  return options.color === true;
}

function colors(options: OutputOptions): Colors {
  return useColor(options) ? pcOn : pcOff;
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
  const sym = statusSymbol(kind);
  const c = colors(options);
  switch (kind) {
    case "pass":
      return c.green(sym);
    case "fail":
      return c.red(sym);
    case "warn":
      return c.yellow(sym);
  }
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
  return `${colors(options).gray(paddedLabel)}  ${value}`;
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
  const c = colors(options);
  if (kind === "passed") return c.green(text);
  if (kind === "warnings") return c.yellow(text);
  return c.red(text);
}

function formatTotalParen(total: number, options: OutputOptions): string {
  return colors(options).gray(`(${total})`);
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
  return colors(options).white(text);
}

export function formatDurationValue(
  text: string,
  paren: string | undefined,
  options: OutputOptions,
): string {
  if (!paren) {
    return formatTimeValue(text, options);
  }
  if (!useColor(options)) return `${text} (${paren})`;
  const c = colors(options);
  return `${c.white(text)} ${c.gray(`(${paren})`)}`;
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
  return colors(options).dim(line);
}
