import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replayTrace, StateSequenceDriver } from "@modality/harness";
import { canonicalJson, type ModelState, type ReplayReport, type Trace } from "@modality/kernel";

export interface ReplayCommandOptions {
  tracePath: string;
  statesPath: string;
  reportPath?: string;
  now?: Date;
}

export interface ReplayCommandResult {
  report: ReplayReport;
  exitCode: number;
  lines: string[];
}

export async function runReplayCommand(options: ReplayCommandOptions): Promise<ReplayCommandResult> {
  const trace = JSON.parse(await readFile(options.tracePath, "utf8")) as Trace;
  const states = JSON.parse(await readFile(options.statesPath, "utf8")) as ModelState[];
  const verdict = await replayTrace(trace, new StateSequenceDriver(states));
  const report: ReplayReport = {
    schemaVersion: 1,
    kind: "replay-report",
    generatedAt: (options.now ?? new Date()).toISOString(),
    verdict
  };
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  return {
    report,
    exitCode: verdict.status === "reproduced" ? 0 : verdict.status === "not-reproduced" ? 2 : 3,
    lines: renderReplayReport(report)
  };
}

export function renderReplayReport(report: ReplayReport): string[] {
  const lines = [`replay: ${report.verdict.status}`, `stepsRun=${report.verdict.stepsRun}`];
  if (report.verdict.divergenceStep !== undefined) lines.push(`divergenceStep=${report.verdict.divergenceStep}`);
  if (report.verdict.reason) lines.push(`reason=${report.verdict.reason}`);
  return lines;
}
