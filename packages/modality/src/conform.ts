import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replayTrace, StateSequenceDriver, type ReplayVerdict } from "@modality/harness";
import { canonicalJson, type ConformReport, type ModelState, type Trace } from "@modality/kernel";

export interface ConformWalkArtifact {
  id: string;
  trace: Trace;
  states: ModelState[];
}

export interface ConformCommandOptions {
  walksPath: string;
  reportPath?: string;
  now?: Date;
}

export interface ConformCommandResult {
  report: ConformReport;
  exitCode: number;
  lines: string[];
}

export async function runConformCommand(options: ConformCommandOptions): Promise<ConformCommandResult> {
  const walks = JSON.parse(await readFile(options.walksPath, "utf8")) as ConformWalkArtifact[];
  const verdicts = await Promise.all(
    walks.map(async (walk) => ({
      id: walk.id,
      verdict: await replayTrace(walk.trace, new StateSequenceDriver(walk.states))
    }))
  );
  const report = createConformReport(verdicts, options.now ?? new Date());
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  return {
    report,
    exitCode: report.metrics.notReproduced > 0 ? 2 : report.metrics.inconclusive > 0 ? 3 : 0,
    lines: renderConformReport(report)
  };
}

function createConformReport(verdicts: readonly { id: string; verdict: ReplayVerdict }[], now: Date): ConformReport {
  const walks = verdicts.map(({ id, verdict }) => ({ id, ...verdict }));
  const reproduced = walks.filter((walk) => walk.status === "reproduced").length;
  const notReproduced = walks.filter((walk) => walk.status === "not-reproduced").length;
  const inconclusive = walks.filter((walk) => walk.status === "inconclusive").length;
  return {
    schemaVersion: 1,
    kind: "conform-report",
    generatedAt: now.toISOString(),
    walks,
    metrics: {
      total: walks.length,
      reproduced,
      notReproduced,
      inconclusive,
      passRate: walks.length === 0 ? 1 : reproduced / walks.length
    }
  };
}

function renderConformReport(report: ConformReport): string[] {
  return [
    `conform: total=${report.metrics.total} reproduced=${report.metrics.reproduced} notReproduced=${report.metrics.notReproduced} inconclusive=${report.metrics.inconclusive}`,
    `passRate=${report.metrics.passRate}`
  ];
}
