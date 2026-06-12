#!/usr/bin/env node
import { runCheckCommand } from "./check.js";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check") {
    console.log("Usage: modality check <model.json> [props.ts] [--report report.json]");
    process.exit(command ? 1 : 0);
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
