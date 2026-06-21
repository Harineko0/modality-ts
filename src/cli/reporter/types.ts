export type { StatusKind } from "../output.js";

export interface RunMeta {
  command: "check" | "extract" | "generate";
  startedAt: Date;
}

export interface ReporterTask<T> {
  title: string;
  run: () => Promise<TargetOutcome<T>>;
}

export interface TargetOutcome<T> {
  entry: T;
  lines: readonly string[];
  status: "pass" | "fail" | "warn";
}

export interface Reporter {
  runTasks<T>(
    meta: RunMeta,
    tasks: ReporterTask<T>[],
  ): Promise<TargetOutcome<T>[]>;
  task<T>(title: string, fn: () => Promise<T>): Promise<T>;
  log(lines: readonly string[], opts?: { truncate?: boolean }): void;
  setFooter(lines: readonly string[]): void;
  clearFooter(): void;
}
