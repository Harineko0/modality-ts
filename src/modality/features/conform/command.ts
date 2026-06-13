import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { replayTrace, StateSequenceDriver, statesFromTrace, type ReplayVerdict } from "modality-ts/harness";
import { modelInitialStates, modelSuccessors } from "modality-ts/checker";
import { canonicalJson, parseModelArtifact, type ConformReport, type Model, type ModelState, type Trace, type TraceStep } from "modality-ts/kernel";

export interface ConformWalkArtifact {
  id: string;
  trace: Trace;
  states?: ModelState[];
  observedStates?: ModelState[];
}

export interface ConformWalksArtifact {
  schemaVersion: 1;
  kind: "conform-walks";
  walks: readonly ConformWalkArtifact[];
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
      trace: walk.trace,
      verdict: await replayTrace(walk.trace, new StateSequenceDriver(walk.observedStates ?? walk.states ?? statesFromTrace(walk.trace)), {
        compareState: walk.observedStates ? compareObservedState : undefined
      })
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
  if (options.walksPath) return parseConformWalksArtifact(await readFile(options.walksPath, "utf8")).walks.slice();
  if (!options.modelPath) throw new Error("runConformCommand requires walksPath or modelPath");
  const model = parseModelArtifact(await readFile(options.modelPath, "utf8"));
  return generateConformWalks(model, { count: options.walkCount, depth: options.depth, seed: options.seed });
}

export function conformWalksArtifact(walks: readonly ConformWalkArtifact[]): ConformWalksArtifact {
  return { schemaVersion: 1, kind: "conform-walks", walks };
}

export function parseConformWalksArtifact(json: string): ConformWalksArtifact {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("conform walks artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported conform walks schemaVersion ${String(value.schemaVersion)}`);
  if (value.kind !== "conform-walks") throw new Error("conform walks artifact kind must be conform-walks");
  if (!Array.isArray(value.walks)) throw new Error("conform walks artifact missing walks");
  for (const [index, walk] of value.walks.entries()) validateConformWalk(walk, index);
  return value as unknown as ConformWalksArtifact;
}

function validateConformWalk(value: unknown, index: number): void {
  if (!isRecord(value) || typeof value.id !== "string" || !isRecord(value.trace) || !Array.isArray(value.trace.steps)) {
    throw new Error(`conform walk ${index + 1} is malformed`);
  }
  if (value.states !== undefined && !Array.isArray(value.states)) throw new Error(`conform walk ${index + 1} states must be an array`);
  if (value.observedStates !== undefined && !Array.isArray(value.observedStates)) throw new Error(`conform walk ${index + 1} observedStates must be an array`);
}

function createConformReport(verdicts: readonly { id: string; trace: Trace; verdict: ReplayVerdict }[], now: Date): ConformReport {
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
    },
    transitionMetrics: transitionMetrics(verdicts)
  };
}

function transitionMetrics(verdicts: readonly { trace: Trace; verdict: ReplayVerdict }[]): ConformReport["transitionMetrics"] {
  const metrics = new Map<string, { walks: number; reproduced: number; notReproduced: number; inconclusive: number }>();
  for (const { trace, verdict } of verdicts) {
    const touched = new Set(trace.steps.map((step) => step.transitionId));
    for (const transitionId of touched) {
      const entry = metrics.get(transitionId) ?? { walks: 0, reproduced: 0, notReproduced: 0, inconclusive: 0 };
      entry.walks += 1;
      if (verdict.status === "reproduced") entry.reproduced += 1;
      else if (verdict.status === "not-reproduced") entry.notReproduced += 1;
      else entry.inconclusive += 1;
      metrics.set(transitionId, entry);
    }
  }
  return [...metrics]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([transitionId, entry]) => ({
      transitionId,
      ...entry,
      passRate: entry.walks === 0 ? 1 : entry.reproduced / entry.walks
    }));
}

function compareObservedState(expected: ModelState, observed: ModelState): string | undefined {
  for (const key of Object.keys(observed).sort()) {
    if (JSON.stringify(expected[key]) !== JSON.stringify(observed[key])) {
      return `${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(observed[key])}`;
    }
  }
  return undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
