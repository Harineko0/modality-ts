import { performance } from "node:perf_hooks";
import cliTruncate from "cli-truncate";
import { createDynamicRegion } from "./dynamic-region.js";
import type {
  FooterContext,
  Reporter,
  ReporterSession,
} from "./types.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function statusIcon(status: "pass" | "fail" | "warn"): string {
  switch (status) {
    case "pass":
      return "✓";
    case "fail":
      return "×";
    case "warn":
      return "⚠";
  }
}

async function runPool<T>(
  fns: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(fns.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < fns.length) {
      const i = next++;
      results[i] = await fns[i]!();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, fns.length || 1) }, () => worker()),
  );
  return results;
}

export class DefaultReporter implements Reporter {
  private readonly isTTY = process.stdout.isTTY === true;

  async run<T>(session: ReporterSession<T>): Promise<T[]> {
    const { meta, tasks, renderFooter, startedMs } = session;
    const origin = startedMs ?? performance.now();
    const concurrency = meta.concurrency ?? 1;

    if (!this.isTTY) {
      return this.runPlain(tasks, concurrency, origin, renderFooter);
    }
    return this.runLive(tasks, concurrency, origin, renderFooter);
  }

  private async runPlain<T>(
    tasks: ReporterSession<T>["tasks"],
    concurrency: number,
    origin: number,
    renderFooter: (ctx: FooterContext<T>) => readonly string[],
  ): Promise<T[]> {
    const entries: T[] = [];

    await runPool(
      tasks.map((task) => async () => {
        const outcome = await task.run();
        entries.push(outcome.entry);
        for (const line of outcome.lines) process.stdout.write(`${line}\n`);
      }),
      concurrency,
    );

    const footerLines = renderFooter({
      entries,
      elapsedMs: performance.now() - origin,
      total: tasks.length,
      final: true,
    });
    for (const line of footerLines) process.stdout.write(`${line}\n`);

    return entries;
  }

  private async runLive<T>(
    tasks: ReporterSession<T>["tasks"],
    concurrency: number,
    origin: number,
    renderFooter: (ctx: FooterContext<T>) => readonly string[],
  ): Promise<T[]> {
    const region = createDynamicRegion();
    const cols = () => process.stdout.columns ?? 80;

    type TaskStatus = "pending" | "running" | "done";
    const taskStatus: TaskStatus[] = tasks.map(() => "pending");
    const pendingCommits: Array<readonly string[]> = [];
    const doneEntries: T[] = [];
    let spinnerFrame = 0;

    function buildLiveLines(): string[] {
      const lines: string[] = [];
      for (let i = 0; i < tasks.length; i++) {
        if (taskStatus[i] === "running") {
          const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]!;
          lines.push(cliTruncate(` ${frame} ${tasks[i]!.title}`, cols()));
        }
      }
      if (lines.length > 0) lines.push("");
      const footerLines = renderFooter({
        entries: doneEntries,
        elapsedMs: performance.now() - origin,
        total: tasks.length,
        final: false,
      });
      for (const fl of footerLines) {
        lines.push(cliTruncate(fl, cols()));
      }
      return lines;
    }

    function tick() {
      spinnerFrame++;
      const toFlush = pendingCommits.splice(0);
      if (toFlush.length > 0) {
        region.clear();
        for (const block of toFlush) {
          for (const line of block) process.stdout.write(`${line}\n`);
        }
      }
      region.update(buildLiveLines());
    }

    region.update(buildLiveLines());
    const timer = setInterval(tick, 80);

    await runPool(
      tasks.map((task, i) => async () => {
        taskStatus[i] = "running";
        const outcome = await task.run();
        taskStatus[i] = "done";
        doneEntries.push(outcome.entry);
        pendingCommits.push(outcome.lines);
      }),
      concurrency,
    );

    clearInterval(timer);

    region.clear();
    for (const block of pendingCommits) {
      for (const line of block) process.stdout.write(`${line}\n`);
    }

    const finalFooter = renderFooter({
      entries: doneEntries,
      elapsedMs: performance.now() - origin,
      total: tasks.length,
      final: true,
    });
    for (const line of finalFooter) process.stdout.write(`${line}\n`);

    return doneEntries;
  }
}
