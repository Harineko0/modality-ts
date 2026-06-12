#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { checkModel } from "@modality/checker";
import type { Model, Property } from "@modality/kernel";

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (command !== "check") {
    console.log("Usage: modality check <model.json> [props.ts]");
    process.exit(command ? 1 : 0);
  }
  const [modelPath, propsPath] = args;
  if (!modelPath) throw new Error("Missing model.json path");
  const model = JSON.parse(await readFile(modelPath, "utf8")) as Model;
  const properties = propsPath ? ((await import(pathToFileURL(propsPath).href)).properties as Property[]) : [];
  const result = checkModel(model, properties);
  for (const verdict of result.verdicts) {
    console.log(`${verdict.property}: ${verdict.status}`);
    if (verdict.status === "violated" || verdict.status === "reachable") {
      console.log(`  trace steps: ${verdict.trace.steps.map((step) => step.transitionId).join(" -> ") || "(initial)"}`);
    }
    if (verdict.status === "error" || verdict.status === "vacuous-warning") {
      console.log(`  ${verdict.message}`);
    }
  }
  console.log(`states=${result.stats.states} edges=${result.stats.edges} depth=${result.stats.depth}`);
  if (result.verdicts.some((verdict) => verdict.status === "violated" || verdict.status === "error")) process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
