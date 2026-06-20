import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Model, SourceAnchor } from "modality-ts/core";
import { emitComponentModalModules } from "../codegen/component-state.js";
import {
  createSemanticProject,
  loadSemanticProjectConfig,
  type SemanticSourceEntry,
} from "../../extract/engine/ts/semantic-project.js";
import ts from "typescript";

export interface SymbolRewriteDiagnostic {
  symbol: string;
  file: string;
  message: string;
}

export interface RewriteImportedSymbolsResult {
  source: string;
  diagnostics: SymbolRewriteDiagnostic[];
}

function anchorKey(anchor: SourceAnchor): string {
  return `${resolve(anchor.file)}:${anchor.line ?? 0}`;
}

function buildAnchorIndex(
  varAnchors: Record<string, SourceAnchor>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const [varId, anchor] of Object.entries(varAnchors)) {
    index.set(anchorKey(anchor), varId);
  }
  return index;
}

function declarationAnchor(
  declaration: ts.Declaration,
): SourceAnchor | undefined {
  const sourceFile = declaration.getSourceFile();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    declaration.getStart(),
  );
  return {
    file: resolve(sourceFile.fileName),
    line: line + 1,
    column: character + 1,
  };
}

function isBindingIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent)) return true;
  if (ts.isNamespaceImport(parent)) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  return false;
}

function isComponentAccessorArgument(node: ts.Identifier): boolean {
  const parent = node.parent;
  return Boolean(
    parent &&
      ts.isCallExpression(parent) &&
      parent.expression.getText() === "s" &&
      parent.arguments[0] === node,
  );
}

function resolveAliasedSymbol(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function modeledVarIdForIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker,
  anchorIndex: Map<string, string>,
): string | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  const resolved = resolveAliasedSymbol(symbol, checker);
  for (const declaration of resolved.getDeclarations() ?? []) {
    if (
      ts.isImportSpecifier(declaration) ||
      ts.isImportClause(declaration) ||
      ts.isNamespaceImport(declaration)
    ) {
      continue;
    }
    const anchor = declarationAnchor(declaration);
    if (!anchor) continue;
    const varId = anchorIndex.get(anchorKey(anchor));
    if (varId) return varId;
  }
  return undefined;
}

function varIdFromHandleDeclaration(
  declaration: ts.Declaration,
): string | undefined {
  if (!ts.isVariableDeclaration(declaration)) return undefined;
  const type = declaration.type;
  if (!type || !ts.isTypeReferenceNode(type)) return undefined;
  if (!ts.isIdentifier(type.typeName) || type.typeName.text !== "Variable") {
    return undefined;
  }
  const idArgument = type.typeArguments?.[1];
  if (!idArgument || !ts.isLiteralTypeNode(idArgument)) return undefined;
  return ts.isStringLiteral(idArgument.literal)
    ? idArgument.literal.text
    : undefined;
}

function transitionIdFromHandleDeclaration(
  declaration: ts.Declaration,
): string | undefined {
  if (!ts.isVariableDeclaration(declaration)) return undefined;
  const type = declaration.type;
  if (!type || !ts.isTypeReferenceNode(type)) return undefined;
  if (
    !ts.isIdentifier(type.typeName) ||
    type.typeName.text !== "TransitionRef"
  ) {
    return undefined;
  }
  const idArgument = type.typeArguments?.[0];
  if (!idArgument || !ts.isLiteralTypeNode(idArgument)) return undefined;
  return ts.isStringLiteral(idArgument.literal)
    ? idArgument.literal.text
    : undefined;
}

/**
 * Resolve an imported identifier whose declaration is a generated transition handle
 * (`export const name: TransitionRef<"Component.onClick.field.seq">`) to its transition id.
 */
function handleTransitionIdForIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker,
): string | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  const resolved = resolveAliasedSymbol(symbol, checker);
  for (const declaration of resolved.getDeclarations() ?? []) {
    const transitionId = transitionIdFromHandleDeclaration(declaration);
    if (transitionId) return transitionId;
  }
  return undefined;
}

/**
 * Resolve an imported identifier whose declaration is a generated handle
 * (`export declare const field: Variable<_, "local:Component.field">`) to its var id, read
 * straight from the embedded type literal.
 */
function handleVarIdForIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker,
): string | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  const resolved = resolveAliasedSymbol(symbol, checker);
  for (const declaration of resolved.getDeclarations() ?? []) {
    const varId = varIdFromHandleDeclaration(declaration);
    if (varId) return varId;
  }
  return undefined;
}

function importModuleSpecifier(
  declaration: ts.Declaration,
): string | undefined {
  let node: ts.Node | undefined = declaration;
  while (node && !ts.isImportDeclaration(node)) node = node.parent;
  if (node && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  return undefined;
}

function isModalityPackageImport(
  node: ts.Identifier,
  checker: ts.TypeChecker,
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return false;
  for (const declaration of symbol.getDeclarations() ?? []) {
    const specifier = importModuleSpecifier(declaration);
    if (specifier?.startsWith("modality-ts")) return true;
  }
  return false;
}

function importModuleSpecifierForIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker,
): string | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  for (const declaration of symbol.getDeclarations() ?? []) {
    const specifier = importModuleSpecifier(declaration);
    if (specifier) return specifier;
  }
  return undefined;
}

function isGeneratedModalSpecifier(specifier: string | undefined): boolean {
  const normalized = specifier?.split("\\").join("/");
  return Boolean(
    normalized &&
      (normalized.endsWith(".modals") ||
        normalized.endsWith(".modals.ts") ||
        normalized.endsWith(".modals.js") ||
        normalized.includes(".modality/modals/") ||
        normalized === "./modals" ||
        normalized.startsWith("./modals/") ||
        normalized === "../modals" ||
        normalized.startsWith("../modals/")),
  );
}

function componentIdFromGeneratedModalSpecifier(
  specifier: string,
): string | undefined {
  if (!isGeneratedModalSpecifier(specifier)) return undefined;
  const normalized = specifier.split("\\").join("/");
  if (!normalized.includes(".modality/modals/")) return undefined;
  const last = normalized.split("/").at(-1);
  return last?.replace(/(\.d\.ts|\.ts|\.js)$/u, "");
}

function resolvedGeneratedModalModulePath(
  containingFile: string,
  specifier: string,
): string | undefined {
  if (!isGeneratedModalSpecifier(specifier)) return undefined;
  if (!specifier.startsWith(".")) return undefined;
  const basePath = resolve(dirname(containingFile), specifier);
  if (basePath.endsWith(".modals.ts")) return basePath;
  if (basePath.endsWith(".modals.js")) {
    return basePath.replace(/\.modals\.js$/u, ".modals.ts");
  }
  if (basePath.endsWith(".modals")) return `${basePath}.ts`;
  return undefined;
}

function localFieldNamesByComponent(model: Model): Map<string, Set<string>> {
  const byComponent = new Map<string, Set<string>>();
  for (const decl of model.vars) {
    if (!decl.id.startsWith("local:")) continue;
    const rest = decl.id.slice("local:".length);
    const dot = rest.indexOf(".");
    if (dot < 0) continue;
    const componentId = rest.slice(0, dot);
    const fieldName = rest.slice(dot + 1);
    const fields = byComponent.get(componentId) ?? new Set<string>();
    fields.add(fieldName);
    byComponent.set(componentId, fields);
  }
  return byComponent;
}

function localFieldNamesByGeneratedModule(
  model: Model,
  file: string,
): Map<string, Set<string>> {
  const appModelPath = join(dirname(file), ".modality", "app.model.ts");
  const byModule = new Map<string, Set<string>>();
  for (const module of emitComponentModalModules(model, appModelPath)) {
    const fields = new Set<string>();
    const sourceFile = ts.createSourceFile(
      module.path,
      module.source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          fields.add(declaration.name.text);
        }
      }
    }
    byModule.set(resolve(module.path), fields);
  }
  return byModule;
}

function generatedImportDiagnostics(
  sourceFile: ts.SourceFile,
  model: Model,
  file: string,
): SymbolRewriteDiagnostic[] {
  const localFields = localFieldNamesByComponent(model);
  const localFieldsByModule = localFieldNamesByGeneratedModule(model, file);
  const diagnostics: SymbolRewriteDiagnostic[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const modulePath = resolvedGeneratedModalModulePath(
      file,
      statement.moduleSpecifier.text,
    );
    const componentId = componentIdFromGeneratedModalSpecifier(
      statement.moduleSpecifier.text,
    );
    const namedBindings = statement.importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;
    const fields = modulePath
      ? localFieldsByModule.get(modulePath)
      : componentId
        ? (localFields.get(componentId) ?? new Set<string>())
        : undefined;
    if (!fields) continue;
    for (const specifier of namedBindings.elements) {
      const exportedName = specifier.propertyName?.text ?? specifier.name.text;
      if (fields.has(exportedName)) continue;
      diagnostics.push({
        symbol: specifier.name.text,
        file,
        message: `Could not resolve imported symbol "${specifier.name.text}" to a modeled state variable. Regenerate the component var module or use var(...) / s(Component).field instead.`,
      });
    }
  }

  return diagnostics;
}

function isImportedIdentifier(
  node: ts.Identifier,
  checker: ts.TypeChecker,
): boolean {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return false;
  const resolved = resolveAliasedSymbol(symbol, checker);
  return (resolved.getDeclarations() ?? []).some(
    (declaration) =>
      ts.isImportSpecifier(declaration) ||
      ts.isImportClause(declaration) ||
      ts.isNamespaceImport(declaration) ||
      declaration.getSourceFile().fileName !== node.getSourceFile().fileName,
  );
}

interface TextReplacement {
  start: number;
  end: number;
  text: string;
}

function applyReplacements(
  source: string,
  replacements: TextReplacement[],
): string {
  const sorted = [...replacements].sort(
    (left, right) => right.start - left.start,
  );
  let rewritten = source;
  for (const replacement of sorted) {
    rewritten =
      rewritten.slice(0, replacement.start) +
      replacement.text +
      rewritten.slice(replacement.end);
  }
  return rewritten;
}

function generatedComponentVarEntries(
  propsPath: string,
  model: Model,
): SemanticSourceEntry[] {
  const propsDir = dirname(resolve(propsPath));
  const appModelPath = join(propsDir, ".modality", "app.model.ts");
  const modalsDirs = [
    join(propsDir, ".modality", "modals"),
    join(propsDir, "modals"),
  ];
  const entries: SemanticSourceEntry[] = [];
  for (const module of emitComponentModalModules(model, appModelPath)) {
    entries.push({
      path: module.path,
      text: module.source,
    });
    for (const modalsDir of modalsDirs) {
      entries.push({
        path: join(modalsDir, module.fileName),
        text: module.source,
      });
    }
  }
  return entries;
}

function ensureStateVarImport(
  source: string,
  sourceFile: ts.SourceFile,
): string {
  if (!source.includes("variable(")) return source;
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const text = statement.getText(sourceFile);
    if (text.includes("variable")) return source;
    if (
      text.includes("modality-ts/properties") ||
      text.includes("modality-ts/core")
    ) {
      const next = text.replace(/\{([^}]*)\}/, (_match, imports: string) => {
        if (imports.includes("variable")) return `{${imports}}`;
        const trimmed = imports.trim().replace(/,\s*$/u, "");
        return trimmed.length > 0 ? `{ ${trimmed}, variable }` : "{ variable }";
      });
      return source.replace(text, next);
    }
  }
  return `import { variable } from "modality-ts/properties";\n${source}`;
}

export async function rewriteImportedSymbols(
  propsPath: string,
  model: Model,
): Promise<RewriteImportedSymbolsResult> {
  const source = await readFile(propsPath, "utf8");
  const varAnchors = model.metadata?.varAnchors ?? {};

  const resolvedPropsPath = resolve(propsPath);
  const config = loadSemanticProjectConfig(dirname(resolvedPropsPath));
  const project = createSemanticProject(
    [
      { path: resolvedPropsPath, text: source },
      ...generatedComponentVarEntries(resolvedPropsPath, model),
    ],
    config,
  );
  const sourceFile = project.getSourceFile(resolvedPropsPath);
  if (!sourceFile) {
    return { source, diagnostics: [] };
  }

  const anchorIndex = buildAnchorIndex(varAnchors);
  const replacements: TextReplacement[] = [];
  const diagnostics: SymbolRewriteDiagnostic[] = generatedImportDiagnostics(
    sourceFile,
    model,
    resolvedPropsPath,
  );
  const checker = project.checker;
  const rewrittenNodes = new Set<ts.Node>();

  const rewrittenSymbolNames = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (rewrittenNodes.has(node)) return;
    if (ts.isIdentifier(node)) {
      if (isBindingIdentifier(node) || isComponentAccessorArgument(node)) {
        ts.forEachChild(node, visit);
        return;
      }
      const parent = node.parent;
      if (
        parent &&
        ts.isPropertyAccessExpression(parent) &&
        parent.name === node
      ) {
        ts.forEachChild(node, visit);
        return;
      }
      if (isModalityPackageImport(node, checker)) {
        // Real package exports (`modality-ts/properties`, `modality-ts/vars`, …) are
        // genuine handles/builders — never rewrite or flag them.
        ts.forEachChild(node, visit);
        return;
      }
      const importSpecifier = importModuleSpecifierForIdentifier(node, checker);
      const varId =
        handleVarIdForIdentifier(node, checker) ??
        modeledVarIdForIdentifier(node, checker, anchorIndex);
      if (varId) {
        replacements.push({
          start: node.getStart(),
          end: node.getEnd(),
          text: `variable(${JSON.stringify(varId)})`,
        });
        rewrittenSymbolNames.add(node.text);
        rewrittenNodes.add(node);
        return;
      }
      const transitionId = handleTransitionIdForIdentifier(node, checker);
      if (transitionId) {
        replacements.push({
          start: node.getStart(),
          end: node.getEnd(),
          text: JSON.stringify(transitionId),
        });
        rewrittenSymbolNames.add(node.text);
        rewrittenNodes.add(node);
        return;
      }
      if (
        isImportedIdentifier(node, checker) &&
        (anchorIndex.size > 0 || isGeneratedModalSpecifier(importSpecifier))
      ) {
        diagnostics.push({
          symbol: node.text,
          file: resolvedPropsPath,
          message: `Could not resolve imported symbol "${node.text}" to a modeled state variable. Declare it in source so extraction records a var anchor, or use var(...) / s(Component).field instead.`,
        });
      }
      ts.forEachChild(node, visit);
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (diagnostics.length > 0) {
    throw new Error(
      diagnostics.map((entry) => `${entry.file}: ${entry.message}`).join("\n"),
    );
  }

  if (replacements.length === 0) {
    return { source, diagnostics };
  }

  let rewritten = applyReplacements(source, replacements);
  rewritten = ensureStateVarImport(rewritten, sourceFile);
  rewritten = removeRewrittenImports(rewritten, rewrittenSymbolNames);
  return { source: rewritten, diagnostics };
}

function removeRewrittenImports(
  source: string,
  symbols: ReadonlySet<string>,
): string {
  if (symbols.size === 0) return source;
  const sourceFile = ts.createSourceFile(
    "rewritten-props.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const replacements: TextReplacement[] = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const importClause = statement.importClause;
    const namedBindings = importClause?.namedBindings;
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue;

    const remaining = namedBindings.elements.filter(
      (specifier) => !symbols.has(specifier.name.text),
    );
    if (remaining.length === namedBindings.elements.length) continue;

    if (remaining.length > 0) {
      replacements.push({
        start: namedBindings.getStart(sourceFile),
        end: namedBindings.getEnd(),
        text: `{ ${remaining.map((specifier) => specifier.getText(sourceFile)).join(", ")} }`,
      });
      continue;
    }

    if (importClause.name) {
      replacements.push({
        start: importClause.getStart(sourceFile),
        end: importClause.getEnd(),
        text: importClause.name.getText(sourceFile),
      });
      continue;
    }

    let end = statement.getEnd();
    while (end < source.length && /[ \t]/.test(source[end] ?? "")) end += 1;
    if (source.startsWith("\r\n", end)) {
      end += 2;
    } else if (source[end] === "\n") {
      end += 1;
    }
    replacements.push({
      start: statement.getStart(sourceFile),
      end,
      text: "",
    });
  }

  return applyReplacements(source, replacements);
}
