import type { EffectIR, ExprIR, Transition } from "modality-ts/core";

export interface DirectionalClause {
  readonly kind: "eq" | "neq";
  readonly var: string;
  readonly value: unknown;
}

export interface DirectionalPredicateAnalysis {
  readonly clauses: readonly DirectionalClause[];
}

export function analyzeDirectionalPredicate(
  expr: ExprIR,
): DirectionalPredicateAnalysis | undefined {
  const clauses = collectSimpleClauses(expr);
  if (clauses === undefined || clauses.length === 0) return undefined;
  return { clauses };
}

export function isTransitionDirectionallyRelevant(
  transition: Transition,
  neededWrittenVars: readonly string[],
  analysis: DirectionalPredicateAnalysis,
): boolean {
  if (neededWrittenVars.length === 0) return false;
  let sawRelevantWrite = false;
  for (const varId of neededWrittenVars) {
    const clauses = analysis.clauses.filter((clause) => clause.var === varId);
    if (clauses.length === 0) {
      return true;
    }
    const assignValues = collectStaticAssignValues(transition.effect, varId);
    if (assignValues === "unsupported") {
      return true;
    }
    if (assignValues.length === 0) {
      continue;
    }
    if (
      assignValues.some((value) =>
        clauses.some((clause) => assignContributesToward(clause, value)),
      )
    ) {
      sawRelevantWrite = true;
      continue;
    }
    if (!onlyWritesAway(clauses, assignValues)) {
      return true;
    }
  }
  return sawRelevantWrite;
}

function collectSimpleClauses(expr: ExprIR): DirectionalClause[] | undefined {
  switch (expr.kind) {
    case "eq": {
      const leftVar = asVarRead(expr.args[0]);
      const rightLit = asLiteral(expr.args[1]);
      if (leftVar !== undefined && rightLit !== undefined) {
        return [{ kind: "eq", var: leftVar, value: rightLit }];
      }
      const rightVar = asVarRead(expr.args[1]);
      const leftLit = asLiteral(expr.args[0]);
      if (rightVar !== undefined && leftLit !== undefined) {
        return [{ kind: "eq", var: rightVar, value: leftLit }];
      }
      return undefined;
    }
    case "neq": {
      const leftVar = asVarRead(expr.args[0]);
      const rightLit = asLiteral(expr.args[1]);
      if (leftVar !== undefined && rightLit !== undefined) {
        return [{ kind: "neq", var: leftVar, value: rightLit }];
      }
      const rightVar = asVarRead(expr.args[1]);
      const leftLit = asLiteral(expr.args[0]);
      if (rightVar !== undefined && leftLit !== undefined) {
        return [{ kind: "neq", var: rightVar, value: leftLit }];
      }
      return undefined;
    }
    case "not": {
      const inner = collectSimpleClauses(expr.args[0]);
      if (inner === undefined || inner.length !== 1) return undefined;
      const clause = inner[0]!;
      if (clause.kind === "eq") {
        return [{ kind: "neq", var: clause.var, value: clause.value }];
      }
      if (clause.kind === "neq") {
        return [{ kind: "eq", var: clause.var, value: clause.value }];
      }
      return undefined;
    }
    case "and":
    case "or": {
      const clauses: DirectionalClause[] = [];
      for (const arg of expr.args) {
        const nested = collectSimpleClauses(arg);
        if (nested === undefined) return undefined;
        clauses.push(...nested);
      }
      return clauses;
    }
    default:
      return undefined;
  }
}

function asVarRead(expr: ExprIR): string | undefined {
  return expr.kind === "read" && expr.path === undefined ? expr.var : undefined;
}

function asLiteral(expr: ExprIR): unknown | undefined {
  return expr.kind === "lit" ? expr.value : undefined;
}

type StaticAssignValues = readonly unknown[] | "unsupported";

function collectStaticAssignValues(
  effect: EffectIR,
  varId: string,
): StaticAssignValues {
  const values: unknown[] = [];
  let unsupported = false;
  walkEffect(effect, (node) => {
    switch (node.kind) {
      case "assign":
        if (node.var !== varId) return;
        if (node.expr.kind === "lit") values.push(node.expr.value);
        else unsupported = true;
        return;
      case "havoc":
      case "opaque":
      case "choose":
      case "if":
        unsupported = true;
        return;
      default:
        return;
    }
  });
  if (unsupported) return "unsupported";
  return values;
}

function walkEffect(effect: EffectIR, visit: (node: EffectIR) => void): void {
  visit(effect);
  switch (effect.kind) {
    case "seq":
      for (const child of effect.effects) walkEffect(child, visit);
      return;
    case "if":
      walkEffect(effect.then, visit);
      walkEffect(effect.else, visit);
      return;
    default:
      return;
  }
}

function assignContributesToward(
  clause: DirectionalClause,
  value: unknown,
): boolean {
  if (clause.kind === "eq") {
    return stableEqual(clause.value, value);
  }
  return !stableEqual(clause.value, value);
}

function onlyWritesAway(
  clauses: readonly DirectionalClause[],
  values: readonly unknown[],
): boolean {
  return values.every((value) =>
    clauses.every((clause) => !assignContributesToward(clause, value)),
  );
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
