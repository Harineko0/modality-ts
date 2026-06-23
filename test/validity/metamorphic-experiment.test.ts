import { describe, expect, it } from "vitest";
import type { CheckReport, Model } from "modality-ts/core";
import { metamorphicExperiment } from "../../tools/validity/experiments/metamorphic.js";
import type { ValidityRunContext } from "../../tools/validity/types.js";

describe("metamorphicExperiment", () => {
  it("classifies invariant variants as stable and semantic-changing variants as divergent", async () => {
    const variants = [
      {
        variantId: "variant-comment",
        appRoot: "/tmp/variant-comment",
        file: "App.tsx",
        transformId: "comment-whitespace",
        siteId: "comment-whitespace:1:0-0",
        sourceDiff: "comment diff",
      },
      {
        variantId: "variant-unsafe",
        appRoot: "/tmp/variant-unsafe",
        file: "App.tsx",
        transformId: "test-unsafe",
        siteId: "test-unsafe:1:1-2",
        sourceDiff: "unsafe diff",
      },
    ];
    let runCount = 0;
    const experiment = metamorphicExperiment({
      countCandidates: async () => 2,
      generate: async () => variants,
      runOnce: async (input) => {
        runCount += 1;
        const unsafe = input.appRoot.includes("variant-unsafe");
        return {
          model: boolModel({ withTransition: !unsafe }),
          extractReport: {},
          checkReport: checkReport(unsafe ? "violated" : "verified"),
          replayVerdicts: new Map(),
          artifactPaths: {
            model: `${input.workDir}/model.json`,
            extractReport: `${input.workDir}/extract.json`,
            checkReport: `${input.workDir}/check.json`,
            tracesDir: `${input.workDir}/traces`,
          },
        } as never;
      },
    });

    const report = await experiment.run(context());

    expect(runCount).toBe(3);
    expect(report.status).toBe("pass");
    expect(report.perBenchmark[0]?.metrics).toMatchObject({
      variantsTotal: 2,
      stable: 1,
      divergent: 1,
      inconclusive: 0,
      stabilityRate: 0.5,
      perTransform: {
        "comment-whitespace": { generated: 1, stable: 1 },
        "test-unsafe": { generated: 1, divergent: 1 },
      },
    });
    expect(report.perBenchmark[0]?.messages.join("\n")).toContain(
      "variant-unsafe divergent test-unsafe",
    );
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
          metamorphic: {
            maxVariants: 2,
            seed: 1,
          },
        },
      ],
      validityThresholds: {
        metamorphic: {
          minStabilityRate: 0,
        },
      },
    },
  };
}

function boolModel(options: { withTransition: boolean }): Model {
  return {
    schemaVersion: 1,
    id: "bool",
    bounds: { maxDepth: 4, maxPending: 0, maxInternalSteps: 4 },
    vars: [
      {
        id: "flag",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: options.withTransition
      ? [
          {
            id: "enable",
            cls: "user",
            label: { kind: "click", text: "Enable" },
            source: [],
            guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
            effect: {
              kind: "assign",
              var: "flag",
              expr: { kind: "lit", value: true },
            },
            reads: ["flag"],
            writes: ["flag"],
            confidence: "exact",
          },
        ]
      : [],
  };
}

function checkReport(
  status: CheckReport["verdicts"][number]["status"],
): CheckReport {
  return {
    schemaVersion: 1,
    kind: "check-report",
    modelId: "model",
    generatedAt: "2026-06-23T00:00:00.000Z",
    verdicts: [{ property: "p", status }],
    stats: { states: 1, edges: 0, depth: 0 },
    vacuityWarnings: [],
    trustLedger: {
      bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
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
  };
}
