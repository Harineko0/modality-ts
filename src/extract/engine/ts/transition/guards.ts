import * as ts from "typescript";
import { isPropertyAccessLike, lineAndColumn, literalValue } from "../ast.js";
import type { ExprIR, Transition } from "modality-ts/core";
import type { BoundExpr, ExtractionWarning, SetterBinding } from "../types.js";
import { unwrapTsExpression, valueExpr } from "./expressions.js";
import { stringAttribute } from "./ui.js";

export interface ParsedGuard {
  expr: ExprIR;
  reads: string[];
}

export function applyParsedGuard(
  transitions: Transition[],
  parsed: ParsedGuard | undefined,
): Transition[] {
  if (!parsed) return transitions;
  return transitions.map((transition) =>
    transition.cls === "user"
      ? {
          ...transition,
          guard: andGuard(parsed.expr, transition.guard),
          reads: [...new Set([...transition.reads, ...parsed.reads])],
        }
      : transition,
  );
}

export function combineParsedGuards(
  guards: readonly (ParsedGuard | undefined)[],
): ParsedGuard | undefined {
  const parsed = guards.filter((guard): guard is ParsedGuard => Boolean(guard));
  if (parsed.length === 0) return undefined;
  return {
    expr: parsed.map((guard) => guard.expr).reduce(andGuard),
    reads: [...new Set(parsed.flatMap((guard) => guard.reads))],
  };
}

export function renderGuardFor(
  eventAttribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
  locals: Map<string, BoundExpr> = new Map(),
): ParsedGuard | undefined {
  const element = jsxElementForAttribute(eventAttribute);
  if (!element) return undefined;
  const guards: ParsedGuard[] = [];
  let current: ts.Node = element;
  while (current.parent) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === current
    ) {
      const parsed = parseConjunctiveGuardExpression(
        parent.left,
        setters,
        locals,
      );
      if (!parsed) {
        warnings.push({
          message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`,
          ...lineAndColumn(source, parent.left),
        });
        return undefined;
      }
      guards.push(parsed);
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.whenTrue === current) {
      const parsed = parseConjunctiveGuardExpression(
        parent.condition,
        setters,
        locals,
      );
      if (!parsed) {
        warnings.push({
          message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`,
          ...lineAndColumn(source, parent.condition),
        });
        return undefined;
      }
      guards.push(parsed);
      current = parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.whenFalse === current) {
      const parsed = parseConjunctiveGuardExpression(
        parent.condition,
        setters,
        locals,
      );
      if (!parsed) {
        warnings.push({
          message: `Unsupported render guard ${component}.${eventAttribute.name.getText(source)}`,
          ...lineAndColumn(source, parent.condition),
        });
        return undefined;
      }
      guards.push({
        expr: { kind: "not", args: [parsed.expr] },
        reads: parsed.reads,
      });
      current = parent;
      continue;
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isJsxExpression(parent) ||
      ts.isJsxElement(parent) ||
      ts.isJsxFragment(parent)
    ) {
      current = parent;
      continue;
    }
    return combineParsedGuards(guards);
  }
  return combineParsedGuards(guards);
}

export function jsxElementForAttribute(
  attribute: ts.JsxAttribute,
): ts.JsxElement | ts.JsxSelfClosingElement | undefined {
  const attrs = attribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const element = attrs.parent;
  if (ts.isJsxOpeningElement(element) && ts.isJsxElement(element.parent))
    return element.parent;
  return ts.isJsxSelfClosingElement(element) ? element : undefined;
}

export function disabledGuardFor(
  eventAttribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
  locals: Map<string, BoundExpr> = new Map(),
): ParsedGuard | undefined {
  return combineParsedGuards([
    disabledAttributeGuardFor(
      eventAttribute,
      setters,
      warnings,
      source,
      component,
      locals,
    ),
    submitRequiredEmptyValueGuard(eventAttribute, setters, locals),
  ]);
}

function disabledAttributeGuardFor(
  eventAttribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  warnings: ExtractionWarning[],
  source: ts.SourceFile,
  component: string,
  locals: Map<string, BoundExpr> = new Map(),
): ParsedGuard | undefined {
  const attrs = eventAttribute.parent;
  if (!ts.isJsxAttributes(attrs)) return undefined;
  const disabled =
    attrs.properties.find(
      (property): property is ts.JsxAttribute =>
        ts.isJsxAttribute(property) &&
        ts.isIdentifier(property.name) &&
        (property.name.text === "disabled" ||
          property.name.text === "aria-disabled"),
    ) ?? submitButtonDisabledAttribute(eventAttribute);
  if (!disabled) return undefined;
  const parsed = jsxAttributeBoolean(disabled, setters, locals);
  if (!parsed) {
    warnings.push({
      message: `Unsupported disabled guard ${component}.${eventAttribute.name.getText(source)}`,
      ...lineAndColumn(source, disabled),
    });
    return undefined;
  }
  return { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads };
}

export function submitButtonDisabledAttribute(
  eventAttribute: ts.JsxAttribute,
): ts.JsxAttribute | undefined {
  if (
    !ts.isIdentifier(eventAttribute.name) ||
    eventAttribute.name.text !== "onSubmit"
  )
    return undefined;
  const element = jsxElementForAttribute(eventAttribute);
  if (!element || !ts.isJsxElement(element)) return undefined;
  let found: ts.JsxAttribute | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
      if (
        tag === "button" &&
        stringAttribute(node.attributes, "type") === "submit"
      ) {
        found = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            (property.name.text === "disabled" ||
              property.name.text === "aria-disabled"),
        );
        if (found) return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(element);
  return found;
}

export function submitRequiredEmptyValueGuard(
  eventAttribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
): ParsedGuard | undefined {
  if (
    !ts.isIdentifier(eventAttribute.name) ||
    eventAttribute.name.text !== "onSubmit"
  )
    return undefined;
  const element = jsxElementForAttribute(eventAttribute);
  if (!element || !ts.isJsxElement(element)) return undefined;
  const guards: ParsedGuard[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = ts.isIdentifier(node.tagName) ? node.tagName.text : undefined;
      if (tag === "input" || tag === "textarea") {
        const required = node.attributes.properties.some(
          (property) =>
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "required",
        );
        if (!required) return;
        const valueAttr = node.attributes.properties.find(
          (property): property is ts.JsxAttribute =>
            ts.isJsxAttribute(property) &&
            ts.isIdentifier(property.name) &&
            property.name.text === "value",
        );
        if (
          !valueAttr?.initializer ||
          !ts.isJsxExpression(valueAttr.initializer) ||
          !valueAttr.initializer.expression
        )
          return;
        const bound = valueExpr(
          valueAttr.initializer.expression,
          setters,
          locals,
        );
        if (!bound) return;
        guards.push({
          expr: {
            kind: "neq",
            args: [bound.expr, { kind: "lit", value: "" }],
          },
          reads: bound.reads,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(element);
  return combineParsedGuards(guards);
}

export function jsxAttributeBoolean(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
): ParsedGuard | undefined {
  if (!attribute.initializer)
    return { expr: { kind: "lit", value: true }, reads: [] };
  if (ts.isStringLiteral(attribute.initializer))
    return {
      expr: { kind: "lit", value: attribute.initializer.text === "true" },
      reads: [],
    };
  if (
    !ts.isJsxExpression(attribute.initializer) ||
    !attribute.initializer.expression
  )
    return undefined;
  return parseConjunctiveGuardExpression(
    attribute.initializer.expression,
    setters,
    locals,
  );
}

export function parseGuardExpression(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  snapshotReads = false,
): ParsedGuard | undefined {
  const unwrapped = unwrapTsExpression(expression);
  if (unwrapped !== expression)
    return parseGuardExpression(unwrapped, setters, locals, snapshotReads);
  if (expression.kind === ts.SyntaxKind.TrueKeyword)
    return { expr: { kind: "lit", value: true }, reads: [] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword)
    return { expr: { kind: "lit", value: false }, reads: [] };
  if (ts.isIdentifier(expression) || isPropertyAccessLike(expression)) {
    const bound = valueExpr(expression, setters, locals, snapshotReads);
    return bound ? guardExprFromBound(bound, snapshotReads) : undefined;
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const parsed = parseGuardExpression(
      expression.operand,
      setters,
      locals,
      snapshotReads,
    );
    return parsed
      ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads }
      : undefined;
  }
  if (ts.isParenthesizedExpression(expression))
    return parseGuardExpression(
      expression.expression,
      setters,
      locals,
      snapshotReads,
    );
  if (ts.isBinaryExpression(expression))
    return parseBinaryGuardExpression(
      expression,
      setters,
      locals,
      snapshotReads,
    );
  return undefined;
}

export function parseBinaryGuardExpression(
  expression: ts.BinaryExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  snapshotReads = false,
): ParsedGuard | undefined {
  if (
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    const left = parseGuardExpression(
      expression.left,
      setters,
      locals,
      snapshotReads,
    );
    const right = parseGuardExpression(
      expression.right,
      setters,
      locals,
      snapshotReads,
    );
    if (!left || !right) return undefined;
    return {
      expr: {
        kind:
          expression.operatorToken.kind ===
          ts.SyntaxKind.AmpersandAmpersandToken
            ? "and"
            : "or",
        args: [left.expr, right.expr],
      },
      reads: [...new Set([...left.reads, ...right.reads])],
    };
  }
  if (
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    expression.operatorToken.kind ===
      ts.SyntaxKind.ExclamationEqualsEqualsToken ||
    expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
  ) {
    const left = parseGuardOperand(
      expression.left,
      setters,
      locals,
      snapshotReads,
    );
    const right = parseGuardOperand(
      expression.right,
      setters,
      locals,
      snapshotReads,
    );
    if (!left || !right) return undefined;
    return {
      expr: {
        kind:
          expression.operatorToken.kind ===
            ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
            ? "neq"
            : "eq",
        args: [left.expr, right.expr],
      },
      reads: [...new Set([...left.reads, ...right.reads])],
    };
  }
  return undefined;
}

export function parseGuardOperand(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  snapshotReads = false,
): ParsedGuard | undefined {
  const unwrapped = unwrapTsExpression(expression);
  if (unwrapped !== expression)
    return parseGuardOperand(unwrapped, setters, locals, snapshotReads);
  const value = literalValue(expression);
  if (value !== undefined) return { expr: { kind: "lit", value }, reads: [] };
  if (ts.isIdentifier(expression) || isPropertyAccessLike(expression)) {
    const bound = valueExpr(expression, setters, locals, snapshotReads);
    return bound ? guardExprFromBound(bound, snapshotReads) : undefined;
  }
  return parseGuardExpression(expression, setters, locals, snapshotReads);
}

export function parseConjunctiveGuardExpression(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
): ParsedGuard | undefined {
  const unwrapped = unwrapTsExpression(expression);
  if (unwrapped !== expression)
    return parseConjunctiveGuardExpression(unwrapped, setters, locals);
  if (ts.isParenthesizedExpression(expression))
    return parseConjunctiveGuardExpression(
      expression.expression,
      setters,
      locals,
    );
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    return combineParsedGuards([
      parseConjunctiveGuardExpression(expression.left, setters, locals),
      parseConjunctiveGuardExpression(expression.right, setters, locals),
    ]);
  }
  return parseGuardExpression(expression, setters, locals);
}

export function andGuard(left: ExprIR, right: ExprIR): ExprIR {
  if (isTrueLiteral(left)) return right;
  if (isTrueLiteral(right)) return left;
  return { kind: "and", args: [left, right] };
}

export function guardExprFromBound(
  bound: BoundExpr,
  snapshotReads: boolean,
): ParsedGuard {
  return {
    expr: snapshotReads ? bound.expr : remapReadPreToRead(bound.expr),
    reads: bound.reads,
  };
}

function remapReadPreToRead(expr: ExprIR): ExprIR {
  if (expr.kind === "readPre") {
    return {
      kind: "read",
      var: expr.var,
      ...(expr.path ? { path: expr.path } : {}),
    };
  }
  if (expr.kind === "not")
    return { kind: "not", args: [remapReadPreToRead(expr.args[0])] };
  if (expr.kind === "and" || expr.kind === "or")
    return {
      kind: expr.kind,
      args: expr.args.map(remapReadPreToRead),
    };
  if (expr.kind === "eq" || expr.kind === "neq")
    return {
      kind: expr.kind,
      args: expr.args.map(remapReadPreToRead),
    };
  return expr;
}

export function isTrueLiteral(expr: ExprIR): boolean {
  return expr.kind === "lit" && expr.value === true;
}
