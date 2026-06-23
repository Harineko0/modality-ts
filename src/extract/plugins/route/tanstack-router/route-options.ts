import * as ts from "typescript";
import { tanstackPathToPattern } from "./discover.js";

export const TANSTACK_ROUTER_PKG = "@tanstack/react-router";

const ROUTES_ROOT = /(?:^|\/)(?:src\/)?routes(?:\/|$)/;

const SERVER_ROUTE_OPTION_KEYS = new Set([
  "loader",
  "beforeLoad",
  "validateSearch",
  "head",
  "headers",
  "params",
]);

const CLIENT_COMPONENT_OPTION_KEYS = new Set([
  "component",
  "pendingComponent",
  "errorComponent",
  "notFoundComponent",
]);

export interface ParsedTanstackRouteModule {
  routePath?: string;
  componentNames: string[];
  serverOptionNames: string[];
  hasLoader: boolean;
  hasBeforeLoad: boolean;
  hasValidateSearch: boolean;
  redirectTo?: string;
  dynamicRedirect: boolean;
}

export function normalizedModulePath(fileName: string): string {
  return fileName.split("\\").join("/");
}

export function isTanstackRouteModulePath(fileName: string): boolean {
  return ROUTES_ROOT.test(normalizedModulePath(fileName));
}

export function isServerOnlyModulePath(fileName: string): boolean {
  const normalized = normalizedModulePath(fileName);
  return /\.server\./.test(normalized) || /\/server\//.test(normalized);
}

export function parseModuleDirectives(
  sourceText: string,
): Array<"use client" | "use server"> {
  const directives: Array<"use client" | "use server"> = [];
  for (const line of sourceText.split(/\r?\n/).slice(0, 5)) {
    const trimmed = line.trim();
    if (trimmed === '"use client";' || trimmed === "'use client';")
      directives.push("use client");
    if (trimmed === '"use server";' || trimmed === "'use server';")
      directives.push("use server");
  }
  return directives;
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

export function importsTanstackRouter(sourceFile: ts.SourceFile): boolean {
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

function readStringProperty(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): string | undefined {
  if (!object) return undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (key !== name) continue;
    const initializer = unwrapExpression(property.initializer);
    if (ts.isStringLiteral(initializer)) return initializer.text;
    if (ts.isNoSubstitutionTemplateLiteral(initializer)) {
      return initializer.text;
    }
  }
  return undefined;
}

function readIdentifierProperty(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): string | undefined {
  if (!object) return undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (key !== name) continue;
    const initializer = unwrapExpression(property.initializer);
    if (ts.isIdentifier(initializer)) return initializer.text;
  }
  return undefined;
}

function hasRouteOption(
  object: ts.ObjectLiteralExpression | undefined,
  name: string,
): boolean {
  if (!object) return false;
  return object.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    return propertyName(property.name) === name;
  });
}

function routeOptionsFromSource(sourceFile: ts.SourceFile): {
  routePath?: string;
  options?: ts.ObjectLiteralExpression;
} {
  let result:
    | { routePath?: string; options?: ts.ObjectLiteralExpression }
    | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
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
      const parsed = parseCreateFileRouteExpression(declaration.initializer);
      if (parsed) {
        result = parsed;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return result ?? {};
}

function parseCreateFileRouteExpression(
  node: ts.Expression,
): { routePath?: string; options?: ts.ObjectLiteralExpression } | undefined {
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
  const routeArg = routeCall.arguments[0];
  const routePath =
    routeArg && ts.isStringLiteral(routeArg) ? routeArg.text : undefined;
  const options = optionsCall
    ? firstObjectLiteralArg(optionsCall)
    : firstObjectLiteralArg(routeCall);
  return {
    ...(routePath ? { routePath } : {}),
    ...(options ? { options } : {}),
  };
}

function functionBodyForOption(
  options: ts.ObjectLiteralExpression | undefined,
  name: string,
): ts.Node | undefined {
  if (!options) return undefined;
  for (const property of options.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) !== name) continue;
    const initializer = unwrapExpression(property.initializer);
    if (
      ts.isArrowFunction(initializer) ||
      ts.isFunctionExpression(initializer)
    ) {
      return initializer.body;
    }
    if (
      ts.isObjectLiteralExpression(initializer) &&
      name === "loader" &&
      hasRouteOption(initializer, "handler")
    ) {
      for (const nested of initializer.properties) {
        if (!ts.isPropertyAssignment(nested)) continue;
        if (propertyName(nested.name) !== "handler") continue;
        const handler = unwrapExpression(nested.initializer);
        if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
          return handler.body;
        }
      }
    }
  }
  return undefined;
}

function redirectTargetFromObject(expression: ts.Expression | undefined): {
  target?: string;
  dynamic: boolean;
} {
  if (!expression) return { dynamic: false };
  const object = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(object)) return { dynamic: true };
  const to = readStringProperty(object, "to");
  if (!to) return { dynamic: true };
  return {
    target: tanstackPathToPattern(to.split("?")[0] ?? to),
    dynamic: false,
  };
}

function redirectTargetFromCall(node: ts.CallExpression): {
  target?: string;
  dynamic: boolean;
} {
  if (calleeName(node.expression) !== "redirect") return { dynamic: false };
  return redirectTargetFromObject(node.arguments[0]);
}

function redirectTargetsInNode(node: ts.Node | undefined): {
  target?: string;
  dynamic: boolean;
} {
  if (!node) return { dynamic: false };
  let staticTarget: string | undefined;
  let dynamic = false;
  const visit = (current: ts.Node): void => {
    if (staticTarget) return;
    if (ts.isCallExpression(current)) {
      const fromCall = redirectTargetFromCall(current);
      if (fromCall.target) {
        staticTarget = fromCall.target;
        return;
      }
      if (fromCall.dynamic) dynamic = true;
    }
    if (
      ts.isReturnStatement(current) &&
      current.expression &&
      ts.isCallExpression(current.expression)
    ) {
      const fromReturn = redirectTargetFromCall(current.expression);
      if (fromReturn.target) {
        staticTarget = fromReturn.target;
        return;
      }
      if (fromReturn.dynamic) dynamic = true;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return { target: staticTarget, dynamic };
}

export function parseTanstackRouteModule(
  sourceText: string,
  fileName: string,
): ParsedTanstackRouteModule | undefined {
  const sourceFile = parseSource(sourceText, fileName);
  if (!importsTanstackRouter(sourceFile)) return undefined;
  const { routePath, options } = routeOptionsFromSource(sourceFile);
  if (!options && !routePath) return undefined;

  const componentNames = [...CLIENT_COMPONENT_OPTION_KEYS].flatMap((key) => {
    const name = readIdentifierProperty(options, key);
    return name ? [name] : [];
  });
  const serverOptionNames: string[] = [];
  for (const key of SERVER_ROUTE_OPTION_KEYS) {
    if (!hasRouteOption(options, key)) continue;
    serverOptionNames.push(key);
    if (
      key === "params" &&
      options &&
      options.properties.some((property) => {
        if (!ts.isPropertyAssignment(property)) return false;
        if (propertyName(property.name) !== "params") return false;
        const initializer = unwrapExpression(property.initializer);
        return (
          ts.isObjectLiteralExpression(initializer) &&
          hasRouteOption(initializer, "parse")
        );
      })
    ) {
      serverOptionNames.push("params.parse");
    }
  }

  const loaderBody = functionBodyForOption(options, "loader");
  const beforeLoadBody = functionBodyForOption(options, "beforeLoad");
  const loaderRedirect = redirectTargetsInNode(loaderBody);
  const beforeLoadRedirect = redirectTargetsInNode(beforeLoadBody);
  const redirectTo = beforeLoadRedirect.target ?? loaderRedirect.target;
  const dynamicRedirect = beforeLoadRedirect.dynamic || loaderRedirect.dynamic;

  return {
    ...(routePath ? { routePath } : {}),
    componentNames,
    serverOptionNames,
    hasLoader: hasRouteOption(options, "loader"),
    hasBeforeLoad: hasRouteOption(options, "beforeLoad"),
    hasValidateSearch: hasRouteOption(options, "validateSearch"),
    ...(redirectTo ? { redirectTo } : {}),
    dynamicRedirect,
  };
}

export function isTanstackRouteModule(
  sourceText: string,
  fileName: string,
): boolean {
  if (isTanstackRouteModulePath(fileName)) return true;
  return parseTanstackRouteModule(sourceText, fileName) !== undefined;
}
