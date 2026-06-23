import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CheckReport,
  canonicalJson,
  type ExtractionReport,
  type Model,
  type ReplayReport,
} from "modality-ts/core";
import { runCheckCommand } from "../../src/cli/check.ts";
import { runExtractCommand } from "../../src/cli/extract.ts";
import { runReplayCommand } from "../../src/cli/replay.ts";

export interface ExtractCheckReplayInput {
  appRoot: string;
  sourcePaths: readonly string[];
  propsPaths: readonly string[];
  effectApis?: readonly string[];
  searchLimits?: {
    maxStates?: number;
    maxEdges?: number;
    maxFrontier?: number;
    memoryGuardMb?: number;
  };
  workDir: string;
  packageJsonPath?: string;
  configPath?: string;
  harnessPath?: string;
}

export interface ReplayVerdictEntry {
  property: string;
  status: ReplayReport["verdict"]["status"];
  report?: ReplayReport;
}

export interface ExtractCheckReplayResult {
  model: Model;
  extractReport: ExtractionReport;
  checkReport: CheckReport;
  replayVerdicts: Map<string, ReplayVerdictEntry>;
  artifactPaths: {
    model: string;
    extractReport: string;
    checkReport: string;
    tracesDir: string;
  };
}

export async function extractCheckReplayOnce(
  input: ExtractCheckReplayInput,
): Promise<ExtractCheckReplayResult> {
  await mkdir(input.workDir, { recursive: true });
  const modelPath = join(input.workDir, "model.json");
  const extractReportPath = join(input.workDir, "extract-report.json");
  const checkReportPath = join(input.workDir, "check-report.json");
  const tracesDir = join(input.workDir, "traces");
  const sourcePaths = input.sourcePaths.map((path) =>
    join(input.appRoot, path),
  );
  const propsPaths = input.propsPaths.map((path) => join(input.appRoot, path));
  const extracted = await runExtractCommand({
    sourcePaths,
    modelPath,
    reportPath: extractReportPath,
    packageJsonPath:
      input.packageJsonPath ?? join(input.appRoot, "package.json"),
    configPath: input.configPath ?? join(input.appRoot, "modality.config.ts"),
    effectApis: input.effectApis,
    propsPaths,
  });

  const model = dedupeModelVars(extracted.model);
  await writeFile(modelPath, `${canonicalJson(model)}\n`, "utf8");
  const checked = await runCheckCommand({
    modelPath,
    propsPaths,
    reportPath: checkReportPath,
    tracesDir,
    searchLimits: toCheckSearchLimits(input.searchLimits),
  });
  const replayVerdicts = await replayViolations({
    tracesDir,
    checkReport: checked.report,
    harnessPath: input.harnessPath,
  });
  return {
    model,
    extractReport: extracted.report,
    checkReport: checked.report,
    replayVerdicts,
    artifactPaths: {
      model: modelPath,
      extractReport: extractReportPath,
      checkReport: checkReportPath,
      tracesDir,
    },
  };
}

function dedupeModelVars(model: Model): Model {
  const seen = new Set<string>();
  const vars = model.vars.filter((decl) => {
    if (seen.has(decl.id)) return false;
    seen.add(decl.id);
    return true;
  });
  if (vars.length === model.vars.length) return model;
  return { ...model, vars };
}

async function replayViolations(input: {
  tracesDir: string;
  checkReport: CheckReport;
  harnessPath?: string;
}): Promise<Map<string, ReplayVerdictEntry>> {
  const replayByProperty = new Map<string, ReplayVerdictEntry>();
  const violated = input.checkReport.verdicts.filter(
    (entry) => entry.status === "violated",
  );
  let traceNames: string[] = [];
  try {
    traceNames = (await readdir(input.tracesDir))
      .filter((name) => name.endsWith(".violated.trace.json"))
      .sort();
  } catch {
    return replayByProperty;
  }

  for (const verdict of violated) {
    const traceName = traceNames.find((name) =>
      name.includes(sanitizeTraceKey(verdict.property)),
    );
    if (!traceName) continue;
    const replay = await runReplayCommand({
      tracePath: join(input.tracesDir, traceName),
      ...(input.harnessPath
        ? { mode: "action" as const, harnessPath: input.harnessPath }
        : {}),
    });
    replayByProperty.set(verdict.property, {
      property: verdict.property,
      status: replay.report.verdict.status,
      report: replay.report,
    });
  }
  return replayByProperty;
}

function sanitizeTraceKey(property: string): string {
  return property.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toCheckSearchLimits(
  searchLimits: ExtractCheckReplayInput["searchLimits"],
):
  | {
      maxStates?: number;
      maxEdges?: number;
      maxFrontier?: number;
      memoryGuardBytes?: number;
    }
  | undefined {
  if (!searchLimits) return undefined;
  return {
    maxStates: searchLimits.maxStates,
    maxEdges: searchLimits.maxEdges,
    maxFrontier: searchLimits.maxFrontier,
    ...(searchLimits.memoryGuardMb !== undefined
      ? { memoryGuardBytes: searchLimits.memoryGuardMb * 1024 * 1024 }
      : {}),
  };
}

export async function readPackageDependencies(
  packageJsonPath: string,
): Promise<Record<string, string>> {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return packageJson.dependencies ?? {};
}
