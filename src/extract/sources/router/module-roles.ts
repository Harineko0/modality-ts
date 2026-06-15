import * as ts from "typescript";
import type {
  ImportEdgeContext,
  ImportEdgeCtx,
  ModuleClassification,
  ModuleDirective,
  ModuleEntryExport,
  ModuleRoleCtx,
  ModuleRuntimeContext,
} from "modality-ts/extract/engine/spi";

const SERVER_EXPORT_NAMES = new Set(["loader", "action", "headers"]);

export function isServerOnlyModulePath(fileName: string): boolean {
  const normalized = fileName.split("\\").join("/");
  return /\.server\./.test(normalized) || /\/server\//.test(normalized);
}

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

export function classifyReactRouterModule(
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
  return {
    defaultContext: "shared",
    directives,
    reason: "route/client module",
  };
}

export function reactRouterModuleEntryExports(
  ctx: ModuleRoleCtx,
): readonly ModuleEntryExport[] {
  const sourceFile = parseSource(ctx.sourceText, ctx.fileName);
  const entries: ModuleEntryExport[] = [];
  const seen = new Set<string>();

  const addEntry = (
    name: ModuleEntryExport["name"],
    context: ModuleRuntimeContext,
    reason: string,
  ): void => {
    const key = name === "default" ? "default" : name;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name, context, reason });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      addEntry("default", "client", "default export");
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const exported = exportNameFromClause(statement);
      if (!exported) continue;
      if (SERVER_EXPORT_NAMES.has(exported)) {
        addEntry(exported, "server", `server route export ${exported}`);
      } else if (isPascalCase(exported)) {
        addEntry(exported, "client", "exported component");
      } else if (isHookExport(exported)) {
        addEntry(exported, "client", "exported hook");
      }
      continue;
    }
    if (!isExported(statement)) continue;
    if (isDefaultExport(statement)) {
      addEntry("default", "client", "default export");
      continue;
    }
    const name = declarationExportName(statement);
    if (!name) continue;
    if (SERVER_EXPORT_NAMES.has(name)) {
      addEntry(name, "server", `server route export ${name}`);
    } else if (isPascalCase(name)) {
      addEntry(name, "client", "exported component");
    } else if (isHookExport(name)) {
      addEntry(name, "client", "exported hook");
    }
  }

  return entries.sort((left, right) => {
    const leftKey = left.name === "default" ? "" : left.name;
    const rightKey = right.name === "default" ? "" : right.name;
    return leftKey.localeCompare(rightKey);
  });
}

export function classifyReactRouterImportEdge(
  ctx: ImportEdgeCtx,
): ImportEdgeContext {
  if (ctx.isTypeOnly) return "type";
  return "unknown";
}
