import cliTruncate from "cli-truncate";
import { Listr } from "listr2";
import ora from "ora";
import { createDynamicRegion } from "./dynamic-region.js";
import type { Reporter, ReporterTask, RunMeta, TargetOutcome } from "./types.js";

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

export class DefaultReporter implements Reporter {
  private readonly isTTY = process.stdout.isTTY === true;
  private readonly region = createDynamicRegion();

  async runTasks<T>(
    meta: RunMeta,
    tasks: ReporterTask<T>[],
  ): Promise<TargetOutcome<T>[]> {
    const outcomes: Array<TargetOutcome<T> | undefined> = new Array(
      tasks.length,
    );

    if (tasks.length > 1 && this.isTTY) {
      const listr = new Listr(
        tasks.map((task, i) => ({
          title: task.title,
          task: async (): Promise<void> => {
            const outcome = await task.run();
            outcomes[i] = outcome;
            if (outcome.status === "fail") {
              throw new Error(task.title);
            }
          },
        })),
        { concurrent: meta.concurrency ?? 1, exitOnError: false },
      );
      await listr.run();
    } else {
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        const spinner = ora({ text: task.title, stream: process.stderr }).start();
        try {
          const outcome = await task.run();
          outcomes[i] = outcome;
          spinner.stopAndPersist({
            symbol: statusIcon(outcome.status),
            text: task.title,
          });
        } catch (e) {
          spinner.fail(task.title);
          throw e;
        }
      }
    }

    return outcomes as TargetOutcome<T>[];
  }

  async task<T>(title: string, fn: () => Promise<T>): Promise<T> {
    const spinner = ora({ text: title, stream: process.stderr }).start();
    try {
      const result = await fn();
      spinner.succeed(title);
      return result;
    } catch (e) {
      spinner.fail(title);
      throw e;
    }
  }

  log(lines: readonly string[], opts?: { truncate?: boolean }): void {
    const cols = process.stdout.columns ?? 80;
    const shouldTruncate = this.isTTY && opts?.truncate !== false;
    for (const line of lines) {
      console.log(shouldTruncate ? cliTruncate(line, cols) : line);
    }
  }

  setFooter(lines: readonly string[]): void {
    this.region.update(lines);
  }

  clearFooter(): void {
    this.region.clear();
  }
}
