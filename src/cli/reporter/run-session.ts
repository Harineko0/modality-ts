import type { FooterContext, Reporter, ReporterTask, RunMeta } from "./types.js";

export async function runReport<TEntry>(args: {
  reporter: Reporter;
  meta: RunMeta;
  tasks: Array<ReporterTask<TEntry>>;
  renderFooter: (ctx: FooterContext<TEntry>) => readonly string[];
  startedMs: number;
}): Promise<TEntry[]> {
  const { reporter, meta, tasks, renderFooter, startedMs } = args;
  return reporter.run({ meta, tasks, renderFooter, startedMs });
}
