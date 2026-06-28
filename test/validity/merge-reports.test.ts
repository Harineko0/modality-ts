import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { mergeValidityReports } from "../../tools/validity/merge-reports.js";
import type {
  ValidityExperimentId,
  ValidityExperimentStatus,
  ValidityReport,
} from "../../tools/validity/types.js";

describe("validity report merger", () => {
  it("merges shard reports without rerunning experiments", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-validity-merge-"));
    const inputPaths = [
      await writeShard(dir, "mutation", "fail"),
      await writeShard(dir, "metamorphic", "skipped"),
      await writeShard(dir, "conformance", "skipped"),
    ];
    const reportPath = join(dir, "report.json");

    const result = await mergeValidityReports({
      inputPaths,
      reportPath,
      now: new Date("2026-06-24T00:00:00.000Z"),
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.subReports.map((entry) => entry.experiment)).toEqual([
      "conformance",
      "mutation",
      "metamorphic",
    ]);
    expect(await readFile(reportPath, "utf8")).toBe(
      `${canonicalJson(result.report)}\n`,
    );
  });

  it("rejects missing shard reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-validity-merge-"));
    const inputPaths = [
      await writeShard(dir, "conformance", "skipped"),
      await writeShard(dir, "mutation", "skipped"),
    ];

    await expect(
      mergeValidityReports({
        inputPaths,
        reportPath: join(dir, "report.json"),
      }),
    ).rejects.toThrow("missing validity report: metamorphic");
  });
});

async function writeShard(
  dir: string,
  experiment: ValidityExperimentId,
  status: ValidityExperimentStatus,
): Promise<string> {
  const shardDir = join(dir, experiment);
  await mkdir(shardDir, { recursive: true });
  const reportPath = join(shardDir, "report.json");
  const report: ValidityReport = {
    schemaVersion: 1,
    kind: "validity-report",
    generatedAt: "2026-06-23T00:00:00.000Z",
    manifestId: "ledgerops-benchmarks",
    reportPath,
    subReports: [
      {
        experiment,
        status,
        headline: `${experiment} ${status}`,
        perBenchmark: [],
        messages: [],
      },
    ],
  };
  await writeFile(reportPath, `${canonicalJson(report)}\n`, "utf8");
  return reportPath;
}
