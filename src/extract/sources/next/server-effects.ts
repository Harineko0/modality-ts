import type {
  DiscoveredEffectApi,
  EffectApiDiscoveryCtx,
  RouteInventory,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import { discoverNextCacheUsage, type NextCacheDiscovery } from "./cache.js";
import { parseModuleDirectives } from "./module-roles.js";

export type { NextCacheDiscovery };

const ROUTE_HANDLER_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const SERVER_DATA_EXPORTS = new Set([
  "getStaticProps",
  "getStaticPaths",
  "getServerSideProps",
  "getInitialProps",
]);

const AUTH_GUARD_PATTERNS =
  /\b(auth|session|unauthorized|forbidden|getServerSession|getSession|currentUser|requireAuth|assertAuth|isAuthenticated|checkAuth|verifyAuth)\b/i;

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

function moduleId(fileName: string): string {
  return normalizedPath(fileName);
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

function normalizeFetchPath(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return (path.startsWith("/") ? path : `/${path}`).replace(
    /\/:param(?=\/|$)/g,
    "/:id",
  );
}

function fetchPathValue(expression: ts.Expression): string | undefined {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return normalizeFetchPath(expression.text);
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans)
      value += `:id${span.literal.text}`;
    return normalizeFetchPath(value);
  }
  return undefined;
}

function fetchMethodValue(
  expression: ts.Expression | undefined,
): string | undefined {
  if (!expression || !ts.isObjectLiteralExpression(expression))
    return undefined;
  for (const prop of expression.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "method" &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer.text.toUpperCase();
    }
  }
  return undefined;
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

function pagesApiPattern(fileName: string): string | undefined {
  const normalized = normalizedPath(fileName);
  const match =
    /(?:^|\/)(?:src\/)?pages\/api\/(.+)\.(?:ts|tsx|js|jsx|mts|cts)$/.exec(
      normalized,
    );
  if (!match?.[1]) return undefined;
  const segments = match[1]
    .split("/")
    .map((segment) => {
      if (segment.startsWith("[[...") && segment.endsWith("]]"))
        return `[[...${segment.slice(5, -2)}]]`;
      if (segment.startsWith("[...") && segment.endsWith("]"))
        return `[...${segment.slice(4, -1)}]`;
      if (segment.startsWith("[") && segment.endsWith("]"))
        return `[${segment.slice(1, -1)}]`;
      return segment;
    })
    .join("/");
  return `/api/${segments}`;
}

function hasInlineUseServerDirective(body: ts.Node | undefined): boolean {
  if (!body || !ts.isBlock(body)) return false;
  for (const statement of body.statements.slice(0, 3)) {
    if (!ts.isExpressionStatement(statement)) continue;
    const expr = statement.expression;
    if (!ts.isStringLiteral(expr) && !ts.isNoSubstitutionTemplateLiteral(expr))
      continue;
    if (expr.text === "use server") return true;
  }
  return false;
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

function functionHasAuthGuard(body: ts.Node | undefined): boolean {
  if (!body) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      AUTH_GUARD_PATTERNS.test(node.text)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function discoverFetchCalls(
  sourceFile: ts.SourceFile,
  fileName: string,
): DiscoveredEffectApi[] {
  const ops: DiscoveredEffectApi[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      const first = node.arguments[0];
      const path = first ? fetchPathValue(first) : undefined;
      if (path) {
        const method = fetchMethodValue(node.arguments[1]) ?? "GET";
        ops.push({
          opId: `${method} ${path}`,
          source: positionOf(sourceFile, fileName, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ops;
}

function discoverServerActions(
  sourceFile: ts.SourceFile,
  fileName: string,
  directives: readonly string[],
): DiscoveredEffectApi[] {
  const ops: DiscoveredEffectApi[] = [];
  const module = moduleId(fileName);

  const addAction = (
    name: string,
    node: ts.Node,
    exported: boolean,
    body?: ts.Node,
  ): void => {
    const entry: DiscoveredEffectApi = {
      opId: `ACTION ${module}#${name}`,
      source: positionOf(sourceFile, fileName, node),
    };
    if (exported && body && !functionHasAuthGuard(body)) {
      entry.warning =
        "Exported Server Action has no statically visible auth/guard check";
    }
    ops.push(entry);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const inline = hasInlineUseServerDirective(statement.body);
      const fileLevel =
        directives.includes("use server") && isExported(statement);
      if (inline || fileLevel)
        addAction(
          statement.name.text,
          statement,
          inline || fileLevel,
          statement.body,
        );
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!decl.name || !ts.isIdentifier(decl.name)) continue;
        const init = decl.initializer;
        if (
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
          hasInlineUseServerDirective(init.body)
        ) {
          addAction(decl.name.text, decl, true, init.body);
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const element of statement.exportClause.elements) {
        const local = (element.propertyName ?? element.name)?.text;
        if (!local) continue;
        const decl = sourceFile.statements.find((stmt) => {
          const name = declarationName(stmt);
          return name === local;
        });
        if (
          decl &&
          ts.isFunctionDeclaration(decl) &&
          hasInlineUseServerDirective(decl.body)
        ) {
          addAction(
            (element.name ?? element.propertyName)?.text ?? local,
            decl,
            true,
            decl.body,
          );
        }
      }
    }
  }

  return ops;
}

function discoverRouteHandlers(
  sourceFile: ts.SourceFile,
  fileName: string,
  routePattern: string | undefined,
): DiscoveredEffectApi[] {
  if (!routePattern) return [];
  const ops: DiscoveredEffectApi[] = [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    const name = declarationName(statement);
    if (!name || !ROUTE_HANDLER_METHODS.has(name)) continue;
    ops.push({
      opId: `${name} ${routePattern}`,
      source: positionOf(sourceFile, fileName, statement),
    });
  }
  return ops;
}

function discoverPagesApiHandlers(
  sourceFile: ts.SourceFile,
  fileName: string,
): DiscoveredEffectApi[] {
  const pattern = pagesApiPattern(fileName);
  if (!pattern) return [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    const isDefault =
      ts.canHaveModifiers(statement) &&
      statement.modifiers?.some(
        (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword,
      );
    if (
      isDefault ||
      (ts.isFunctionDeclaration(statement) &&
        declarationName(statement) === "handler")
    ) {
      return [
        {
          opId: `POST ${pattern}`,
          source: positionOf(sourceFile, fileName, statement),
        },
      ];
    }
  }
  return [];
}

function discoverDataFunctions(
  sourceFile: ts.SourceFile,
  fileName: string,
  routePattern: string | undefined,
): DiscoveredEffectApi[] {
  if (!routePattern) return [];
  const ops: DiscoveredEffectApi[] = [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) continue;
    const name = declarationName(statement);
    if (!name || !SERVER_DATA_EXPORTS.has(name)) continue;
    ops.push({
      opId: `DATA ${name} ${routePattern}`,
      source: positionOf(sourceFile, fileName, statement),
    });
  }
  return ops;
}

export function discoverNextServerCacheUsage(ctx: {
  fileName: string;
  sourceText: string;
  route?: RouteNode;
  inventory?: RouteInventory;
}): NextCacheDiscovery {
  return discoverNextCacheUsage(ctx);
}

export function discoverNextServerEffectApis(
  ctx: EffectApiDiscoveryCtx,
): readonly DiscoveredEffectApi[] {
  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  const directives = parseModuleDirectives(ctx.sourceText);
  const routePattern = routePatternForFile(
    ctx.fileName,
    ctx.route,
    ctx.inventory,
  );
  const ops = [
    ...discoverServerActions(sourceFile, ctx.fileName, directives),
    ...discoverRouteHandlers(sourceFile, ctx.fileName, routePattern),
    ...discoverPagesApiHandlers(sourceFile, ctx.fileName),
    ...discoverDataFunctions(sourceFile, ctx.fileName, routePattern),
    ...discoverFetchCalls(sourceFile, ctx.fileName),
  ];
  const seen = new Set<string>();
  return ops
    .filter((entry) => {
      const key = `${entry.opId}:${entry.source.line}:${entry.source.column}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.opId.localeCompare(right.opId) ||
        left.source.line - right.source.line ||
        left.source.column - right.source.column,
    );
}
