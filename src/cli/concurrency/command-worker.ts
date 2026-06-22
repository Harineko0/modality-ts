import { parentPort } from "node:worker_threads";
import { runCheckCommand } from "../features/check/command.js";
import { runExtractCommand } from "../features/extract/command.js";
import { runGenerateCommand } from "../features/generate/command.js";
import type { CommandJob, WorkerResponse } from "./jobs.js";

if (!parentPort) throw new Error("command-worker must run in a worker thread");

parentPort.on("message", async (job: CommandJob) => {
  try {
    let response: WorkerResponse;
    if (job.command === "generate") {
      const result = await runGenerateCommand(job.options);
      response = { ok: true, command: "generate", result };
    } else if (job.command === "extract") {
      const {
        model: _model,
        lines: _lines,
        appModelPath: _appModelPath,
        ...result
      } = await runExtractCommand(job.options);
      response = { ok: true, command: "extract", result };
    } else {
      const { lines: _lines, ...result } = await runCheckCommand(job.options);
      response = { ok: true, command: "check", result };
    }
    parentPort!.postMessage(response);
  } catch (error) {
    const response: WorkerResponse = {
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
    parentPort!.postMessage(response);
  }
});
