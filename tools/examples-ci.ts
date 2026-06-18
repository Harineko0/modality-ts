import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCanarySuite } from "./canary/runner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "test/canaries/canaries.json");

async function main(): Promise<void> {
  const startedAt = Date.now();
  const result = await runCanarySuite({
    repoRoot,
    manifestPath,
    canaryId: "examples-demo-app",
    now: new Date("2026-06-12T00:00:00.000Z"),
  });

  for (const line of result.lines) {
    if (result.exitCode !== 0) {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  if (result.exitCode === 0) {
    console.log(`examples-ci: passed elapsedMs=${Date.now() - startedAt}`);
  }
  process.exit(result.exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(4);
});
