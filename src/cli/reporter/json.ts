import type { Reporter, ReporterTask, RunMeta, TargetOutcome } from "./types.js";

export class JsonReporter implements Reporter {
  async runTasks<T>(
    meta: RunMeta,
    tasks: ReporterTask<T>[],
  ): Promise<TargetOutcome<T>[]> {
    const outcomes: TargetOutcome<T>[] = [];
    for (const t of tasks) {
      outcomes.push(await t.run());
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          command: meta.command,
          startedAt: meta.startedAt.toISOString(),
          targets: outcomes.map((o) => ({
            status: o.status,
            entry: o.entry,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return outcomes;
  }

  async task<T>(_title: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  log(): void {}
  setFooter(): void {}
  clearFooter(): void {}
}
