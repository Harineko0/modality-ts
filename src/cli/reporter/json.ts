import type { Reporter, ReporterSession } from "./types.js";

export class JsonReporter implements Reporter {
  async run<T>(session: ReporterSession<T>): Promise<T[]> {
    const { meta, tasks } = session;
    const outcomes = await Promise.all(tasks.map((t) => t.run()));
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
    return outcomes.map((o) => o.entry);
  }
}
