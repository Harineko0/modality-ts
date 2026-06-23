import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderValidityComment } from "./validity/comment.js";
import { runValiditySuite } from "./validity/runner.js";
import type { ValidityExperimentId } from "./validity/types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(repoRoot, "benchmarks/manifest.json");

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function readRepeatedFlag(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function parseExperimentIds(): ValidityExperimentId[] | undefined {
  const ids = readRepeatedFlag("--id");
  if (ids.length === 0) return undefined;
  for (const id of ids) {
    if (!isValidityExperimentId(id)) {
      throw new Error(`unknown validity experiment id ${id}`);
    }
  }
  return ids;
}

function isValidityExperimentId(id: string): id is ValidityExperimentId {
  return id === "conformance" || id === "mutation" || id === "metamorphic";
}

async function main(): Promise<void> {
  const result = await runValiditySuite({
    repoRoot,
    manifestPath,
    experimentIds: parseExperimentIds(),
    reportPath: readFlag("--report"),
    log: (message) => console.log(message),
  });

  const commentPath = readFlag("--comment");
  if (commentPath) {
    await mkdir(dirname(commentPath), { recursive: true });
    await writeFile(commentPath, renderValidityComment(result.report), "utf8");
  }

  console.log(
    `validity: selected=${result.report.subReports.length} errors=${
      result.report.subReports.filter((entry) => entry.status === "error")
        .length
    }`,
  );
  console.log(`report=${result.reportPath}`);
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 4;
});
