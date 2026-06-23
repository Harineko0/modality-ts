import type { ExprIR, Value } from "modality-ts/core";
import type { SourceDecl, TypePlugin } from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { compilerBackedTypeAliases } from "../../../lang/ts/driver/domains.js";
import { collectSemanticNamedImports } from "../../../lang/ts/driver/semantic-imports.js";
import { semanticSourceFileFor } from "../../../lang/ts/driver/semantic-source-file.js";
import { inferPayloadDomain } from "./domains.js";

function sourceFileForDiscovery(
  sourceText: string,
  fileName: string,
  types?: SemanticTypeContext,
): ts.SourceFile {
  return semanticSourceFileFor(sourceText, fileName, types, ts.ScriptKind.TSX);
}

export function discoverSwrHooks(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): SourceDecl[] {
  const source = sourceFileForDiscovery(sourceText, fileName, types);
  const useSwrNames = useSwrImportNames(source, types);
  if (useSwrNames.size === 0) return [];
  const typeAliases = compilerBackedTypeAliases(source, types);
  const swrNamingContext = swrInstanceNamingContext(source, useSwrNames);

  const decls: SourceDecl[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      useSwrNames.has(node.expression.text)
    ) {
      const key = keyFromExpression(node.arguments[0]);
      if (key) {
        const id = swrInstanceId(node, swrNamingContext, key.id);
        const origin = { file: fileName, ...lineAndColumn(source, node) };
        decls.push({
          id: `swr:${id}`,
          kind: "swr/useSWR",
          origin,
          metadata: {
            key: key.id,
            id,
            op: `GET ${key.id}`,
            payloadDomain: inferPayloadDomain(
              node.typeArguments?.[0],
              typeAliases,
              types,
              source,
              typePlugins,
            ) as Value,
            ...(key.activeWhen ? { activeWhen: key.activeWhen as Value } : {}),
            ...optionsMetadata(node.arguments[2]),
          },
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return decls;
}

export const SWR_MODULES = new Set(["swr"]);
const SWR_ALLOWED_EXPORTS = new Set(["useSWR", "default"]);

export function useSwrImportNames(
  source: ts.SourceFile,
  types?: SemanticTypeContext,
): Set<string> {
  if (types?.checker) {
    const names = new Set<string>();
    for (const resolved of collectSemanticNamedImports(
      source,
      SWR_MODULES,
      SWR_ALLOWED_EXPORTS,
      types,
    )) {
      names.add(resolved.localName);
    }
    return names;
  }
  return useSwrImportNamesSyntax(source);
}

function useSwrImportNamesSyntax(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "swr"
    )
      continue;
    if (statement.importClause?.name)
      names.add(statement.importClause.name.text);
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "useSWR") names.add(specifier.name.text);
    }
  }
  return names;
}

export function keyFromExpression(
  expr: ts.Expression | undefined,
): { id: string; activeWhen?: ExprIR } | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr) && expr.text.length > 0)
    return { id: expr.text };
  if (ts.isNoSubstitutionTemplateLiteral(expr) && expr.text.length > 0)
    return { id: expr.text };
  if (ts.isArrayLiteralExpression(expr)) {
    const parts = expr.elements.map(keyPartFromExpression);
    if (
      parts.length > 0 &&
      parts.every((part): part is string => Boolean(part))
    )
      return { id: parts.join(":") };
  }
  if (ts.isConditionalExpression(expr) && isNullish(expr.whenFalse)) {
    const key = keyFromExpression(expr.whenTrue);
    const activeWhen = exprFromCondition(expr.condition);
    if (key && activeWhen) return { ...key, activeWhen };
  }
  if (ts.isConditionalExpression(expr) && isNullish(expr.whenTrue)) {
    const key = keyFromExpression(expr.whenFalse);
    const activeWhen = exprFromCondition(expr.condition);
    if (key && activeWhen) return { ...key, activeWhen: negateIr(activeWhen) };
  }
  return undefined;
}

const hookNamePattern = /^use[A-Z0-9]/u;

function functionInitializerName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name &&
    hookNamePattern.test(node.name.text)
  ) {
    return node.name.text;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    hookNamePattern.test(node.name.text) &&
    node.initializer &&
    (ts.isFunctionExpression(node.initializer) ||
      ts.isArrowFunction(node.initializer))
  ) {
    return node.name.text;
  }
  if (
    ts.isPropertyAssignment(node) &&
    ts.isIdentifier(node.name) &&
    hookNamePattern.test(node.name.text) &&
    (ts.isFunctionExpression(node.initializer) ||
      ts.isArrowFunction(node.initializer))
  ) {
    return node.name.text;
  }
  return undefined;
}

function enclosingHookName(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    const name = functionInitializerName(current);
    if (name) return name;
    current = current.parent;
  }
  return undefined;
}

export interface SwrInstanceNamingContext {
  hookCallCounts: ReadonlyMap<string, number>;
  enclosingHookByCall: ReadonlyMap<ts.Node, string>;
}

export function swrInstanceNamingContext(
  source: ts.SourceFile,
  useSwrNames: ReadonlySet<string>,
): SwrInstanceNamingContext {
  const counts = new Map<string, number>();
  const enclosingHookByCall = new Map<ts.Node, string>();
  const visit = (node: ts.Node, currentHook?: string): void => {
    const nodeHook = functionInitializerName(node) ?? currentHook;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      useSwrNames.has(node.expression.text)
    ) {
      const hookName = nodeHook;
      if (hookName) counts.set(hookName, (counts.get(hookName) ?? 0) + 1);
      if (hookName) enclosingHookByCall.set(node, hookName);
    }
    ts.forEachChild(node, (child) => visit(child, nodeHook));
  };
  visit(source);
  return { hookCallCounts: counts, enclosingHookByCall };
}

export function swrInstanceId(
  node: ts.Node,
  context: SwrInstanceNamingContext,
  keyId: string,
): string {
  const hookName =
    context.enclosingHookByCall.get(node) ?? enclosingHookName(node);
  const keyBasedId = swrIdFromKey(keyId);
  if (!hookName) return keyBasedId;
  if ((context.hookCallCounts.get(hookName) ?? 0) > 1) {
    return `${hookName}_${keyBasedId}`;
  }
  return hookName;
}

function keyPartFromExpression(expr: ts.Expression): string | undefined {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr))
    return expr.text;
  if (ts.isNumericLiteral(expr)) return expr.text;
  if (ts.isIdentifier(expr)) return expr.text;
  return undefined;
}

function exprFromCondition(expr: ts.Expression): ExprIR | undefined {
  if (ts.isIdentifier(expr)) return { kind: "read", var: expr.text };
  if (expr.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: "lit", value: false };
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)
  ) {
    const left = ts.isIdentifier(expr.left)
      ? { kind: "read" as const, var: expr.left.text }
      : undefined;
    const right = literalExpr(expr.right);
    if (left && right)
      return {
        kind:
          expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
            ? "eq"
            : "neq",
        args: [left, right],
      };
  }
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const inner = exprFromCondition(expr.operand);
    if (inner) return { kind: "not", args: [inner] };
  }
  return undefined;
}

function literalExpr(expr: ts.Expression): ExprIR | undefined {
  if (ts.isStringLiteral(expr)) return { kind: "lit", value: expr.text };
  if (ts.isNumericLiteral(expr))
    return { kind: "lit", value: Number(expr.text) };
  if (expr.kind === ts.SyntaxKind.TrueKeyword)
    return { kind: "lit", value: true };
  if (expr.kind === ts.SyntaxKind.FalseKeyword)
    return { kind: "lit", value: false };
  if (expr.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "lit", value: null };
  return undefined;
}

function isNullish(expr: ts.Expression): boolean {
  return (
    expr.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expr) && expr.text === "undefined")
  );
}

function optionsMetadata(
  expr: ts.Expression | undefined,
): Record<string, Value> {
  if (!expr || !ts.isObjectLiteralExpression(expr)) return {};
  const metadata: Record<string, Value> = {};
  for (const prop of expr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    if (
      prop.name.text === "revalidateOnFocus" &&
      prop.initializer.kind === ts.SyntaxKind.TrueKeyword
    )
      metadata.revalidateOnFocus = true;
    if (
      prop.name.text === "revalidateOnFocus" &&
      prop.initializer.kind === ts.SyntaxKind.FalseKeyword
    )
      metadata.revalidateOnFocus = false;
  }
  return metadata;
}

export function swrIdFromKey(key: string): string {
  return (
    key
      .replace(/^\/+/, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "root"
  );
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}

function negateIr(expr: ExprIR): ExprIR {
  if (expr.kind === "not") return expr.args[0] ?? lit(true);
  return { kind: "not", args: [expr] };
}
