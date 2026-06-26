import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderValidityComment } from "./validity/comment.js";
import { mergeValidityReports } from "./validity/merge-reports.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

async function main(): Promise<void> {
  const reportPath = readFlag("--report");
  if (!reportPath) {
    throw new Error("missing required --report flag");
  }

  const inputPaths = readRepeatedFlag("--input");
  if (inputPaths.length === 0) {
    throw new Error("missing required --input flag");
  }

  const result = await mergeValidityReports({
    inputPaths,
    reportPath,
  });

  const commentPath = readFlag("--comment");
  if (commentPath) {
    await writeFile(commentPath, renderValidityComment(result.report), "utf8");
  }

  console.log(
    `validity: merged=${result.report.subReports.length} failures=${
      result.report.subReports.filter((entry) => entry.status === "fail").length
    } errors=${
      result.report.subReports.filter((entry) => entry.status === "error")
        .length
    }`,
  );
  console.log(`report=${resolve(repoRoot, reportPath)}`);
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 4;
});
