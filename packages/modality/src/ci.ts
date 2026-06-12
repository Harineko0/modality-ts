import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runCheckCommand } from "./check.js";

export interface CiCommandOptions {
  modelPath: string;
  propsPath?: string;
  artifactDir: string;
  overlayPath?: string;
  now?: Date;
}

export interface CiCommandResult {
  exitCode: number;
  lines: string[];
  reportPath: string;
  tracesDir: string;
}

export async function runCiCommand(options: CiCommandOptions): Promise<CiCommandResult> {
  await mkdir(options.artifactDir, { recursive: true });
  const reportPath = join(options.artifactDir, "report.json");
  const tracesDir = join(options.artifactDir, "traces");
  const check = await runCheckCommand({
    modelPath: options.modelPath,
    propsPath: options.propsPath,
    overlayPath: options.overlayPath,
    reportPath,
    tracesDir,
    now: options.now
  });
  const violationCount = check.check.verdicts.filter((verdict) => verdict.status === "violated").length;
  const errorCount = check.check.verdicts.filter((verdict) => verdict.status === "error").length;
  const exitCode = violationCount > 0 || errorCount > 0 ? 2 : 0;
  return {
    exitCode,
    reportPath,
    tracesDir,
    lines: [
      `ci: ${exitCode === 0 ? "passed" : "failed"}`,
      `violations=${violationCount} errors=${errorCount}`,
      `report=${reportPath}`,
      `traces=${tracesDir}`
    ]
  };
}
