import * as ts from "typescript";
import { normalizeRouteTarget } from "../../../compile/routes.js";
export {
  normalizeRouteTarget,
  routeMountGuard,
  routeMountReads,
  routeMountScope,
} from "../../../compile/routes.js";
import { literalValue } from "./ast.js";

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
