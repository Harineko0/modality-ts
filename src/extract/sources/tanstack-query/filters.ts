import { canonicalJson } from "modality-ts/core";
import type { ExprIR } from "modality-ts/core";
import * as ts from "typescript";
import { safeKeyId } from "./ids.js";
import type {
  MutationFilterMetadata,
  QueryFilterMetadata,
  ResolvedQueryKey,
} from "./types.js";

export function queryKeyFromExpression(
  expr: ts.Expression | undefined,
): ResolvedQueryKey | undefined {
  if (!expr) return undefined;
  if (ts.isParenthesizedExpression(expr)) {
    return queryKeyFromExpression(expr.expression);
  }
  if (ts.isStringLiteral(expr) && expr.text.length > 0) {
    return { display: expr.text, id: safeKeyId(expr.text) };
  }
  if (ts.isNoSubstitutionTemplateLiteral(expr) && expr.text.length > 0) {
    return { display: expr.text, id: safeKeyId(expr.text) };
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const parts = expr.elements.map(keyPartFromExpression);
    const hasIdentifier = expr.elements.some((el) => ts.isIdentifier(el));
    if (parts.some((part) => part === undefined)) {
      return dynamicKeySummary(expr);
    }
    const display = parts.join(":");
    return {
      display,
      id: safeKeyId(display),
      ...(hasIdentifier ? { dynamic: true } : {}),
    };
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const canonical = canonicalObjectKey(expr);
    if (!canonical) return dynamicKeySummary(expr);
    return { display: canonical.display, id: safeKeyId(canonical.display) };
  }
  if (ts.isIdentifier(expr)) {
    return {
      display: expr.text,
      id: safeKeyId(expr.text),
      dynamic: true,
    };
  }
  if (ts.isConditionalExpression(expr) && isNullish(expr.whenFalse)) {
    const key = queryKeyFromExpression(expr.whenTrue);
    const activeWhen = exprFromCondition(expr.condition);
    if (key && activeWhen) return { ...key, activeWhen };
  }
  if (ts.isConditionalExpression(expr) && isNullish(expr.whenTrue)) {
    const key = queryKeyFromExpression(expr.whenFalse);
    const activeWhen = exprFromCondition(expr.condition);
    if (key && activeWhen) {
      return { ...key, activeWhen: negateIr(activeWhen) };
    }
  }
  return dynamicKeySummary(expr);
}

function canonicalObjectKey(
  object: ts.ObjectLiteralExpression,
): { display: string } | undefined {
  const entries: [string, string][] = [];
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) return undefined;
    const name = propertyName(prop.name);
    if (!name) return undefined;
    const part = keyPartFromExpression(prop.initializer);
    if (part === undefined) return undefined;
    entries.push([name, part]);
  }
  entries.sort(([left], [right]) => left.localeCompare(right));
  const display = canonicalJson(
    Object.fromEntries(entries.map(([key, value]) => [key, value])),
  );
  return { display };
}

function keyPartFromExpression(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isNumericLiteral(expr)) return expr.text;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return "true";
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return "false";
  if (expr.kind === ts.SyntaxKind.NullKeyword) return "null";
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isObjectLiteralExpression(expr)) {
    const canonical = canonicalObjectKey(expr);
    return canonical?.display;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    const parts = expr.elements.map(keyPartFromExpression);
    if (parts.some((part) => part === undefined)) return undefined;
    return `[${parts.join(",")}]`;
  }
  return undefined;
}

function dynamicKeySummary(expr: ts.Expression): ResolvedQueryKey {
  const text = expr.getText().slice(0, 40);
  return {
    display: text,
    id: safeKeyId(`dynamic:${text}`),
    dynamic: true,
  };
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

export function queryFiltersFromExpression(
  expr: ts.Expression | undefined,
): QueryFilterMetadata | undefined {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return undefined;
  const filter: QueryFilterMetadata = {
    id: safeKeyId(`filter:${expr.getStart()}`),
  };
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    if (name === "queryKey") {
      const key = queryKeyFromExpression(prop.initializer);
      if (key) filter.queryKey = key.display.split(":");
    }
    if (
      name === "exact" &&
      prop.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      filter.exact = true;
    }
    if (name === "type" && ts.isStringLiteral(prop.initializer)) {
      if (
        prop.initializer.text === "active" ||
        prop.initializer.text === "inactive" ||
        prop.initializer.text === "all"
      ) {
        filter.type = prop.initializer.text;
      }
    }
    if (
      name === "stale" &&
      prop.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      filter.stale = true;
    }
    if (name === "fetchStatus" && ts.isStringLiteral(prop.initializer)) {
      if (
        prop.initializer.text === "fetching" ||
        prop.initializer.text === "idle" ||
        prop.initializer.text === "paused"
      ) {
        filter.fetchStatus = prop.initializer.text;
      }
    }
    if (name === "predicate") {
      filter.hasPredicate = true;
    }
  }
  return filter;
}

export function mutationFiltersFromExpression(
  expr: ts.Expression | undefined,
): MutationFilterMetadata | undefined {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return undefined;
  const filter: MutationFilterMetadata = {
    id: safeKeyId(`mfilter:${expr.getStart()}`),
  };
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    if (name === "mutationKey") {
      const key = queryKeyFromExpression(prop.initializer);
      if (key) filter.mutationKey = key.display.split(":");
    }
    if (name === "status" && ts.isStringLiteral(prop.initializer)) {
      if (
        prop.initializer.text === "idle" ||
        prop.initializer.text === "pending" ||
        prop.initializer.text === "success" ||
        prop.initializer.text === "error"
      ) {
        filter.status = prop.initializer.text;
      }
    }
    if (name === "predicate") {
      filter.hasPredicate = true;
    }
  }
  return filter;
}

function exprFromCondition(expr: ts.Expression): ExprIR | undefined {
  if (ts.isIdentifier(expr)) return { kind: "read", var: expr.text };
  if (expr.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: "lit", value: false };
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
  ) {
    const left = ts.isIdentifier(expr.left)
      ? { kind: "read" as const, var: expr.left.text }
      : undefined;
    const right = literalExpr(expr.right);
    if (left && right) {
      return {
        kind:
          expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
            ? "eq"
            : "neq",
        args: [left, right],
      };
    }
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = exprFromCondition(expr.operand);
    if (inner) return { kind: "not", args: [inner] };
  }
  return undefined;
}

function literalExpr(expr: ts.Expression): ExprIR | undefined {
  if (ts.isStringLiteral(expr)) return { kind: "lit", value: expr.text };
  if (ts.isNumericLiteral(expr))
    return { kind: "lit", value: Number(expr.text) };
  if (expr.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: "lit", value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "lit", value: null };
  return undefined;
}

function isNullish(expr: ts.Expression): boolean {
  return (
    expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) && expr.text === "undefined")
  );
}

function negateIr(expr: ExprIR): ExprIR {
  if (expr.kind === "not") return expr.args[0] ?? { kind: "lit", value: true };
  return { kind: "not", args: [expr] };
}

export function queryKeysMatch(
  queryKey: readonly string[] | undefined,
  candidateKey: string,
  exact?: boolean,
): boolean {
  if (!queryKey || queryKey.length === 0) return true;
  const candidateParts = candidateKey.split(":");
  if (exact) {
    return (
      queryKey.length === candidateParts.length &&
      queryKey.every((part, index) => part === candidateParts[index])
    );
  }
  return queryKey.every((part, index) => part === candidateParts[index]);
}
