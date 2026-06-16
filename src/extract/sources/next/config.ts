import { join } from "node:path";
import * as ts from "typescript";
import type { EffectIR, Transition, Value } from "modality-ts/core";
import type { RouteInventory } from "modality-ts/extract/engine/spi";
import { safeId } from "../../engine/ts/ids.js";
import { routeMountGuard } from "../../engine/ts/routes.js";

export interface NextConfigRedirect {
  source: string;
  destination: string;
  permanent?: boolean;
}

export interface NextConfigRewrite {
  source: string;
  destination: string;
}

export interface NextConfigHeader {
  source: string;
  headers: ReadonlyArray<{ key: string; value: string }>;
}

export interface NextConfigI18n {
  locales: readonly string[];
  defaultLocale: string;
}

export interface NextParsedConfig {
  basePath?: string;
  trailingSlash?: boolean;
  redirects: NextConfigRedirect[];
  rewrites: NextConfigRewrite[];
  headers: NextConfigHeader[];
  i18n?: NextConfigI18n;
  pageExtensions?: readonly string[];
  typedRoutes?: boolean;
  cacheComponents?: boolean;
  serverActionsAllowedOrigins?: readonly string[];
  warnings: string[];
}

const NEXT_CONFIG_NAMES = [
  "next.config.ts",
  "next.config.mts",
  "next.config.js",
  "next.config.mjs",
  "next.config.cjs",
] as const;

function parseSource(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function stringLiteralValue(
  node: ts.Expression | undefined,
): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function booleanLiteralValue(
  node: ts.Expression | undefined,
): boolean | undefined {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function objectLiteralProperties(
  node: ts.ObjectLiteralExpression | undefined,
): Map<string, ts.Expression> {
  const properties = new Map<string, ts.Expression>();
  if (!node) return properties;
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = propertyNameText(prop.name);
    if (key) properties.set(key, prop.initializer);
  }
  return properties;
}

function arrayLiteralElements(
  node: ts.Expression | undefined,
): ts.Expression[] {
  if (!node) return [];
  if (ts.isArrayLiteralExpression(node)) return [...node.elements];
  return [];
}

function resolveConfigValue(
  node: ts.Expression | undefined,
  warnings: string[],
  context: string,
): ts.Expression | undefined {
  if (!node) return undefined;
  if (
    ts.isObjectLiteralExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return node;
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const body = node.body;
    if (
      ts.isObjectLiteralExpression(body) ||
      ts.isArrayLiteralExpression(body)
    ) {
      return body;
    }
    if (ts.isBlock(body)) {
      for (const statement of body.statements) {
        if (ts.isReturnStatement(statement) && statement.expression) {
          return resolveConfigValue(statement.expression, warnings, context);
        }
      }
    }
  }
  if (ts.isFunctionDeclaration(node) && node.body) {
    for (const statement of node.body.statements) {
      if (ts.isReturnStatement(statement) && statement.expression) {
        return resolveConfigValue(statement.expression, warnings, context);
      }
    }
  }
  warnings.push(
    `Could not statically parse ${context} in next.config; using defaults`,
  );
  return undefined;
}

function extractConfigObject(
  sourceFile: ts.SourceFile,
  warnings: string[],
): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && statement.expression) {
      const resolved = resolveConfigValue(
        statement.expression,
        warnings,
        "default export",
      );
      if (resolved && ts.isObjectLiteralExpression(resolved)) return resolved;
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (decl.initializer) {
          const resolved = resolveConfigValue(
            decl.initializer,
            warnings,
            "config variable",
          );
          if (resolved && ts.isObjectLiteralExpression(resolved))
            return resolved;
        }
      }
    }
    if (ts.isModuleDeclaration(statement) && statement.body) {
      if (ts.isModuleBlock(statement.body)) {
        for (const inner of statement.body.statements) {
          if (
            ts.isExportAssignment(inner) &&
            inner.expression &&
            ts.isObjectLiteralExpression(inner.expression)
          ) {
            return inner.expression;
          }
        }
      }
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const resolved = resolveConfigValue(
        statement.expression.right,
        warnings,
        "module.exports",
      );
      if (resolved && ts.isObjectLiteralExpression(resolved)) return resolved;
    }
  }
  warnings.push("Could not find a static next.config object literal");
  return undefined;
}

function parseRedirectEntry(
  node: ts.Expression,
  warnings: string[],
): NextConfigRedirect | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const props = objectLiteralProperties(node);
  const source = stringLiteralValue(props.get("source"));
  const destination = stringLiteralValue(props.get("destination"));
  if (!source || !destination) {
    warnings.push("Skipping redirect entry without static source/destination");
    return undefined;
  }
  return {
    source,
    destination,
    ...(booleanLiteralValue(props.get("permanent")) === true
      ? { permanent: true }
      : {}),
  };
}

function parseRewriteEntry(
  node: ts.Expression,
  warnings: string[],
): NextConfigRewrite | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const props = objectLiteralProperties(node);
  const source = stringLiteralValue(props.get("source"));
  const destination = stringLiteralValue(props.get("destination"));
  if (!source || !destination) {
    warnings.push("Skipping rewrite entry without static source/destination");
    return undefined;
  }
  return { source, destination };
}

function parseHeaderEntry(
  node: ts.Expression,
  warnings: string[],
): NextConfigHeader | undefined {
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const props = objectLiteralProperties(node);
  const source = stringLiteralValue(props.get("source"));
  if (!source) return undefined;
  const headersNode = props.get("headers");
  const headers: Array<{ key: string; value: string }> = [];
  if (headersNode && ts.isArrayLiteralExpression(headersNode)) {
    for (const headerEntry of headersNode.elements) {
      if (!ts.isObjectLiteralExpression(headerEntry)) continue;
      const headerProps = objectLiteralProperties(headerEntry);
      const key = stringLiteralValue(headerProps.get("key"));
      const value = stringLiteralValue(headerProps.get("value"));
      if (key && value) headers.push({ key, value });
    }
  }
  return { source, headers };
}

function parseI18n(
  node: ts.Expression | undefined,
  warnings: string[],
): NextConfigI18n | undefined {
  const resolved = resolveConfigValue(node, warnings, "i18n");
  if (!resolved || !ts.isObjectLiteralExpression(resolved)) return undefined;
  const props = objectLiteralProperties(resolved);
  const defaultLocale = stringLiteralValue(props.get("defaultLocale"));
  const localesNode = props.get("locales");
  const locales = arrayLiteralElements(localesNode)
    .map((entry) => stringLiteralValue(entry))
    .filter((entry): entry is string => entry !== undefined);
  if (!defaultLocale || locales.length === 0) {
    warnings.push("Skipping i18n config without static locales/defaultLocale");
    return undefined;
  }
  return { defaultLocale, locales };
}

function parseServerActions(
  node: ts.Expression | undefined,
  warnings: string[],
): string[] | undefined {
  const resolved = resolveConfigValue(node, warnings, "serverActions");
  if (!resolved || !ts.isObjectLiteralExpression(resolved)) return undefined;
  const props = objectLiteralProperties(resolved);
  const originsNode = props.get("allowedOrigins");
  const origins = arrayLiteralElements(originsNode)
    .map((entry) => stringLiteralValue(entry))
    .filter((entry): entry is string => entry !== undefined);
  return origins.length > 0 ? origins : undefined;
}

function parseRouteRules(
  node: ts.Expression | undefined,
  warnings: string[],
  kind: "redirects" | "rewrites" | "headers",
): ts.Expression[] {
  const resolved = resolveConfigValue(node, warnings, kind);
  if (!resolved) return [];
  if (ts.isArrayLiteralExpression(resolved)) return [...resolved.elements];
  return [];
}

export function parseNextConfig(
  sourceText: string,
  fileName = "next.config.ts",
): NextParsedConfig {
  const warnings: string[] = [];
  const sourceFile = parseSource(sourceText, fileName);
  const configObject = extractConfigObject(sourceFile, warnings);
  if (!configObject) {
    return {
      redirects: [],
      rewrites: [],
      headers: [],
      warnings,
    };
  }
  const props = objectLiteralProperties(configObject);

  const redirects = parseRouteRules(
    props.get("redirects"),
    warnings,
    "redirects",
  )
    .map((entry) => parseRedirectEntry(entry, warnings))
    .filter((entry): entry is NextConfigRedirect => entry !== undefined);
  const rewrites = parseRouteRules(props.get("rewrites"), warnings, "rewrites")
    .map((entry) => parseRewriteEntry(entry, warnings))
    .filter((entry): entry is NextConfigRewrite => entry !== undefined);
  const headers = parseRouteRules(props.get("headers"), warnings, "headers")
    .map((entry) => parseHeaderEntry(entry, warnings))
    .filter((entry): entry is NextConfigHeader => entry !== undefined);

  const pageExtensions = arrayLiteralElements(props.get("pageExtensions"))
    .map((entry) => stringLiteralValue(entry))
    .filter((entry): entry is string => entry !== undefined);

  return {
    ...(stringLiteralValue(props.get("basePath"))
      ? { basePath: stringLiteralValue(props.get("basePath")) }
      : {}),
    ...(booleanLiteralValue(props.get("trailingSlash")) !== undefined
      ? { trailingSlash: booleanLiteralValue(props.get("trailingSlash")) }
      : {}),
    redirects,
    rewrites,
    headers,
    ...(parseI18n(props.get("i18n"), warnings)
      ? { i18n: parseI18n(props.get("i18n"), warnings) }
      : {}),
    ...(pageExtensions.length > 0 ? { pageExtensions } : {}),
    ...(booleanLiteralValue(props.get("typedRoutes")) !== undefined
      ? { typedRoutes: booleanLiteralValue(props.get("typedRoutes")) }
      : {}),
    ...(booleanLiteralValue(props.get("cacheComponents")) !== undefined
      ? { cacheComponents: booleanLiteralValue(props.get("cacheComponents")) }
      : {}),
    ...(parseServerActions(props.get("serverActions"), warnings)
      ? {
          serverActionsAllowedOrigins: parseServerActions(
            props.get("serverActions"),
            warnings,
          ),
        }
      : {}),
    warnings,
  };
}

export function nextConfigFileNames(): readonly string[] {
  return NEXT_CONFIG_NAMES;
}

export function nextConfigCandidates(rootDir: string): string[] {
  return NEXT_CONFIG_NAMES.map((name) => join(rootDir, name));
}

export function configMetadata(
  config: NextParsedConfig,
): Record<string, Value> {
  const metadata: Record<string, Value> = {};
  if (config.basePath) metadata.basePath = config.basePath;
  if (config.trailingSlash !== undefined)
    metadata.trailingSlash = config.trailingSlash;
  if (config.typedRoutes !== undefined)
    metadata.typedRoutes = config.typedRoutes;
  if (config.cacheComponents !== undefined)
    metadata.cacheComponents = config.cacheComponents;
  if (config.pageExtensions?.length)
    metadata.pageExtensions = [...config.pageExtensions];
  if (config.serverActionsAllowedOrigins?.length) {
    metadata.serverActionsAllowedOrigins = [
      ...config.serverActionsAllowedOrigins,
    ];
  }
  if (config.i18n) {
    metadata.i18n = {
      defaultLocale: config.i18n.defaultLocale,
      locales: [...config.i18n.locales],
    };
  }
  return metadata;
}

function navigateReplace(target: string): EffectIR {
  return {
    kind: "navigate",
    mode: "replace",
    to: { kind: "lit", value: target },
  };
}

export function synthesizeConfigRedirectTransitions(
  config: NextParsedConfig,
  inventory: RouteInventory,
): Transition[] {
  const modeledPatterns = new Set(
    inventory.routes
      .filter((node) => node.kind === "page" || node.kind === "index")
      .map((node) => node.pattern),
  );
  const transitions: Transition[] = [];

  for (const redirect of config.redirects) {
    const destination = applyBasePath(config.basePath, redirect.destination);
    const source = applyBasePath(config.basePath, redirect.source);
    if (!modeledPatterns.has(source) && !source.includes(":")) {
      continue;
    }
    transitions.push({
      id: `next:config:redirect:${safeId(source)}->${safeId(destination)}`,
      cls: "nav",
      label: { kind: "navigate", mode: "push", to: destination },
      source: [],
      guard: routeMountGuard(source),
      effect: navigateReplace(destination),
      reads: ["sys:route", "sys:history"],
      writes: ["sys:route", "sys:history"],
      confidence: "exact",
    });
  }

  for (const rewrite of config.rewrites) {
    const destination = applyBasePath(config.basePath, rewrite.destination);
    const source = applyBasePath(config.basePath, rewrite.source);
    transitions.push({
      id: `next:config:rewrite:${safeId(source)}->${safeId(destination)}`,
      cls: "nav",
      label: {
        kind: "navigate",
        mode: "push",
        to: destination,
      },
      source: [],
      guard: routeMountGuard(source),
      effect: navigateReplace(destination),
      reads: ["sys:route", "sys:history"],
      writes: ["sys:route", "sys:history"],
      confidence: "over-approx",
    });
  }

  return transitions.sort((left, right) => left.id.localeCompare(right.id));
}

export function expandInventoryForI18n(
  inventory: RouteInventory,
  config: NextParsedConfig,
): RouteInventory {
  if (!config.i18n || config.i18n.locales.length === 0) return inventory;
  const { locales, defaultLocale } = config.i18n;
  const expanded = inventory.routes.flatMap((route) => {
    if (route.kind !== "page" && route.kind !== "index") return [route];
    return locales.map((locale) => ({
      ...route,
      pattern:
        locale === defaultLocale
          ? route.pattern
          : `/${locale}${route.pattern === "/" ? "" : route.pattern}`,
      metadata: {
        ...(route.metadata ?? {}),
        locale,
      },
    }));
  });
  return { routes: expanded };
}

function applyBasePath(basePath: string | undefined, path: string): string {
  if (!basePath || path.startsWith("http")) return path;
  const normalizedBase = basePath.endsWith("/")
    ? basePath.slice(0, -1)
    : basePath;
  if (path.startsWith(normalizedBase)) return path;
  if (path === "/") return normalizedBase || "/";
  return `${normalizedBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export function configSecurityWarnings(config: NextParsedConfig): string[] {
  const warnings = [...config.warnings];
  if (config.rewrites.length > 0) {
    warnings.push(
      "next.config rewrites are over-approximated as replace navigations",
    );
  }
  if (config.serverActionsAllowedOrigins?.length) {
    warnings.push(
      `next.config serverActions.allowedOrigins=${config.serverActionsAllowedOrigins.join(",")}`,
    );
  }
  return [...new Set(warnings)].sort();
}
