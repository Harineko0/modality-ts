import { describe, expect, it } from "vitest";
import type { CheckReport, ConformReport } from "modality-ts/core";
import { mutationExperiment } from "../../tools/validity/experiments/mutation.js";
import type { ValidityRunContext } from "../../tools/validity/types.js";

describe("mutationExperiment", () => {
  it("classifies behaviour-affecting mutants as killed and no-op mutants as preserved", async () => {
    const mutants = [
      {
        mutantId: "mutant-affecting",
        appRoot: "/tmp/mutant-affecting",
        file: "App.tsx",
        operatorId: "conditional-boundary",
        siteId: "conditional-boundary:1:1-2",
        sourceDiff: "diff",
      },
      {
        mutantId: "mutant-noop",
        appRoot: "/tmp/mutant-noop",
        file: "App.tsx",
        operatorId: "numeric-off-by-one",
        siteId: "numeric-off-by-one:1:1-2",
        sourceDiff: "diff",
      },
    ];
    let runCount = 0;
    const experiment = mutationExperiment({
      countCandidates: async () => 2,
      generate: async () => mutants,
      runOnce: async (input) => {
        runCount += 1;
        const isAffecting = input.appRoot.includes("mutant-affecting");
        const isMutant = input.appRoot.includes("mutant-");
        const verdicts: CheckReport["verdicts"] = [
          { property: "existing", status: "violated" },
          {
            property: "breaks",
            status: isAffecting ? "violated" : "verified",
          },
        ];
        const replayVerdicts = new Map([
          ["existing", { property: "existing", status: "reproduced" }],
          ...(isAffecting
            ? [["breaks", { property: "breaks", status: "reproduced" }]]
            : []),
        ]);
        return {
          model: { vars: [], transitions: [], bounds: {}, id: "model" },
          extractReport: {},
          checkReport: checkReport(verdicts),
          replayVerdicts,
          artifactPaths: {
            model: isMutant
              ? `${input.appRoot}/model.json`
              : "/tmp/base/model.json",
            extractReport: "/tmp/extract.json",
            checkReport: "/tmp/check.json",
            tracesDir: "/tmp/traces",
          },
        } as never;
      },
      compareBehaviour: async (input) => ({
        preserved: input.mutantModelPath.includes("mutant-noop"),
        baselineReport: conformReport(),
        mutantReport: conformReport(),
        differences: input.mutantModelPath.includes("mutant-noop")
          ? []
          : ["walk-1 status reproduced -> not-reproduced"],
      }),
    });

    const report = await experiment.run(context());

    expect(runCount).toBe(3);
    expect(report.status).toBe("pass");
    expect(report.perBenchmark[0]?.metrics).toMatchObject({
      mutantsTotal: 2,
      killed: 1,
      survived: 0,
      preserved: 1,
      detectionRate: 1,
    });
  });

  it("fails all-survived mutation runs even when the detection threshold is zero", async () => {
    const mutants = [
      {
        mutantId: "mutant-survived",
        appRoot: "/tmp/mutant-survived",
        file: "App.tsx",
        operatorId: "conditional-boundary",
        siteId: "conditional-boundary:1:1-2",
        sourceDiff: "diff",
      },
    ];
    const experiment = mutationExperiment({
      countCandidates: async () => 1,
      generate: async () => mutants,
      runOnce: async (input) =>
        ({
          model: { vars: [], transitions: [], bounds: {}, id: "model" },
          extractReport: {},
          checkReport: checkReport([{ property: "p", status: "verified" }]),
          replayVerdicts: new Map(),
          artifactPaths: {
            model: `${input.appRoot}/model.json`,
            extractReport: "/tmp/extract.json",
            checkReport: "/tmp/check.json",
            tracesDir: "/tmp/traces",
          },
        }) as never,
      compareBehaviour: async () => ({
        preserved: false,
        baselineReport: conformReport(),
        mutantReport: conformReport(),
        differences: [],
      }),
    });

    const report = await experiment.run(context());

    expect(report.status).toBe("fail");
    expect(report.headline).toBe(
      "blocked: no mutants killed or preserved (oracle produced no signal)",
    );
    expect(report.messages).toContain(
      "blocked: no mutants killed or preserved (oracle produced no signal)",
    );
    expect(report.perBenchmark[0]).toMatchObject({
      status: "fail",
      headline:
        "blocked: no mutants killed or preserved (oracle produced no signal)",
      metrics: {
        mutantsTotal: 1,
        killed: 0,
        survived: 1,
        preserved: 0,
        detectionRate: 0,
      },
    });
  });

  it("blocks all-preserved mutation runs instead of reporting vacuous full detection", async () => {
    const mutants = [
      {
        mutantId: "mutant-preserved",
        appRoot: "/tmp/mutant-preserved",
        file: "App.tsx",
        operatorId: "numeric-off-by-one",
        siteId: "numeric-off-by-one:1:1-2",
        sourceDiff: "diff",
      },
    ];
    const experiment = mutationExperiment({
      countCandidates: async () => 1,
      generate: async () => mutants,
      runOnce: async (input) =>
        ({
          model: { vars: [], transitions: [], bounds: {}, id: "model" },
          extractReport: {},
          checkReport: checkReport([{ property: "p", status: "verified" }]),
          replayVerdicts: new Map(),
          artifactPaths: {
            model: `${input.appRoot}/model.json`,
            extractReport: "/tmp/extract.json",
            checkReport: "/tmp/check.json",
            tracesDir: "/tmp/traces",
          },
        }) as never,
      compareBehaviour: async () => ({
        preserved: true,
        baselineReport: conformReport(),
        mutantReport: conformReport(),
        differences: [],
      }),
    });

    const report = await experiment.run(context());

    expect(report.status).toBe("fail");
    expect(report.headline).toBe("blocked: no discriminating mutants");
    expect(report.messages).toContain("blocked: no discriminating mutants");
    expect(report.perBenchmark[0]).toMatchObject({
      status: "fail",
      headline: "blocked: no discriminating mutants",
      metrics: {
        mutantsTotal: 1,
        killed: 0,
        survived: 0,
        preserved: 1,
        detectionRate: 0,
      },
    });
  });
});

function context(): ValidityRunContext {
  return {
    repoRoot: "/repo",
    workDir: "/tmp/modality-validity-test",
    now: new Date("2026-06-23T00:00:00.000Z"),
    manifest: {
      schemaVersion: 1,
      manifestId: "test",
      benchmarks: [
        {
          id: "fixture",
          framework: "react-router",
          root: "fixture",
          packageJsonPath: "package.json",
          sourcePaths: ["App.tsx"],
          propsPaths: ["App.props.ts"],
          effectApis: ["api.call"],
          expected: {
            truePositiveViolations: 0,
            trueNegativeVerified: 1,
            falsePositiveProbes: 0,
            falseNegativeProbes: 0,
          },
          mutation: {
            maxMutants: 2,
            seed: 1,
          },
        },
      ],
      validityThresholds: {
        mutation: {
          minDetectionRate: 0,
        },
      },
    },
  };
}

function checkReport(verdicts: CheckReport["verdicts"]): CheckReport {
  return {
    schemaVersion: 1,
    kind: "check-report",
    modelId: "model",
    generatedAt: "2026-06-23T00:00:00.000Z",
    verdicts,
    stats: { states: 1, edges: 0, depth: 0 },
    vacuityWarnings: [],
    trustLedger: {
      bounds: {},
      plugins: [],
      assumptions: [],
      abstractions: [],
      globalTaints: [],
      staleReads: [],
      unhandledRejections: [],
      unextractableHandlers: [],
      modelSlack: [],
      domains: [],
      manualTransitions: [],
      overApproxTransitions: [],
      boundHits: [],
      ignoredVars: [],
      numericReductions: [],
    },
  } as CheckReport;
}

function conformReport(): ConformReport {
  return {
    schemaVersion: 1,
    kind: "conform-report",
    generatedAt: "2026-06-23T00:00:00.000Z",
    walks: [],
    metrics: {
      total: 0,
      reproduced: 0,
      notReproduced: 0,
      inconclusive: 0,
      passRate: 1,
    },
    transitionMetrics: [],
  };
}
