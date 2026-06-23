import type {
  DiscoveredEffectApi,
  EffectApiDiscoveryCtx,
  RouteInventory,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import * as ts from "typescript";

export function reactRouterActionOpId(routePattern: string): string {
  return `ACTION ${routePattern}`;
}

export function reactRouterLoaderOpId(routePattern: string): string {
  return `DATA ${routePattern}`;
}

function parseSource(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function normalizedPath(fileName: string): string {
  return fileName.split("\\").join("/");
}

function positionOf(
  sourceFile: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): DiscoveredEffectApi["source"] {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    file: fileName,
    line: start.line + 1,
    column: start.character + 1,
  };
}

function routePatternForFile(
  fileName: string,
  route: RouteNode | undefined,
  inventory: RouteInventory | undefined,
): string | undefined {
  if (route?.pattern) return route.pattern;
  if (!inventory) return undefined;
  const resolved = normalizedPath(fileName);
  return inventory.routes.find(
    (node) =>
      node.file &&
      (normalizedPath(node.file) === resolved ||
        resolved.endsWith(`/${normalizedPath(node.file)}`)),
  )?.pattern;
}

function isExported(statement: ts.Statement): boolean {
  return (
    (ts.canHaveModifiers(statement) &&
      statement.modifiers?.some(
        (mod) => mod.kind === ts.SyntaxKind.ExportKeyword,
      )) ??
    false
  );
}

function declarationName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name)
    return statement.name.text;
  if (ts.isVariableStatement(statement)) {
    const decl = statement.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  return undefined;
}

function isActionExport(statement: ts.Statement): boolean {
  return isNamedServerExport(statement, "action");
}

function isLoaderExport(statement: ts.Statement): boolean {
  return isNamedServerExport(statement, "loader");
}

function isNamedServerExport(
  statement: ts.Statement,
  exportName: "action" | "loader",
): boolean {
  if (!isExported(statement)) return false;
  const name = declarationName(statement);
  if (name === exportName) return true;
  if (ts.isExportDeclaration(statement) && statement.exportClause) {
    if (!ts.isNamedExports(statement.exportClause)) return false;
    return statement.exportClause.elements.some(
      (element) => (element.name ?? element.propertyName)?.text === exportName,
    );
  }
  return false;
}

function actionBody(statement: ts.Statement): ts.Node | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === "action")
    return statement.body;
  if (ts.isVariableStatement(statement)) {
    const decl = statement.declarationList.declarations[0];
    if (!decl || !ts.isIdentifier(decl.name) || decl.name.text !== "action")
      return undefined;
    const init = decl.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
      return init.body;
  }
  return undefined;
}

function literalProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const propName = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    if (propName === name) return prop.initializer;
  }
  return undefined;
}

function returnedObjects(
  body: ts.Node | undefined,
): ts.ObjectLiteralExpression[] {
  if (!body) return [];
  const objects: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      if (ts.isObjectLiteralExpression(node.expression))
        objects.push(node.expression);
      if (
        ts.isAwaitExpression(node.expression) &&
        ts.isObjectLiteralExpression(node.expression.expression)
      )
        objects.push(node.expression.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return objects;
}

export function reactRouterActionOutcomeHints(body: ts.Node | undefined): {
  success: boolean;
  error: boolean;
} {
  const objects = returnedObjects(body);
  if (objects.length === 0) return { success: true, error: true };
  let hasSuccess = false;
  let hasError = false;
  for (const object of objects) {
    const ok = literalProperty(object, "ok");
    const error = literalProperty(object, "error");
    const orderNumber = literalProperty(object, "orderNumber");
    if (ok?.kind === ts.SyntaxKind.TrueKeyword) hasSuccess = true;
    if (orderNumber) hasSuccess = true;
    if (!ok && !error) hasSuccess = true;
    if (error) {
      hasError = true;
      if (!ok || ok.kind !== ts.SyntaxKind.FalseKeyword) hasSuccess = true;
    }
    if (ok?.kind === ts.SyntaxKind.FalseKeyword) hasError = true;
  }
  if (!hasSuccess && !hasError) return { success: true, error: true };
  return {
    success: hasSuccess || !hasError,
    error: hasError || !hasSuccess,
  };
}

export function discoverReactRouterActionEffectApis(
  ctx: EffectApiDiscoveryCtx,
): readonly DiscoveredEffectApi[] {
  const routePattern = routePatternForFile(
    ctx.fileName,
    ctx.route,
    ctx.inventory,
  );
  if (!routePattern) return [];
  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  const ops: DiscoveredEffectApi[] = [];
  for (const statement of sourceFile.statements) {
    if (isLoaderExport(statement)) {
      ops.push({
        opId: reactRouterLoaderOpId(routePattern),
        source: positionOf(sourceFile, ctx.fileName, statement),
      });
    }
    if (!isActionExport(statement)) continue;
    const body = actionBody(statement);
    ops.push({
      opId: reactRouterActionOpId(routePattern),
      source: positionOf(sourceFile, ctx.fileName, statement),
    });
    void body;
  }
  const seen = new Set<string>();
  return ops.filter((entry) => {
    const key = `${entry.opId}:${entry.source.line}:${entry.source.column}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
