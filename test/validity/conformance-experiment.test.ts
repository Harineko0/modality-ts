import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ConformReport } from "modality-ts/core";
import { conformanceExperiment } from "../../tools/validity/experiments/conformance.js";
import type { ValidityRunContext } from "../../tools/validity/types.js";

const conformReport = {
  schemaVersion: 1,
  kind: "conform-report",
  generatedAt: "2026-06-23T00:00:00.000Z",
  mode: "action",
  walks: [
    { id: "walk-1", status: "reproduced", stepsRun: 2 },
    {
      id: "walk-2",
      status: "inconclusive",
      stepsRun: 1,
      reason: "locator missing",
    },
  ],
  metrics: {
    total: 2,
    reproduced: 1,
    notReproduced: 0,
    inconclusive: 1,
    passRate: 0.5,
  },
  transitionMetrics: [
    {
      transitionId: "t.login",
      walks: 2,
      reproduced: 1,
      notReproduced: 0,
      inconclusive: 1,
      passRate: 0.5,
    },
  ],
} satisfies ConformReport;

describe("conformance validity experiment", () => {
  it("maps action conform metrics and warns on inconclusive walks", async () => {
    const calls: { conform?: unknown } = {};
    const experiment = conformanceExperiment({
      extract: async () =>
        ({
          model: { vars: [], transitions: [], bounds: {} },
          report: {},
          lines: [],
          targetLabel: "fixture",
          appModelPath: "",
          varCount: 0,
          transitionCount: 0,
          pluginLabels: [],
          artifacts: [],
          propsErrors: [],
        }) as never,
      conform: async (options) => {
        calls.conform = options;
        return { report: conformReport, exitCode: 3, lines: [] };
      },
      readReport: async () => conformReport,
    });

    const report = await experiment.run(await context());
    expect(report.status).toBe("pass");
    expect(report.headline).toBe("action pass-rate 50.0% (1/2)");
    expect(report.messages).toContain("aggregate inconclusive=1");
    expect(report.messages[1]).toContain("t.login=50.0% (1/2)");
    expect(report.perBenchmark[0]).toMatchObject({
      benchmarkId: "fixture-app",
      status: "pass",
      headline: "warning: pass-rate 50.0% (1/2)",
      metrics: {
        total: 2,
        reproduced: 1,
        inconclusive: 1,
        passRate: 0.5,
        walkCount: 4,
        depth: 3,
        seed: 17,
        transitionMetrics: conformReport.transitionMetrics,
      },
    });
    expect(report.perBenchmark[0]?.messages.join("\n")).toContain(
      "walk-2 (locator missing)",
    );
    expect(calls.conform).toMatchObject({
      mode: "action",
      walkCount: 4,
      depth: 3,
      seed: 17,
      fixtureId: "fixture-app",
    });
  });
});

async function context(): Promise<ValidityRunContext> {
  return {
    repoRoot: process.cwd(),
    workDir: await mkdtemp(join(tmpdir(), "modality-conformance-test-")),
    now: new Date("2026-06-23T00:00:00.000Z"),
    manifest: {
      schemaVersion: 1,
      manifestId: "fixture",
      validityThresholds: { conformance: { minPassRate: 0 } },
      benchmarks: [
        {
          id: "fixture-app",
          framework: "react-router",
          root: ".",
          packageJsonPath: "package.json",
          sourcePaths: ["src/App.tsx"],
          propsPaths: ["src/App.props.ts"],
          effectApis: ["api.login"],
          conformance: { walkCount: 4, depth: 3, seed: 17 },
          expected: {
            truePositiveViolations: 0,
            trueNegativeVerified: 0,
            falsePositiveProbes: 0,
            falseNegativeProbes: 0,
          },
        },
      ],
    },
  };
}
