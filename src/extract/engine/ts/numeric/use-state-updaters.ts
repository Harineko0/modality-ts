import type {
  AbstractDomain,
  EffectIR,
  ExprIR,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import * as ts from "typescript";

interface NumericWideningInfo {
  literals: number[];
  positiveDeltas: number[];
  negativeDeltas: number[];
  upperClamps: number[];
  lowerClamps: number[];
}

function emptyInfo(): NumericWideningInfo {
  return {
    literals: [],
    positiveDeltas: [],
    negativeDeltas: [],
    upperClamps: [],
    lowerClamps: [],
  };
}

function mergeInfo(
  left: NumericWideningInfo,
  right: NumericWideningInfo,
): NumericWideningInfo {
  return {
    literals: [...left.literals, ...right.literals],
    positiveDeltas: [...left.positiveDeltas, ...right.positiveDeltas],
    negativeDeltas: [...left.negativeDeltas, ...right.negativeDeltas],
    upperClamps: [...left.upperClamps, ...right.upperClamps],
    lowerClamps: [...left.lowerClamps, ...right.lowerClamps],
  };
}

function numericLiteral(expr: ExprIR): number | undefined {
  return expr.kind === "lit" && typeof expr.value === "number"
    ? expr.value
    : undefined;
}

function isVarRead(expr: ExprIR, varId: string): boolean {
  return (
    (expr.kind === "read" || expr.kind === "readPre") &&
    expr.var === varId &&
    (!expr.path || expr.path.length === 0)
  );
}

function clampBoundsFromCond(
  cond: ExprIR,
  whenFalse: ExprIR,
): NumericWideningInfo {
  if (cond.kind === "lte" && cond.args.length === 2) {
    const cap =
      numericLiteral(cond.args[1]) ??
      numericLiteral(cond.args[0] ?? cond.args[1]);
    const falseLit = numericLiteral(whenFalse);
    if (cap !== undefined && falseLit === cap) {
      return { ...emptyInfo(), upperClamps: [cap] };
    }
  }
  if (cond.kind === "gte" && cond.args.length === 2) {
    const floor =
      numericLiteral(cond.args[1]) ??
      numericLiteral(cond.args[0] ?? cond.args[1]);
    const falseLit = numericLiteral(whenFalse);
    if (floor !== undefined && falseLit === floor) {
      return { ...emptyInfo(), lowerClamps: [floor] };
    }
  }
  return emptyInfo();
}

function collectFromAssignExpr(
  expr: ExprIR,
  varId: string,
): NumericWideningInfo {
  const lit = numericLiteral(expr);
  if (lit !== undefined) return { ...emptyInfo(), literals: [lit] };

  if (expr.kind === "add" && expr.args.length === 2) {
    const [left, right] = expr.args;
    const rightLit = right ? numericLiteral(right) : undefined;
    const leftLit = left ? numericLiteral(left) : undefined;
    if (
      left &&
      isVarRead(left, varId) &&
      rightLit !== undefined &&
      rightLit > 0
    ) {
      return { ...emptyInfo(), positiveDeltas: [rightLit] };
    }
    if (
      right &&
      isVarRead(right, varId) &&
      leftLit !== undefined &&
      leftLit > 0
    ) {
      return { ...emptyInfo(), positiveDeltas: [leftLit] };
    }
  }

  if (expr.kind === "sub" && expr.args.length === 2) {
    const [left, right] = expr.args;
    const rightLit = right ? numericLiteral(right) : undefined;
    if (
      left &&
      isVarRead(left, varId) &&
      rightLit !== undefined &&
      rightLit > 0
    ) {
      return { ...emptyInfo(), negativeDeltas: [rightLit] };
    }
  }

  if (expr.kind === "cond" && expr.args.length === 3) {
    const [cond, whenTrue, whenFalse] = expr.args;
    if (cond && whenTrue && whenFalse) {
      return mergeInfo(
        collectFromAssignExpr(whenTrue, varId),
        clampBoundsFromCond(cond, whenFalse),
      );
    }
  }

  return emptyInfo();
}

function collectFromEffect(
  effect: EffectIR,
  varId: string,
): NumericWideningInfo {
  if (effect.kind === "assign" && effect.var === varId) {
    return collectFromAssignExpr(effect.expr, varId);
  }
  if (effect.kind === "seq") {
    return effect.effects.reduce(
      (acc, inner) => mergeInfo(acc, collectFromEffect(inner, varId)),
      emptyInfo(),
    );
  }
  if (effect.kind === "if") {
    return mergeInfo(
      collectFromEffect(effect.then, varId),
      collectFromEffect(effect.else, varId),
    );
  }
  return emptyInfo();
}

function isSingletonNumericSeed(
  domain: AbstractDomain,
  varId: string,
  numericSeedVarIds?: ReadonlySet<string>,
): boolean {
  if (domain.kind !== "boundedInt" || domain.min !== domain.max) return false;
  return numericSeedVarIds?.has(varId) ?? false;
}

function widenDomain(
  decl: StateVarDecl,
  info: NumericWideningInfo,
  maxDepth: number,
): AbstractDomain {
  const domain = decl.domain;
  if (domain.kind !== "boundedInt" || domain.min !== domain.max) return domain;

  const initial = typeof decl.initial === "number" ? decl.initial : domain.min;
  const literalMin = Math.min(
    initial,
    domain.min,
    domain.max,
    ...info.literals,
  );
  const literalMax = Math.max(
    initial,
    domain.min,
    domain.max,
    ...info.literals,
  );
  const maxPositiveDelta =
    info.positiveDeltas.length > 0 ? Math.max(...info.positiveDeltas) : 0;
  const maxNegativeDelta =
    info.negativeDeltas.length > 0 ? Math.max(...info.negativeDeltas) : 0;

  const deltaMin = literalMin - maxNegativeDelta * maxDepth;
  const deltaMax = literalMax + maxPositiveDelta * maxDepth;

  let min = deltaMin;
  let max = deltaMax;
  if (info.upperClamps.length > 0) {
    max = Math.max(literalMax, Math.max(...info.upperClamps));
  }
  if (info.lowerClamps.length > 0) {
    min = Math.min(deltaMin, Math.min(...info.lowerClamps));
    min = Math.min(min, literalMin);
  }

  return {
    kind: "boundedInt",
    min,
    max,
    overflow: "forbid",
  };
}

export function widenNumericDomainsFromTransitions(args: {
  vars: readonly StateVarDecl[];
  transitions: readonly Transition[];
  maxDepth: number;
  numericSeedVarIds?: ReadonlySet<string>;
}): StateVarDecl[] {
  return args.vars.map((decl) => {
    if (!isSingletonNumericSeed(decl.domain, decl.id, args.numericSeedVarIds)) {
      return decl;
    }
    const info = args.transitions.reduce(
      (acc, transition) =>
        mergeInfo(acc, collectFromEffect(transition.effect, decl.id)),
      emptyInfo(),
    );
    const hasEvidence =
      info.literals.length > 0 ||
      info.positiveDeltas.length > 0 ||
      info.negativeDeltas.length > 0 ||
      info.upperClamps.length > 0 ||
      info.lowerClamps.length > 0;
    if (!hasEvidence) return decl;
    return {
      ...decl,
      domain: widenDomain(decl, info, args.maxDepth),
    };
  });
}

function componentNameFor(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    /^[A-Z]/.test(node.name.text)
  ) {
    return node.name.text;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    /^[A-Z]/.test(node.name.text)
  ) {
    return node.name.text;
  }
  return undefined;
}

function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useState"
  );
}

export function collectNumericSeedVarIds(
  sourceText: string,
  fileName = "App.tsx",
): ReadonlySet<string> {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const ids = new Set<string>();
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    const component = componentNameFor(node) ?? componentName;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      isUseStateCall(node.initializer)
    ) {
      const stateName = node.name.elements[0];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const call = node.initializer;
        if (
          !call.typeArguments?.[0] &&
          call.arguments[0] &&
          ts.isNumericLiteral(call.arguments[0])
        ) {
          const componentId = component ?? "Anonymous";
          ids.add(`local:${componentId}.${stateName.name.text}`);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, component));
  };
  visit(source, undefined);
  return ids;
}
