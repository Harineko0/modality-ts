import * as ts from "typescript";
import type { SemanticTypeContext } from "../../lang/ts/semantic-type-context.js";

export interface ResolvedSemanticImport {
  localName: string;
  exportedName: string;
  moduleName: string;
  symbolKey: string;
}

export type SemanticImportContext = Pick<
  SemanticTypeContext,
  | "checker"
  | "aliasedSymbolAt"
  | "symbolAt"
  | "symbolKey"
  | "localSymbolKey"
  | "resolveModuleName"
  | "canonicalFileName"
  | "getSourceFile"
>;

function localSymbol(
  node: ts.Node,
  context: SemanticImportContext,
): ts.Symbol | undefined {
  if (context.symbolAt) return context.symbolAt(node);
  return context.checker.getSymbolAtLocation(node);
}

function aliasedSymbol(
  node: ts.Node,
  context: SemanticImportContext,
): ts.Symbol | undefined {
  if (context.aliasedSymbolAt) return context.aliasedSymbolAt(node);
  const symbol = localSymbol(node, context);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    try {
      return context.checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function symbolKeyFor(
  node: ts.Node,
  symbol: ts.Symbol,
  context: SemanticImportContext,
): string {
  if (context.localSymbolKey) {
    const localKey = context.localSymbolKey(node);
    if (localKey) return localKey;
  }
  if (context.symbolKey) return context.symbolKey(symbol);
  const declarations = symbol.getDeclarations();
  if (declarations && declarations.length > 0) {
    const declaration = declarations[0]!;
    return `${declaration.getSourceFile().fileName}:${declaration.getStart()}:${symbol.getName()}`;
  }
  return context.checker.getFullyQualifiedName(symbol);
}

function importDeclarationFor(decl: ts.Node): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = decl;
  while (current) {
    if (ts.isImportDeclaration(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function moduleNameFromSymbolDeclarations(
  symbol: ts.Symbol,
): string | undefined {
  for (const decl of symbol.getDeclarations() ?? []) {
    if (ts.isImportSpecifier(decl) || ts.isNamespaceImport(decl)) {
      const importDecl = importDeclarationFor(decl);
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
    if (ts.isExportSpecifier(decl)) {
      const exportDecl = decl.parent.parent;
      if (
        ts.isExportDeclaration(exportDecl) &&
        exportDecl.moduleSpecifier &&
        ts.isStringLiteral(exportDecl.moduleSpecifier)
      ) {
        return exportDecl.moduleSpecifier.text;
      }
    }
  }
  return undefined;
}

function moduleNameForResolvedSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): string | undefined {
  const visited = new Set<ts.Symbol>();
  let current: ts.Symbol | undefined = symbol;
  while (current) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    const moduleName = moduleNameFromSymbolDeclarations(current);
    if (moduleName) return moduleName;
    if (current.flags & ts.SymbolFlags.Alias) {
      try {
        current = checker.getAliasedSymbol(current);
      } catch {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
  return undefined;
}

function followRelativeReExport(
  specifier: string,
  exportedName: string,
  containingFile: string,
  context: SemanticImportContext,
): string | undefined {
  if (!context.resolveModuleName) return undefined;
  const resolved = context.resolveModuleName(specifier, containingFile);
  const barrelFile = resolved?.sourceFile;
  if (!barrelFile) return undefined;
  for (const statement of barrelFile.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const element of statement.exportClause.elements) {
      const localExport = element.name.text;
      const remoteExport = element.propertyName?.text ?? localExport;
      if (localExport !== exportedName && remoteExport !== exportedName)
        continue;
      return statement.moduleSpecifier.text;
    }
    for (const element of statement.exportClause.elements) {
      if (
        element.name.text === "default" ||
        element.propertyName?.text === "default"
      ) {
        return statement.moduleSpecifier.text;
      }
    }
  }
  return undefined;
}

function resolveAllowedModuleName(
  identifier: ts.Identifier,
  localBinding: ts.Symbol | undefined,
  resolvedSymbol: ts.Symbol,
  exportedName: string,
  allowedModules: ReadonlySet<string>,
  context: SemanticImportContext,
): string | undefined {
  const candidates = new Set<string>();
  if (localBinding) {
    const fromLocal = moduleNameFromSymbolDeclarations(localBinding);
    if (fromLocal) candidates.add(fromLocal);
  }
  const fromChain = moduleNameForResolvedSymbol(
    resolvedSymbol,
    context.checker,
  );
  if (fromChain) candidates.add(fromChain);

  for (const candidate of candidates) {
    if (allowedModules.has(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    if (!candidate.startsWith(".")) continue;
    const followed = followRelativeReExport(
      candidate,
      exportedName,
      identifier.getSourceFile().fileName,
      context,
    );
    if (followed && allowedModules.has(followed)) return followed;
  }
  return undefined;
}

function exportedNameFromBinding(
  binding: ts.Symbol,
  resolvedSymbol: ts.Symbol,
): string | undefined {
  const importSpecifier = binding.getDeclarations()?.find(ts.isImportSpecifier);
  if (importSpecifier) {
    return importSpecifier.propertyName?.text ?? importSpecifier.name.text;
  }
  const importClause = binding
    .getDeclarations()
    ?.find(
      (decl): decl is ts.ImportClause => ts.isImportClause(decl) && !!decl.name,
    );
  if (importClause) return "default";
  const fromSymbol = resolvedSymbol.getName();
  if (fromSymbol && fromSymbol !== "unknown" && fromSymbol !== "__type") {
    return fromSymbol === "default" ? "default" : fromSymbol;
  }
  return undefined;
}

function isShadowedLocalBinding(binding: ts.Symbol): boolean {
  const declarations = binding.getDeclarations() ?? [];
  if (declarations.length === 0) return false;
  const hasImportBinding = declarations.some(
    (decl) =>
      ts.isImportSpecifier(decl) ||
      (ts.isImportClause(decl) && decl.name !== undefined) ||
      ts.isNamespaceImport(decl),
  );
  if (hasImportBinding) return false;
  return declarations.some(
    (decl) =>
      ts.isVariableDeclaration(decl) ||
      ts.isFunctionDeclaration(decl) ||
      ts.isParameter(decl),
  );
}

function resolveImportBinding(
  identifier: ts.Identifier,
  allowedModules: ReadonlySet<string>,
  allowedExports: ReadonlySet<string>,
  context: SemanticImportContext,
): ResolvedSemanticImport | undefined {
  const binding = localSymbol(identifier, context);
  const symbol = aliasedSymbol(identifier, context);
  if (!binding || !symbol) return undefined;
  if (isShadowedLocalBinding(binding)) return undefined;
  const exportedName = exportedNameFromBinding(binding, symbol);
  if (!exportedName || !allowedExports.has(exportedName)) return undefined;
  const moduleName = resolveAllowedModuleName(
    identifier,
    binding,
    symbol,
    exportedName,
    allowedModules,
    context,
  );
  if (!moduleName) return undefined;
  return {
    localName: identifier.text,
    exportedName,
    moduleName,
    symbolKey: symbolKeyFor(identifier, binding, context),
  };
}

export function resolveSemanticNamedExport(
  identifier: ts.Identifier,
  allowedModules: ReadonlySet<string>,
  allowedExports: ReadonlySet<string>,
  context: SemanticImportContext,
): ResolvedSemanticImport | undefined {
  return resolveImportBinding(
    identifier,
    allowedModules,
    allowedExports,
    context,
  );
}

export function collectSemanticNamedImports(
  source: ts.SourceFile,
  allowedModules: ReadonlySet<string>,
  allowedExports: ReadonlySet<string>,
  context: SemanticImportContext,
): ResolvedSemanticImport[] {
  const results: ResolvedSemanticImport[] = [];
  const seen = new Set<string>();

  const add = (resolved: ResolvedSemanticImport | undefined): void => {
    if (!resolved) return;
    const key = `${resolved.localName}:${resolved.exportedName}:${resolved.moduleName}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(resolved);
  };

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const defaultName = statement.importClause?.name;
    if (defaultName) {
      add(
        resolveImportBinding(
          defaultName,
          allowedModules,
          allowedExports,
          context,
        ),
      );
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const resolved = resolveImportBinding(
        specifier.name,
        allowedModules,
        allowedExports,
        context,
      );
      if (!resolved) continue;
      add({
        ...resolved,
        exportedName: specifier.propertyName?.text ?? resolved.exportedName,
      });
    }
  }
  return results;
}
