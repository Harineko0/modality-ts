import type { CheckReport, ExtractionReport } from "modality-ts/core";
import type { GateBudgetResult, SharedBudgets } from "./types.js";

export function evaluateStateSpaceBudgets(input: {
  extractionReport?: ExtractionReport;
  checkReport?: CheckReport;
  budgets?: SharedBudgets;
}): GateBudgetResult[] {
  if (!input.budgets) return [];
  const results: GateBudgetResult[] = [];
  const stats = input.checkReport?.stats;
  const search = input.checkReport?.diagnostics?.search;
  const limits = input.checkReport?.diagnostics?.limits;
  const dominantVars = input.checkReport?.diagnostics?.dominantVars ?? [];
  const contributors = input.extractionReport?.stateContributors;

  if (limits) {
    results.push({
      id: "searchLimitHit",
      status: "fail",
      evidence: [
        "checkReport.diagnostics.limits",
        `reason: ${limits.reason}`,
        ...(limits.maxStates !== undefined
          ? [`limits.maxStates: ${limits.maxStates}`]
          : []),
        ...(limits.maxEdges !== undefined
          ? [`limits.maxEdges: ${limits.maxEdges}`]
          : []),
        ...(limits.maxFrontier !== undefined
          ? [`limits.maxFrontier: ${limits.maxFrontier}`]
          : []),
      ],
      message: `search limit hit: ${limits.reason}`,
    });
  }

  if (input.budgets.maxStates !== undefined) {
    const actualStates = stats?.states ?? 0;
    results.push(
      compareBudget({
        id: "maxStates",
        actual: actualStates,
        expected: input.budgets.maxStates,
        reportField: "checkReport.stats.states",
        contributorVarIds: contributors?.topVars.map((entry) => entry.varId),
        formatMessage: (actual, expected) =>
          `state count ${actual} exceeds budget ${expected}`,
        fields: { maxStates: input.budgets.maxStates, actualStates },
      }),
    );
  }

  if (input.budgets.maxEdges !== undefined) {
    const actualEdges = stats?.edges ?? 0;
    results.push(
      compareBudget({
        id: "maxEdges",
        actual: actualEdges,
        expected: input.budgets.maxEdges,
        reportField: "checkReport.stats.edges",
        formatMessage: (actual, expected) =>
          `edge count ${actual} exceeds budget ${expected}`,
        fields: { maxEdges: input.budgets.maxEdges, actualEdges },
      }),
    );
  }

  if (input.budgets.maxDepth !== undefined) {
    const actualDepth = stats?.depth ?? 0;
    results.push(
      compareBudget({
        id: "maxDepth",
        actual: actualDepth,
        expected: input.budgets.maxDepth,
        reportField: "checkReport.stats.depth",
        formatMessage: (actual, expected) =>
          `depth ${actual} exceeds budget ${expected}`,
        fields: { maxDepth: input.budgets.maxDepth, actualDepth },
      }),
    );
  }

  if (input.budgets.maxFrontier !== undefined) {
    const actualFrontier = search?.maxFrontier ?? 0;
    results.push(
      compareBudget({
        id: "maxFrontier",
        actual: actualFrontier,
        expected: input.budgets.maxFrontier,
        reportField: "checkReport.diagnostics.search.maxFrontier",
        formatMessage: (actual, expected) =>
          `frontier ${actual} exceeds budget ${expected}`,
        fields: {
          maxFrontier: input.budgets.maxFrontier,
          actualFrontier,
        },
      }),
    );
  }

  if (input.budgets.maxDominantVarValues !== undefined) {
    const actual = dominantVars.length
      ? Math.max(...dominantVars.map((entry) => entry.distinctValues))
      : 0;
    const varIds = dominantVars
      .filter(
        (entry) => entry.distinctValues === actual && actual > 0,
      )
      .map((entry) => entry.varId);
    results.push(
      compareBudget({
        id: "maxDominantVarValues",
        actual,
        expected: input.budgets.maxDominantVarValues,
        reportField: "checkReport.diagnostics.dominantVars",
        contributorVarIds: varIds,
        formatMessage: (actualValue, expected) =>
          `dominant var values ${actualValue} exceed budget ${expected}`,
        fields: {
          expected: input.budgets.maxDominantVarValues,
          actual,
        },
      }),
    );
  }

  if (input.budgets.maxStateSpaceBits !== undefined) {
    const actual = contributors?.totalBits ?? 0;
    results.push(
      compareBudget({
        id: "maxStateSpaceBits",
        actual,
        expected: input.budgets.maxStateSpaceBits,
        reportField: "extractionReport.stateContributors.totalBits",
        contributorVarIds: contributors?.topVars.map((entry) => entry.varId),
        formatMessage: (actualValue, expected) =>
          `state-space bits ${actualValue} exceed budget ${expected}`,
        fields: {
          expected: input.budgets.maxStateSpaceBits,
          actual,
        },
      }),
    );
  }

  if (input.budgets.maxTopContributorBits !== undefined) {
    const topContributor = contributors?.topVars[0];
    const actual = topContributor?.bits ?? 0;
    results.push(
      compareBudget({
        id: "maxTopContributorBits",
        actual,
        expected: input.budgets.maxTopContributorBits,
        reportField: "extractionReport.stateContributors.topVars[0].bits",
        contributorVarIds: topContributor ? [topContributor.varId] : [],
        formatMessage: (actualValue, expected) =>
          `top contributor bits ${actualValue} exceed budget ${expected}`,
        fields: {
          expected: input.budgets.maxTopContributorBits,
          actual,
        },
      }),
    );
  }

  const boundHits = input.checkReport?.trustLedger.boundHits ?? [];
  if (boundHits.length > 0 && input.budgets.maxBoundHits !== undefined) {
    const status =
      boundHits.length <= input.budgets.maxBoundHits ? "pass" : "fail";
    results.push({
      id: "boundHits",
      status,
      expected: input.budgets.maxBoundHits,
      actual: boundHits.length,
      evidence: [
        "checkReport.trustLedger.boundHits",
        ...boundHits.map((entry) => `boundHit: ${entry}`),
      ],
      ...(status === "fail"
        ? {
            message: `bound hits ${boundHits.length} exceed budget ${input.budgets.maxBoundHits}`,
          }
        : {}),
    });
  }

  return results;
}

function compareBudget(input: {
  id: string;
  actual: number;
  expected: number;
  reportField: string;
  contributorVarIds?: readonly string[];
  formatMessage: (actual: number, expected: number) => string;
  fields: GateBudgetResult;
}): GateBudgetResult {
  const status = input.actual <= input.expected ? "pass" : "fail";
  return {
    id: input.id,
    status,
    ...input.fields,
    ...(status === "fail"
      ? {
          evidence: [
            `${input.reportField}: ${input.actual}`,
            `budget.${input.id}: ${input.expected}`,
            ...(input.contributorVarIds?.length
              ? input.contributorVarIds.map((varId) => `varId: ${varId}`)
              : []),
          ],
          message: input.formatMessage(input.actual, input.expected),
        }
      : {}),
  };
}
