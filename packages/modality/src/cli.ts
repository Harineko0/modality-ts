#!/usr/bin/env node
import { runCheckCommand } from "./check.js";
import { runCiCommand } from "./ci.js";
import { runConformCommand } from "./conform.js";
import { runExtractCommand } from "./extract.js";
import { runReplayCommand } from "./replay.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check" && command !== "ci" && command !== "conform" && command !== "extract" && command !== "replay") {
    console.log("Usage: modality extract <source.tsx> --out model.json [--report extraction-report.json] [--expect-model expected.json] [--effect-api name]");
    console.log("Usage: modality check <model.json> [props.ts] [--report report.json]");
    console.log("       modality ci <model.json> [props.ts] --artifacts .modality [--baseline report.json] [--conform-count 8]");
    console.log("       modality replay <trace.json> --states states.json [--report report.json]");
    console.log("       modality conform <walks.json> [--report conform-report.json]");
    console.log("       modality conform --model model.json [--count 8] [--depth 4] [--seed 1] [--report conform-report.json]");
    process.exit(command ? 1 : 0);
  }
  if (command === "ci") {
    const artifactsFlag = args.indexOf("--artifacts");
    const overlayFlag = args.indexOf("--overlay");
    const baselineFlag = args.indexOf("--baseline");
    const conformWalksFlag = args.indexOf("--conform-walks");
    const conformCountFlag = args.indexOf("--conform-count");
    const conformDepthFlag = args.indexOf("--conform-depth");
    const conformSeedFlag = args.indexOf("--conform-seed");
    const minConformPassRateFlag = args.indexOf("--min-conform-pass-rate");
    const artifactDir = artifactsFlag >= 0 ? args[artifactsFlag + 1] : undefined;
    const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
    const baselinePath = baselineFlag >= 0 ? args[baselineFlag + 1] : undefined;
    const conformWalksPath = conformWalksFlag >= 0 ? args[conformWalksFlag + 1] : undefined;
    const conformCount = conformCountFlag >= 0 && args[conformCountFlag + 1] ? Number(args[conformCountFlag + 1]) : undefined;
    const conformDepth = conformDepthFlag >= 0 && args[conformDepthFlag + 1] ? Number(args[conformDepthFlag + 1]) : undefined;
    const conformSeed = conformSeedFlag >= 0 && args[conformSeedFlag + 1] ? Number(args[conformSeedFlag + 1]) : undefined;
    const minConformPassRate = minConformPassRateFlag >= 0 && args[minConformPassRateFlag + 1] ? Number(args[minConformPassRateFlag + 1]) : undefined;
    const positional = args.filter((arg, index) =>
      index !== artifactsFlag && index !== artifactsFlag + 1 &&
      index !== overlayFlag && index !== overlayFlag + 1 &&
      index !== baselineFlag && index !== baselineFlag + 1 &&
      index !== conformWalksFlag && index !== conformWalksFlag + 1 &&
      index !== conformCountFlag && index !== conformCountFlag + 1 &&
      index !== conformDepthFlag && index !== conformDepthFlag + 1 &&
      index !== conformSeedFlag && index !== conformSeedFlag + 1 &&
      index !== minConformPassRateFlag && index !== minConformPassRateFlag + 1
    );
    const [modelPath, propsPath] = positional;
    if (!modelPath) throw new Error("Missing model.json path");
    if (!artifactDir) throw new Error("Missing --artifacts path");
    if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
    if (baselineFlag >= 0 && !baselinePath) throw new Error("Missing --baseline path");
    if (conformWalksFlag >= 0 && !conformWalksPath) throw new Error("Missing --conform-walks path");
    const result = await runCiCommand({ modelPath, propsPath, artifactDir, overlayPath, baselinePath, conformWalksPath, conformCount, conformDepth, conformSeed, minConformPassRate });
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
  if (command === "extract") {
    const outFlag = args.indexOf("--out");
    const reportFlag = args.indexOf("--report");
    const overlayFlag = args.indexOf("--overlay");
    const expectModelFlag = args.indexOf("--expect-model");
    const effectApiFlags = args.flatMap((arg, index) => (arg === "--effect-api" && args[index + 1] ? [args[index + 1]!] : []));
    const sourcePath = args.find((arg, index) => !arg.startsWith("--") && index !== outFlag + 1 && index !== reportFlag + 1 && index !== overlayFlag + 1 && index !== expectModelFlag + 1 && args[index - 1] !== "--effect-api");
    const modelPath = outFlag >= 0 ? args[outFlag + 1] : undefined;
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
    const expectModelPath = expectModelFlag >= 0 ? args[expectModelFlag + 1] : undefined;
    if (!sourcePath) throw new Error("Missing source.tsx path");
    if (!modelPath) throw new Error("Missing --out path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
    if (expectModelFlag >= 0 && !expectModelPath) throw new Error("Missing --expect-model path");
    const result = await runExtractCommand({ sourcePath, modelPath, reportPath, overlayPath, expectModelPath, effectApis: effectApiFlags });
    for (const line of result.lines) console.log(line);
    process.exit(0);
  }
  if (command === "replay") {
    const reportFlag = args.indexOf("--report");
    const statesFlag = args.indexOf("--states");
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const statesPath = statesFlag >= 0 ? args[statesFlag + 1] : undefined;
    const tracePath = args.find((arg, index) => !arg.startsWith("--") && index !== reportFlag + 1 && index !== statesFlag + 1);
    if (!tracePath) throw new Error("Missing trace.json path");
    if (!statesPath) throw new Error("Missing --states path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    const result = await runReplayCommand({ tracePath, statesPath, reportPath });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  const reportFlag = args.indexOf("--report");
  const overlayFlag = args.indexOf("--overlay");
  const tracesFlag = args.indexOf("--traces");
  const replayTestsFlag = args.indexOf("--replay-tests");
  const statesFlag = args.indexOf("--states");
  const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
  const tracesDir = tracesFlag >= 0 ? args[tracesFlag + 1] : undefined;
  const replayTestsDir = replayTestsFlag >= 0 ? args[replayTestsFlag + 1] : undefined;
  const statesPath = statesFlag >= 0 ? args[statesFlag + 1] : undefined;
  const positional = args.filter((arg, index) => index !== reportFlag && index !== reportFlag + 1 && index !== overlayFlag && index !== overlayFlag + 1 && index !== tracesFlag && index !== tracesFlag + 1 && index !== replayTestsFlag && index !== replayTestsFlag + 1 && index !== statesFlag && index !== statesFlag + 1);
  const [modelPath, propsPath] = positional;
  const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
  if (!modelPath) throw new Error("Missing model.json path");
  if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
  if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
  if (tracesFlag >= 0 && !tracesDir) throw new Error("Missing --traces path");
  if (replayTestsFlag >= 0 && !replayTestsDir) throw new Error("Missing --replay-tests path");
  if (statesFlag >= 0 && !statesPath) throw new Error("Missing --states path");
  const result = await runCheckCommand({ modelPath, propsPath, reportPath, overlayPath, tracesDir, replayTestsDir, statesPath });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
