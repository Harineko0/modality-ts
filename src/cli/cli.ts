#!/usr/bin/env node
import { runCheckCommand } from "./features/check/index.js";
import { runCiCommand } from "./features/ci/index.js";
import { runConformCommand } from "./features/conform/index.js";
import { runExportTlaCommand } from "./features/export/index.js";
import { runExtractCommand } from "./features/extract/index.js";
import { runReplayCommand } from "./features/replay/index.js";

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function positionals(args: readonly string[], valueFlags: readonly string[], repeatableValueFlags: readonly string[] = []): string[] {
  const values = new Set<number>();
  for (const flag of valueFlags) {
    const index = args.indexOf(flag);
    if (index >= 0) values.add(index + 1);
  }
  for (let index = 0; index < args.length; index += 1) {
    if (repeatableValueFlags.includes(args[index]!)) values.add(index + 1);
  }
  return args.filter((arg, index) => !arg.startsWith("--") && !values.has(index));
}

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check" && command !== "ci" && command !== "conform" && command !== "export" && command !== "extract" && command !== "replay") {
    console.log("Usage: modality extract <source.tsx> --out model.json [--app-model app.model.ts] [--report extraction-report.json] [--expect-model expected.json] [--config modality.config.ts] [--package-json package.json] [--disable-plugin id] [--effect-api name] [--explain-drift]");
    console.log("Usage: modality check <model.json> [props.ts] [--report report.json]");
    console.log("       modality ci <model.json> [props.ts] --artifacts .modality [--baseline report.json] [--source source.tsx] [--conform-count 8] [--min-transition-conform-pass-rate 1]");
    console.log("       modality replay <trace.json> [--mode abstract|action] [--harness harness.ts] [--states states.json] [--observed observed-states.json] [--report report.json]");
    console.log("       modality conform <walks.json> [--mode abstract|action] [--harness harness.ts] [--report conform-report.json]");
    console.log("       modality conform --model model.json [--count 8] [--depth 4] [--seed 1] [--mode abstract|action] [--harness harness.ts] [--report conform-report.json]");
    console.log("       modality export <model.json> --format tla --out model.tla");
    process.exit(command ? 1 : 0);
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
    const conformMode = flagValue(args, "--conform-mode") as "abstract" | "action" | undefined;
    const conformHarnessPath = flagValue(args, "--conform-harness");
    const minConformPassRateValue = flagValue(args, "--min-conform-pass-rate");
    const minTransitionConformPassRateValue = flagValue(args, "--min-transition-conform-pass-rate");
    const conformCount = conformCountValue ? Number(conformCountValue) : undefined;
    const conformDepth = conformDepthValue ? Number(conformDepthValue) : undefined;
    const conformSeed = conformSeedValue ? Number(conformSeedValue) : undefined;
    const minConformPassRate = minConformPassRateValue ? Number(minConformPassRateValue) : undefined;
    const minTransitionConformPassRate = minTransitionConformPassRateValue ? Number(minTransitionConformPassRateValue) : undefined;
    const positional = positionals(args, ["--artifacts", "--overlay", "--baseline", "--source", "--conform-walks", "--conform-count", "--conform-depth", "--conform-seed", "--conform-mode", "--conform-harness", "--min-conform-pass-rate", "--min-transition-conform-pass-rate"]);
    const [modelPath, propsPath] = positional;
    if (!modelPath) throw new Error("Missing model.json path");
    if (!artifactDir) throw new Error("Missing --artifacts path");
    if (args.includes("--overlay") && !overlayPath) throw new Error("Missing --overlay path");
    if (args.includes("--baseline") && !baselinePath) throw new Error("Missing --baseline path");
    if (args.includes("--source") && !sourcePath) throw new Error("Missing --source path");
    if (args.includes("--conform-walks") && !conformWalksPath) throw new Error("Missing --conform-walks path");
    const result = await runCiCommand({ modelPath, propsPath, artifactDir, overlayPath, baselinePath, sourcePath, conformWalksPath, conformCount, conformDepth, conformSeed, conformMode, conformHarnessPath, minConformPassRate, minTransitionConformPassRate });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "conform") {
    const reportPath = flagValue(args, "--report");
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
    const walksPath = flaggedWalksPath ?? positionals(args, ["--report", "--model", "--walks", "--count", "--depth", "--seed", "--mode", "--harness"])[0];
    if (!walksPath && !modelPath) throw new Error("Missing walks.json path or --model path");
    if (args.includes("--report") && !reportPath) throw new Error("Missing --report path");
    if (args.includes("--model") && !modelPath) throw new Error("Missing --model path");
    if (args.includes("--walks") && !flaggedWalksPath) throw new Error("Missing --walks path");
    const result = await runConformCommand({ walksPath, modelPath, reportPath, walkCount, depth, seed, mode, harnessPath });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "export") {
    const outPath = flagValue(args, "--out");
    const format = flagValue(args, "--format") ?? "tla";
    const moduleName = flagValue(args, "--module");
    const modelPath = positionals(args, ["--out", "--format", "--module"])[0];
    if (!modelPath) throw new Error("Missing model.json path");
    if (!outPath) throw new Error("Missing --out path");
    if (format !== "tla") throw new Error(`Unsupported export format ${format}`);
    if (args.includes("--module") && !moduleName) throw new Error("Missing --module path");
    const result = await runExportTlaCommand({ modelPath, outPath, moduleName });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "extract") {
    const explainDrift = args.includes("--explain-drift");
    const effectApiFlags = args.flatMap((arg, index) => (arg === "--effect-api" && args[index + 1] ? [args[index + 1]!] : []));
    const disabledPlugins = args.flatMap((arg, index) => (arg === "--disable-plugin" && args[index + 1] ? [args[index + 1]!] : []));
    const sourcePath = positionals(args, ["--out", "--app-model", "--report", "--overlay", "--expect-model", "--config", "--package-json"], ["--effect-api", "--disable-plugin"])[0];
    const modelPath = flagValue(args, "--out");
    const appModelPath = flagValue(args, "--app-model");
    const reportPath = flagValue(args, "--report");
    const overlayPath = flagValue(args, "--overlay");
    const expectModelPath = flagValue(args, "--expect-model");
    const configPath = flagValue(args, "--config");
    const packageJsonPath = flagValue(args, "--package-json");
    if (!sourcePath) throw new Error("Missing source.tsx path");
    if (!modelPath) throw new Error("Missing --out path");
    if (args.includes("--app-model") && !appModelPath) throw new Error("Missing --app-model path");
    if (args.includes("--report") && !reportPath) throw new Error("Missing --report path");
    if (args.includes("--overlay") && !overlayPath) throw new Error("Missing --overlay path");
    if (args.includes("--expect-model") && !expectModelPath) throw new Error("Missing --expect-model path");
    if (args.includes("--config") && !configPath) throw new Error("Missing --config path");
    if (args.includes("--package-json") && !packageJsonPath) throw new Error("Missing --package-json path");
    if (args.includes("--disable-plugin") && disabledPlugins.length === 0) throw new Error("Missing --disable-plugin id");
    const result = await runExtractCommand({ sourcePath, modelPath, appModelPath, reportPath, overlayPath, expectModelPath, configPath, packageJsonPath, disabledPlugins, effectApis: effectApiFlags, explainDrift });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "replay") {
    const reportPath = flagValue(args, "--report");
    const statesPath = flagValue(args, "--states");
    const observedPath = flagValue(args, "--observed");
    const mode = flagValue(args, "--mode") as "abstract" | "action" | undefined;
    const harnessPath = flagValue(args, "--harness");
    const tracePath = positionals(args, ["--report", "--states", "--observed", "--mode", "--harness"])[0];
    if (!tracePath) throw new Error("Missing trace.json path");
    if (args.includes("--report") && !reportPath) throw new Error("Missing --report path");
    if (args.includes("--states") && !statesPath) throw new Error("Missing --states path");
    if (args.includes("--observed") && !observedPath) throw new Error("Missing --observed path");
    const result = await runReplayCommand({ tracePath, statesPath, observedPath, reportPath, mode, harnessPath });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  const reportPath = flagValue(args, "--report");
  const tracesDir = flagValue(args, "--traces");
  const replayTestsDir = flagValue(args, "--replay-tests");
  const actionReplayTestsDir = flagValue(args, "--action-replay-tests");
  const statesPath = flagValue(args, "--states");
  const positional = positionals(args, ["--report", "--overlay", "--traces", "--replay-tests", "--action-replay-tests", "--states"]);
  const [modelPath, propsPath] = positional;
  const overlayPath = flagValue(args, "--overlay");
  if (!modelPath) throw new Error("Missing model.json path");
  if (args.includes("--report") && !reportPath) throw new Error("Missing --report path");
  if (args.includes("--overlay") && !overlayPath) throw new Error("Missing --overlay path");
  if (args.includes("--traces") && !tracesDir) throw new Error("Missing --traces path");
  if (args.includes("--replay-tests") && !replayTestsDir) throw new Error("Missing --replay-tests path");
  if (args.includes("--action-replay-tests") && !actionReplayTestsDir) throw new Error("Missing --action-replay-tests path");
  if (args.includes("--states") && !statesPath) throw new Error("Missing --states path");
  const result = await runCheckCommand({ modelPath, propsPath, reportPath, overlayPath, tracesDir, replayTestsDir, actionReplayTestsDir, statesPath });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
