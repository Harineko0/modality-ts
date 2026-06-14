#!/usr/bin/env node
import {
  defaultActionReplayTestsDir,
  defaultAppModelPath,
  defaultConformReportPath,
  defaultModelPath,
  defaultReplayReportPath,
  defaultReplayTestsDir,
  defaultReportPath,
  defaultTlaPath,
  defaultTracesDir,
  discoverPropsFiles,
  inferSourceFilesFromProps,
} from "./defaults.js";
import { runCheckCommand } from "./features/check/index.js";
import { runCiCommand } from "./features/ci/index.js";
import { runConformCommand } from "./features/conform/index.js";
import { runExportTlaCommand } from "./features/export/index.js";
import { runExtractCommand } from "./features/extract/index.js";
import { runInitCommand } from "./features/init/index.js";
import { runReplayCommand } from "./features/replay/index.js";

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function parsePositiveIntegerValue(flag: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid ${flag} value`);
  }
  return value;
}

function positionals(
  args: readonly string[],
  valueFlags: readonly string[],
  repeatableValueFlags: readonly string[] = [],
): string[] {
  const values = new Set<number>();
  for (const flag of valueFlags) {
    const index = args.indexOf(flag);
    if (index >= 0) values.add(index + 1);
  }
  for (let index = 0; index < args.length; index += 1) {
    if (repeatableValueFlags.includes(args[index]!)) values.add(index + 1);
  }
  return args.filter(
    (arg, index) => !arg.startsWith("--") && !values.has(index),
  );
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (
    command !== "check" &&
    command !== "ci" &&
    command !== "conform" &&
    command !== "export" &&
    command !== "extract" &&
    command !== "init" &&
    command !== "replay"
  ) {
    console.log("Usage: modality init");
    console.log(
      "       modality extract [source.tsx ...] [--out .modality/model.json] [--app-model .modality/app.model.ts] [--report extraction-report.json] [--expect-model expected.json] [--config modality.config.ts] [--package-json package.json] [--disable-plugin id] [--effect-api name] [--explain-drift]",
    );
    console.log(
      "       modality check [model.json] [props.mjs ...] [--report .modality/report.json] [--max-states N] [--max-edges N] [--max-frontier N] [--memory-guard-mb N] [--no-search-limits]",
    );
    console.log(
      "       modality ci <model.json> [props.ts] --artifacts .modality [--baseline report.json] [--source source.tsx] [--conform-count 8] [--min-transition-conform-pass-rate 1]",
    );
    console.log(
      "       modality replay <trace.json> [--mode abstract|action] [--harness harness.ts] [--states states.json] [--observed observed-states.json] [--report report.json]",
    );
    console.log(
      "       modality conform <walks.json> [--mode abstract|action] [--harness harness.ts] [--report conform-report.json]",
    );
    console.log(
      "       modality conform [--model .modality/model.json] [--count 8] [--depth 4] [--seed 1] [--mode abstract|action] [--harness harness.ts] [--report .modality/conform-report.json]",
    );
    console.log(
      "       modality export [model.json] [--format tla] [--out .modality/model.tla]",
    );
    process.exit(command ? 1 : 0);
  }
  if (command === "init") {
    const result = await runInitCommand();
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "ci") {
    const artifactDir = flagValue(args, "--artifacts");
    const overlayPath = flagValue(args, "--overlay");
    const baselinePath = flagValue(args, "--baseline");
    const sourcePath = flagValue(args, "--source");
    const conformWalksPath = flagValue(args, "--conform-walks");
    const conformCountValue = flagValue(args, "--conform-count");
    const conformDepthValue = flagValue(args, "--conform-depth");
    const conformSeedValue = flagValue(args, "--conform-seed");
    const conformMode = flagValue(args, "--conform-mode") as
      | "abstract"
      | "action"
      | undefined;
    const conformHarnessPath = flagValue(args, "--conform-harness");
    const minConformPassRateValue = flagValue(args, "--min-conform-pass-rate");
    const minTransitionConformPassRateValue = flagValue(
      args,
      "--min-transition-conform-pass-rate",
    );
    const conformCount = conformCountValue
      ? Number(conformCountValue)
      : undefined;
    const conformDepth = conformDepthValue
      ? Number(conformDepthValue)
      : undefined;
    const conformSeed = conformSeedValue ? Number(conformSeedValue) : undefined;
    const minConformPassRate = minConformPassRateValue
      ? Number(minConformPassRateValue)
      : undefined;
    const minTransitionConformPassRate = minTransitionConformPassRateValue
      ? Number(minTransitionConformPassRateValue)
      : undefined;
    const positional = positionals(args, [
      "--artifacts",
      "--overlay",
      "--baseline",
      "--source",
      "--conform-walks",
      "--conform-count",
      "--conform-depth",
      "--conform-seed",
      "--conform-mode",
      "--conform-harness",
      "--min-conform-pass-rate",
      "--min-transition-conform-pass-rate",
    ]);
    const [modelPath, propsPath] = positional;
    if (!modelPath) throw new Error("Missing model.json path");
    if (!artifactDir) throw new Error("Missing --artifacts path");
    if (args.includes("--overlay") && !overlayPath)
      throw new Error("Missing --overlay path");
    if (args.includes("--baseline") && !baselinePath)
      throw new Error("Missing --baseline path");
    if (args.includes("--source") && !sourcePath)
      throw new Error("Missing --source path");
    if (args.includes("--conform-walks") && !conformWalksPath)
      throw new Error("Missing --conform-walks path");
    const result = await runCiCommand({
      modelPath,
      propsPath,
      artifactDir,
      overlayPath,
      baselinePath,
      sourcePath,
      conformWalksPath,
      conformCount,
      conformDepth,
      conformSeed,
      conformMode,
      conformHarnessPath,
      minConformPassRate,
      minTransitionConformPassRate,
    });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "conform") {
    const reportFlag = flagValue(args, "--report");
    const reportPath = reportFlag ?? defaultConformReportPath;
    const modelPath = flagValue(args, "--model");
    const flaggedWalksPath = flagValue(args, "--walks");
    const countValue = flagValue(args, "--count");
    const depthValue = flagValue(args, "--depth");
    const seedValue = flagValue(args, "--seed");
    const mode = flagValue(args, "--mode") as "abstract" | "action" | undefined;
    const harnessPath = flagValue(args, "--harness");
    const walkCount = countValue ? Number(countValue) : undefined;
    const depth = depthValue ? Number(depthValue) : undefined;
    const seed = seedValue ? Number(seedValue) : undefined;
    const walksPath =
      flaggedWalksPath ??
      positionals(args, [
        "--report",
        "--model",
        "--walks",
        "--count",
        "--depth",
        "--seed",
        "--mode",
        "--harness",
      ])[0];
    const effectiveModelPath = walksPath
      ? modelPath
      : (modelPath ?? defaultModelPath);
    if (args.includes("--report") && !reportFlag)
      throw new Error("Missing --report path");
    if (args.includes("--model") && !modelPath)
      throw new Error("Missing --model path");
    if (args.includes("--walks") && !flaggedWalksPath)
      throw new Error("Missing --walks path");
    const result = await runConformCommand({
      walksPath,
      modelPath: effectiveModelPath,
      reportPath,
      walkCount,
      depth,
      seed,
      mode,
      harnessPath,
    });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "export") {
    const outFlag = flagValue(args, "--out");
    const outPath = outFlag ?? defaultTlaPath;
    const formatFlag = flagValue(args, "--format");
    const format = formatFlag ?? "tla";
    const moduleName = flagValue(args, "--module");
    const modelPath =
      positionals(args, ["--out", "--format", "--module"])[0] ??
      defaultModelPath;
    if (format !== "tla")
      throw new Error(`Unsupported export format ${format}`);
    if (args.includes("--out") && !outFlag)
      throw new Error("Missing --out path");
    if (args.includes("--format") && !formatFlag)
      throw new Error("Missing --format value");
    if (args.includes("--module") && !moduleName)
      throw new Error("Missing --module path");
    const result = await runExportTlaCommand({
      modelPath,
      outPath,
      moduleName,
    });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "extract") {
    const explainDrift = args.includes("--explain-drift");
    const effectApiFlags = args.flatMap((arg, index) =>
      arg === "--effect-api" && args[index + 1] ? [args[index + 1]!] : [],
    );
    const disabledPlugins = args.flatMap((arg, index) =>
      arg === "--disable-plugin" && args[index + 1] ? [args[index + 1]!] : [],
    );
    const sourcePaths = positionals(
      args,
      [
        "--out",
        "--app-model",
        "--report",
        "--overlay",
        "--expect-model",
        "--config",
        "--package-json",
      ],
      ["--effect-api", "--disable-plugin"],
    );
    const outFlag = flagValue(args, "--out");
    const appModelFlag = flagValue(args, "--app-model");
    const modelPath = outFlag ?? defaultModelPath;
    const appModelPath = appModelFlag ?? defaultAppModelPath;
    const reportPath = flagValue(args, "--report");
    const overlayPath = flagValue(args, "--overlay");
    const expectModelPath = flagValue(args, "--expect-model");
    const configPath = flagValue(args, "--config");
    const packageJsonPath = flagValue(args, "--package-json");
    if (args.includes("--out") && !outFlag)
      throw new Error("Missing --out path");
    if (args.includes("--app-model") && !appModelFlag)
      throw new Error("Missing --app-model path");
    if (args.includes("--report") && !reportPath)
      throw new Error("Missing --report path");
    if (args.includes("--overlay") && !overlayPath)
      throw new Error("Missing --overlay path");
    if (args.includes("--expect-model") && !expectModelPath)
      throw new Error("Missing --expect-model path");
    if (args.includes("--config") && !configPath)
      throw new Error("Missing --config path");
    if (args.includes("--package-json") && !packageJsonPath)
      throw new Error("Missing --package-json path");
    if (args.includes("--disable-plugin") && disabledPlugins.length === 0)
      throw new Error("Missing --disable-plugin id");
    const effectiveSourcePaths =
      sourcePaths.length > 0 ? sourcePaths : await inferSourceFilesFromProps();
    const result = await runExtractCommand({
      sourcePaths: effectiveSourcePaths,
      modelPath,
      appModelPath,
      reportPath,
      overlayPath,
      expectModelPath,
      configPath,
      packageJsonPath,
      disabledPlugins,
      effectApis: effectApiFlags,
      explainDrift,
    });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "replay") {
    const reportFlag = flagValue(args, "--report");
    const reportPath = reportFlag ?? defaultReplayReportPath;
    const statesPath = flagValue(args, "--states");
    const observedPath = flagValue(args, "--observed");
    const mode = flagValue(args, "--mode") as "abstract" | "action" | undefined;
    const harnessPath = flagValue(args, "--harness");
    const tracePath = positionals(args, [
      "--report",
      "--states",
      "--observed",
      "--mode",
      "--harness",
    ])[0];
    if (!tracePath) throw new Error("Missing trace.json path");
    if (args.includes("--report") && !reportFlag)
      throw new Error("Missing --report path");
    if (args.includes("--states") && !statesPath)
      throw new Error("Missing --states path");
    if (args.includes("--observed") && !observedPath)
      throw new Error("Missing --observed path");
    const result = await runReplayCommand({
      tracePath,
      statesPath,
      observedPath,
      reportPath,
      mode,
      harnessPath,
    });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  const reportPath = flagValue(args, "--report");
  const tracesFlag = flagValue(args, "--traces");
  const replayTestsFlag = flagValue(args, "--replay-tests");
  const actionReplayTestsFlag = flagValue(args, "--action-replay-tests");
  const noSearchLimits = args.includes("--no-search-limits");
  const maxStatesRaw = flagValue(args, "--max-states");
  const maxEdgesRaw = flagValue(args, "--max-edges");
  const maxFrontierRaw = flagValue(args, "--max-frontier");
  const memoryGuardMbRaw = flagValue(args, "--memory-guard-mb");
  if (
    noSearchLimits &&
    (args.includes("--max-states") ||
      args.includes("--max-edges") ||
      args.includes("--max-frontier") ||
      args.includes("--memory-guard-mb"))
  ) {
    throw new Error(
      "--no-search-limits cannot be combined with explicit search-limit flags",
    );
  }
  if (args.includes("--max-states") && maxStatesRaw === undefined)
    throw new Error("Missing --max-states value");
  if (args.includes("--max-edges") && maxEdgesRaw === undefined)
    throw new Error("Missing --max-edges value");
  if (args.includes("--max-frontier") && maxFrontierRaw === undefined)
    throw new Error("Missing --max-frontier value");
  if (args.includes("--memory-guard-mb") && memoryGuardMbRaw === undefined)
    throw new Error("Missing --memory-guard-mb value");
  const maxStates =
    maxStatesRaw !== undefined
      ? parsePositiveIntegerValue("--max-states", maxStatesRaw)
      : undefined;
  const maxEdges =
    maxEdgesRaw !== undefined
      ? parsePositiveIntegerValue("--max-edges", maxEdgesRaw)
      : undefined;
  const maxFrontier =
    maxFrontierRaw !== undefined
      ? parsePositiveIntegerValue("--max-frontier", maxFrontierRaw)
      : undefined;
  const memoryGuardMb =
    memoryGuardMbRaw !== undefined
      ? parsePositiveIntegerValue("--memory-guard-mb", memoryGuardMbRaw)
      : undefined;
  const tracesDir = tracesFlag ?? defaultTracesDir;
  const replayTestsDir = replayTestsFlag ?? defaultReplayTestsDir;
  const actionReplayTestsDir =
    actionReplayTestsFlag ?? defaultActionReplayTestsDir;
  const statesPath = flagValue(args, "--states");
  const positional = positionals(args, [
    "--report",
    "--overlay",
    "--traces",
    "--replay-tests",
    "--action-replay-tests",
    "--states",
    "--max-states",
    "--max-edges",
    "--max-frontier",
    "--memory-guard-mb",
  ]);
  const [modelPath, ...propsPaths] = positional;
  const overlayPath = flagValue(args, "--overlay");
  const effectiveModelPath = modelPath ?? defaultModelPath;
  const effectivePropsPaths =
    propsPaths.length > 0 ? propsPaths : await discoverPropsFiles();
  if (args.includes("--report") && !reportPath)
    throw new Error("Missing --report path");
  if (args.includes("--overlay") && !overlayPath)
    throw new Error("Missing --overlay path");
  if (args.includes("--traces") && !tracesFlag)
    throw new Error("Missing --traces path");
  if (args.includes("--replay-tests") && !replayTestsFlag)
    throw new Error("Missing --replay-tests path");
  if (args.includes("--action-replay-tests") && !actionReplayTestsFlag)
    throw new Error("Missing --action-replay-tests path");
  if (args.includes("--states") && !statesPath)
    throw new Error("Missing --states path");
  let searchLimits:
    | {
        maxStates?: number;
        maxEdges?: number;
        maxFrontier?: number;
        memoryGuardBytes?: number;
      }
    | false
    | undefined;
  if (noSearchLimits) {
    searchLimits = false;
  } else if (
    maxStates !== undefined ||
    maxEdges !== undefined ||
    maxFrontier !== undefined ||
    memoryGuardMb !== undefined
  ) {
    searchLimits = {
      ...(maxStates !== undefined ? { maxStates } : {}),
      ...(maxEdges !== undefined ? { maxEdges } : {}),
      ...(maxFrontier !== undefined ? { maxFrontier } : {}),
      ...(memoryGuardMb !== undefined
        ? { memoryGuardBytes: memoryGuardMb * 1024 * 1024 }
        : {}),
    };
  }
  const result = await runCheckCommand({
    modelPath: effectiveModelPath,
    propsPaths: effectivePropsPaths,
    reportPath: reportPath ?? defaultReportPath,
    overlayPath,
    tracesDir,
    replayTestsDir,
    actionReplayTestsDir,
    statesPath,
    searchLimits,
  });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
