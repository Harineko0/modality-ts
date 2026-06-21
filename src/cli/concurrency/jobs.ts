import type {
  GenerateCommandOptions,
  GenerateTargetResult,
} from "../features/generate/command.js";
import type {
  ExtractCommandOptions,
  ExtractCommandResult,
} from "../features/extract/command.js";
import type {
  CheckCommandOptions,
  CheckCommandResult,
} from "../features/check/command.js";

export type GenerateJobOptions = Omit<GenerateCommandOptions, "now">;
export type ExtractJobOptions = Omit<
  ExtractCommandOptions,
  "sourcePlugins" | "domainRefinements" | "routerPlugin" | "now"
>;
export type CheckJobOptions = Omit<CheckCommandOptions, "output" | "now">;

export type CommandJob =
  | { command: "generate"; options: GenerateJobOptions }
  | { command: "extract"; options: ExtractJobOptions }
  | { command: "check"; options: CheckJobOptions };

export type GenerateWorkerResult = GenerateTargetResult;
// Drop model (large), lines and appModelPath (not read by CLI tasks)
export type ExtractWorkerResult = Omit<
  ExtractCommandResult,
  "model" | "lines" | "appModelPath"
>;
export type CheckWorkerResult = Omit<CheckCommandResult, "lines">;

export type WorkerResponse =
  | { ok: true; command: "generate"; result: GenerateWorkerResult }
  | { ok: true; command: "extract"; result: ExtractWorkerResult }
  | { ok: true; command: "check"; result: CheckWorkerResult }
  | { ok: false; error: { message: string; stack?: string } };

export type JobResultMap = {
  generate: GenerateWorkerResult;
  extract: ExtractWorkerResult;
  check: CheckWorkerResult;
};
