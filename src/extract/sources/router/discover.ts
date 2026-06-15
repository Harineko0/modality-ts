import { basename, dirname, extname, join, resolve } from "node:path";
import * as ts from "typescript";
import type {
  RouteDiscoveryCtx,
  RouteInventory,
  RouteKind,
  RouteNode,
} from "modality-ts/extract/engine/spi";

export function parseReactRouterRoutes(
  source: string,
): Array<{ pattern: string; file: string }> {
  const routes: Array<{ pattern: string; file: string }> = [];
  const parsed = ts.createSourceFile(
    "routes.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        node.expression.text === "index" &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        routes.push({ pattern: "/", file: node.arguments[0].text });
      }
      if (
        node.expression.text === "route" &&
        ts.isStringLiteral(node.arguments[0]) &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        routes.push({
          pattern: reactRouterPathPattern(node.arguments[0].text),
          file: node.arguments[1].text,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return routes;
}

export function reactRouterPathPattern(pattern: string): string {
  const normalized = pattern.startsWith("/") ? pattern : `/${pattern}`;
  return normalized.replace(/\$([A-Za-z0-9_]+)/g, ":$1").replace(/\*$/, "*");
}

function classifyRouteKind(pattern: string, file: string): RouteKind {
  if (pattern === "/") return "index";
  if (
    !file.endsWith(".tsx") ||
    pattern.startsWith("/api/") ||
    pattern === "/api"
  )
    return "resource";
  return "page";
}

const REDIRECT_LITERAL =
  /(?:permanentRedirect|redirect)\(\s*["']([^"']+)["']\s*\)/g;

function literalRedirectTarget(fileText: string): string | undefined {
  const match = REDIRECT_LITERAL.exec(fileText);
  REDIRECT_LITERAL.lastIndex = 0;
  if (!match?.[1]) return undefined;
  return reactRouterPathPattern(match[1].split("?")[0] ?? match[1]);
}

function findManifestFile(
  files: RouteDiscoveryCtx["files"],
): { path: string; text: string } | undefined {
  const candidates = files.filter((file) => file.path.endsWith("routes.ts"));
  if (candidates.length === 0) return undefined;
  return (
    candidates.find((file) => file.path.endsWith("app/routes.ts")) ??
    candidates[0]
  );
}

function resolveRouteFile(
  file: string,
  manifestPath: string,
  rootDir?: string,
): string {
  const absoluteManifest = rootDir
    ? resolve(rootDir, manifestPath)
    : resolve(manifestPath);
  return join(dirname(absoluteManifest), file);
}

export async function discoverRoutes(
  ctx: RouteDiscoveryCtx,
): Promise<RouteInventory> {
  const manifest = findManifestFile(ctx.files);
  if (!manifest) return { routes: [] };

  const entries = parseReactRouterRoutes(manifest.text);
  const routes: RouteNode[] = [];

  for (const entry of entries) {
    const node: RouteNode = {
      pattern: entry.pattern,
      kind: classifyRouteKind(entry.pattern, entry.file),
      file: entry.file,
    };

    try {
      const filePath = resolveRouteFile(entry.file, manifest.path, ctx.rootDir);
      const fileText = await ctx.readFile(filePath);
      const redirectTo = literalRedirectTarget(fileText);
      if (redirectTo !== undefined) node.redirectTo = redirectTo;
    } catch {
      // missing or unreadable route file — keep the node without redirectTo
    }

    routes.push(node);
  }

  routes.sort((left, right) => left.pattern.localeCompare(right.pattern));
  return { routes };
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

  const preferred = inventory.routes.filter(
    (node) =>
      (node.kind === "page" || node.kind === "index") &&
      node.file !== undefined &&
      fileNameKeys(node.file).includes(normalized),
  );
  const candidates =
    preferred.length > 0
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
