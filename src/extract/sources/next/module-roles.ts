import type {
  ImportEdgeContext,
  ImportEdgeCtx,
  ModuleClassification,
  ModuleDirective,
  ModuleEntryExport,
  ModuleRoleCtx,
} from "modality-ts/extract/engine/spi";
import * as ts from "typescript";

const SERVER_DATA_EXPORTS = new Set([
  "getStaticProps",
  "getStaticPaths",
  "getServerSideProps",
  "getInitialProps",
]);

const SERVER_METADATA_EXPORTS = new Set([
  "generateMetadata",
  "generateStaticParams",
  "generateImageMetadata",
  "generateSitemaps",
]);

const ROUTE_HANDLER_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const ASSET_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".pcss",
  ".module.css",
  ".module.scss",
  ".module.sass",
  ".module.less",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".avif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
]);

const NO_OP_NEXT_MODULES = [
  "next/image",
  "next/script",
  /^next\/font\//,
] as const;

export function parseModuleDirectives(sourceText: string): ModuleDirective[] {
  const directives: ModuleDirective[] = [];
  const lines = sourceText.split(/\r?\n/).slice(0, 5);
  for (const line of lines) {
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

function normalizedPath(fileName: string): string {
  return fileName.split("\\").join("/");
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function isHookExport(name: string): boolean {
  return (
    name.startsWith("use") && name.length > 3 && /^[A-Z]/.test(name[3] ?? "")
  );
}

function isAppRouterPath(fileName: string): boolean {
  const normalized = normalizedPath(fileName);
  return /(?:^|\/)(?:src\/)?app\//.test(normalized);
}

function isPagesRouterPath(fileName: string): boolean {
  const normalized = normalizedPath(fileName);
  return /(?:^|\/)(?:src\/)?pages\//.test(normalized);
}

function isPagesApiPath(fileName: string): boolean {
  const normalized = normalizedPath(fileName);
  return /(?:^|\/)(?:src\/)?pages\/api\//.test(normalized);
}

function isAppRouteHandlerPath(fileName: string): boolean {
  const normalized = normalizedPath(fileName);
  return /(?:^|\/)(?:src\/)?app\/.*\/route\.(?:ts|tsx|js|jsx|mts|cts)$/.test(
    normalized,
  );
}

function isProxyPath(fileName: string): boolean {
  const normalized = normalizedPath(fileName);
  return /(?:^|\/)(?:src\/)?app\/proxy\.(?:ts|tsx|js|jsx|mts|cts)$/.test(
    normalized,
  );
}

function isAssetSpecifier(specifier: string): boolean {
  const queryless = specifier.split("?")[0] ?? specifier;
  const lower = queryless.toLowerCase();
  for (const ext of ASSET_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function isNoOpNextModule(specifier: string): boolean {
  for (const pattern of NO_OP_NEXT_MODULES) {
    if (typeof pattern === "string" && specifier === pattern) return true;
    if (pattern instanceof RegExp && pattern.test(specifier)) return true;
  }
  return false;
}

function exportNameFromClause(
  clause: ts.ExportDeclaration,
): string | undefined {
  if (!clause.exportClause || !ts.isNamedExports(clause.exportClause))
    return undefined;
  const elements = clause.exportClause.elements;
  if (elements.length !== 1) return undefined;
  const element = elements[0];
  if (!element) return undefined;
  return (element.name ?? element.propertyName)?.text;
}

function declarationExportName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name)
    return statement.name.text;
  if (ts.isVariableStatement(statement)) {
    const decl = statement.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  if (ts.isClassDeclaration(statement) && statement.name)
    return statement.name.text;
  return undefined;
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

function isDefaultExport(statement: ts.Statement): boolean {
  return (
    (ts.canHaveModifiers(statement) &&
      statement.modifiers?.some(
        (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword,
      )) ??
    false
  );
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

function serverExportContext(
  name: string,
  fileName: string,
  directives: readonly ModuleDirective[],
): ModuleEntryExport["context"] | undefined {
  if (SERVER_DATA_EXPORTS.has(name) || SERVER_METADATA_EXPORTS.has(name))
    return "server";
  if (ROUTE_HANDLER_METHODS.has(name) && isAppRouteHandlerPath(fileName))
    return "server";
  if (directives.includes("use server")) return "server";
  return undefined;
}

function defaultExportContext(
  fileName: string,
  directives: readonly ModuleDirective[],
): ModuleEntryExport["context"] {
  if (directives.includes("use client")) return "client";
  if (
    isAppRouteHandlerPath(fileName) ||
    isPagesApiPath(fileName) ||
    isProxyPath(fileName) ||
    directives.includes("use server")
  ) {
    return "server";
  }
  if (isAppRouterPath(fileName)) return "server";
  if (isPagesRouterPath(fileName)) return "shared";
  return "client";
}

function namedExportContext(
  name: string,
  fileName: string,
  directives: readonly ModuleDirective[],
): ModuleEntryExport["context"] | undefined {
  const server = serverExportContext(name, fileName, directives);
  if (server) return server;
  if (directives.includes("use server")) return "server";
  if (directives.includes("use client")) {
    if (isPascalCase(name) || isHookExport(name)) return "client";
    return undefined;
  }
  if (isAppRouterPath(fileName)) {
    if (isPascalCase(name) || isHookExport(name)) return "server";
    return undefined;
  }
  if (isPascalCase(name) || isHookExport(name)) return "client";
  return undefined;
}

export function isNextServerOnlyModule(fileName: string): boolean {
  const normalized = normalizedPath(fileName);
  if (/\.server\./.test(normalized) || /\/server\//.test(normalized))
    return true;
  if (isAppRouteHandlerPath(fileName)) return true;
  if (isPagesApiPath(fileName)) return true;
  if (isProxyPath(fileName)) return true;
  return false;
}

export function classifyNextModule(ctx: ModuleRoleCtx): ModuleClassification {
  const directives = parseModuleDirectives(ctx.sourceText);
  if (isNextServerOnlyModule(ctx.fileName)) {
    return {
      defaultContext: "server",
      serverOnly: true,
      directives,
      reason: "next server-only module path",
    };
  }
  if (directives.includes("use server")) {
    return {
      defaultContext: "server",
      serverOnly: true,
      directives,
      reason: "use server directive",
    };
  }
  if (directives.includes("use client")) {
    return {
      defaultContext: "client",
      directives,
      reason: "use client directive",
    };
  }
  if (isAppRouterPath(ctx.fileName)) {
    return {
      defaultContext: "server",
      directives,
      reason: "app router server module",
    };
  }
  if (isPagesRouterPath(ctx.fileName)) {
    return {
      defaultContext: "shared",
      directives,
      reason: "pages router module",
    };
  }
  return {
    defaultContext: "unknown",
    directives,
    reason: "neutral module",
  };
}

export function nextModuleEntryExports(
  ctx: ModuleRoleCtx,
): readonly ModuleEntryExport[] {
  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  const directives = parseModuleDirectives(ctx.sourceText);
  const entries: ModuleEntryExport[] = [];
  const seen = new Set<string>();

  const addEntry = (
    name: ModuleEntryExport["name"],
    context: ModuleEntryExport["context"],
    reason: string,
  ): void => {
    const key = name === "default" ? "default" : name;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name, context, reason });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      addEntry(
        "default",
        defaultExportContext(ctx.fileName, directives),
        "default export",
      );
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const exported = exportNameFromClause(statement);
      if (!exported) continue;
      const context = namedExportContext(exported, ctx.fileName, directives);
      if (context)
        addEntry(exported, context, `exported ${context} symbol ${exported}`);
      continue;
    }
    if (!isExported(statement)) {
      if (
        directives.includes("use server") &&
        ts.isFunctionDeclaration(statement) &&
        statement.name
      ) {
        addEntry(statement.name.text, "server", "use server exported function");
      }
      continue;
    }
    if (isDefaultExport(statement)) {
      addEntry(
        "default",
        defaultExportContext(ctx.fileName, directives),
        "default export",
      );
      continue;
    }
    const name = declarationExportName(statement);
    if (!name) continue;
    const context = namedExportContext(name, ctx.fileName, directives);
    if (context) addEntry(name, context, `exported ${context} symbol ${name}`);
    if (
      ts.isFunctionDeclaration(statement) &&
      hasInlineUseServerDirective(statement.body)
    ) {
      addEntry(name, "server", "inline use server function");
    }
  }

  if (
    directives.includes("use server") &&
    !entries.some((entry) => entry.context === "server")
  ) {
    for (const statement of sourceFile.statements) {
      if (!ts.isFunctionDeclaration(statement) || !statement.name) continue;
      if (!isExported(statement)) continue;
      addEntry(statement.name.text, "server", "use server exported function");
    }
  }

  return entries.sort((left, right) => {
    const leftKey = left.name === "default" ? "" : left.name;
    const rightKey = right.name === "default" ? "" : right.name;
    return leftKey.localeCompare(rightKey);
  });
}

export function classifyNextImportEdge(ctx: ImportEdgeCtx): ImportEdgeContext {
  if (ctx.isTypeOnly) return "type";
  if (isAssetSpecifier(ctx.specifier)) return "asset";
  if (isNoOpNextModule(ctx.specifier)) return "asset";
  return "unknown";
}
