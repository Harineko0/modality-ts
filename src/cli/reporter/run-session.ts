import { performance } from "node:perf_hooks";
import type { Reporter, ReporterTask, RunMeta, } from "./types.js";

export async function runReport<TEntry>(args: {
  reporter: Reporter;
  meta: RunMeta;
  tasks: Array<ReporterTask<TEntry>>;
  renderSummary: (
    entries: readonly TEntry[],
    totalDurationMs: number,
  ) => readonly string[];
  startedMs: number;
}): Promise<TEntry[]> {
  const { reporter, meta, tasks, renderSummary, startedMs } = args;

  const outcomes = await reporter.runTasks(meta, tasks);

  for (const outcome of outcomes) {
    reporter.log(outcome.lines);
  }

  const entries = outcomes.map((o) => o.entry);
  reporter.log(renderSummary(entries, performance.now() - startedMs));

  return entries;
}
