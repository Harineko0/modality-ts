#!/usr/bin/env node
import { runCheckCommand } from "./features/check/index.js";
import { runCiCommand } from "./features/ci/index.js";
import { runConformCommand } from "./features/conform/index.js";
import { runExportTlaCommand } from "./features/export/index.js";
import { runExtractCommand } from "./features/extract/index.js";
import { runReplayCommand } from "./features/replay/index.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check" && command !== "ci" && command !== "conform" && command !== "export" && command !== "extract" && command !== "replay") {
    console.log("Usage: modality extract <source.tsx> --out model.json [--app-model app.model.ts] [--report extraction-report.json] [--expect-model expected.json] [--config modality.config.ts] [--package-json package.json] [--disable-plugin id] [--effect-api name] [--explain-drift]");
    console.log("Usage: modality check <model.json> [props.ts] [--report report.json]");
    console.log("       modality ci <model.json> [props.ts] --artifacts .modality [--baseline report.json] [--source source.tsx] [--conform-count 8] [--min-transition-conform-pass-rate 1]");
    console.log("       modality replay <trace.json> [--states states.json] [--observed observed-states.json] [--report report.json]");
    console.log("       modality conform <walks.json> [--report conform-report.json]");
    console.log("       modality conform --model model.json [--count 8] [--depth 4] [--seed 1] [--report conform-report.json]");
    console.log("       modality export <model.json> --format tla --out model.tla");
    process.exit(command ? 1 : 0);
  }
  if (command === "ci") {
    const artifactsFlag = args.indexOf("--artifacts");
    const overlayFlag = args.indexOf("--overlay");
    const baselineFlag = args.indexOf("--baseline");
    const sourceFlag = args.indexOf("--source");
    const conformWalksFlag = args.indexOf("--conform-walks");
    const conformCountFlag = args.indexOf("--conform-count");
    const conformDepthFlag = args.indexOf("--conform-depth");
    const conformSeedFlag = args.indexOf("--conform-seed");
    const minConformPassRateFlag = args.indexOf("--min-conform-pass-rate");
    const minTransitionConformPassRateFlag = args.indexOf("--min-transition-conform-pass-rate");
    const artifactDir = artifactsFlag >= 0 ? args[artifactsFlag + 1] : undefined;
    const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
    const baselinePath = baselineFlag >= 0 ? args[baselineFlag + 1] : undefined;
    const sourcePath = sourceFlag >= 0 ? args[sourceFlag + 1] : undefined;
    const conformWalksPath = conformWalksFlag >= 0 ? args[conformWalksFlag + 1] : undefined;
    const conformCount = conformCountFlag >= 0 && args[conformCountFlag + 1] ? Number(args[conformCountFlag + 1]) : undefined;
    const conformDepth = conformDepthFlag >= 0 && args[conformDepthFlag + 1] ? Number(args[conformDepthFlag + 1]) : undefined;
    const conformSeed = conformSeedFlag >= 0 && args[conformSeedFlag + 1] ? Number(args[conformSeedFlag + 1]) : undefined;
    const minConformPassRate = minConformPassRateFlag >= 0 && args[minConformPassRateFlag + 1] ? Number(args[minConformPassRateFlag + 1]) : undefined;
    const minTransitionConformPassRate = minTransitionConformPassRateFlag >= 0 && args[minTransitionConformPassRateFlag + 1] ? Number(args[minTransitionConformPassRateFlag + 1]) : undefined;
    const positional = args.filter((arg, index) =>
      index !== artifactsFlag && index !== artifactsFlag + 1 &&
      index !== overlayFlag && index !== overlayFlag + 1 &&
      index !== baselineFlag && index !== baselineFlag + 1 &&
      index !== sourceFlag && index !== sourceFlag + 1 &&
      index !== conformWalksFlag && index !== conformWalksFlag + 1 &&
      index !== conformCountFlag && index !== conformCountFlag + 1 &&
      index !== conformDepthFlag && index !== conformDepthFlag + 1 &&
      index !== conformSeedFlag && index !== conformSeedFlag + 1 &&
      index !== minConformPassRateFlag && index !== minConformPassRateFlag + 1 &&
      index !== minTransitionConformPassRateFlag && index !== minTransitionConformPassRateFlag + 1
    );
    const [modelPath, propsPath] = positional;
    if (!modelPath) throw new Error("Missing model.json path");
    if (!artifactDir) throw new Error("Missing --artifacts path");
    if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
    if (baselineFlag >= 0 && !baselinePath) throw new Error("Missing --baseline path");
    if (sourceFlag >= 0 && !sourcePath) throw new Error("Missing --source path");
    if (conformWalksFlag >= 0 && !conformWalksPath) throw new Error("Missing --conform-walks path");
    const result = await runCiCommand({ modelPath, propsPath, artifactDir, overlayPath, baselinePath, sourcePath, conformWalksPath, conformCount, conformDepth, conformSeed, minConformPassRate, minTransitionConformPassRate });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "conform") {
    const reportFlag = args.indexOf("--report");
    const modelFlag = args.indexOf("--model");
    const walksFlag = args.indexOf("--walks");
    const countFlag = args.indexOf("--count");
    const depthFlag = args.indexOf("--depth");
    const seedFlag = args.indexOf("--seed");
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const modelPath = modelFlag >= 0 ? args[modelFlag + 1] : undefined;
    const flaggedWalksPath = walksFlag >= 0 ? args[walksFlag + 1] : undefined;
    const walkCount = countFlag >= 0 && args[countFlag + 1] ? Number(args[countFlag + 1]) : undefined;
    const depth = depthFlag >= 0 && args[depthFlag + 1] ? Number(args[depthFlag + 1]) : undefined;
    const seed = seedFlag >= 0 && args[seedFlag + 1] ? Number(args[seedFlag + 1]) : undefined;
    const walksPath = flaggedWalksPath ?? args.find((arg, index) =>
      !arg.startsWith("--") &&
      index !== reportFlag + 1 &&
      index !== modelFlag + 1 &&
      index !== walksFlag + 1 &&
      index !== countFlag + 1 &&
      index !== depthFlag + 1 &&
      index !== seedFlag + 1
    );
    if (!walksPath && !modelPath) throw new Error("Missing walks.json path or --model path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    if (modelFlag >= 0 && !modelPath) throw new Error("Missing --model path");
    if (walksFlag >= 0 && !flaggedWalksPath) throw new Error("Missing --walks path");
    const result = await runConformCommand({ walksPath, modelPath, reportPath, walkCount, depth, seed });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "export") {
    const outFlag = args.indexOf("--out");
    const formatFlag = args.indexOf("--format");
    const moduleFlag = args.indexOf("--module");
    const outPath = outFlag >= 0 ? args[outFlag + 1] : undefined;
    const format = formatFlag >= 0 ? args[formatFlag + 1] : "tla";
    const moduleName = moduleFlag >= 0 ? args[moduleFlag + 1] : undefined;
    const modelPath = args.find((arg, index) => !arg.startsWith("--") && index !== outFlag + 1 && index !== formatFlag + 1 && index !== moduleFlag + 1);
    if (!modelPath) throw new Error("Missing model.json path");
    if (!outPath) throw new Error("Missing --out path");
    if (format !== "tla") throw new Error(`Unsupported export format ${format}`);
    if (moduleFlag >= 0 && !moduleName) throw new Error("Missing --module path");
    const result = await runExportTlaCommand({ modelPath, outPath, moduleName });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "extract") {
    const outFlag = args.indexOf("--out");
    const appModelFlag = args.indexOf("--app-model");
    const reportFlag = args.indexOf("--report");
    const overlayFlag = args.indexOf("--overlay");
    const expectModelFlag = args.indexOf("--expect-model");
    const configFlag = args.indexOf("--config");
    const packageJsonFlag = args.indexOf("--package-json");
    const explainDrift = args.includes("--explain-drift");
    const effectApiFlags = args.flatMap((arg, index) => (arg === "--effect-api" && args[index + 1] ? [args[index + 1]!] : []));
    const disabledPlugins = args.flatMap((arg, index) => (arg === "--disable-plugin" && args[index + 1] ? [args[index + 1]!] : []));
    const sourcePath = args.find((arg, index) => !arg.startsWith("--") && index !== outFlag + 1 && index !== appModelFlag + 1 && index !== reportFlag + 1 && index !== overlayFlag + 1 && index !== expectModelFlag + 1 && index !== configFlag + 1 && index !== packageJsonFlag + 1 && args[index - 1] !== "--effect-api" && args[index - 1] !== "--disable-plugin");
    const modelPath = outFlag >= 0 ? args[outFlag + 1] : undefined;
    const appModelPath = appModelFlag >= 0 ? args[appModelFlag + 1] : undefined;
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
    const expectModelPath = expectModelFlag >= 0 ? args[expectModelFlag + 1] : undefined;
    const configPath = configFlag >= 0 ? args[configFlag + 1] : undefined;
    const packageJsonPath = packageJsonFlag >= 0 ? args[packageJsonFlag + 1] : undefined;
    if (!sourcePath) throw new Error("Missing source.tsx path");
    if (!modelPath) throw new Error("Missing --out path");
    if (appModelFlag >= 0 && !appModelPath) throw new Error("Missing --app-model path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
    if (expectModelFlag >= 0 && !expectModelPath) throw new Error("Missing --expect-model path");
    if (configFlag >= 0 && !configPath) throw new Error("Missing --config path");
    if (packageJsonFlag >= 0 && !packageJsonPath) throw new Error("Missing --package-json path");
    if (args.includes("--disable-plugin") && disabledPlugins.length === 0) throw new Error("Missing --disable-plugin id");
    const result = await runExtractCommand({ sourcePath, modelPath, appModelPath, reportPath, overlayPath, expectModelPath, configPath, packageJsonPath, disabledPlugins, effectApis: effectApiFlags, explainDrift });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "replay") {
    const reportFlag = args.indexOf("--report");
    const statesFlag = args.indexOf("--states");
    const observedFlag = args.indexOf("--observed");
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const statesPath = statesFlag >= 0 ? args[statesFlag + 1] : undefined;
    const observedPath = observedFlag >= 0 ? args[observedFlag + 1] : undefined;
    const tracePath = args.find((arg, index) => !arg.startsWith("--") && index !== reportFlag + 1 && index !== statesFlag + 1 && index !== observedFlag + 1);
    if (!tracePath) throw new Error("Missing trace.json path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    if (statesFlag >= 0 && !statesPath) throw new Error("Missing --states path");
    if (observedFlag >= 0 && !observedPath) throw new Error("Missing --observed path");
    const result = await runReplayCommand({ tracePath, statesPath, observedPath, reportPath });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  const reportFlag = args.indexOf("--report");
  const overlayFlag = args.indexOf("--overlay");
  const tracesFlag = args.indexOf("--traces");
  const replayTestsFlag = args.indexOf("--replay-tests");
  const actionReplayTestsFlag = args.indexOf("--action-replay-tests");
  const statesFlag = args.indexOf("--states");
  const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
  const tracesDir = tracesFlag >= 0 ? args[tracesFlag + 1] : undefined;
  const replayTestsDir = replayTestsFlag >= 0 ? args[replayTestsFlag + 1] : undefined;
  const actionReplayTestsDir = actionReplayTestsFlag >= 0 ? args[actionReplayTestsFlag + 1] : undefined;
  const statesPath = statesFlag >= 0 ? args[statesFlag + 1] : undefined;
  const positional = args.filter((arg, index) => index !== reportFlag && index !== reportFlag + 1 && index !== overlayFlag && index !== overlayFlag + 1 && index !== tracesFlag && index !== tracesFlag + 1 && index !== replayTestsFlag && index !== replayTestsFlag + 1 && index !== actionReplayTestsFlag && index !== actionReplayTestsFlag + 1 && index !== statesFlag && index !== statesFlag + 1);
  const [modelPath, propsPath] = positional;
  const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
  if (!modelPath) throw new Error("Missing model.json path");
  if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
  if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
  if (tracesFlag >= 0 && !tracesDir) throw new Error("Missing --traces path");
  if (replayTestsFlag >= 0 && !replayTestsDir) throw new Error("Missing --replay-tests path");
  if (actionReplayTestsFlag >= 0 && !actionReplayTestsDir) throw new Error("Missing --action-replay-tests path");
  if (statesFlag >= 0 && !statesPath) throw new Error("Missing --states path");
  const result = await runCheckCommand({ modelPath, propsPath, reportPath, overlayPath, tracesDir, replayTestsDir, actionReplayTestsDir, statesPath });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
