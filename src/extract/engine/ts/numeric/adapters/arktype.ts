import * as ts from "typescript";
import type { AbstractDomain } from "modality-ts/core";
import { unprovableNumericDomainCaveat } from "../../caveats.js";
import {
  sourceAnchorFromNode,
  type NumericDomainResolution,
  type NumericDomainResolverContext,
} from "../resolver.js";

const ARKTYPE_INTEGER_RANGE = /^(-?\d+)\s*<=\s*number\.integer\s*<=\s*(-?\d+)$/;

export function resolveArktypeNumericSchema(
  ctx: NumericDomainResolverContext,
): NumericDomainResolution | undefined {
  const expression = expressionFromContext(ctx);
  if (!expression) return undefined;
  const schema = staticStringValue(expression);
  if (!schema) return undefined;
  const match = ARKTYPE_INTEGER_RANGE.exec(schema.trim());
  if (!match) {
    if (looksLikeArktypeSchema(expression)) {
      return {
        caveats: [
          unprovableNumericDomainCaveat(
            ctx.varId ?? "numeric",
            "Unsupported arktype numeric schema grammar",
            sourceAnchorFromNode(expression, ctx.sourceFile),
          ),
        ],
      };
    }
    return undefined;
  }
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    return {
      caveats: [
        unprovableNumericDomainCaveat(
          ctx.varId ?? "numeric",
          "Unsupported arktype numeric schema bounds",
          sourceAnchorFromNode(expression, ctx.sourceFile),
        ),
      ],
    };
  }
  const domain: AbstractDomain = {
    kind: "boundedInt",
    min,
    max,
    overflow: "forbid",
  };
  return { domain, caveats: [] };
}

function staticStringValue(expression: ts.Expression): string | undefined {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    if (
      ts.isIdentifier(callee) &&
      callee.text === "type" &&
      expression.arguments.length === 1
    ) {
      return staticStringValue(expression.arguments[0]!);
    }
  }
  return undefined;
}

function looksLikeArktypeSchema(expression: ts.Expression): boolean {
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    if (ts.isIdentifier(callee) && callee.text === "type") return true;
  }
  const text = staticStringValue(expression);
  return text?.includes("number.integer") ?? false;
}

function expressionFromContext(
  ctx: NumericDomainResolverContext,
): ts.Expression | undefined {
  return ctx.initializer;
}
