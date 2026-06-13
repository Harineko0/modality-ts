import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replayTrace, StateSequenceDriver, statesFromTrace } from "@modality-ts/harness";
import { canonicalJson, parseTraceArtifact, type ModelState, type ReplayReport } from "@modality-ts/kernel";

export interface ReplayCommandOptions {
  tracePath: string;
  statesPath?: string;
  observedPath?: string;
  reportPath?: string;
  now?: Date;
}

export interface ReplayCommandResult {
  report: ReplayReport;
  exitCode: number;
  lines: string[];
}

export async function runReplayCommand(options: ReplayCommandOptions): Promise<ReplayCommandResult> {
  const trace = parseTraceArtifact(await readFile(options.tracePath, "utf8"));
  const states = await replayStates(options, trace);
  const verdict = await replayTrace(trace, new StateSequenceDriver(states), {
    compareState: options.observedPath ? compareObservedState : undefined
  });
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

async function replayStates(options: ReplayCommandOptions, trace: ReturnType<typeof parseTraceArtifact>): Promise<ModelState[]> {
  if (options.observedPath) return JSON.parse(await readFile(options.observedPath, "utf8")) as ModelState[];
  if (options.statesPath) return JSON.parse(await readFile(options.statesPath, "utf8")) as ModelState[];
  return statesFromTrace(trace);
}

function compareObservedState(expected: ModelState, observed: ModelState): string | undefined {
  for (const key of Object.keys(observed).sort()) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(observed[key])) {
      return `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(observed[key])}`;
    }
  }
  return undefined;
}

export function renderReplayReport(report: ReplayReport): string[] {
  const lines = [`replay: ${report.verdict.status}`, `stepsRun=${report.verdict.stepsRun}`];
  if (report.verdict.divergenceStep !== undefined) lines.push(`divergenceStep=${report.verdict.divergenceStep}`);
  if (report.verdict.reason) lines.push(`reason=${report.verdict.reason}`);
  return lines;
}
