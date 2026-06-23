import type {
  ImportEdgeContext,
  ImportEdgeCtx,
  ModuleClassification,
  ModuleEntryExport,
  ModuleRoleCtx,
  ModuleRuntimeContext,
} from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import {
  isServerOnlyModulePath,
  isTanstackRouteModule,
  isTanstackRouteModulePath,
  parseModuleDirectives,
  parseTanstackRouteModule,
  TANSTACK_ROUTER_PKG,
} from "./route-options.js";

function parseSource(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function isHookExport(name: string): boolean {
  return (
    name.startsWith("use") && name.length > 3 && /^[A-Z]/.test(name[3] ?? "")
  );
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

function addEntry(
  entries: ModuleEntryExport[],
  seen: Set<string>,
  name: ModuleEntryExport["name"],
  context: ModuleRuntimeContext,
  reason: string,
): void {
  const key = name === "default" ? "default" : name;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push({ name, context, reason });
}

export function classifyTanstackModule(
  ctx: ModuleRoleCtx,
): ModuleClassification {
  const directives = parseModuleDirectives(ctx.sourceText);
  if (isServerOnlyModulePath(ctx.fileName)) {
    return {
      defaultContext: "server",
      serverOnly: true,
      directives,
      reason: "server-only module path",
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
  if (isTanstackRouteModule(ctx.sourceText, ctx.fileName)) {
    return {
      defaultContext: "shared",
      directives,
      reason: "tanstack route module",
    };
  }
  if (isTanstackRouteModulePath(ctx.fileName)) {
    return {
      defaultContext: "shared",
      directives,
      reason: "tanstack route path",
    };
  }
  return {
    defaultContext: "unknown",
    directives,
    reason: "neutral module",
  };
}

export function tanstackModuleEntryExports(
  ctx: ModuleRoleCtx,
): readonly ModuleEntryExport[] {
  const routeModule = parseTanstackRouteModule(ctx.sourceText, ctx.fileName);
  const entries: ModuleEntryExport[] = [];
  const seen = new Set<string>();

  if (routeModule) {
    for (const componentName of routeModule.componentNames) {
      addEntry(
        entries,
        seen,
        componentName,
        "client",
        "tanstack route component option",
      );
    }
    if (routeModule.hasLoader) {
      addEntry(
        entries,
        seen,
        "loader",
        "server",
        "tanstack route loader option",
      );
    }
    if (routeModule.hasBeforeLoad) {
      addEntry(
        entries,
        seen,
        "beforeLoad",
        "server",
        "tanstack route beforeLoad option",
      );
    }
    for (const optionName of routeModule.serverOptionNames) {
      if (optionName === "loader" || optionName === "beforeLoad") continue;
      addEntry(
        entries,
        seen,
        optionName,
        "server",
        `tanstack route ${optionName} option`,
      );
    }
  }

  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      addEntry(entries, seen, "default", "client", "default export");
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const exported = exportNameFromClause(statement);
      if (!exported) continue;
      if (isPascalCase(exported)) {
        addEntry(entries, seen, exported, "client", "exported component");
      } else if (isHookExport(exported)) {
        addEntry(entries, seen, exported, "client", "exported hook");
      }
      continue;
    }
    if (!isExported(statement)) continue;
    if (isDefaultExport(statement)) {
      addEntry(entries, seen, "default", "client", "default export");
      continue;
    }
    const name = declarationExportName(statement);
    if (!name || name === "Route") continue;
    if (isPascalCase(name)) {
      addEntry(entries, seen, name, "client", "exported component");
    } else if (isHookExport(name)) {
      addEntry(entries, seen, name, "client", "exported hook");
    }
  }

  return entries.sort((left, right) => {
    const leftKey = left.name === "default" ? "" : left.name;
    const rightKey = right.name === "default" ? "" : right.name;
    return leftKey.localeCompare(rightKey);
  });
}

export function classifyTanstackImportEdge(
  ctx: ImportEdgeCtx,
): ImportEdgeContext {
  if (ctx.isTypeOnly) return "type";
  if (ctx.specifier === TANSTACK_ROUTER_PKG && ctx.surface === "interaction") {
    return "unknown";
  }
  return "unknown";
}

export function shouldDiscoverTanstackEffectApis(ctx: {
  fileName: string;
  sourceText: string;
  classification: ModuleClassification;
  entryExports: readonly ModuleEntryExport[];
}): boolean {
  const routeModule = parseTanstackRouteModule(ctx.sourceText, ctx.fileName);
  if (routeModule?.hasLoader || routeModule?.hasBeforeLoad) return true;
  if (ctx.classification.serverOnly === true) return true;
  if (ctx.classification.defaultContext === "server") return true;
  return ctx.entryExports.some(
    (entry) =>
      entry.context === "server" &&
      (entry.name === "loader" || entry.name === "beforeLoad"),
  );
}
