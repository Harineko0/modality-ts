import type { Value } from "modality-ts/core";
import * as ts from "typescript";
import type {
  EngineFrameworkContext,
  FrameworkCtx,
  FrameworkPlugin,
} from "../spi/index.js";
import {
  createEngineFrameworkContext,
  resolveFrameworkPlugin,
} from "../spi/index.js";
import {
  recognizeHookFromTs,
  symbolRefFromIdentifier,
} from "./framework-bridge.js";
import { engineFrameworkPlugin } from "./framework-ts-bridge.js";

export {
  recognizeHookFromTs,
  recognizeRenderBoundaryFromTs,
  surfaceCallFromTs,
} from "./framework-bridge.js";

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

export function currentEngineFramework(
  explicit?: EngineFrameworkContext,
): EngineFrameworkContext {
  if (explicit) return explicit;
  if (activeEngineFramework) return activeEngineFramework;
  return createEngineFrameworkContext(resolveFrameworkPlugin());
}

function engineFramework(
  explicit?: EngineFrameworkContext,
): EngineFrameworkContext {
  return currentEngineFramework(explicit);
}

function calleeName(
  node: ts.CallExpression,
  ctx: FrameworkCtx,
  fileName: string,
): string | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  return resolveImportedNameFromTs(node.expression, ctx, fileName);
}

function resolveImportedNameFromTs(
  identifier: ts.Identifier,
  ctx: FrameworkCtx,
  fileName: string,
): string {
  return resolveImportedName(
    symbolRefFromIdentifier(identifier, fileName),
    ctx,
  );
}

function resolveImportedName(
  symbol: import("../../lang/ts/surface-ir.js").SymbolRef,
  ctx: FrameworkCtx,
): string {
  if (ctx.symbols) {
    const binding = ctx.symbols.importBinding(symbol);
    if (binding) return binding.exportedName;
  }
  return symbol.name;
}

function hookNamed(
  node: ts.Expression,
  name: string,
  engineFw?: EngineFrameworkContext,
  fileName?: string,
): node is ts.CallExpression {
  const fw = engineFramework(engineFw);
  if (!ts.isCallExpression(node)) return false;
  const resolvedFile = fileName ?? fw.ctx.fileName ?? "";
  return calleeName(node, fw.ctx, resolvedFile) === name;
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
  fileName?: string,
): node is ts.CallExpression {
  const fw = engineFramework(engineFw);
  if (!ts.isCallExpression(node)) return false;
  const resolvedFile = fileName ?? fw.ctx.fileName ?? "";
  const hook = recognizeHookFromTs(node, fw, resolvedFile);
  if (hook?.hook.kind !== "state") return false;
  return calleeName(node, fw.ctx, resolvedFile) === "useState";
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
  fileName?: string,
): ExtractableHandler | undefined {
  if (isExtractableHandler(node)) return node;
  const fw = engineFramework(engineFw);
  if (!ts.isCallExpression(node)) return undefined;
  const resolvedFile = fileName ?? fw.ctx.fileName ?? "";
  const hook = recognizeHookFromTs(node, fw, resolvedFile);
  if (hook?.hook.kind === "callback") {
    const _callbackRef = hook.hook.handler;
    const originNode = node.arguments[0];
    if (originNode && isExtractableHandler(originNode)) return originNode;
    return undefined;
  }
  return undefined;
}

export function unwrapHandlerInitializer(
  node: ts.Expression,
  ctx: {
    sourceFile: ts.SourceFile;
    fileName: string;
    types?: import("../../lang/ts/semantic-type-context.js").SemanticTypeContext;
  },
  engineFw?: EngineFrameworkContext,
): ExtractableHandler | undefined {
  const direct = extractableHandlerInitializer(node, engineFw, ctx.fileName);
  if (direct) return direct;
  const fw = engineFramework(engineFw);
  const enginePlugin = engineFrameworkPlugin(fw.framework);
  if (enginePlugin.unwrapTsHandler) {
    const result = enginePlugin.unwrapTsHandler(node, {
      sourceFile: ctx.sourceFile,
      fileName: ctx.fileName,
      ...(ctx.types ? { types: ctx.types } : {}),
    });
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
