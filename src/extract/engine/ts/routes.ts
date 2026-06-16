import * as ts from "typescript";
import type { ExprIR } from "modality-ts/core";
import { literalValue } from "./ast.js";

export function routeMountGuard(routePattern: string | undefined): ExprIR {
  return routePattern
    ? {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:route" },
          { kind: "lit", value: routePattern },
        ],
      }
    : { kind: "lit", value: true };
}

export function routeMountReads(routePattern: string | undefined): string[] {
  return routePattern
    ? ["sys:history", "sys:route"]
    : ["sys:route", "sys:history"];
}

export function jsxRouteTarget(
  attribute: ts.JsxAttribute,
  routePatterns: readonly string[],
): string | undefined {
  if (!attribute.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer))
    return normalizeRouteTarget(attribute.initializer.text, routePatterns);
  if (
    !ts.isJsxExpression(attribute.initializer) ||
    !attribute.initializer.expression
  )
    return undefined;
  return routeTargetValue(attribute.initializer.expression, routePatterns);
}

export function routeTargetValue(
  expression: ts.Expression | undefined,
  routePatterns: readonly string[],
): string | undefined {
  if (!expression) return undefined;
  const literal = literalValue(expression);
  if (typeof literal === "string")
    return normalizeRouteTarget(literal, routePatterns);
  if (ts.isNoSubstitutionTemplateLiteral(expression))
    return normalizeRouteTarget(expression.text, routePatterns);
  if (ts.isTemplateExpression(expression)) {
    const pattern = templateRoutePattern(expression);
    return pattern ? normalizeRouteTarget(pattern, routePatterns) : undefined;
  }
  return undefined;
}

export function templateRoutePattern(
  expression: ts.TemplateExpression,
): string | undefined {
  let value = expression.head.text;
  for (const span of expression.templateSpans)
    value += `:param${span.literal.text}`;
  return value;
}

export function normalizeRouteTarget(
  target: string,
  routePatterns: readonly string[],
): string {
  const withoutQuery = target.split(/[?#]/)[0] || "/";
  const slash = withoutQuery.startsWith("/")
    ? withoutQuery
    : `/${withoutQuery}`;
  const matched = [...routePatterns]
    .sort(
      (left, right) =>
        routePatternSpecificity(right) - routePatternSpecificity(left),
    )
    .find((pattern) => routePatternMatches(pattern, slash));
  return matched ?? slash.replace(/\/:param(?=\/|$)/g, "/:id");
}

function routePatternSpecificity(pattern: string): number {
  return pattern
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && !part.startsWith(":") && part !== "*").length;
}

function routePatternMatches(pattern: string, target: string): boolean {
  const left = pattern.replace(/^\/+/, "").split("/");
  const right = target.replace(/^\/+/, "").split("/");
  if (left.length !== right.length) return false;
  return left.every((part, index) => {
    const targetPart = right[index];
    if (targetPart === ":param") return part.startsWith(":") || part === "*";
    return part.startsWith(":") || part === "*" || part === targetPart;
  });
}
