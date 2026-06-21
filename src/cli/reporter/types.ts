export type { StatusKind } from "../output.js";

export interface RunMeta {
  command: "check" | "extract" | "generate";
  startedAt: Date;
  concurrency?: number;
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

export interface FooterContext<T> {
  entries: readonly T[];
  elapsedMs: number;
  total: number;
  final: boolean;
}

export interface ReporterSession<T> {
  meta: RunMeta;
  tasks: ReporterTask<T>[];
  renderFooter: (ctx: FooterContext<T>) => readonly string[];
  startedMs?: number;
}

export interface Reporter {
  run<T>(session: ReporterSession<T>): Promise<T[]>;
}
