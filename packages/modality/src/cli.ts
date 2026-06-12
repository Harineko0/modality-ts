#!/usr/bin/env node
import { runCheckCommand } from "./check.js";
import { runConformCommand } from "./conform.js";
import { runExtractCommand } from "./extract.js";
import { runReplayCommand } from "./replay.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check" && command !== "conform" && command !== "extract" && command !== "replay") {
    console.log("Usage: modality extract <source.tsx> --out model.json [--report extraction-report.json] [--effect-api name]");
    console.log("Usage: modality check <model.json> [props.ts] [--report report.json]");
    console.log("       modality replay <trace.json> --states states.json [--report report.json]");
    console.log("       modality conform <walks.json> [--report conform-report.json]");
    process.exit(command ? 1 : 0);
  }
  if (command === "conform") {
    const reportFlag = args.indexOf("--report");
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const walksPath = args.find((arg, index) => !arg.startsWith("--") && index !== reportFlag + 1);
    if (!walksPath) throw new Error("Missing walks.json path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    const result = await runConformCommand({ walksPath, reportPath });
    for (const line of result.lines) console.log(line);
    process.exit(result.exitCode);
  }
  if (command === "extract") {
    const outFlag = args.indexOf("--out");
    const reportFlag = args.indexOf("--report");
    const overlayFlag = args.indexOf("--overlay");
    const effectApiFlags = args.flatMap((arg, index) => (arg === "--effect-api" && args[index + 1] ? [args[index + 1]!] : []));
    const sourcePath = args.find((arg, index) => !arg.startsWith("--") && index !== outFlag + 1 && index !== reportFlag + 1 && index !== overlayFlag + 1 && args[index - 1] !== "--effect-api");
    const modelPath = outFlag >= 0 ? args[outFlag + 1] : undefined;
    const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
    const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
    if (!sourcePath) throw new Error("Missing source.tsx path");
    if (!modelPath) throw new Error("Missing --out path");
    if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
    if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
    const result = await runExtractCommand({ sourcePath, modelPath, reportPath, overlayPath, effectApis: effectApiFlags });
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
  const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
  const tracesDir = tracesFlag >= 0 ? args[tracesFlag + 1] : undefined;
  const positional = args.filter((arg, index) => index !== reportFlag && index !== reportFlag + 1 && index !== overlayFlag && index !== overlayFlag + 1 && index !== tracesFlag && index !== tracesFlag + 1);
  const [modelPath, propsPath] = positional;
  const overlayPath = overlayFlag >= 0 ? args[overlayFlag + 1] : undefined;
  if (!modelPath) throw new Error("Missing model.json path");
  if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
  if (overlayFlag >= 0 && !overlayPath) throw new Error("Missing --overlay path");
  if (tracesFlag >= 0 && !tracesDir) throw new Error("Missing --traces path");
  const result = await runCheckCommand({ modelPath, propsPath, reportPath, overlayPath, tracesDir });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
