import * as ts from "typescript";
import type { Value } from "modality-ts/core";
import type {
  EngineFrameworkContext,
  FrameworkCtx,
  FrameworkPlugin,
  HandlerWrapperCtx,
  HandlerWrapperProvider,
} from "../spi/index.js";
import {
  createEngineFrameworkContext,
  resolveFrameworkPlugin,
  resolveImportedName,
} from "../spi/index.js";

export type ExtractableHandler =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | (ts.FunctionDeclaration & { body: ts.Block });

let activeEngineFramework: EngineFrameworkContext | undefined;

export function withEngineFramework<T>(
  engineFramework: EngineFrameworkContext,
  fn: () => T,
): T {
  const previous = activeEngineFramework;
  activeEngineFramework = engineFramework;
  try {
    return fn();
  } finally {
    activeEngineFramework = previous;
  }
}

function engineFramework(
  explicit?: EngineFrameworkContext,
): EngineFrameworkContext {
  if (explicit) return explicit;
  if (activeEngineFramework) return activeEngineFramework;
  return createEngineFrameworkContext(resolveFrameworkPlugin());
}

function calleeName(
  node: ts.CallExpression,
  ctx: FrameworkCtx,
): string | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  return resolveImportedName(node.expression, ctx);
}

function hookNamed(
  node: ts.Expression,
  name: string,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  const fw = engineFramework(engineFw);
  if (!ts.isCallExpression(node)) return false;
  return calleeName(node, fw.ctx) === name;
}

export function isUseStateCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node, "useState", engineFw);
}

export function isRecognizedUseStateCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  const fw = engineFramework(engineFw);
  if (!ts.isCallExpression(node)) return false;
  const hook = fw.framework.recognizeHook(node, fw.ctx);
  if (hook?.hook.kind !== "state") return false;
  return calleeName(node, fw.ctx) === "useState";
}

export function isUseReducerCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node, "useReducer", engineFw);
}

export function isUseRefCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node, "useRef", engineFw);
}

export function isUseEffectCall(
  node: ts.CallExpression,
  engineFw?: EngineFrameworkContext,
): boolean {
  return reactEffectHookName(node, engineFw) === "useEffect";
}

export type ReactEffectHookName =
  | "useEffect"
  | "useLayoutEffect"
  | "useInsertionEffect";

export function reactEffectHookName(
  node: ts.CallExpression,
  engineFw?: EngineFrameworkContext,
): ReactEffectHookName | undefined {
  const fw = engineFramework(engineFw);
  const hook = fw.framework.recognizeHook(node, fw.ctx);
  if (hook?.hook.kind !== "effect") return undefined;
  const name = calleeName(node, fw.ctx);
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
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node, "useTransition", engineFw);
}

export function isUseDeferredValueCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node, "useDeferredValue", engineFw);
}

export function isStartTransitionCall(
  node: ts.Node,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node as ts.Expression, "startTransition", engineFw);
}

export function isFlushSyncCall(
  node: ts.Node,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  return hookNamed(node as ts.Expression, "flushSync", engineFw);
}

export function isSuspenseElement(
  node: ts.Node,
  engineFw?: EngineFrameworkContext,
): node is ts.JsxElement | ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  const fw = engineFramework(engineFw);
  return fw.framework.recognizeRenderBoundary(node, fw.ctx)?.kind === "suspense";
}

export function isReactLazyCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  const fw = engineFramework(engineFw);
  return fw.framework.recognizeRenderBoundary(node, fw.ctx)?.kind === "lazy";
}

export function isUseCall(
  node: ts.Expression,
  engineFw?: EngineFrameworkContext,
): node is ts.CallExpression {
  const fw = engineFramework(engineFw);
  return fw.framework.recognizeRenderBoundary(node, fw.ctx)?.kind === "use";
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
  engineFw?: EngineFrameworkContext,
): ExtractableHandler | undefined {
  if (isExtractableHandler(node)) return node;
  const fw = engineFramework(engineFw);
  if (!ts.isCallExpression(node)) return undefined;
  const hook = fw.framework.recognizeHook(node, fw.ctx);
  if (hook?.hook.kind === "callback") {
    const callback = hook.hook.handler;
    return isExtractableHandler(callback) ? callback : undefined;
  }
  return undefined;
}

export function unwrapHandlerInitializer(
  node: ts.Expression,
  providers: readonly HandlerWrapperProvider[],
  ctx: HandlerWrapperCtx,
  engineFw?: EngineFrameworkContext,
): ExtractableHandler | undefined {
  const direct = extractableHandlerInitializer(node, engineFw);
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

export function bindEngineFrameworkFromPlugin(
  framework: FrameworkPlugin,
  ctx: FrameworkCtx = {},
): EngineFrameworkContext {
  return createEngineFrameworkContext(framework, ctx);
}
