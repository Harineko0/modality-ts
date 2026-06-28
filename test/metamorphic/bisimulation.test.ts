import { describe, expect, it } from "vitest";
import type { CheckReport, Model } from "modality-ts/core";
import { compareModels } from "../../tools/metamorphic/bisimulation.js";

describe("compareModels", () => {
  it("treats token-renamed reachable states as equal", () => {
    const result = compareModels({
      baseline: tokenModel(["tok1", "tok2"]),
      variant: tokenModel(["tok2", "tok1"]),
      baselineReport: checkReport("verified"),
      variantReport: checkReport("verified"),
    });

    expect(result.bisimilar).toBe(true);
    expect(result.stateSetDelta).toBeUndefined();
  });

  it("reports a reachable-state delta", () => {
    const result = compareModels({
      baseline: boolModel({ withTransition: true }),
      variant: boolModel({ withTransition: false }),
      baselineReport: checkReport("verified"),
      variantReport: checkReport("verified"),
    });

    expect(result.bisimilar).toBe(false);
    expect(result.stateSetDelta?.variantOnly).toHaveLength(0);
    expect(result.stateSetDelta?.baselineOnly.length).toBeGreaterThan(0);
  });

  it("reports verdict deltas", () => {
    const result = compareModels({
      baseline: boolModel({ withTransition: false }),
      variant: boolModel({ withTransition: false }),
      baselineReport: checkReport("verified"),
      variantReport: checkReport("violated"),
    });

    expect(result.bisimilar).toBe(false);
    expect(result.verdictDelta).toEqual([
      expect.objectContaining({ property: "p" }),
    ]);
  });

  it("classifies bound-hit exploration of differing models as inconclusive", () => {
    const result = compareModels({
      baseline: boolModel({ withTransition: true }),
      variant: twoFlagModel(),
      searchLimits: { maxStates: 1, maxEdges: 100, maxFrontier: 100 },
    });

    expect(result.bisimilar).toBe(false);
    expect(result.boundHit).toBe(true);
  });

  it("treats semantically identical models as bisimilar without enumeration", () => {
    const result = compareModels({
      baseline: boolModel({ withTransition: true }),
      variant: boolModel({ withTransition: true }),
      // A bound that the bool model's reachable set would exceed if enumerated;
      // the semantic short-circuit must decide bisimilarity without exploring.
      searchLimits: { maxStates: 1, maxEdges: 1, maxFrontier: 1 },
    });

    expect(result.bisimilar).toBe(true);
    expect(result.boundHit).toBeUndefined();
    expect(result.baselineStates).toBe(0);
    expect(result.variantStates).toBe(0);
  });

  it("flags verdict deltas even for semantically identical models", () => {
    const result = compareModels({
      baseline: boolModel({ withTransition: true }),
      variant: boolModel({ withTransition: true }),
      baselineReport: checkReport("verified"),
      variantReport: checkReport("violated"),
    });

    expect(result.bisimilar).toBe(false);
    expect(result.verdictDelta).toEqual([
      expect.objectContaining({ property: "p" }),
    ]);
  });
});

function twoFlagModel(): Model {
  const base = boolModel({ withTransition: true });
  return {
    ...base,
    vars: [
      ...base.vars,
      {
        id: "flag2",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
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

function tokenModel(initial: readonly [string, string]): Model {
  return {
    schemaVersion: 1,
    id: "token",
    bounds: { maxDepth: 1, maxPending: 0, maxInternalSteps: 1 },
    vars: [
      {
        id: "left",
        domain: { kind: "tokens", count: 2 },
        origin: "system",
        scope: { kind: "global" },
        initial: initial[0],
      },
      {
        id: "right",
        domain: { kind: "tokens", count: 2 },
        origin: "system",
        scope: { kind: "global" },
        initial: initial[1],
      },
    ],
    transitions: [],
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
