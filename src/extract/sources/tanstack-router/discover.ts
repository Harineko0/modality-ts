import { basename, dirname, extname, resolve } from "node:path";
import type {
  RouteDiscoveryCtx,
  RouteInventory,
  RouteKind,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import { parseTanstackRouteModule } from "./route-options.js";
import {
  type TanstackDiscoveryMode,
  type TanstackRouteTreeNode,
  type TanstackSegmentKind,
  tanstackRouteTreeToMetadata,
} from "./types.js";

const ROUTES_ROOT = /(?:^|\/)(?:src\/)?routes(?:\/|$)/;
const ROUTE_FILE = /\.(?:tsx?|jsx?)$/;
const IGNORE_FILE =
  /(?:^|\/)routeTree\.gen\.(?:ts|tsx)$|\.(?:test|spec)\.(?:tsx?|jsx?)$|\.d\.ts$/;
const TANSTACK_ROUTER_PKG = "@tanstack/react-router";

const ROUTE_FACTORY_NAMES = new Set([
  "createRootRoute",
  "createRootRouteWithContext",
  "createRoute",
]);

export function tanstackPathToPattern(path: string): string {
  const trimmed = path.replace(/\/+$/, "") || "/";
  const normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (normalized === "/") return "/";
  const segments = normalized.split("/").filter(Boolean);
  const mapped = segments.map((segment) => {
    if (segment === "$") return "*";
    if (segment.startsWith("$")) return `:${segment.slice(1)}`;
    return segment;
  });
  const pattern = `/${mapped.join("/")}`;
  return pattern.endsWith("/*") ? pattern : pattern.replace(/\/\*$/, "/*");
}

export interface TanstackFileRoutePattern {
  pattern: string;
  kind: RouteKind;
  pathless: boolean;
  routeId: string;
  segmentKind: TanstackSegmentKind;
}

export function tanstackFilePathToPattern(
  relativePath: string,
): TanstackFileRoutePattern | undefined {
  const normalized = relativePath.replace(/\\/g, "/");
  if (!ROUTE_FILE.test(normalized)) return undefined;
  const withoutExt = normalized.replace(/\.(?:tsx?|jsx?)$/, "");
  if (withoutExt === "__root" || withoutExt.endsWith("/__root")) {
    return {
      pattern: "/",
      kind: "layout",
      pathless: false,
      routeId: "__root",
      segmentKind: "static",
    };
  }

  const slashParts = withoutExt.split("/");
  const filePart = slashParts.pop() ?? "";
  const directoryParts = slashParts;
  const flatParts = filePart.includes(".") ? filePart.split(".") : [filePart];

  let pathless = false;
  let isIndex = false;
  const urlSegments: string[] = [];

  for (const segment of directoryParts) {
    if (segment.startsWith("_")) {
      pathless = true;
      continue;
    }
    urlSegments.push(segment);
  }

  for (const segment of flatParts) {
    if (segment === "index") {
      isIndex = true;
      continue;
    }
    if (segment.startsWith("_")) {
      pathless = true;
      continue;
    }
    urlSegments.push(segment);
  }

  const pattern =
    urlSegments.length === 0
      ? "/"
      : tanstackPathToPattern(`/${urlSegments.join("/")}`);

  const hasSplat = urlSegments.some((segment) => segment === "$");
  const hasDynamic = urlSegments.some(
    (segment) => segment.startsWith("$") && segment !== "$",
  );
  const segmentKind: TanstackSegmentKind = hasSplat
    ? "splat"
    : hasDynamic
      ? "dynamic"
      : isIndex
        ? "index"
        : pathless
          ? "pathless"
          : "static";

  const kind: RouteKind =
    isIndex && pattern === "/"
      ? "index"
      : pathless && flatParts.length === 1 && flatParts[0]?.startsWith("_")
        ? "layout"
        : "page";

  const routeId =
    withoutExt === "index"
      ? "/"
      : `/${[...directoryParts, ...flatParts.filter((part) => part !== "index")].join("/")}`;

  return { pattern, kind, pathless, routeId, segmentKind };
}

export interface ParsedCreateFileRoute {
  routePath: string;
  component?: string;
}

export function parseTanstackCreateFileRoute(
  source: string,
): ParsedCreateFileRoute | undefined {
  const parsed = ts.createSourceFile(
    "route.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (!importsTanstackRouter(parsed)) return undefined;

  let result: ParsedCreateFileRoute | undefined;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      )
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== "Route" ||
          !declaration.initializer
        ) {
          continue;
        }
        const parsedRoute = parseCreateFileRouteCall(declaration.initializer);
        if (parsedRoute) {
          result = parsedRoute;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return result;
}

export interface ParsedCodeRoute {
  varName: string;
  path?: string;
  id?: string;
  parentVar?: string;
  component?: string;
  isRoot: boolean;
  pathless: boolean;
}

export function parseTanstackCodeRoutes(
  source: string,
): readonly ParsedCodeRoute[] {
  const parsed = ts.createSourceFile(
    "routes.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (!importsTanstackRouter(parsed)) return [];

  const routes: ParsedCodeRoute[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isVariableStatement(node)) {
      ts.forEachChild(node, visit);
      return;
    }
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
        continue;
      }
      const initializer = unwrapExpression(declaration.initializer);
      if (!ts.isCallExpression(initializer)) continue;
      const factory = calleeName(initializer.expression);
      if (!factory || !ROUTE_FACTORY_NAMES.has(factory)) continue;
      const options = firstObjectLiteralArg(initializer);
      const path = readStringProperty(options, "path");
      const id = readStringProperty(options, "id");
      const parentVar = readGetParentRoute(options);
      const component = readComponentProperty(options);
      routes.push({
        varName: declaration.name.text,
        ...(path !== undefined ? { path } : {}),
        ...(id !== undefined ? { id } : {}),
        ...(parentVar !== undefined ? { parentVar } : {}),
        ...(component !== undefined ? { component } : {}),
        isRoot:
          factory === "createRootRoute" ||
          factory === "createRootRouteWithContext",
        pathless: path === undefined && id !== undefined,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return routes;
}

interface DiscoveredTanstackRoute {
  pattern: string;
  kind: RouteKind;
  file: string;
  routeId: string;
  parentId?: string;
  segmentKind: TanstackSegmentKind;
  pathless?: boolean;
  discoveryMode: TanstackDiscoveryMode;
  component?: string;
  fromGeneratedTree?: boolean;
  redirectTo?: string;
}

export async function discoverRoutes(
  ctx: RouteDiscoveryCtx,
): Promise<RouteInventory> {
  const discovered = new Map<string, DiscoveredTanstackRoute>();
  const routeFiles = collectRouteFiles(ctx.files);
  const rootDir = ctx.rootDir ? resolve(ctx.rootDir) : undefined;

  for (const file of routeFiles) {
    const relative = relativizeRouteFile(file.path, rootDir);
    if (!relative || shouldIgnoreRouteFile(relative)) continue;
    const parsedLiteral = parseTanstackCreateFileRoute(file.text);
    const fromPath = tanstackFilePathToPattern(relative);
    if (!fromPath && !parsedLiteral) continue;

    const pattern = parsedLiteral
      ? tanstackPathToPattern(parsedLiteral.routePath)
      : fromPath!.pattern;
    const kind = parsedLiteral
      ? classifyLiteralRouteKind(parsedLiteral.routePath, relative)
      : fromPath!.kind;
    const routeId = parsedLiteral?.routePath ?? fromPath!.routeId;
    const segmentKind = fromPath?.segmentKind ?? segmentKindForPattern(pattern);
    const absoluteFile = resolveRouteFilePath(file.path, rootDir);
    const redirectTo = parseTanstackRouteModule(
      file.text,
      absoluteFile,
    )?.redirectTo;

    addDiscoveredRoute(discovered, {
      pattern,
      kind,
      file: absoluteFile,
      routeId,
      segmentKind,
      pathless: fromPath?.pathless,
      discoveryMode: "file",
      ...(parsedLiteral?.component
        ? { component: parsedLiteral.component }
        : {}),
      ...(redirectTo ? { redirectTo } : {}),
    });
  }

  const generated = ctx.files.find((file) =>
    file.path.replace(/\\/g, "/").endsWith("routeTree.gen.ts"),
  );
  if (generated) {
    await enrichFromGeneratedTree(
      generated.text,
      generated.path,
      rootDir,
      discovered,
      ctx,
    );
  }

  for (const file of ctx.files) {
    if (isRouteModuleFile(file.path)) continue;
    const codeRoutes = parseTanstackCodeRoutes(file.text);
    if (codeRoutes.length === 0) continue;
    mergeCodeRoutes(
      codeRoutes,
      resolveRouteFilePath(file.path, rootDir),
      discovered,
    );
  }

  return { routes: finalizeRoutes(discovered) };
}

function collectRouteFiles(
  files: RouteDiscoveryCtx["files"],
): RouteDiscoveryCtx["files"] {
  return files.filter((file) => {
    const normalized = file.path.replace(/\\/g, "/");
    return ROUTES_ROOT.test(normalized) || ROUTE_FILE.test(normalized);
  });
}

function shouldIgnoreRouteFile(relativePath: string): boolean {
  if (IGNORE_FILE.test(relativePath)) return true;
  if (relativePath.endsWith(".d.ts")) return true;
  return false;
}

function isRouteModuleFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return ROUTES_ROOT.test(normalized);
}

function relativizeRouteFile(
  path: string,
  rootDir?: string,
): string | undefined {
  const normalized = path.replace(/\\/g, "/");
  const routesMatch = normalized.match(/(?:^|\/)(?:(src)\/)?routes\/(.+)$/);
  if (routesMatch?.[2]) return routesMatch[2];
  if (rootDir) {
    const root = resolve(rootDir).replace(/\\/g, "/");
    for (const prefix of [`${root}/src/routes/`, `${root}/routes/`]) {
      if (normalized.startsWith(prefix)) {
        return normalized.slice(prefix.length);
      }
    }
  }
  return undefined;
}

function resolveRouteFilePath(path: string, rootDir?: string): string {
  if (rootDir && !path.startsWith("/") && !/^[A-Za-z]:/.test(path)) {
    return resolve(rootDir, path);
  }
  return resolve(path);
}

function classifyLiteralRouteKind(
  routePath: string,
  relativePath: string,
): RouteKind {
  if (
    routePath === "/" ||
    basename(relativePath, extname(relativePath)) === "index"
  ) {
    return "index";
  }
  if (basename(relativePath).startsWith("__root")) return "layout";
  return "page";
}

function segmentKindForPattern(pattern: string): TanstackSegmentKind {
  if (pattern === "/") return "index";
  if (pattern.endsWith("/*")) return "splat";
  if (pattern.includes(":")) return "dynamic";
  return "static";
}

function addDiscoveredRoute(
  discovered: Map<string, DiscoveredTanstackRoute>,
  route: DiscoveredTanstackRoute,
): void {
  const key = routeKey(route.pattern, route.kind, route.file);
  const existing = discovered.get(key);
  if (
    existing &&
    existing.routeId !== route.routeId &&
    existing.pattern === route.pattern
  ) {
    discovered.set(key, route);
    return;
  }
  if (!existing) discovered.set(key, route);
}

async function enrichFromGeneratedTree(
  source: string,
  generatedPath: string,
  rootDir: string | undefined,
  discovered: Map<string, DiscoveredTanstackRoute>,
  ctx: RouteDiscoveryCtx,
): Promise<void> {
  const parsed = ts.createSourceFile(
    generatedPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const generatedDir = dirname(resolve(generatedPath));
  const importedFiles = new Map<string, string>();

  for (const statement of parsed.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const importPath = statement.moduleSpecifier.text;
    if (!importPath.includes("routes/") && !importPath.includes("routes\\")) {
      continue;
    }
    const resolved = resolve(generatedDir, importPath);
    importedFiles.set(importPath, resolved);
    if (![...discovered.values()].some((route) => route.file === resolved)) {
      try {
        const text = await ctx.readFile(resolved);
        const relative = relativizeRouteFile(resolved, rootDir);
        if (!relative || shouldIgnoreRouteFile(relative)) continue;
        const parsedLiteral = parseTanstackCreateFileRoute(text);
        const fromPath = tanstackFilePathToPattern(relative);
        if (!fromPath && !parsedLiteral) continue;
        addDiscoveredRoute(discovered, {
          pattern: parsedLiteral
            ? tanstackPathToPattern(parsedLiteral.routePath)
            : fromPath!.pattern,
          kind: parsedLiteral
            ? classifyLiteralRouteKind(parsedLiteral.routePath, relative)
            : fromPath!.kind,
          file: resolved,
          routeId: parsedLiteral?.routePath ?? fromPath!.routeId,
          segmentKind: fromPath?.segmentKind ?? "static",
          pathless: fromPath?.pathless,
          discoveryMode: "generated",
          fromGeneratedTree: true,
          ...(parsedLiteral?.component
            ? { component: parsedLiteral.component }
            : {}),
        });
      } catch {
        // unreadable generated import target
      }
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === "id" && ts.isStringLiteral(node.initializer)) {
        const routeId = node.initializer.text;
        const parent = findAncestorRouteFile(node, importedFiles);
        if (!parent) return;
        const existing = [...discovered.values()].find(
          (route) => route.file === parent,
        );
        if (existing) {
          existing.routeId = routeId;
          existing.fromGeneratedTree = true;
          existing.discoveryMode = "generated";
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}

function findAncestorRouteFile(
  node: ts.Node,
  importedFiles: Map<string, string>,
): string | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const callee = calleeName(current.expression);
      if (callee === "update" || callee === "_addFileChildren") {
        for (const arg of current.arguments) {
          const importPath = extractImportPath(arg);
          if (importPath && importedFiles.has(importPath)) {
            return importedFiles.get(importPath);
          }
        }
      }
    }
    current = current.parent;
  }
  return undefined;
}

function extractImportPath(node: ts.Node): string | undefined {
  if (ts.isIdentifier(node)) return undefined;
  if (ts.isPropertyAccessExpression(node)) {
    return extractImportPath(node.expression);
  }
  return undefined;
}

function mergeCodeRoutes(
  codeRoutes: readonly ParsedCodeRoute[],
  file: string,
  discovered: Map<string, DiscoveredTanstackRoute>,
): void {
  const _byVar = new Map(codeRoutes.map((route) => [route.varName, route]));
  const parentPatterns = new Map<string, string>();

  for (const route of codeRoutes) {
    if (route.isRoot) {
      addDiscoveredRoute(discovered, {
        pattern: "/",
        kind: "layout",
        file,
        routeId: route.id ?? "__root",
        segmentKind: "static",
        discoveryMode: "code",
        ...(route.component ? { component: route.component } : {}),
      });
      parentPatterns.set(route.varName, "/");
      continue;
    }

    const parentPattern = route.parentVar
      ? parentPatterns.get(route.parentVar)
      : undefined;
    const pattern = route.pathless
      ? (parentPattern ?? "/")
      : joinRoutePattern(parentPattern, route.path);
    if (!pattern) continue;

    const kind: RouteKind = route.pathless
      ? "layout"
      : pattern === "/" || route.path === "/"
        ? "index"
        : "page";

    addDiscoveredRoute(discovered, {
      pattern,
      kind,
      file,
      routeId: route.id ?? pattern,
      parentId: route.parentVar,
      segmentKind: segmentKindForPattern(pattern),
      pathless: route.pathless,
      discoveryMode: "code",
      ...(route.component ? { component: route.component } : {}),
    });
    parentPatterns.set(route.varName, pattern);
  }
}

function joinRoutePattern(
  parentPattern: string | undefined,
  childPath: string | undefined,
): string | undefined {
  if (!childPath) return undefined;
  if (childPath === "/") return "/";
  const child = childPath.startsWith("/")
    ? childPath
    : parentPattern && parentPattern !== "/"
      ? `${parentPattern}/${childPath}`
      : `/${childPath}`;
  return tanstackPathToPattern(child);
}

function finalizeRoutes(
  discovered: Map<string, DiscoveredTanstackRoute>,
): RouteNode[] {
  const nodes: RouteNode[] = [];
  const seenPatterns = new Map<string, DiscoveredTanstackRoute>();

  for (const route of discovered.values()) {
    const _dedupeKey = routeKey(route.pattern, route.kind, route.file);
    const exactDuplicate = nodes.find(
      (node) =>
        node.pattern === route.pattern &&
        node.kind === route.kind &&
        node.file === route.file,
    );
    if (exactDuplicate) continue;

    const samePattern = seenPatterns.get(`${route.pattern}:${route.kind}`);
    if (
      samePattern &&
      samePattern.file !== route.file &&
      samePattern.routeId === route.routeId
    ) {
      continue;
    }
    seenPatterns.set(`${route.pattern}:${route.kind}`, route);

    const metadataNode: TanstackRouteTreeNode = {
      routeId: route.routeId,
      fullPath: route.pattern,
      filePath: route.file,
      segmentKind: route.segmentKind,
      routeKind: route.kind,
      discoveryMode: route.discoveryMode,
      ...(route.parentId ? { parentId: route.parentId } : {}),
      ...(route.pathless ? { pathless: true } : {}),
      ...(route.fromGeneratedTree ? { fromGeneratedTree: true } : {}),
      ...(route.component ? { component: route.component } : {}),
    };

    nodes.push({
      pattern: route.pattern,
      kind: route.kind,
      file: route.file,
      ...(route.redirectTo ? { redirectTo: route.redirectTo } : {}),
      metadata: {
        tanstackRouteTree: tanstackRouteTreeToMetadata(metadataNode),
      },
    });
  }

  nodes.sort((left, right) => {
    const byPattern = left.pattern.localeCompare(right.pattern);
    if (byPattern !== 0) return byPattern;
    const byKind = left.kind.localeCompare(right.kind);
    if (byKind !== 0) return byKind;
    return (left.file ?? "").localeCompare(right.file ?? "");
  });
  return nodes;
}

function routeKey(pattern: string, kind: RouteKind, file: string): string {
  return `${pattern}\0${kind}\0${file}`;
}

function importsTanstackRouter(sourceFile: ts.SourceFile): boolean {
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

function parseCreateFileRouteCall(
  node: ts.Expression,
): ParsedCreateFileRoute | undefined {
  const outer = unwrapExpression(node);
  if (!ts.isCallExpression(outer)) return undefined;

  let routeCall = outer;
  let optionsCall: ts.CallExpression | undefined;
  const innerExpression = unwrapExpression(outer.expression);
  if (ts.isCallExpression(innerExpression)) {
    optionsCall = outer;
    routeCall = innerExpression;
  }

  const factory = calleeName(routeCall.expression);
  if (factory !== "createFileRoute") return undefined;
  const routeArg = routeCall.arguments[0];
  if (!routeArg || !ts.isStringLiteral(routeArg)) return undefined;
  const options = optionsCall
    ? firstObjectLiteralArg(optionsCall)
    : firstObjectLiteralArg(routeCall);
  return {
    routePath: routeArg.text,
    ...(readComponentProperty(options)
      ? { component: readComponentProperty(options) }
      : {}),
  };
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
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
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
    if (key !== name || !ts.isStringLiteral(property.initializer)) continue;
    return property.initializer.text;
  }
  return undefined;
}

function readGetParentRoute(
  object: ts.ObjectLiteralExpression | undefined,
): string | undefined {
  if (!object) return undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (key !== "getParentRoute") continue;
    const initializer = unwrapExpression(property.initializer);
    if (
      !ts.isArrowFunction(initializer) &&
      !ts.isFunctionExpression(initializer)
    ) {
      continue;
    }
    const body = initializer.body;
    if (ts.isIdentifier(body)) return body.text;
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        if (
          ts.isReturnStatement(statement) &&
          statement.expression &&
          ts.isIdentifier(statement.expression)
        ) {
          return statement.expression.text;
        }
      }
    }
  }
  return undefined;
}

function readComponentProperty(
  object: ts.ObjectLiteralExpression | undefined,
): string | undefined {
  if (!object) return undefined;
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (key !== "component") continue;
    const initializer = unwrapExpression(property.initializer);
    if (ts.isIdentifier(initializer)) return initializer.text;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) ? name.text : undefined;
}

function normalizeComponentRouteName(component: string): string {
  return component.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function fileNameKeys(file: string): string[] {
  const base = basename(file, extname(file));
  const lastSeg = basename(
    file.split("/").filter(Boolean).pop() ?? "",
    extname(file),
  );
  return [
    normalizeComponentRouteName(base),
    normalizeComponentRouteName(lastSeg),
  ];
}

function suffixMatchLength(component: string, file: string): number {
  const normComp = normalizeComponentRouteName(component);
  const normFile = file.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  for (let len = Math.min(normComp.length, normFile.length); len > 0; len--) {
    const suffix = normFile.slice(-len);
    if (normComp.endsWith(suffix)) return len;
  }
  return 0;
}

export function routeForComponent(
  componentName: string,
  inventory: RouteInventory,
): string | undefined {
  const normalized = normalizeComponentRouteName(componentName);
  if (!normalized) return undefined;

  const componentMatches = inventory.routes.filter((node) => {
    const metadata = node.metadata?.tanstackRouteTree;
    if (
      metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      "component" in metadata &&
      typeof metadata.component === "string" &&
      normalizeComponentRouteName(metadata.component) === normalized
    ) {
      return node.kind === "page" || node.kind === "index";
    }
    return false;
  });

  const preferred = inventory.routes.filter(
    (node) =>
      (node.kind === "page" || node.kind === "index") &&
      node.file !== undefined &&
      fileNameKeys(node.file).includes(normalized),
  );
  const candidates =
    componentMatches.length > 0
      ? componentMatches
      : preferred.length > 0
        ? preferred
        : inventory.routes.filter(
            (node) =>
              node.file !== undefined &&
              fileNameKeys(node.file).includes(normalized),
          );

  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0]?.pattern;

  const ranked = [...candidates].sort(
    (left, right) =>
      suffixMatchLength(componentName, right.file ?? "") -
      suffixMatchLength(componentName, left.file ?? ""),
  );
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (
    best &&
    runnerUp &&
    suffixMatchLength(componentName, best.file ?? "") ===
      suffixMatchLength(componentName, runnerUp.file ?? "")
  ) {
    return undefined;
  }
  return best?.pattern;
}
