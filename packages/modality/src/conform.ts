import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replayTrace, StateSequenceDriver, type ReplayVerdict } from "@modality/harness";
import { modelInitialStates, modelSuccessors } from "@modality/checker";
import { canonicalJson, parseModelArtifact, type ConformReport, type Model, type ModelState, type Trace, type TraceStep } from "@modality/kernel";

export interface ConformWalkArtifact {
  id: string;
  trace: Trace;
  states: ModelState[];
}

export interface ConformCommandOptions {
  walksPath?: string;
  modelPath?: string;
  reportPath?: string;
  walkCount?: number;
  depth?: number;
  seed?: number;
  now?: Date;
}

export interface ConformCommandResult {
  report: ConformReport;
  exitCode: number;
  lines: string[];
}

export async function runConformCommand(options: ConformCommandOptions): Promise<ConformCommandResult> {
  const walks = await loadOrGenerateWalks(options);
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

export function generateConformWalks(model: Model, options: { count?: number; depth?: number; seed?: number } = {}): ConformWalkArtifact[] {
  const count = options.count ?? 8;
  const depth = options.depth ?? model.bounds.maxDepth;
  const rand = lcg(options.seed ?? 1);
  const initials = modelInitialStates(model);
  const transitionRanks = new Map(model.transitions.map((transition) => [transition.id, confidenceRank(transition.confidence)]));
  const walks: ConformWalkArtifact[] = [];
  for (let index = 0; index < count; index += 1) {
    const start = initials[index % Math.max(initials.length, 1)];
    if (!start) break;
    const steps: TraceStep[] = [];
    const states: ModelState[] = [start];
    let current = start;
    for (let stepIndex = 0; stepIndex < depth; stepIndex += 1) {
      const successors = modelSuccessors(model, current).sort((a, b) =>
        (transitionRanks.get(a.transitionId) ?? 9) - (transitionRanks.get(b.transitionId) ?? 9) || a.transitionId.localeCompare(b.transitionId) || canonicalJson(a.post).localeCompare(canonicalJson(b.post))
      );
      if (successors.length === 0) break;
      const next = successors[Math.floor(rand() * successors.length)]!;
      steps.push(next);
      states.push(next.post);
      current = next.post;
    }
    walks.push({ id: `walk-${index + 1}`, trace: { steps }, states });
  }
  return walks;
}

async function loadOrGenerateWalks(options: ConformCommandOptions): Promise<ConformWalkArtifact[]> {
  if (options.walksPath) return JSON.parse(await readFile(options.walksPath, "utf8")) as ConformWalkArtifact[];
  if (!options.modelPath) throw new Error("runConformCommand requires walksPath or modelPath");
  const model = parseModelArtifact(await readFile(options.modelPath, "utf8"));
  return generateConformWalks(model, { count: options.walkCount, depth: options.depth, seed: options.seed });
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

function confidenceRank(confidence: Model["transitions"][number]["confidence"]): number {
  if (confidence === "exact") return 0;
  if (confidence === "over-approx") return 1;
  return 2;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
