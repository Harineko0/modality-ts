import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCanarySuite } from "./canary/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "test/canaries/canaries.json");

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const result = await runCanarySuite({
    repoRoot,
    manifestPath,
    canaryId: readFlag("--canary"),
    kind: readFlag("--kind") as Parameters<typeof runCanarySuite>[0]["kind"],
    reportPath: readFlag("--report"),
  });

  const passed = result.report.canaryResults.filter(
    (entry) => entry.status === "pass",
  ).length;
  const failed = result.report.canaryResults.length - passed;
  console.log(
    `canaries: selected=${result.selectedCanaryCount} pass=${passed} fail=${failed}`,
  );
  console.log(`report=${result.reportPath}`);
  for (const line of result.lines) {
    console.log(line);
  }
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(4);
});
