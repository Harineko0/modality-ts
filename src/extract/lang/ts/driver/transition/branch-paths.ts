import * as ts from "typescript";
import type { BoundExpr, SetterBinding } from "../types.js";
import {
  combineParsedGuards,
  parseGuardExpression,
  type ParsedGuard,
} from "./guards.js";
import { bindConstStatement } from "./locals.js";

export interface GuardedPath {
  guard?: ParsedGuard;
  statements: readonly ts.Statement[];
}

export interface PathEnumOptions {
  setters: Map<string, SetterBinding>;
  initialLocals?: Map<string, BoundExpr>;
  maxPaths?: number;
}

interface CandidateGuard {
  guard?: ParsedGuard;
  representable: boolean;
}

interface BranchArm {
  guard: CandidateGuard;
  statements: readonly ts.Statement[];
}

export function enumerateGuardedPaths(
  statements: readonly ts.Statement[],
  options: PathEnumOptions,
): { paths: GuardedPath[]; truncated: boolean } {
  const maxPaths = options.maxPaths ?? 8;
  const paths: GuardedPath[] = [];
  let truncated = false;

  const emit = (path: GuardedPath): void => {
    if (paths.length >= maxPaths) {
      truncated = true;
      return;
    }
    paths.push(path);
  };

  const walk = (
    remaining: readonly ts.Statement[],
    guard: CandidateGuard,
    prefix: readonly ts.Statement[],
    locals: Map<string, BoundExpr>,
  ): void => {
    if (truncated) return;
    const [head, ...tail] = remaining;
    if (!head) {
      emit({
        guard: guard.representable ? guard.guard : undefined,
        statements: prefix,
      });
      return;
    }
    if (ts.isReturnStatement(head)) {
      emit({
        guard: guard.representable ? guard.guard : undefined,
        statements: prefix,
      });
      return;
    }
    if (!ts.isIfStatement(head)) {
      const nextLocals = new Map(locals);
      bindConstStatement(head, options.setters, nextLocals, true);
      walk(tail, guard, [...prefix, head], nextLocals);
      return;
    }

    for (const arm of ifChainArms(head, { ...options, initialLocals: locals })) {
      walk(
        [...arm.statements, ...tail],
        combineCandidateGuards([guard, arm.guard]),
        prefix,
        new Map(locals),
      );
      if (truncated) return;
    }
  };

  walk(
    statements,
    { representable: true },
    [],
    new Map(options.initialLocals),
  );
  return { paths, truncated };
}

function ifChainArms(
  statement: ts.IfStatement,
  options: PathEnumOptions,
): BranchArm[] {
  const arms: BranchArm[] = [];
  const previousConditions: CandidateGuard[] = [];
  let current: ts.IfStatement | undefined = statement;

  while (current) {
    const condition = parsedCondition(current.expression, options);
    const truth = condition.representable
      ? literalBoolean(condition.guard?.expr)
      : undefined;
    if (truth === true) {
      arms.push({
        guard: combineCandidateGuards([
          ...previousConditions.map(negateCandidateGuard),
          condition,
        ]),
        statements: statementsForArm(current.thenStatement),
      });
      break;
    }
    if (truth === false) {
      previousConditions.push(condition);
      const elseStatement: ts.Statement | undefined = current.elseStatement;
      if (!elseStatement) {
        arms.push({
          guard: combineCandidateGuards(
            previousConditions.map(negateCandidateGuard),
          ),
          statements: [],
        });
        break;
      }
      if (ts.isIfStatement(elseStatement)) {
        current = elseStatement;
        continue;
      }
      arms.push({
        guard: combineCandidateGuards(
          previousConditions.map(negateCandidateGuard),
        ),
        statements: statementsForArm(elseStatement),
      });
      break;
    }
    arms.push({
      guard: combineCandidateGuards([
        ...previousConditions.map(negateCandidateGuard),
        condition,
      ]),
      statements: statementsForArm(current.thenStatement),
    });
    previousConditions.push(condition);

    const elseStatement: ts.Statement | undefined = current.elseStatement;
    if (!elseStatement) {
      arms.push({
        guard: combineCandidateGuards(
          previousConditions.map(negateCandidateGuard),
        ),
        statements: [],
      });
      break;
    }
    if (ts.isIfStatement(elseStatement)) {
      current = elseStatement;
      continue;
    }
    arms.push({
      guard: combineCandidateGuards(
        previousConditions.map(negateCandidateGuard),
      ),
      statements: statementsForArm(elseStatement),
    });
    break;
  }

  return arms;
}

function statementsForArm(statement: ts.Statement): readonly ts.Statement[] {
  return ts.isBlock(statement) ? Array.from(statement.statements) : [statement];
}

function parsedCondition(
  expression: ts.Expression,
  options: PathEnumOptions,
): CandidateGuard {
  const guard = parseGuardExpression(
    expression,
    options.setters,
    options.initialLocals,
  );
  return guard ? { guard, representable: true } : { representable: false };
}

function negateCandidateGuard(candidate: CandidateGuard): CandidateGuard {
  if (!candidate.representable) return { representable: false };
  if (!candidate.guard) return { guard: falseGuard(), representable: true };
  return {
    guard: {
      expr: { kind: "not", args: [candidate.guard.expr] },
      reads: candidate.guard.reads,
    },
    representable: true,
  };
}

function combineCandidateGuards(
  guards: readonly CandidateGuard[],
): CandidateGuard {
  if (guards.some((guard) => !guard.representable)) {
    return { representable: false };
  }
  return {
    guard: combineParsedGuards(guards.map((guard) => guard.guard)),
    representable: true,
  };
}

function falseGuard(): ParsedGuard {
  return { expr: { kind: "lit", value: false }, reads: [] };
}

function literalBoolean(
  expr: ParsedGuard["expr"] | undefined,
): boolean | undefined {
  if (!expr) return undefined;
  switch (expr.kind) {
    case "lit":
      return typeof expr.value === "boolean" ? expr.value : undefined;
    case "eq":
    case "neq": {
      const [left, right] = expr.args;
      if (left?.kind !== "lit" || right?.kind !== "lit") return undefined;
      const equal = left.value === right.value;
      return expr.kind === "eq" ? equal : !equal;
    }
    case "not": {
      const value = literalBoolean(expr.args[0]);
      return value === undefined ? undefined : !value;
    }
    case "and": {
      const values = expr.args.map(literalBoolean);
      if (values.some((value) => value === false)) return false;
      return values.every((value) => value === true) ? true : undefined;
    }
    case "or": {
      const values = expr.args.map(literalBoolean);
      if (values.some((value) => value === true)) return true;
      return values.every((value) => value === false) ? false : undefined;
    }
    default:
      return undefined;
  }
}
