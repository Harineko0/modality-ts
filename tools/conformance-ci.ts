import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runConformanceMatrix } from "./conformance/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrixPath = resolve(repoRoot, "test/conformance/matrix.json");

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const result = await runConformanceMatrix({
    repoRoot,
    matrixPath,
    featureId: readFlag("--feature"),
    targetId: readFlag("--target"),
    fixtureId: readFlag("--fixture"),
    includePartial: process.argv.includes("--include-partial"),
    reportPath: readFlag("--report"),
  });

  const passed = result.report.fixtureResults.filter(
    (entry) => entry.status === "pass",
  ).length;
  const failed = result.report.fixtureResults.length - passed;
  console.log(
    `conformance: fixtures=${result.selectedFixtureCount} pass=${passed} fail=${failed}`,
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
