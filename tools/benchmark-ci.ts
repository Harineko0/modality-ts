import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarkSuite } from "./benchmark/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "benchmarks/manifest.json");

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const result = await runBenchmarkSuite({
    repoRoot,
    manifestPath,
    benchmarkId: readFlag("--id"),
    reportPath: readFlag("--report"),
  });

  const passed = result.report.frameworks.filter(
    (entry) => entry.status === "pass",
  ).length;
  const failed = result.report.frameworks.length - passed;
  console.log(
    `benchmarks: selected=${result.report.frameworks.length} pass=${passed} fail=${failed}`,
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
