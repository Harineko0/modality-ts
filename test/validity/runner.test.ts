import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import { runValiditySuite } from "../../tools/validity/runner.js";
import type { ValidityExperiment } from "../../tools/validity/types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(repoRoot, "benchmarks/manifest.json");

describe("validity runner", () => {
  it("writes a deterministic all-stub report", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-validity-test-"));
    const reportPath = join(dir, "report.json");
    const result = await runValiditySuite({
      repoRoot,
      manifestPath,
      reportPath,
      now: new Date("2026-06-23T00:00:00.000Z"),
      experiments: {
        conformance: () => skippedExperiment("conformance"),
        mutation: () => skippedExperiment("mutation"),
        metamorphic: () => skippedExperiment("metamorphic"),
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.report).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        kind: "validity-report",
        generatedAt: "2026-06-23T00:00:00.000Z",
        manifestId: "ledgerops-benchmarks",
        reportPath,
      }),
    );
    expect(result.report.subReports).toHaveLength(3);
    expect(result.report.subReports.map((entry) => entry.status)).toEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.report.subReports.map((entry) => entry.experiment)).toEqual([
      "conformance",
      "mutation",
      "metamorphic",
    ]);
    expect(await readFile(reportPath, "utf8")).toBe(
      `${canonicalJson(result.report)}\n`,
    );
  });

  it("records a throwing experiment as an error and completes the suite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-validity-error-"));
    await mkdir(dir, { recursive: true });
    const throwingExperiment: ValidityExperiment = {
      id: "mutation",
      async run() {
        throw new Error("synthetic failure");
      },
    };

    const result = await runValiditySuite({
      repoRoot,
      manifestPath,
      reportPath: join(dir, "report.json"),
      now: new Date("2026-06-23T00:00:00.000Z"),
      experiments: {
        conformance: () => skippedExperiment("conformance"),
        mutation: () => throwingExperiment,
        metamorphic: () => skippedExperiment("metamorphic"),
      },
    });

    expect(result.exitCode).toBe(4);
    expect(result.report.subReports).toHaveLength(3);
    expect(result.report.subReports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          experiment: "conformance",
          status: "skipped",
        }),
        expect.objectContaining({
          experiment: "mutation",
          status: "error",
          headline: "synthetic failure",
        }),
        expect.objectContaining({
          experiment: "metamorphic",
          status: "skipped",
        }),
      ]),
    );
  });

  it("returns a failing exit code when any experiment fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-validity-fail-"));
    const result = await runValiditySuite({
      repoRoot,
      manifestPath,
      reportPath: join(dir, "report.json"),
      now: new Date("2026-06-23T00:00:00.000Z"),
      experiments: {
        conformance: () => skippedExperiment("conformance"),
        mutation: () => failedExperiment("mutation"),
        metamorphic: () => skippedExperiment("metamorphic"),
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.report.subReports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          experiment: "mutation",
          status: "fail",
          headline: "blocked: synthetic failure",
        }),
      ]),
    );
  });
});

function skippedExperiment(id: ValidityExperiment["id"]): ValidityExperiment {
  return {
    id,
    async run(ctx) {
      const headline = `${id} skipped in runner test`;
      return {
        experiment: id,
        status: "skipped",
        headline,
        perBenchmark: ctx.manifest.benchmarks.map((benchmark) => ({
          benchmarkId: benchmark.id,
          framework: benchmark.framework,
          status: "skipped",
          headline,
          metrics: {},
          messages: [headline],
        })),
        messages: [headline],
      };
    },
  };
}

function failedExperiment(id: ValidityExperiment["id"]): ValidityExperiment {
  return {
    id,
    async run(ctx) {
      return {
        experiment: id,
        status: "fail",
        headline: "blocked: synthetic failure",
        perBenchmark: ctx.manifest.benchmarks.map((benchmark) => ({
          benchmarkId: benchmark.id,
          framework: benchmark.framework,
          status: "fail",
          headline: "blocked: synthetic failure",
          metrics: {},
          messages: ["blocked: synthetic failure"],
        })),
        messages: ["blocked: synthetic failure"],
      };
    },
  };
}
