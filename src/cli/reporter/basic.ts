import type { Reporter, ReporterTask, RunMeta, TargetOutcome } from "./types.js";

export class BasicReporter implements Reporter {
  async runTasks<T>(
    _meta: RunMeta,
    tasks: ReporterTask<T>[],
  ): Promise<TargetOutcome<T>[]> {
    return Promise.all(tasks.map((t) => t.run()));
  }

  async task<T>(_title: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  log(lines: readonly string[]): void {
    for (const line of lines) console.log(line);
  }

  setFooter(): void {}
  clearFooter(): void {}
}
