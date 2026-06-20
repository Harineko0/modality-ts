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
