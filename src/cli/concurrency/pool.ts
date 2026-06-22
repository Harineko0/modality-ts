import { Worker } from "node:worker_threads";
import { runCheckCommand } from "../features/check/command.js";
import { runExtractCommand } from "../features/extract/command.js";
import { runGenerateCommand } from "../features/generate/command.js";
import type { CommandJob, JobResultMap, WorkerResponse } from "./jobs.js";

interface PooledWorker {
  worker: Worker;
  busy: boolean;
}

interface PendingEntry {
  job: CommandJob;
  resolve: (result: JobResultMap[CommandJob["command"]]) => void;
  reject: (error: Error) => void;
}

export interface CommandPool {
  run<K extends CommandJob["command"]>(
    job: Extract<CommandJob, { command: K }>,
  ): Promise<JobResultMap[K]>;
  dispose(): Promise<void>;
}

export function createCommandPool(size: number): CommandPool {
  if (size <= 1) return createInlinePool();

  // ESM type is determined by package.json "type": "module"; no explicit option needed
  const workerUrl = new URL("./command-worker.js", import.meta.url);
  const pooled: PooledWorker[] = Array.from({ length: size }, () => ({
    worker: new Worker(workerUrl),
    busy: false,
  }));
  const queue: PendingEntry[] = [];

  function dispatch(slot: PooledWorker, entry: PendingEntry): void {
    slot.busy = true;
    const { job, resolve, reject } = entry;

    function onMessage(response: WorkerResponse): void {
      slot.worker.off("message", onMessage);
      slot.worker.off("error", onError);
      slot.busy = false;
      drainQueue();
      if (response.ok) {
        resolve(response.result as JobResultMap[CommandJob["command"]]);
      } else {
        const err = new Error(response.error.message);
        if (response.error.stack) err.stack = response.error.stack;
        reject(err);
      }
    }

    function onError(err: Error): void {
      slot.worker.off("message", onMessage);
      slot.worker.off("error", onError);
      slot.busy = false;
      drainQueue();
      reject(err);
    }

    slot.worker.on("message", onMessage);
    slot.worker.on("error", onError);
    slot.worker.postMessage(job);
  }

  function drainQueue(): void {
    if (queue.length === 0) return;
    const idle = pooled.find((s) => !s.busy);
    if (!idle) return;
    dispatch(idle, queue.shift()!);
  }

  return {
    run<K extends CommandJob["command"]>(
      job: Extract<CommandJob, { command: K }>,
    ): Promise<JobResultMap[K]> {
      return new Promise<JobResultMap[K]>((resolve, reject) => {
        const entry: PendingEntry = {
          job,
          resolve: resolve as PendingEntry["resolve"],
          reject,
        };
        const idle = pooled.find((s) => !s.busy);
        if (idle) {
          dispatch(idle, entry);
        } else {
          queue.push(entry);
        }
      });
    },
    async dispose(): Promise<void> {
      await Promise.all(pooled.map((s) => s.worker.terminate()));
    },
  };
}

function createInlinePool(): CommandPool {
  // Use a plain function so TypeScript can narrow job.command properly
  async function runInline(
    job: CommandJob,
  ): Promise<JobResultMap[CommandJob["command"]]> {
    if (job.command === "generate") {
      return runGenerateCommand(job.options);
    } else if (job.command === "extract") {
      const {
        model: _model,
        lines: _lines,
        appModelPath: _appModelPath,
        ...result
      } = await runExtractCommand(job.options);
      return result;
    } else {
      const { lines: _lines, ...result } = await runCheckCommand(job.options);
      return result;
    }
  }

  return {
    run: runInline as CommandPool["run"],
    async dispose(): Promise<void> {},
  };
}
