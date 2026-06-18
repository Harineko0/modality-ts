import type {
  CheckReport,
  ConformReport,
  EffectIR,
  ExtractionReport,
  ExprIR,
  Model,
} from "modality-ts/core";
import { evaluateStateSpaceBudgets } from "../shared-gates/budgets.js";
import {
  evaluateConformThresholds,
  evaluateCoverageThresholds,
} from "../shared-gates/thresholds.js";
import type {
  GateBudgetResult,
  GateThresholdResult,
  SharedBudgets,
  SharedThresholds,
} from "../shared-gates/types.js";

export type FixtureThresholds = SharedThresholds;
export type FixtureBudgets = SharedBudgets;

export interface FixtureSemanticExpectations {
  transitionIds?: readonly string[];
  transitionIdPrefixes?: readonly string[];
  vars?: readonly {
    id: string;
    scope?: unknown;
    domainKind?: string;
  }[];
  effectReadKinds?: readonly {
    transitionIdPrefix: string;
    kinds: readonly string[];
  }[];
  navigateTargets?: readonly string[];
  minStateContributorVars?: number;
  caveatKinds?: readonly string[];
}

export interface AssertionFailure {
  id: string;
  message: string;
}

export type ThresholdAssertionResult = GateThresholdResult;
export type BudgetAssertionResult = GateBudgetResult;

export function assertCoverageThreshold(
  report: ExtractionReport,
  threshold: number | undefined,
): ThresholdAssertionResult {
  if (threshold === undefined) {
    return { id: "minCoverageExactOrOverlay", status: "skipped" };
  }
  return (
    evaluateCoverageThresholds(report, {
      minCoverageExactOrOverlay: threshold,
    })[0] ?? { id: "minCoverageExactOrOverlay", status: "skipped" }
  );
}

export function assertConformPassRate(
  report: ConformReport | undefined,
  threshold: number | undefined,
): ThresholdAssertionResult {
  if (threshold === undefined) {
    return { id: "minConformPassRate", status: "skipped" };
  }
  return (
    evaluateConformThresholds(report, { minConformPassRate: threshold })[0] ?? {
      id: "minConformPassRate",
      status: "skipped",
    }
  );
}

export function assertTransitionPassRates(
  report: ConformReport | undefined,
  threshold: number | undefined,
): ThresholdAssertionResult[] {
  if (threshold === undefined) return [];
  return evaluateConformThresholds(report, {
    minTransitionPassRate: threshold,
  });
}

export function assertThresholds(input: {
  extractionReport: ExtractionReport;
  conformReport?: ConformReport;
  thresholds?: FixtureThresholds;
}): ThresholdAssertionResult[] {
  return [
    ...evaluateCoverageThresholds(input.extractionReport, input.thresholds),
    ...evaluateConformThresholds(input.conformReport, input.thresholds),
  ];
}

export function assertStateSpaceBudget(
  checkReport: CheckReport | undefined,
  budgets: FixtureBudgets | undefined,
  extractionReport?: ExtractionReport,
): BudgetAssertionResult[] {
  return evaluateStateSpaceBudgets({
    checkReport,
    extractionReport,
    budgets,
  });
}

export function assertSemanticExpectations(
  model: Model,
  extractionReport: ExtractionReport,
  expectations: FixtureSemanticExpectations | undefined,
): AssertionFailure[] {
  if (!expectations) return [];
  const failures: AssertionFailure[] = [];
  const transitionIds = model.transitions.map((transition) => transition.id);

  for (const transitionId of expectations.transitionIds ?? []) {
    if (!transitionIds.includes(transitionId)) {
      failures.push({
        id: `transition:${transitionId}`,
        message: `missing transition id ${transitionId}`,
      });
    }
  }

  for (const prefix of expectations.transitionIdPrefixes ?? []) {
    if (!transitionIds.some((id) => id.startsWith(prefix))) {
      failures.push({
        id: `transition-prefix:${prefix}`,
        message: `no transition id starts with ${prefix}`,
      });
    }
  }

  for (const expectedVar of expectations.vars ?? []) {
    const actualVar = model.vars.find((decl) => decl.id === expectedVar.id);
    if (!actualVar) {
      failures.push({
        id: `var:${expectedVar.id}`,
        message: `missing var ${expectedVar.id}`,
      });
      continue;
    }
    if (
      expectedVar.scope !== undefined &&
      JSON.stringify(actualVar.scope) !== JSON.stringify(expectedVar.scope)
    ) {
      failures.push({
        id: `var-scope:${expectedVar.id}`,
        message: `var ${expectedVar.id} scope ${JSON.stringify(actualVar.scope)} does not match ${JSON.stringify(expectedVar.scope)}`,
      });
    }
    if (
      expectedVar.domainKind !== undefined &&
      actualVar.domain.kind !== expectedVar.domainKind
    ) {
      failures.push({
        id: `var-domain:${expectedVar.id}`,
        message: `var ${expectedVar.id} domain kind ${actualVar.domain.kind} does not match ${expectedVar.domainKind}`,
      });
    }
  }

  for (const expectation of expectations.effectReadKinds ?? []) {
    const matching = model.transitions.filter((candidate) =>
      candidate.id.startsWith(expectation.transitionIdPrefix),
    );
    if (matching.length === 0) {
      failures.push({
        id: `effect-reads:${expectation.transitionIdPrefix}`,
        message: `missing transition for prefix ${expectation.transitionIdPrefix}`,
      });
      continue;
    }
    const kinds = matching.flatMap((transition) =>
      collectExprReadKinds(transition.effect),
    );
    for (const kind of expectation.kinds) {
      if (!kinds.includes(kind)) {
        failures.push({
          id: `effect-read:${expectation.transitionIdPrefix}:${kind}`,
          message: `transitions matching ${expectation.transitionIdPrefix} missing read kind ${kind}`,
        });
      }
    }
  }

  for (const target of expectations.navigateTargets ?? []) {
    const hasNavigate = model.transitions.some((transition) => {
      if (transition.effect.kind !== "navigate") return false;
      const to = transition.effect.to;
      return to.kind === "lit" && to.value === target;
    });
    if (!hasNavigate) {
      failures.push({
        id: `navigate:${target}`,
        message: `missing navigate transition to ${target}`,
      });
    }
  }

  if (expectations.minStateContributorVars !== undefined) {
    const count = extractionReport.stateContributors?.topVars.length ?? 0;
    if (count < expectations.minStateContributorVars) {
      failures.push({
        id: "stateContributors",
        message: `expected at least ${expectations.minStateContributorVars} state contributors, got ${count}`,
      });
    }
  }

  if (expectations.caveatKinds !== undefined) {
    const kinds = new Set(
      [
        ...extractionReport.globalTaints,
        ...extractionReport.staleReads,
        ...extractionReport.unhandledRejections,
      ].map((caveat) => caveat.kind),
    );
    for (const kind of expectations.caveatKinds) {
      if (!kinds.has(kind)) {
        failures.push({
          id: `caveat:${kind}`,
          message: `missing caveat kind ${kind}`,
        });
      }
    }
  }

  return failures;
}

function collectExprReadKinds(effect: EffectIR): string[] {
  const kinds: string[] = [];
  walkEffect(effect, (expr) => walkExpr(expr, kinds));
  return kinds;
}

function walkExpr(expr: ExprIR, kinds: string[]): void {
  if (
    expr.kind === "read" ||
    expr.kind === "readPre" ||
    expr.kind === "readOpArg"
  ) {
    kinds.push(expr.kind);
  }
  if ("args" in expr && Array.isArray(expr.args)) {
    for (const arg of expr.args) {
      if (arg && typeof arg === "object" && "kind" in arg) {
        walkExpr(arg as ExprIR, kinds);
      }
    }
  }
}

function walkEffect(effect: EffectIR, visitExpr: (expr: ExprIR) => void): void {
  if (effect.kind === "assign") {
    visitExpr(effect.expr);
    return;
  }
  if (effect.kind === "seq") {
    for (const nested of effect.effects) walkEffect(nested, visitExpr);
    return;
  }
  if (effect.kind === "navigate") {
    visitExpr(effect.to);
  }
}
