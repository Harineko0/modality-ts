import { join } from "node:path";
import { runConformCommand } from "../../src/cli/conform.js";
import type { ConformReport } from "modality-ts/core";

export interface BehaviourOracleSettings {
  walkCount?: number;
  depth?: number;
  seed?: number;
}

export interface BehaviourOracleInput {
  baselineModelPath: string;
  baselineHarnessPath: string;
  mutantModelPath: string;
  mutantHarnessPath: string;
  workDir: string;
  fixtureId: string;
  settings?: BehaviourOracleSettings;
  now?: Date;
}

export interface BehaviourOracleResult {
  preserved: boolean;
  baselineReport: ConformReport;
  mutantReport: ConformReport;
  differences: string[];
}

const defaultSettings = {
  walkCount: 16,
  depth: 8,
  seed: 26062304,
};

export async function compareSeededBehaviour(
  input: BehaviourOracleInput,
): Promise<BehaviourOracleResult> {
  const settings = { ...defaultSettings, ...(input.settings ?? {}) };
  const baseline = await runConformCommand({
    modelPath: input.baselineModelPath,
    mode: "action",
    harnessPath: input.baselineHarnessPath,
    walkCount: settings.walkCount,
    depth: settings.depth,
    seed: settings.seed,
    fixtureId: input.fixtureId,
    reportPath: join(input.workDir, "baseline-conform.json"),
    now: input.now,
  });
  const mutant = await runConformCommand({
    modelPath: input.mutantModelPath,
    mode: "action",
    harnessPath: input.mutantHarnessPath,
    walkCount: settings.walkCount,
    depth: settings.depth,
    seed: settings.seed,
    fixtureId: input.fixtureId,
    reportPath: join(input.workDir, "mutant-conform.json"),
    now: input.now,
  });
  const differences = compareReports(baseline.report, mutant.report);
  return {
    preserved: differences.length === 0,
    baselineReport: baseline.report,
    mutantReport: mutant.report,
    differences,
  };
}

function compareReports(
  baseline: ConformReport,
  mutant: ConformReport,
): string[] {
  const differences: string[] = [];
  if (baseline.walks.length !== mutant.walks.length) {
    differences.push(
      `walk count changed ${baseline.walks.length} -> ${mutant.walks.length}`,
    );
  }
  const mutantById = new Map(mutant.walks.map((walk) => [walk.id, walk]));
  for (const baselineWalk of baseline.walks) {
    const mutantWalk = mutantById.get(baselineWalk.id);
    if (!mutantWalk) {
      differences.push(`missing mutant walk ${baselineWalk.id}`);
      continue;
    }
    if (baselineWalk.status !== mutantWalk.status) {
      differences.push(
        `${baselineWalk.id} status ${baselineWalk.status} -> ${mutantWalk.status}`,
      );
    }
    if (baselineWalk.stepsRun !== mutantWalk.stepsRun) {
      differences.push(
        `${baselineWalk.id} steps ${baselineWalk.stepsRun} -> ${mutantWalk.stepsRun}`,
      );
    }
    if ((baselineWalk.reason ?? "") !== (mutantWalk.reason ?? "")) {
      differences.push(`${baselineWalk.id} reason changed`);
    }
    if ((baselineWalk.crashReason ?? "") !== (mutantWalk.crashReason ?? "")) {
      differences.push(`${baselineWalk.id} crash changed`);
    }
  }
  return differences;
}

/**
 * Walk ids where the mutant app crashed during render but the baseline did not.
 * A newly-introduced render crash is a behavioural divergence the model cannot
 * see (an error boundary preserves the surrounding observable state), so it is
 * surfaced here for the kill decision.
 */
export function newCrashWalks(
  baseline: ConformReport,
  mutant: ConformReport,
): string[] {
  const baselineCrashed = new Set(
    baseline.walks
      .filter((walk) => walk.crashReason !== undefined)
      .map((walk) => walk.id),
  );
  return mutant.walks
    .filter(
      (walk) => walk.crashReason !== undefined && !baselineCrashed.has(walk.id),
    )
    .map((walk) => walk.id)
    .sort();
}
