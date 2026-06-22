import type { Value } from "modality-ts/core";
import * as ts from "typescript";
import { findNodeAt, type NodeRef } from "./node-ref.js";
import type { SurfaceExpr, SymbolRef } from "./surface-ir.js";

export interface ResolvedSymbol {
  name: string;
  kind: "local" | "parameter" | "import" | "module" | "property" | "unknown";
  module?: string;
  declaration?: NodeRef;
}

export interface ImportBinding {
  module: string;
  exportedName: string;
  isNamespace: boolean;
}

export type TypeView =
  | {
      kind: "primitive";
      name: "string" | "number" | "boolean" | "undefined" | "null" | "unknown";
    }
  | { kind: "literal"; value: Value }
  | { kind: "union"; members: TypeView[] }
  | { kind: "object"; properties: string[] }
  | { kind: "opaque" };

export interface SymbolPortContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFile?: ts.SourceFile;
  getSourceFile?(fileName: string): ts.SourceFile | undefined;
  localSymbolKey?(node: ts.Node): string | undefined;
  symbolAt?(node: ts.Node): ts.Symbol | undefined;
  aliasedSymbolAt?(node: ts.Node): ts.Symbol | undefined;
  resolveModuleName?(
    specifier: string,
    containingFile: string,
  ): { fileName: string; isExternal: boolean } | undefined;
}

export interface SymbolPort {
  resolve(ref: SymbolRef): ResolvedSymbol | undefined;
  localSymbolKey(ref: SymbolRef): string | undefined;
  importBinding(ref: SymbolRef): ImportBinding | undefined;
  typeOf(expr: SurfaceExpr): TypeView | undefined;
  /** L4-only: re-resolve the original language node behind a Surface IR origin. */
  nodeAt(ref: NodeRef): ts.Node | undefined;
}

function localSymbol(
  node: ts.Node,
  ctx: SymbolPortContext,
): ts.Symbol | undefined {
  if (ctx.symbolAt) return ctx.symbolAt(node);
  return ctx.checker.getSymbolAtLocation(node);
}

function aliasedSymbol(
  node: ts.Node,
  ctx: SymbolPortContext,
): ts.Symbol | undefined {
  if (ctx.aliasedSymbolAt) return ctx.aliasedSymbolAt(node);
  const symbol = localSymbol(node, ctx);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      return ctx.checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function exportedNameFromBinding(
  binding: ts.Symbol,
  symbol: ts.Symbol,
): string | undefined {
  const name = symbol.getName();
  if (name && name !== "__type") return name;
  return binding.getName() || undefined;
}

function moduleNameFromDeclarations(symbol: ts.Symbol): string | undefined {
  for (const decl of symbol.getDeclarations() ?? []) {
    if (ts.isImportSpecifier(decl) || ts.isNamespaceImport(decl)) {
      const importDecl = findImportDeclaration(decl);
      const specifier = importDecl?.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) return specifier.text;
    }
    if (ts.isImportClause(decl) && decl.name) {
      const importDecl = decl.parent;
      if (
        ts.isImportDeclaration(importDecl) &&
        ts.isStringLiteral(importDecl.moduleSpecifier)
      ) {
        return importDecl.moduleSpecifier.text;
      }
    }
  }
  return undefined;
}

function findImportDeclaration(
  decl: ts.Node,
): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = decl;
  while (current) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function isImportBinding(symbol: ts.Symbol): boolean {
  return (symbol.getDeclarations() ?? []).some(
    (decl) =>
      ts.isImportSpecifier(decl) ||
      ts.isNamespaceImport(decl) ||
      (ts.isImportClause(decl) && decl.name !== undefined),
  );
}

function resolvedKind(symbol: ts.Symbol): ResolvedSymbol["kind"] {
  const flags = symbol.flags;
  if (flags & ts.SymbolFlags.BlockScopedVariable) return "local";
  if (flags & ts.SymbolFlags.FunctionScopedVariable) return "local";
  if (flags & ts.SymbolFlags.ValueModule) return "module";
  if (isImportBinding(symbol)) return "import";
  if (flags & ts.SymbolFlags.Property) return "property";
  if (flags & ts.SymbolFlags.Function) return "local";
  return "unknown";
}

function primitiveTypeView(type: ts.Type): TypeView {
  if (type.flags & ts.TypeFlags.String)
    return { kind: "primitive", name: "string" };
  if (type.flags & ts.TypeFlags.Number)
    return { kind: "primitive", name: "number" };
  if (type.flags & ts.TypeFlags.Boolean)
    return { kind: "primitive", name: "boolean" };
  if (type.flags & ts.TypeFlags.Undefined)
    return { kind: "primitive", name: "undefined" };
  if (type.flags & ts.TypeFlags.Null)
    return { kind: "primitive", name: "null" };
  return { kind: "primitive", name: "unknown" };
}

function sameSourceFile(left: string, right: string): boolean {
  return (
    left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`)
  );
}

function importBindingFromSource(
  ref: SymbolRef,
  sourceFile: ts.SourceFile,
): ImportBinding | undefined {
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const module = statement.moduleSpecifier.text;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named) && named.name.text === ref.name) {
      return { module, exportedName: "*", isNamespace: true };
    }
    if (named && ts.isNamedImports(named)) {
      for (const element of named.elements) {
        if (element.name.text !== ref.name) continue;
        return {
          module,
          exportedName: element.propertyName?.text ?? element.name.text,
          isNamespace: false,
        };
      }
    }
    const defaultName = statement.importClause?.name;
    if (defaultName?.text === ref.name) {
      return { module, exportedName: "default", isNamespace: false };
    }
  }
  return undefined;
}

export function createTsSymbolPort(ctx: SymbolPortContext): SymbolPort {
  const nodeAt = (ref: NodeRef): ts.Node | undefined => {
    const source =
      ctx.sourceFile && sameSourceFile(ctx.sourceFile.fileName, ref.file)
        ? ctx.sourceFile
        : ctx.getSourceFile?.(ref.file);
    if (!source) return undefined;
    return findNodeAt(source, ref);
  };

  return {
    nodeAt,

    resolve(ref: SymbolRef): ResolvedSymbol | undefined {
      const node = nodeAt(ref.origin);
      if (!node || !ts.isIdentifier(node)) return undefined;
      const symbol = aliasedSymbol(node, ctx);
      if (!symbol) return undefined;
      const module = moduleNameFromDeclarations(symbol);
      return {
        name: symbol.getName() || ref.name,
        kind: resolvedKind(symbol),
        ...(module ? { module } : {}),
        declaration: ref.origin,
      };
    },

    localSymbolKey(ref: SymbolRef): string | undefined {
      const node = nodeAt(ref.origin);
      if (!node) return undefined;
      if (ctx.localSymbolKey) return ctx.localSymbolKey(node);
      const symbol = localSymbol(node, ctx);
      if (!symbol) return undefined;
      const decls = symbol.getDeclarations();
      if (!decls || decls.length === 0) return undefined;
      const decl = decls[0]!;
      return `${decl.getSourceFile().fileName}:${decl.getStart()}:${symbol.getName()}`;
    },

    importBinding(ref: SymbolRef): ImportBinding | undefined {
      const node = nodeAt(ref.origin);
      if (node && ts.isIdentifier(node)) {
        const binding = localSymbol(node, ctx);
        const symbol = aliasedSymbol(node, ctx);
        if (binding && symbol && isImportBinding(binding)) {
          const declarations = binding.getDeclarations() ?? [];
          const namespaceDecl = declarations.find(ts.isNamespaceImport);
          if (namespaceDecl) {
            const importDecl = findImportDeclaration(namespaceDecl);
            const specifier = importDecl?.moduleSpecifier;
            if (specifier && ts.isStringLiteral(specifier)) {
              return {
                module: specifier.text,
                exportedName: "*",
                isNamespace: true,
              };
            }
          }

          const importSpecifier = declarations.find(ts.isImportSpecifier);
          if (importSpecifier) {
            const importDecl = findImportDeclaration(importSpecifier);
            const specifier = importDecl?.moduleSpecifier;
            if (specifier && ts.isStringLiteral(specifier)) {
              const exportedName =
                importSpecifier.propertyName?.text ??
                importSpecifier.name.text ??
                exportedNameFromBinding(binding, symbol) ??
                ref.name;
              return {
                module: specifier.text,
                exportedName,
                isNamespace: false,
              };
            }
          }

          const importClause = declarations.find(
            (decl): decl is ts.ImportClause =>
              ts.isImportClause(decl) && decl.name !== undefined,
          );
          if (importClause?.name) {
            const importDecl = importClause.parent;
            if (
              ts.isImportDeclaration(importDecl) &&
              ts.isStringLiteral(importDecl.moduleSpecifier)
            ) {
              return {
                module: importDecl.moduleSpecifier.text,
                exportedName: "default",
                isNamespace: false,
              };
            }
          }

          const module = moduleNameFromDeclarations(symbol);
          if (module) {
            return {
              module,
              exportedName:
                exportedNameFromBinding(binding, symbol) ?? ref.name,
              isNamespace: false,
            };
          }
        }
      }
      if (
        ctx.sourceFile &&
        sameSourceFile(ctx.sourceFile.fileName, ref.origin.file)
      ) {
        return importBindingFromSource(ref, ctx.sourceFile);
      }
      return undefined;
    },

    typeOf(expr: SurfaceExpr): TypeView | undefined {
      const origin =
        expr.kind === "ref"
          ? expr.symbol.origin
          : "origin" in expr
            ? expr.origin
            : undefined;
      if (!origin) return undefined;
      const node = nodeAt(origin);
      if (!node) return undefined;
      const type = ctx.checker.getTypeAtLocation(node);
      if (!type) return undefined;
      if (type.isUnion()) {
        return {
          kind: "union",
          members: type.types.map(primitiveTypeView),
        };
      }
      return primitiveTypeView(type);
    },
  };
}
