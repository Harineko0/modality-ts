#!/usr/bin/env node
import { runCheckCommand } from "./check.js";
import { runReplayCommand } from "./replay.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check" && command !== "replay") {
    console.log("Usage: modality check <model.json> [props.ts] [--report report.json]");
    console.log("       modality replay <trace.json> --states states.json [--report report.json]");
    process.exit(command ? 1 : 0);
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
  const reportPath = reportFlag >= 0 ? args[reportFlag + 1] : undefined;
  const positional = reportFlag >= 0 ? args.slice(0, reportFlag) : args;
  const [modelPath, propsPath] = positional;
  if (!modelPath) throw new Error("Missing model.json path");
  if (reportFlag >= 0 && !reportPath) throw new Error("Missing --report path");
  const result = await runCheckCommand({ modelPath, propsPath, reportPath });
  for (const line of result.lines) console.log(line);
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
