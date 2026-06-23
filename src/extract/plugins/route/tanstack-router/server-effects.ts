import type {
  DiscoveredEffectApi,
  EffectApiDiscoveryCtx,
  RouteInventory,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../../lang/ts/driver/caveats.js";
import {
  parseTanstackRouteModule,
  TANSTACK_ROUTER_PKG,
} from "./route-options.js";

export function tanstackLoaderOpId(routePattern: string): string {
  return `LOADER ${routePattern}`;
}

export function tanstackBeforeLoadOpId(routePattern: string): string {
  return `BEFORE_LOAD ${routePattern}`;
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
  routePath?: string,
): string | undefined {
  if (route?.pattern) return route.pattern;
  if (routePath) return routePath;
  if (!inventory) return undefined;
  const resolved = normalizedPath(fileName);
  return inventory.routes.find(
    (node) =>
      node.file &&
      (normalizedPath(node.file) === resolved ||
        resolved.endsWith(`/${normalizedPath(node.file)}`)),
  )?.pattern;
}

function routeOptionNode(
  sourceFile: ts.SourceFile,
  optionName: "loader" | "beforeLoad",
): ts.Node | undefined {
  let target: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (target) return;
    if (
      !ts.isVariableStatement(node) ||
      !node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      ts.forEachChild(node, visit);
      return;
    }
    for (const declaration of node.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== "Route" ||
        !declaration.initializer
      ) {
        continue;
      }
      const found = findRouteOption(declaration.initializer, optionName);
      if (found) {
        target = found;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return target;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function firstObjectLiteralArg(
  call: ts.CallExpression,
): ts.ObjectLiteralExpression | undefined {
  if (call.arguments.length === 0) return undefined;
  const options = unwrapExpression(call.arguments[0]!);
  return ts.isObjectLiteralExpression(options) ? options : undefined;
}

function findRouteOption(
  node: ts.Expression,
  optionName: string,
): ts.Node | undefined {
  const outer = unwrapExpression(node);
  if (!ts.isCallExpression(outer)) return undefined;
  let routeCall = outer;
  let optionsCall: ts.CallExpression | undefined;
  const innerExpression = unwrapExpression(outer.expression);
  if (ts.isCallExpression(innerExpression)) {
    optionsCall = outer;
    routeCall = innerExpression;
  }
  if (calleeName(routeCall.expression) !== "createFileRoute") return undefined;
  const options = optionsCall
    ? firstObjectLiteralArg(optionsCall)
    : firstObjectLiteralArg(routeCall);
  if (!options) return undefined;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) !== optionName) continue;
    return property;
  }
  return undefined;
}

export function discoverTanstackRouteEffectApis(
  ctx: EffectApiDiscoveryCtx,
): readonly DiscoveredEffectApi[] {
  const routeModule = parseTanstackRouteModule(ctx.sourceText, ctx.fileName);
  if (!routeModule) return [];

  const routePattern = routePatternForFile(
    ctx.fileName,
    ctx.route,
    ctx.inventory,
    routeModule.routePath,
  );
  if (!routePattern) return [];

  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  const ops: DiscoveredEffectApi[] = [];
  const producer = {
    kind: "effect-api" as const,
    id: "tanstack-effect-api",
  };

  if (routeModule.hasLoader) {
    const node = routeOptionNode(sourceFile, "loader");
    ops.push({
      opId: tanstackLoaderOpId(routePattern),
      source: positionOf(sourceFile, ctx.fileName, node ?? sourceFile),
      producer,
    });
  }
  if (routeModule.hasBeforeLoad) {
    const node = routeOptionNode(sourceFile, "beforeLoad");
    const entry: DiscoveredEffectApi = {
      opId: tanstackBeforeLoadOpId(routePattern),
      source: positionOf(sourceFile, ctx.fileName, node ?? sourceFile),
      producer,
    };
    if (routeModule.dynamicRedirect) {
      entry.warning = `Dynamic redirect target in ${routePattern} is unsupported`;
      entry.caveats = [
        modelSlackCaveat(
          `tanstack-redirect:${routePattern}`,
          `Dynamic redirect target in route ${routePattern} is not modeled exactly`,
          { file: ctx.fileName, line: 1, column: 1 },
        ),
      ];
    }
    ops.push(entry);
  } else if (routeModule.dynamicRedirect) {
    ops.push({
      opId: tanstackLoaderOpId(routePattern),
      source: positionOf(sourceFile, ctx.fileName, sourceFile),
      warning: `Dynamic redirect target in ${routePattern} is unsupported`,
      caveats: [
        modelSlackCaveat(
          `tanstack-redirect:${routePattern}`,
          `Dynamic redirect target in route ${routePattern} is not modeled exactly`,
          { file: ctx.fileName, line: 1, column: 1 },
        ),
      ],
      producer,
    });
  }

  const seen = new Set<string>();
  return ops.filter((entry) => {
    const key = `${entry.opId}:${entry.source.line}:${entry.source.column}:${entry.warning ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tanstackRedirectTargetForFile(
  sourceText: string,
  fileName: string,
): string | undefined {
  return parseTanstackRouteModule(sourceText, fileName)?.redirectTo;
}

export function importsTanstackRouterPackage(sourceText: string): boolean {
  const sourceFile = parseSource(sourceText, fileNameFromText(sourceText));
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === TANSTACK_ROUTER_PKG
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function fileNameFromText(sourceText: string): string {
  return sourceText.includes("</") ? "route.tsx" : "route.ts";
}
