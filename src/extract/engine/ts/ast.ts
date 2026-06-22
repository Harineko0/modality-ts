import * as ts from "typescript";
import type { Value } from "modality-ts/core";
import type {
  HandlerWrapperCtx,
  HandlerWrapperProvider,
} from "../spi/index.js";

export type ExtractableHandler =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | (ts.FunctionDeclaration & { body: ts.Block });

export function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useState"
  );
}

export function isUseReducerCall(
  node: ts.Expression,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useReducer"
  );
}

export function isUseRefCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useRef"
  );
}

export function isUseEffectCall(node: ts.CallExpression): boolean {
  return reactEffectHookName(node) === "useEffect";
}

export type ReactEffectHookName =
  | "useEffect"
  | "useLayoutEffect"
  | "useInsertionEffect";

export function reactEffectHookName(
  node: ts.CallExpression,
): ReactEffectHookName | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  const name = node.expression.text;
  if (
    name === "useEffect" ||
    name === "useLayoutEffect" ||
    name === "useInsertionEffect"
  ) {
    return name;
  }
  return undefined;
}

export function isUseTransitionCall(
  node: ts.Expression,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useTransition"
  );
}

export function isUseDeferredValueCall(
  node: ts.Expression,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useDeferredValue"
  );
}

export function isStartTransitionCall(
  node: ts.Node,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "startTransition"
  );
}

export function isFlushSyncCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "flushSync"
  );
}

export function isSuspenseElement(
  node: ts.Node,
): node is ts.JsxElement | ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName;
    return ts.isIdentifier(tag) && tag.text === "Suspense";
  }
  if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
    return false;
  const tag = node.tagName;
  return ts.isIdentifier(tag) && tag.text === "Suspense";
}

export function isReactLazyCall(
  node: ts.Expression,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "React" &&
    node.expression.name.text === "lazy"
  );
}

export function isUseCall(node: ts.Expression): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "use"
  );
}

export function isExtractableHandler(
  node: ts.Node,
): node is ExtractableHandler {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    (ts.isFunctionDeclaration(node) && Boolean(node.body))
  );
}

export function extractableHandlerInitializer(
  node: ts.Expression,
): ExtractableHandler | undefined {
  if (isExtractableHandler(node)) return node;
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "useCallback"
  ) {
    const callback = node.arguments[0];
    return callback && isExtractableHandler(callback) ? callback : undefined;
  }
  return undefined;
}

export function unwrapHandlerInitializer(
  node: ts.Expression,
  providers: readonly HandlerWrapperProvider[],
  ctx: HandlerWrapperCtx,
): ExtractableHandler | undefined {
  const direct = extractableHandlerInitializer(node);
  if (direct) return direct;
  for (const provider of providers) {
    const result = provider.unwrapHandler(node, ctx);
    if (result && isExtractableHandler(result)) return result;
  }
  return undefined;
}

export function componentNameFor(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    startsUppercase(node.name.text)
  )
    return node.name.text;
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    startsUppercase(node.name.text)
  )
    return node.name.text;
  return undefined;
}

export function providerComponentNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const name = componentNameFor(node);
    if (name && node.getText(source).includes(".Provider")) names.add(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

export function startsUppercase(value: string): boolean {
  return /^[A-Z]/.test(value);
}

export function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
}

export function isPropertyAccessLike(
  expression: ts.Expression,
): expression is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(expression) ||
    ts.isPropertyAccessChain(expression)
  );
}

export function literalValue(expression: ts.Expression): Value | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  return undefined;
}

export function callName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (isPropertyAccessLike(expression))
    return `${callName(expression.expression) ?? expression.expression.getText()}.${expression.name.text}`;
  return undefined;
}

export function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
