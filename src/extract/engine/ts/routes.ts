import * as ts from "typescript";
import type { ExprIR } from "modality-ts/core";
import { literalValue } from "./ast.js";

export function routeMountGuard(
  component: string,
  routePatterns: readonly string[],
): ExprIR {
  const route = routeForComponent(component, routePatterns);
  return route
    ? {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:route" },
          { kind: "lit", value: route },
        ],
      }
    : { kind: "lit", value: true };
}

export function routeMountReads(
  component: string,
  routePatterns: readonly string[],
): string[] {
  return routeForComponent(component, routePatterns)
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

function routeForComponent(
  component: string,
  routePatterns: readonly string[],
): string | undefined {
  const normalized = normalizeComponentRouteName(component);
  if (!normalized) return undefined;
  return routePatterns.find(
    (pattern) => normalizeRouteComponentName(pattern) === normalized,
  );
}

function normalizeComponentRouteName(component: string): string {
  return component.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function normalizeRouteComponentName(route: string): string {
  const parts = route.replace(/^\/+/, "").split("/").filter(Boolean);
  if (parts.length !== 1) return "";
  const [part] = parts;
  if (!part || part.startsWith(":") || part === "*") return "";
  return part.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
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
  return left.every(
    (part, index) =>
      part.startsWith(":") ||
      part === "*" ||
      part === right[index] ||
      right[index] === ":param",
  );
}
