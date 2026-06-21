import { performance } from "node:perf_hooks";
import type { Reporter, ReporterSession } from "./types.js";

export class BasicReporter implements Reporter {
  async run<T>(session: ReporterSession<T>): Promise<T[]> {
    const { tasks, renderFooter, startedMs } = session;
    const origin = startedMs ?? performance.now();
    const entries: T[] = [];

    for (const task of tasks) {
      const outcome = await task.run();
      entries.push(outcome.entry);
      for (const line of outcome.lines) console.log(line);
    }

    const footerLines = renderFooter({
      entries,
      elapsedMs: performance.now() - origin,
      total: tasks.length,
      final: true,
    });
    for (const line of footerLines) console.log(line);

    return entries;
  }
}
