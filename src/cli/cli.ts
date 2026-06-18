#!/usr/bin/env node
import { access } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { relative } from "node:path";
import {
  artifactPathsForPropsFile,
  defaultActionReplayTestsDir,
  defaultAppModelPath,
  defaultConformReportPath,
  defaultModelPath,
  defaultReplayReportPath,
  defaultReplayTestsDir,
  defaultReportPath,
  defaultTlaPath,
  defaultTracesDir,
  discoverGeneratedModelFiles,
  discoverPropsFiles,
  inferCheckTargetsFromProps,
  inferExtractTargetsFromProps,
  inferSourceFilesFromProps,
} from "./defaults.js";
import {
  renderHumanCheckTargets,
  runCheckCommand,
} from "./features/check/index.js";
import { renderHumanCiResult, runCiCommand } from "./features/ci/index.js";
import {
  renderHumanConformResult,
  runConformCommand,
} from "./features/conform/index.js";
import {
  renderHumanExportResult,
  runExportTlaCommand,
} from "./features/export/index.js";
import {
  renderHumanExtractTargets,
  runExtractCommand,
} from "./features/extract/index.js";
import {
  renderHumanInitResult,
  runInitCommand,
} from "./features/init/index.js";
import {
  renderHumanReplayResult,
  runReplayCommand,
} from "./features/replay/index.js";

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
    const arg = args[index];
    if (arg !== undefined && repeatableValueFlags.includes(arg))
      values.add(index + 1);
  }
  return args.filter(
    (arg, index) => !arg.startsWith("--") && !values.has(index),
  );
}

function shouldUseColor(): boolean {
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0")
    return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return process.stdout.isTTY === true;
}

function outputOptions() {
  return { color: shouldUseColor() } as const;
}

function emitLines(lines: readonly string[]): void {
  for (const line of lines) console.log(line);
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
      "         explicit sources write one configured output; no sources with discovered props writes .modality/models/**/*.model.json and .props.ts",
    );
    console.log(
      "       modality check [model.json] [props.ts ...] [--report .modality/report.json] [--max-states N] [--max-edges N] [--max-frontier N] [--memory-guard-mb N] [--no-search-limits] [--artifact|-A]",
    );
    console.log(
      "         no args checks each discovered *.props.ts against its matching .modality/models/**/*.model.json",
    );
    console.log(
      "       modality ci <model.json> [props.ts] --artifacts .modality [--baseline report.json] [--source source.tsx] [--conform-count 8] [--min-transition-conform-pass-rate 1]",
    );
    console.log(
      "         modality ci <props.ts> --artifacts .modality derives the matching .modality/models model path",
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
    const startedMs = performance.now();
    const result = await runInitCommand();
    emitLines(
      renderHumanInitResult(
        result,
        performance.now() - startedMs,
        outputOptions(),
      ),
    );
    process.exit(0);
  }
  if (command === "ci") {
    const startedMs = performance.now();
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
    const [firstPositional, secondPositional] = positional;
    if (!firstPositional) throw new Error("Missing model.json path");
    if (!artifactDir) throw new Error("Missing --artifacts path");
    let modelPath: string;
    let propsPath: string | undefined;
    if (firstPositional.endsWith(".props.ts")) {
      modelPath = artifactPathsForPropsFile(firstPositional).modelPath;
      propsPath = firstPositional;
    } else {
      modelPath = firstPositional;
      propsPath = secondPositional;
    }
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
    emitLines(
      renderHumanCiResult(
        {
          ...result.summary,
          durationMs: performance.now() - startedMs,
        },
        outputOptions(),
      ),
    );
    process.exit(result.exitCode);
  }
  if (command === "conform") {
    const startedMs = performance.now();
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
    let effectiveModelPath: string | undefined;
    if (walksPath) {
      effectiveModelPath = modelPath;
    } else if (modelPath) {
      effectiveModelPath = modelPath;
    } else {
      try {
        await access(defaultModelPath);
        effectiveModelPath = defaultModelPath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const generatedModels = await discoverGeneratedModelFiles();
        if (generatedModels.length === 1) {
          effectiveModelPath = generatedModels[0];
        } else if (generatedModels.length > 1) {
          throw new Error(
            "Multiple generated models found; pass --model <path>",
          );
        } else {
          effectiveModelPath = defaultModelPath;
        }
      }
    }
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
    emitLines(
      renderHumanConformResult(
        {
          report: result.report,
          reportPath,
          durationMs: performance.now() - startedMs,
        },
        outputOptions(),
      ),
    );
    process.exit(result.exitCode);
  }
  if (command === "export") {
    const startedMs = performance.now();
    const outFlag = flagValue(args, "--out");
    const outPath = outFlag ?? defaultTlaPath;
    const formatFlag = flagValue(args, "--format");
    const format = formatFlag ?? "tla";
    const moduleName = flagValue(args, "--module");
    const positionalModelPath = positionals(args, [
      "--out",
      "--format",
      "--module",
    ])[0];
    let modelPath: string;
    if (positionalModelPath) {
      modelPath = positionalModelPath;
    } else {
      try {
        await access(defaultModelPath);
        modelPath = defaultModelPath;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const generatedModels = await discoverGeneratedModelFiles();
        if (generatedModels.length === 1) {
          modelPath = generatedModels[0];
        } else if (generatedModels.length > 1) {
          throw new Error("Multiple generated models found; pass a model path");
        } else {
          modelPath = defaultModelPath;
        }
      }
    }
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
    emitLines(
      renderHumanExportResult(
        {
          outPath: result.outPath,
          moduleName: result.moduleName,
          durationMs: performance.now() - startedMs,
        },
        outputOptions(),
      ),
    );
    process.exit(0);
  }
  if (command === "extract") {
    const startedMs = performance.now();
    const explainDrift = args.includes("--explain-drift");
    const effectApiFlags = args.flatMap((arg, index) => {
      if (arg !== "--effect-api") return [];
      const value = args[index + 1];
      return value ? [value] : [];
    });
    const disabledPlugins = args.flatMap((arg, index) => {
      if (arg !== "--disable-plugin") return [];
      const value = args[index + 1];
      return value ? [value] : [];
    });
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
    const wantsSingleMergedOutput =
      outFlag !== undefined ||
      appModelFlag !== undefined ||
      reportPath !== undefined ||
      expectModelPath !== undefined;
    const sharedOptions = {
      reportPath,
      overlayPath,
      expectModelPath,
      configPath,
      packageJsonPath,
      disabledPlugins,
      effectApis: effectApiFlags,
      explainDrift,
    };
    const extractTargets: Array<{
      label: string;
      durationMs: number;
      result: Awaited<ReturnType<typeof runExtractCommand>>;
    }> = [];
    if (sourcePaths.length > 0 || wantsSingleMergedOutput) {
      const effectiveSourcePaths =
        sourcePaths.length > 0
          ? sourcePaths
          : await inferSourceFilesFromProps();
      const targetStartedMs = performance.now();
      const result = await runExtractCommand({
        sourcePaths: effectiveSourcePaths,
        modelPath,
        appModelPath,
        ...sharedOptions,
      });
      extractTargets.push({
        label: result.targetLabel,
        durationMs: performance.now() - targetStartedMs,
        result,
      });
    } else {
      const targets = await inferExtractTargetsFromProps();
      for (const target of targets) {
        const targetStartedMs = performance.now();
        const result = await runExtractCommand({
          sourcePath: target.sourcePath,
          modelPath: target.modelPath,
          appModelPath: target.appModelPath,
          ...sharedOptions,
        });
        extractTargets.push({
          label: target.sourcePath,
          durationMs: performance.now() - targetStartedMs,
          result,
        });
      }
    }
    emitLines(
      renderHumanExtractTargets(
        extractTargets.map(({ label, durationMs, result }) => ({
          label,
          durationMs,
          varCount: result.varCount,
          transitionCount: result.transitionCount,
          report: result.report,
          pluginLabels: result.pluginLabels,
          stateSpaceLine: result.stateSpaceLine,
          coarseDomainsLine: result.coarseDomainsLine,
          artifacts: result.artifacts,
        })),
        {
          ...outputOptions(),
          totalDurationMs: performance.now() - startedMs,
        },
      ),
    );
    process.exit(0);
  }
  if (command === "replay") {
    const startedMs = performance.now();
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
    emitLines(
      renderHumanReplayResult(
        {
          tracePath,
          report: result.report,
          reportPath,
          durationMs: performance.now() - startedMs,
        },
        outputOptions(),
      ),
    );
    process.exit(result.exitCode);
  }
  const reportPath = flagValue(args, "--report");
  const tracesFlag = flagValue(args, "--traces");
  const replayTestsFlag = flagValue(args, "--replay-tests");
  const actionReplayTestsFlag = flagValue(args, "--action-replay-tests");
  const noSearchLimits = args.includes("--no-search-limits");
  const showArtifacts = args.includes("--artifact") || args.includes("-A");
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
  const statesPath = flagValue(args, "--states");
  const positional = positionals(
    args.filter((arg) => arg !== "-A"),
    [
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
    ],
  );
  const [modelPath, ...propsPaths] = positional;
  const overlayPath = flagValue(args, "--overlay");
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
  const startedAt = new Date();
  const startedMs = performance.now();
  const color = shouldUseColor();
  if (!modelPath) {
    const generatedModels = await discoverGeneratedModelFiles();
    let useMultiTarget = generatedModels.length > 0;
    if (!useMultiTarget) {
      try {
        await access(defaultModelPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        useMultiTarget = true;
      }
    }
    if (useMultiTarget) {
      if (
        reportPath !== undefined ||
        tracesFlag !== undefined ||
        replayTestsFlag !== undefined ||
        actionReplayTestsFlag !== undefined
      ) {
        throw new Error(
          "--report requires an explicit model path when checking multiple generated models",
        );
      }
      const targets = await inferCheckTargetsFromProps();
      let exitCode = 0;
      const checkTargets = [];
      for (const target of targets) {
        const targetStartedMs = performance.now();
        const base = target.modelPath.replace(/\.model\.json$/, "");
        const result = await runCheckCommand({
          modelPath: target.modelPath,
          propsPaths: [target.propsPath],
          reportPath: `${base}.report.json`,
          overlayPath,
          tracesDir: `${base}.traces`,
          replayTestsDir: `${base}.replay-tests`,
          actionReplayTestsDir: `${base}.action-replay-tests`,
          statesPath,
          searchLimits,
        });
        if (result.exitCode === 2) exitCode = 2;
        checkTargets.push({
          modelPath: target.modelPath,
          propsPath: relative(process.cwd(), target.propsPath),
          check: result.check,
          reportVerdicts: result.report.verdicts,
          reportPath: `${base}.report.json`,
          artifacts: result.artifacts,
          durationMs: performance.now() - targetStartedMs,
        });
      }
      emitLines(
        renderHumanCheckTargets(checkTargets, {
          color,
          startedAt,
          totalDurationMs: performance.now() - startedMs,
          showArtifacts,
        }),
      );
      process.exit(exitCode);
    }
  }
  const effectiveModelPath = modelPath ?? defaultModelPath;
  const effectivePropsPaths =
    propsPaths.length > 0 ? propsPaths : await discoverPropsFiles();
  const targetStartedMs = performance.now();
  const effectiveReportPath = reportPath ?? defaultReportPath;
  const result = await runCheckCommand({
    modelPath: effectiveModelPath,
    propsPaths: effectivePropsPaths,
    reportPath: effectiveReportPath,
    overlayPath,
    tracesDir: tracesFlag ?? defaultTracesDir,
    replayTestsDir: replayTestsFlag ?? defaultReplayTestsDir,
    actionReplayTestsDir: actionReplayTestsFlag ?? defaultActionReplayTestsDir,
    statesPath,
    searchLimits,
  });
  const propsLabel =
    effectivePropsPaths.length === 1
      ? relative(process.cwd(), effectivePropsPaths[0] ?? "")
      : effectivePropsPaths
          .map((props) => relative(process.cwd(), props))
          .join(", ");
  emitLines(
    renderHumanCheckTargets(
      [
        {
          modelPath: effectiveModelPath,
          propsPath: propsLabel,
          check: result.check,
          reportVerdicts: result.report.verdicts,
          reportPath: effectiveReportPath,
          artifacts: result.artifacts,
          durationMs: performance.now() - targetStartedMs,
        },
      ],
      {
        color,
        startedAt,
        totalDurationMs: performance.now() - startedMs,
        showArtifacts,
      },
    ),
  );
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
