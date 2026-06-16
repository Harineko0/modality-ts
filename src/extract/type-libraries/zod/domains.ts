import * as ts from "typescript";
import type { AbstractDomain } from "modality-ts/core";
import type {
  DomainRefinementContext,
  DomainRefinementProvider,
  DomainRefinementResolution,
} from "modality-ts/extract/engine/spi";
import { unprovableNumericDomainCaveat } from "../../engine/ts/caveats.js";
import { sourceAnchorFromNode } from "../../engine/ts/domain-refinements.js";

export function zodDomainRefinementProvider(): DomainRefinementProvider {
  return {
    id: "zod",
    version: "0.1.0",
    packageNames: ["zod"],
    refineDomain: resolveZodNumericSchema,
  };
}

function resolveZodNumericSchema(
  ctx: DomainRefinementContext,
): DomainRefinementResolution | undefined {
  const expression = ctx.initializer ?? ctx.typeNode;
  if (!expression || !ts.isExpression(expression)) return undefined;
  const parsed = parseZodNumberChain(expression);
  if (!parsed) return undefined;
  if (parsed.dynamic) {
    return {
      caveats: [
        unprovableNumericDomainCaveat(
          ctx.varId ?? "numeric",
          "Zod numeric schema uses dynamic bounds",
          sourceAnchorFromNode(expression, ctx.sourceFile),
        ),
      ],
    };
  }
  if (
    parsed.integral &&
    parsed.min !== undefined &&
    parsed.max !== undefined &&
    Number.isInteger(parsed.min) &&
    Number.isInteger(parsed.max)
  ) {
    const domain: AbstractDomain = {
      kind: "boundedInt",
      min: parsed.min,
      max: parsed.max,
      overflow: "forbid",
    };
    return { domain, caveats: [] };
  }
  return {
    caveats: [
      unprovableNumericDomainCaveat(
        ctx.varId ?? "numeric",
        "Unsupported or unprovable Zod numeric schema",
        sourceAnchorFromNode(expression, ctx.sourceFile),
      ),
    ],
  };
}

interface ZodNumberParse {
  integral: boolean;
  min?: number;
  max?: number;
  dynamic: boolean;
}

function parseZodNumberChain(expression: ts.Expression): ZodNumberParse | null {
  const chain = flattenCallChain(expression);
  if (chain.length === 0) return null;
  const root = chain[0];
  if (!root || root.name !== "number" || root.args.length > 0) return null;
  const result: ZodNumberParse = { integral: false, dynamic: false };
  for (const step of chain.slice(1)) {
    if (step.name === "int") {
      result.integral = true;
      continue;
    }
    if (step.name === "min" || step.name === "max") {
      const bound = staticNumericArg(step.args[0]);
      if (bound === undefined) {
        result.dynamic = true;
        continue;
      }
      if (step.name === "min") result.min = bound;
      else result.max = bound;
      continue;
    }
    return null;
  }
  return result;
}

interface ChainStep {
  name: string;
  args: ts.Expression[];
}

function flattenCallChain(expression: ts.Expression): ChainStep[] {
  const steps: ChainStep[] = [];
  let current: ts.Expression = expression;
  while (ts.isCallExpression(current)) {
    const callee = current.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      steps.unshift({
        name: callee.name.text,
        args: [...current.arguments],
      });
      current = callee.expression;
      continue;
    }
    if (ts.isIdentifier(callee)) {
      steps.unshift({ name: callee.text, args: [...current.arguments] });
      break;
    }
    break;
  }
  if (
    steps.length === 0 &&
    ts.isPropertyAccessExpression(current) &&
    current.name.text === "number"
  ) {
    steps.unshift({ name: "number", args: [] });
  }
  return steps;
}

function staticNumericArg(
  expression: ts.Expression | undefined,
): number | undefined {
  if (!expression) return undefined;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }
  return undefined;
}
