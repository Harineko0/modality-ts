import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import * as ts from "typescript";
import type {
  EffectApiProvider,
  EffectApiSurfaceCtx,
  ImportEdgeContext,
  ImportEdgeCtx,
  ModuleClassification,
  ModuleEntryExport,
  ModuleExtractionSurface,
  ModuleDirective,
  ModuleRoleAdapter,
  ModuleRuntimeContext,
  NavigationAdapter,
  RouteInventory,
  RouteNode,
} from "modality-ts/extract/engine/spi";
import {
  allEffectOpAliasCanonicalIds,
  type EffectOpAliases,
  normalizeSourcePath,
} from "../../../extract/engine/ts/effect-op-aliases.js";
import type {
  SemanticModuleResolver,
  SemanticProjectTsConfig,
} from "../../../extract/engine/ts/semantic-project.js";

export type { SemanticModuleResolver };

function parseModuleDirectives(sourceText: string): ModuleDirective[] {
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

export interface TsConfigResolution extends SemanticProjectTsConfig {}

export interface ProjectSourceEntry {
  path: string;
  text: string;
  interactionText: string;
  renderText: string;
  included: boolean;
  excludedReason?: string;
}

export interface EffectApiProvenanceEntry {
  opId: string;
  source: { file: string; line: number; column: number };
}

export interface ReachableImportsResult {
  sources: ProjectSourceEntry[];
  warnings: string[];
  effectApiProvenance: EffectApiProvenanceEntry[];
  effectApis: string[];
  effectOpAliases: EffectOpAliases;
}

type Surface = ModuleExtractionSurface;

interface ImportBinding {
  local: string;
  imported?: string;
  specifier: string;
  isTypeOnly: boolean;
}

interface ModuleRecord {
  path: string;
  text: string;
  classification: ModuleClassification;
  entryExports: readonly ModuleEntryExport[];
  route?: RouteNode;
  isManifest: boolean;
  renderDecls: Set<string>;
  interactionDecls: Set<string>;
  renderImports: Set<string>;
  interactionImports: Set<string>;
  typeDecls: Set<string>;
  typeImports: Set<string>;
}

function isManifestFile(path: string): boolean {
  return path.endsWith("routes.ts");
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function isHookName(name: string): boolean {
  return (
    name.startsWith("use") && name.length > 3 && /^[A-Z]/.test(name[3] ?? "")
  );
}

function isLocalImportSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("~/");
}

function createSourceFile(fileName: string, sourceText: string): ts.SourceFile {
  const kind = [".tsx", ".jsx"].includes(extname(fileName))
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
}

export interface SourceWithReachableImportsOptions {
  navigation?: NavigationAdapter;
  moduleRoleAdapters?: readonly ModuleRoleAdapter[];
  effectApiProviders?: readonly EffectApiProvider[];
  inventory?: RouteInventory;
}

const EXPLICIT_MODULE_CONTEXTS = new Set<ModuleRuntimeContext>([
  "client",
  "server",
  "shared",
  "type",
]);

const IMPORT_EDGE_PRIORITY: Record<ImportEdgeContext, number> = {
  unknown: 0,
  "client-value": 1,
  "server-value": 1,
  "render-value": 1,
  type: 2,
  asset: 2,
};

function mergeModuleClassifications(
  results: readonly ModuleClassification[],
  warnings: string[],
  path: string,
): ModuleClassification {
  const directives = [
    ...new Set(results.flatMap((result) => result.directives ?? [])),
  ];
  const serverOnly = results.some((result) => result.serverOnly === true);
  const explicit = results.filter((result) =>
    EXPLICIT_MODULE_CONTEXTS.has(result.defaultContext as ModuleRuntimeContext),
  );
  let defaultContext: ModuleClassification["defaultContext"] = "unknown";
  if (explicit.length === 1) {
    defaultContext = explicit[0]!.defaultContext;
  } else if (explicit.length > 1) {
    const contexts = [
      ...new Set(explicit.map((result) => result.defaultContext)),
    ];
    if (contexts.length === 1) {
      defaultContext = contexts[0]!;
    } else {
      warnings.push(
        `Conflicting module classifications for ${path}: ${contexts.sort().join(", ")}`,
      );
      defaultContext = [...contexts].sort()[0]!;
    }
  }
  return {
    defaultContext,
    ...(directives.length > 0 ? { directives } : {}),
    ...(serverOnly ? { serverOnly: true } : {}),
  };
}

function classifyModuleFromProviders(
  adapters: readonly ModuleRoleAdapter[],
  path: string,
  text: string,
  route: RouteNode | undefined,
  warnings: string[],
): ModuleClassification {
  if (adapters.length === 0) {
    const directives = parseModuleDirectives(text);
    if (directives.includes("use client"))
      return { defaultContext: "client", directives };
    if (directives.includes("use server"))
      return { defaultContext: "server", serverOnly: true, directives };
    return defaultClassification();
  }
  const ctx = { fileName: path, sourceText: text, route };
  const results = adapters.map((adapter) => adapter.classifyModule(ctx));
  return mergeModuleClassifications(results, warnings, path);
}

function moduleEntryExportsFromProviders(
  adapters: readonly ModuleRoleAdapter[],
  path: string,
  text: string,
  route: RouteNode | undefined,
): readonly ModuleEntryExport[] {
  if (adapters.length === 0) return inferDefaultEntryExports(text, path);
  const ctx = { fileName: path, sourceText: text, route };
  const byName = new Map<string, ModuleEntryExport>();
  for (const adapter of [...adapters].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    for (const entry of adapter.moduleEntryExports(ctx)) {
      const key = entry.name === "default" ? "default" : entry.name;
      if (!byName.has(key)) byName.set(key, entry);
    }
  }
  if (byName.size === 0) return inferDefaultEntryExports(text, path);
  return [...byName.values()].sort((left, right) => {
    const leftKey = left.name === "default" ? "" : left.name;
    const rightKey = right.name === "default" ? "" : right.name;
    return leftKey.localeCompare(rightKey);
  });
}

function classifyImportEdgeFromProviders(
  adapters: readonly ModuleRoleAdapter[],
  ctx: ImportEdgeCtx,
  warnings: string[],
): ImportEdgeContext {
  if (adapters.length === 0) return ctx.isTypeOnly ? "type" : "unknown";
  const results = adapters.map((adapter) => adapter.classifyImportEdge(ctx));
  const nonUnknown = results.filter((result) => result !== "unknown");
  if (nonUnknown.length === 0) return ctx.isTypeOnly ? "type" : "unknown";
  const unique = [...new Set(nonUnknown)];
  if (unique.length === 1) return unique[0]!;
  const ranked = [...unique].sort(
    (left, right) => IMPORT_EDGE_PRIORITY[right] - IMPORT_EDGE_PRIORITY[left],
  );
  if (IMPORT_EDGE_PRIORITY[ranked[0]!]! > IMPORT_EDGE_PRIORITY[ranked[1]!]!) {
    return ranked[0]!;
  }
  warnings.push(
    `Conflicting import edge classifications for ${ctx.specifier} in ${ctx.importer}`,
  );
  return [...unique].sort()[0]!;
}

function isServerOnlyTarget(
  adapters: readonly ModuleRoleAdapter[],
  path: string,
  classification: ModuleClassification,
): boolean {
  if (classification.serverOnly === true) return true;
  return adapters.some((adapter) =>
    adapter.isServerOnlyModule(path, classification),
  );
}

function shouldDiscoverEffectApis(
  adapters: readonly ModuleRoleAdapter[],
  ctx: EffectApiSurfaceCtx,
): boolean {
  const withHook = adapters.filter(
    (adapter) => adapter.shouldDiscoverEffectApis !== undefined,
  );
  if (withHook.length > 0) {
    return withHook.some((adapter) => adapter.shouldDiscoverEffectApis!(ctx));
  }
  return (
    ctx.classification.serverOnly === true ||
    ctx.classification.defaultContext === "server"
  );
}

function defaultClassification(): ModuleClassification {
  return { defaultContext: "unknown" };
}

function inferDefaultEntryExports(
  text: string,
  path: string,
): readonly ModuleEntryExport[] {
  const sourceFile = createSourceFile(path, text);
  const entries: ModuleEntryExport[] = [];
  const seen = new Set<string>();
  const add = (name: ModuleEntryExport["name"], reason: string): void => {
    const key = name === "default" ? "default" : name;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ name, context: "client", reason });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      add("default", "default export");
      continue;
    }
    if (!ts.canHaveModifiers(statement)) continue;
    const exported = statement.modifiers?.some(
      (mod) => mod.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    const isDefault = statement.modifiers?.some(
      (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword,
    );
    if (isDefault) {
      add("default", "default export");
      continue;
    }
    const name = topLevelDeclName(statement);
    if (!name) continue;
    if (isPascalCase(name) || isHookName(name))
      add(name, "exported client symbol");
  }
  return entries;
}

function isAnonymousDefaultExport(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    statement.modifiers?.some(
      (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword,
    ) === true &&
    !topLevelDeclName(statement) &&
    (ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isVariableStatement(statement))
  );
}

function topLevelDeclName(statement: ts.Statement): string | undefined {
  if (ts.isFunctionDeclaration(statement) && statement.name)
    return statement.name.text;
  if (ts.isVariableStatement(statement)) {
    const decl = statement.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name)) return decl.name.text;
  }
  if (ts.isClassDeclaration(statement) && statement.name)
    return statement.name.text;
  if (ts.isInterfaceDeclaration(statement)) return statement.name.text;
  if (ts.isTypeAliasDeclaration(statement)) return statement.name.text;
  if (ts.isEnumDeclaration(statement)) return statement.name.text;
  return undefined;
}

function exportContextForDecl(
  name: string,
  isDefault: boolean,
  entryExports: readonly ModuleEntryExport[],
): ModuleRuntimeContext | "unknown" {
  if (isDefault) {
    const entry = entryExports.find((item) => item.name === "default");
    return entry?.context ?? "client";
  }
  const entry = entryExports.find((item) => item.name === name);
  return entry?.context ?? "unknown";
}

function seedsForModule(
  record: ModuleRecord,
  broadEntry: boolean,
  isEntry: boolean,
): { render: Set<string>; interaction: Set<string> } {
  const render = new Set<string>();
  const interaction = new Set<string>();
  if (record.isManifest) return { render, interaction };

  const sourceFile = createSourceFile(record.path, record.text);
  const hasEntryExports = record.entryExports.length > 0;
  const useBroadEntry = broadEntry && isEntry;

  for (const statement of sourceFile.statements) {
    const name = topLevelDeclName(statement);
    const isDefault =
      (ts.canHaveModifiers(statement) &&
        statement.modifiers?.some(
          (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword,
        )) ??
      false;
    const exported =
      isDefault ||
      ((ts.canHaveModifiers(statement) &&
        statement.modifiers?.some(
          (mod) => mod.kind === ts.SyntaxKind.ExportKeyword,
        )) ??
        false) ||
      ts.isExportAssignment(statement);

    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (name) record.typeDecls.add(name);
      continue;
    }

    if (!name && !ts.isExportAssignment(statement)) {
      if (isAnonymousDefaultExport(statement)) {
        render.add("default");
        interaction.add("default");
      }
      continue;
    }

    if (useBroadEntry || (broadEntry && !hasEntryExports)) {
      if (name) {
        render.add(name);
        interaction.add(name);
      } else if (ts.isExportAssignment(statement)) {
        render.add("default");
        interaction.add("default");
      }
      continue;
    }

    const declName = ts.isExportAssignment(statement) ? "default" : name;
    if (!declName) continue;

    const context = exportContextForDecl(
      declName,
      isDefault || ts.isExportAssignment(statement),
      record.entryExports,
    );

    if (context === "server") {
      render.add(declName);
      continue;
    }
    if (context === "type") {
      record.typeDecls.add(declName);
      continue;
    }
    if (context === "client" || context === "shared" || context === "unknown") {
      render.add(declName);
      interaction.add(declName);
    }
  }

  if (!useBroadEntry && render.size === 0 && interaction.size === 0) {
    for (const statement of sourceFile.statements) {
      if (isAnonymousDefaultExport(statement)) {
        render.add("default");
        interaction.add("default");
        continue;
      }
      const name = topLevelDeclName(statement);
      if (!name) continue;
      if (
        ts.isTypeAliasDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement)
      ) {
        record.typeDecls.add(name);
        continue;
      }
      render.add(name);
      interaction.add(name);
    }
  }

  return { render, interaction };
}

function parseImportBindings(
  node: ts.ImportDeclaration,
  localOnly = false,
): ImportBinding[] {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return [];
  const specifier = node.moduleSpecifier.text;
  if (localOnly && !isLocalImportSpecifier(specifier)) return [];
  const isTypeOnly =
    node.importClause?.isTypeOnly === true ||
    (node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.every((el) => el.isTypeOnly));
  const bindings: ImportBinding[] = [];
  const clause = node.importClause;
  if (!clause) {
    bindings.push({ local: "*", specifier, isTypeOnly: false });
    return bindings;
  }
  if (clause.name) {
    bindings.push({
      local: clause.name.text,
      specifier,
      isTypeOnly: clause.isTypeOnly === true,
    });
  }
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({
        local: clause.namedBindings.name.text,
        specifier,
        isTypeOnly: false,
      });
    } else if (ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const local = (element.name ?? element.propertyName)?.text;
        if (!local) continue;
        bindings.push({
          local,
          imported: element.propertyName?.text ?? local,
          specifier,
          isTypeOnly: element.isTypeOnly === true || clause.isTypeOnly === true,
        });
      }
    }
  }
  return bindings;
}

function collectImportBindings(
  sourceFile: ts.SourceFile,
  localOnly = false,
): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement))
      bindings.push(...parseImportBindings(statement, localOnly));
  }
  return bindings;
}

function referencedIdentifiers(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): Set<string> {
  const ids = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isIdentifier(current) && current.parent !== node) {
      if (
        current.parent &&
        ts.isPropertyAccessExpression(current.parent) &&
        current.parent.expression === current
      ) {
        // keep root identifier only
      } else if (
        !(
          ts.isPropertyAccessExpression(current.parent) &&
          current.parent.name === current
        )
      ) {
        ids.add(current.text);
      }
    }
    if (
      ts.isJsxOpeningElement(current) ||
      ts.isJsxSelfClosingElement(current)
    ) {
      const tag = current.tagName;
      if (ts.isIdentifier(tag) && isPascalCase(tag.text)) ids.add(tag.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return ids;
}

function findTopLevelDeclaration(
  sourceFile: ts.SourceFile,
  name: string,
): ts.Statement | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement) && name === "default")
      return statement;
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (ts.isNamedExports(statement.exportClause)) {
        const matches = statement.exportClause.elements.some(
          (element) => (element.name ?? element.propertyName)?.text === name,
        );
        if (matches) return statement;
      }
    }
    const declName = topLevelDeclName(statement);
    if (declName === name) return statement;
    if (
      name === "default" &&
      ts.canHaveModifiers(statement) &&
      statement.modifiers?.some(
        (mod) => mod.kind === ts.SyntaxKind.DefaultKeyword,
      )
    ) {
      return statement;
    }
  }
  return undefined;
}

function resolveReExportTarget(
  statement: ts.ExportDeclaration,
  localName: string,
): { specifier: string; exportedName: string } | undefined {
  if (
    !statement.moduleSpecifier ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  )
    return undefined;
  if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
    return undefined;
  const element = statement.exportClause.elements.find(
    (entry) => (entry.name ?? entry.propertyName)?.text === localName,
  );
  if (!element) return undefined;
  return {
    specifier: statement.moduleSpecifier.text,
    exportedName: element.propertyName?.text ?? localName,
  };
}

function isSemanticModuleResolver(
  value: SemanticModuleResolver | TsConfigResolution,
): value is SemanticModuleResolver {
  return (
    typeof (value as SemanticModuleResolver).resolveModuleName === "function"
  );
}

function moduleKey(
  path: string,
  moduleResolver?: SemanticModuleResolver,
): string {
  const resolved = resolve(path);
  return moduleResolver ? moduleResolver.canonicalFileName(resolved) : resolved;
}

function storagePath(path: string): string {
  return resolve(path);
}

function unresolvedModuleWarning(
  kind: "import" | "re-export" | "server-action",
  specifier: string,
  containingFile: string,
): string {
  return `Unresolved ${kind} "${specifier}" in ${containingFile}`;
}

async function followDeclarationReference(
  record: ModuleRecord,
  declName: string,
  moduleResolver: SemanticModuleResolver | undefined,
  tsconfig: TsConfigResolution | undefined,
  ensureModule: (
    path: string,
    text?: string,
  ) => Promise<ModuleRecord | undefined>,
  warnings: string[],
): Promise<{ module: ModuleRecord; declName: string } | undefined> {
  const sourceFile = createSourceFile(record.path, record.text);
  const decl = findTopLevelDeclaration(sourceFile, declName);
  if (!decl || !ts.isExportDeclaration(decl))
    return { module: record, declName };
  const reexport = resolveReExportTarget(decl, declName);
  if (!reexport) {
    warnings.push(
      `Over-approximating unresolved re-export ${declName} in ${record.path}`,
    );
    return { module: record, declName };
  }
  const importedPath = await resolveImportPath(
    record.path,
    reexport.specifier,
    moduleResolver,
    tsconfig,
    warnings,
    "re-export",
  );
  if (!importedPath) return undefined;
  const target = await ensureModule(importedPath);
  if (!target) return undefined;
  return followDeclarationReference(
    target,
    reexport.exportedName,
    moduleResolver,
    tsconfig,
    ensureModule,
    warnings,
  );
}

function classifyImportEdge(
  adapters: readonly ModuleRoleAdapter[],
  ctx: ImportEdgeCtx,
  warnings: string[],
): ImportEdgeContext {
  return classifyImportEdgeFromProviders(adapters, ctx, warnings);
}

function statementIncludedInSurface(
  statement: ts.Statement,
  declNames: Set<string>,
  importLocals: Set<string>,
  typeDeclNames: Set<string>,
  typeImportLocals: Set<string>,
): boolean {
  if (ts.isImportDeclaration(statement)) {
    const bindings = parseImportBindings(statement, false);
    return bindings.some((binding) =>
      binding.isTypeOnly
        ? typeImportLocals.has(binding.local)
        : importLocals.has(binding.local),
    );
  }
  if (ts.isExportDeclaration(statement) && statement.exportClause) {
    if (ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.some((element) => {
        const local = (element.name ?? element.propertyName)?.text;
        return local ? declNames.has(local) : false;
      });
    }
  }
  if (ts.isExportAssignment(statement)) return declNames.has("default");
  if (isAnonymousDefaultExport(statement)) return declNames.has("default");
  const name = topLevelDeclName(statement);
  if (name && declNames.has(name)) return true;
  return (
    name !== undefined &&
    typeDeclNames.has(name) &&
    (ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isEnumDeclaration(statement))
  );
}

function buildSurfaceText(
  sourceText: string,
  sourceFile: ts.SourceFile,
  declNames: Set<string>,
  importLocals: Set<string>,
  typeDeclNames: Set<string>,
  typeImportLocals: Set<string>,
): string {
  const includedLines = new Set<number>();
  const lines = sourceText.split(/\r?\n/);

  for (const statement of sourceFile.statements) {
    if (
      !statementIncludedInSurface(
        statement,
        declNames,
        importLocals,
        typeDeclNames,
        typeImportLocals,
      )
    ) {
      continue;
    }
    const start = sourceFile.getLineAndCharacterOfPosition(
      statement.getStart(),
    );
    const end = sourceFile.getLineAndCharacterOfPosition(statement.getEnd());
    for (let line = start.line; line <= end.line; line += 1) {
      includedLines.add(line);
    }
  }

  return lines
    .map((line, index) => (includedLines.has(index) ? line : ""))
    .join("\n");
}

function collectTypeReferences(node: ts.Node): Set<string> {
  const refs = new Set<string>();
  const visit = (current: ts.Node): void => {
    if (ts.isTypeReferenceNode(current) && ts.isIdentifier(current.typeName)) {
      refs.add(current.typeName.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return refs;
}

function expandTypeDependencies(record: ModuleRecord): void {
  const sourceFile = createSourceFile(record.path, record.text);
  let changed = true;
  while (changed) {
    changed = false;
    for (const typeName of [...record.typeDecls]) {
      const decl = findTopLevelDeclaration(sourceFile, typeName);
      if (!decl) continue;
      for (const ref of collectTypeReferences(decl)) {
        const refDecl = findTopLevelDeclaration(sourceFile, ref);
        if (
          refDecl &&
          (ts.isTypeAliasDeclaration(refDecl) ||
            ts.isInterfaceDeclaration(refDecl) ||
            ts.isEnumDeclaration(refDecl)) &&
          !record.typeDecls.has(ref)
        ) {
          record.typeDecls.add(ref);
          changed = true;
        }
      }
    }
  }
}

function syncReferencedImports(record: ModuleRecord, surface: Surface): void {
  const declSet =
    surface === "render" ? record.renderDecls : record.interactionDecls;
  const importSet =
    surface === "render" ? record.renderImports : record.interactionImports;
  const sourceFile = createSourceFile(record.path, record.text);
  const importBindings = collectImportBindings(sourceFile, false);
  for (const declName of declSet) {
    const decl = findTopLevelDeclaration(sourceFile, declName);
    if (!decl) continue;
    for (const ref of referencedIdentifiers(decl, sourceFile)) {
      const binding = importBindings.find((item) => item.local === ref);
      if (binding) importSet.add(binding.local);
    }
  }
}

function routeForFile(
  path: string,
  inventory: RouteInventory | undefined,
  manifestDir: string | undefined,
): RouteNode | undefined {
  if (!inventory || !manifestDir) return undefined;
  const resolved = resolve(path);
  return inventory.routes.find((node) => {
    if (!node.file) return false;
    return resolve(manifestDir, node.file) === resolved;
  });
}

export async function sourceWithReachableImports(
  entries: Array<{ path: string; text: string }>,
  moduleResolverOrTsconfig: SemanticModuleResolver | TsConfigResolution,
  options: SourceWithReachableImportsOptions = {},
): Promise<ReachableImportsResult> {
  const moduleResolver = isSemanticModuleResolver(moduleResolverOrTsconfig)
    ? moduleResolverOrTsconfig
    : undefined;
  const tsconfig = isSemanticModuleResolver(moduleResolverOrTsconfig)
    ? undefined
    : moduleResolverOrTsconfig;
  const warnings: string[] = [];
  const moduleRoleAdapters = options.moduleRoleAdapters ?? [];
  const effectApiProviders = options.effectApiProviders ?? [];
  const inventory = options.inventory;
  const modules = new Map<string, ModuleRecord>();
  const manifestEntry = entries.find((entry) => isManifestFile(entry.path));
  const manifestDir = manifestEntry
    ? dirname(resolve(manifestEntry.path))
    : undefined;
  const broadEntry = !inventory || inventory.routes.length === 0;
  const entryPaths = new Set(
    entries.map((entry) => moduleKey(entry.path, moduleResolver)),
  );

  const ensureModule = async (
    path: string,
    text?: string,
  ): Promise<ModuleRecord | undefined> => {
    const canonical = storagePath(path);
    const key = moduleKey(canonical, moduleResolver);
    const existing = modules.get(key);
    if (existing) return existing;
    const sourceText = text ?? (await readFile(canonical, "utf8"));
    const route = routeForFile(canonical, inventory, manifestDir);
    const classification = classifyModuleFromProviders(
      moduleRoleAdapters,
      canonical,
      sourceText,
      route,
      warnings,
    );
    const entryExports = moduleEntryExportsFromProviders(
      moduleRoleAdapters,
      canonical,
      sourceText,
      route,
    );
    const record: ModuleRecord = {
      path: canonical,
      text: sourceText,
      classification,
      entryExports,
      route,
      isManifest: isManifestFile(canonical),
      renderDecls: new Set(),
      interactionDecls: new Set(),
      renderImports: new Set(),
      interactionImports: new Set(),
      typeDecls: new Set(),
      typeImports: new Set(),
    };
    modules.set(key, record);
    return record;
  };

  for (const entry of entries) {
    await ensureModule(entry.path, entry.text);
  }

  const queue: Array<{ path: string; surface: Surface }> = [];
  for (const record of modules.values()) {
    const seeds = seedsForModule(
      record,
      broadEntry,
      entryPaths.has(moduleKey(record.path, moduleResolver)),
    );
    for (const name of seeds.render) record.renderDecls.add(name);
    for (const name of seeds.interaction) record.interactionDecls.add(name);
    if (record.renderDecls.size > 0)
      queue.push({ path: record.path, surface: "render" });
    if (record.interactionDecls.size > 0)
      queue.push({ path: record.path, surface: "interaction" });
  }

  const fixpoint = (
    record: ModuleRecord,
    surface: Surface,
    declName: string,
  ): void => {
    const declSet =
      surface === "render" ? record.renderDecls : record.interactionDecls;
    if (declSet.has(declName)) return;
    declSet.add(declName);
    queue.push({ path: record.path, surface });
  };

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const record = modules.get(moduleKey(next.path, moduleResolver));
    if (!record || record.isManifest) continue;
    const declSet =
      next.surface === "render" ? record.renderDecls : record.interactionDecls;
    const importSet =
      next.surface === "render"
        ? record.renderImports
        : record.interactionImports;
    const sourceFile = createSourceFile(record.path, record.text);
    const importBindings = collectImportBindings(sourceFile, true);

    for (const declName of [...declSet]) {
      const decl = findTopLevelDeclaration(sourceFile, declName);
      if (!decl) continue;
      const refs = referencedIdentifiers(decl, sourceFile);
      for (const ref of refs) {
        const localDecl = findTopLevelDeclaration(sourceFile, ref);
        if (localDecl) {
          if (ts.isExportDeclaration(localDecl)) {
            const resolved = await followDeclarationReference(
              record,
              ref,
              moduleResolver,
              tsconfig,
              ensureModule,
              warnings,
            );
            if (resolved)
              fixpoint(resolved.module, next.surface, resolved.declName);
            continue;
          }
          fixpoint(record, next.surface, ref);
          continue;
        }
        const binding = importBindings.find((item) => item.local === ref);
        if (!binding) continue;

        if (
          binding.isTypeOnly ||
          (binding.local === ref && binding.isTypeOnly)
        ) {
          record.typeImports.add(binding.local);
          const importedPath = await resolveImportPath(
            record.path,
            binding.specifier,
            moduleResolver,
            tsconfig,
            warnings,
            "import",
          );
          if (!importedPath) continue;
          const target = await ensureModule(importedPath);
          if (!target) continue;
          const targetFile = createSourceFile(target.path, target.text);
          const importedName = binding.imported ?? binding.local;
          const typeDecl = findTopLevelDeclaration(targetFile, importedName);
          if (typeDecl && topLevelDeclName(typeDecl))
            target.typeDecls.add(topLevelDeclName(typeDecl)!);
          continue;
        }

        const edgeContext = classifyImportEdge(
          moduleRoleAdapters,
          {
            importer: record.path,
            specifier: binding.specifier,
            imported: binding.imported,
            isTypeOnly: binding.isTypeOnly,
            importerContext: record.classification.defaultContext,
            surface: next.surface,
          },
          warnings,
        );

        if (edgeContext === "type") {
          record.typeImports.add(binding.local);
          continue;
        }

        if (edgeContext === "asset") {
          continue;
        }

        const importedPath = await resolveImportPath(
          record.path,
          binding.specifier,
          moduleResolver,
          tsconfig,
          warnings,
          "import",
        );
        if (!importedPath) continue;

        const target = await ensureModule(importedPath);
        if (!target) continue;

        if (
          next.surface === "interaction" &&
          isServerOnlyTarget(
            moduleRoleAdapters,
            target.path,
            target.classification,
          )
        ) {
          warnings.push(
            `Client import skipped server-only module ${target.path} from ${record.path}`,
          );
          continue;
        }

        if (binding.local === "*" || !binding.imported) {
          warnings.push(
            `Over-approximating namespace import ${binding.specifier} in ${record.path}`,
          );
          const broadSeeds = seedsForModule(target, true, false);
          for (const name of broadSeeds.render) target.renderDecls.add(name);
          for (const name of broadSeeds.interaction)
            target.interactionDecls.add(name);
          importSet.add(binding.local);
          queue.push({ path: target.path, surface: next.surface });
          if (next.surface === "render" && isPascalCase(ref)) {
            for (const name of broadSeeds.interaction)
              target.interactionDecls.add(name);
            queue.push({ path: target.path, surface: "interaction" });
          }
          continue;
        }

        importSet.add(binding.local);
        const importedName = binding.imported ?? binding.local;
        const resolved = await followDeclarationReference(
          target,
          importedName,
          moduleResolver,
          tsconfig,
          ensureModule,
          warnings,
        );
        if (!resolved) continue;
        const promoteInteraction =
          isPascalCase(ref) &&
          (resolved.module.classification.defaultContext === "client" ||
            resolved.module.classification.defaultContext === "shared" ||
            resolved.module.classification.defaultContext === "unknown" ||
            !moduleRoleAdapters.length);

        if (promoteInteraction) {
          resolved.module.interactionDecls.add(resolved.declName);
          resolved.module.renderDecls.add(resolved.declName);
          queue.push({ path: resolved.module.path, surface: "interaction" });
          queue.push({ path: resolved.module.path, surface: "render" });
        } else {
          fixpoint(resolved.module, next.surface, resolved.declName);
        }
      }
    }
  }

  for (const record of [...modules.values()]) {
    expandTypeDependencies(record);
    syncReferencedImports(record, "render");
    syncReferencedImports(record, "interaction");
  }

  const effectApiProvenance: EffectApiProvenanceEntry[] = [];
  const sources: ProjectSourceEntry[] = [];

  for (const record of [...modules.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    const sourceFile = createSourceFile(record.path, record.text);
    const included =
      record.isManifest ||
      record.renderDecls.size > 0 ||
      record.interactionDecls.size > 0 ||
      record.typeDecls.size > 0;
    const renderText = record.isManifest
      ? ""
      : buildSurfaceText(
          record.text,
          sourceFile,
          record.renderDecls,
          record.renderImports,
          record.typeDecls,
          record.typeImports,
        );
    const interactionText = record.isManifest
      ? ""
      : buildSurfaceText(
          record.text,
          sourceFile,
          record.interactionDecls,
          record.interactionImports,
          record.typeDecls,
          record.typeImports,
        );

    if (interactionText) {
      for (const entry of discoverFetchOps(interactionText, record.path)) {
        effectApiProvenance.push(entry);
      }
    }

    const effectSurfaceCtx: EffectApiSurfaceCtx = {
      fileName: record.path,
      sourceText: record.text,
      route: record.route,
      classification: record.classification,
      entryExports: record.entryExports,
      isManifest: record.isManifest,
    };
    if (
      shouldDiscoverEffectApis(moduleRoleAdapters, effectSurfaceCtx) &&
      !record.isManifest
    ) {
      for (const provider of effectApiProviders) {
        for (const entry of provider.discoverEffectApis({
          fileName: record.path,
          sourceText: record.text,
          route: record.route,
          inventory,
        })) {
          effectApiProvenance.push({
            opId: entry.opId,
            source: entry.source,
          });
          if (entry.warning) warnings.push(entry.warning);
        }
      }
    }

    sources.push({
      path: record.path,
      text: record.text,
      renderText,
      interactionText,
      included,
      ...(record.classification.serverOnly &&
      interactionText.trim().length === 0
        ? { excludedReason: "server-only module" }
        : {}),
    });
  }

  const renderSurface = sources.some((entry) => entry.renderText.length > 0);
  if (!renderSurface && entries.length > 0) {
    warnings.push("No render surface found for requested extraction entries");
  }
  if (!sources.some((entry) => entry.interactionText.length > 0)) {
    warnings.push(
      "No interaction surface found; extraction may produce a zero-transition client model",
    );
  }

  const effectOpAliases = discoverServerActionImportAliases(
    modules,
    effectApiProvenance,
    moduleResolver,
    tsconfig,
  );
  const canonicalIds = new Set(effectApiProvenance.map((entry) => entry.opId));
  for (const canonical of allEffectOpAliasCanonicalIds(effectOpAliases))
    canonicalIds.add(canonical);
  const effectApis = [...canonicalIds].sort();
  return {
    sources,
    warnings: [...new Set(warnings)],
    effectApiProvenance,
    effectApis,
    effectOpAliases,
  };
}

function discoverFetchOps(
  sourceText: string,
  fileName: string,
): EffectApiProvenanceEntry[] {
  const sourceFile = createSourceFile(fileName, sourceText);
  const ops: EffectApiProvenanceEntry[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      const op = fetchOpId(node);
      if (op) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        ops.push({
          opId: op,
          source: {
            file: fileName,
            line: start.line + 1,
            column: start.character + 1,
          },
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ops;
}

function fetchOpId(call: ts.CallExpression): string | undefined {
  const first = call.arguments[0];
  if (!first) return undefined;
  const path = fetchPathValue(first);
  if (!path) return undefined;
  const method = fetchMethodValue(call.arguments[1]) ?? "GET";
  return `${method} ${path}`;
}

function fetchPathValue(expression: ts.Expression): string | undefined {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return normalizeFetchPath(expression.text);
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans)
      value += `:id${span.literal.text}`;
    return normalizeFetchPath(value);
  }
  return undefined;
}

function normalizeFetchPath(path: string): string {
  return (path.startsWith("/") ? path : `/${path}`).replace(
    /\/:param(?=\/|$)/g,
    "/:id",
  );
}

function fetchMethodValue(
  expression: ts.Expression | undefined,
): string | undefined {
  if (!expression || !ts.isObjectLiteralExpression(expression))
    return undefined;
  for (const prop of expression.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "method" &&
      ts.isStringLiteral(prop.initializer)
    ) {
      return prop.initializer.text.toUpperCase();
    }
  }
  return undefined;
}

async function resolveImportPath(
  containingFile: string,
  specifier: string,
  moduleResolver: SemanticModuleResolver | undefined,
  tsconfig: TsConfigResolution | undefined,
  warnings: string[],
  kind: "import" | "re-export" | "server-action",
): Promise<string | undefined> {
  if (specifier.startsWith("./+types/") || specifier.startsWith("../+types/"))
    return undefined;
  if (moduleResolver) {
    const resolved = moduleResolver.resolveModuleName(
      specifier,
      containingFile,
    );
    if (!resolved) {
      warnings.push(unresolvedModuleWarning(kind, specifier, containingFile));
      return undefined;
    }
    if (resolved.isExternal) return undefined;
    return storagePath(resolved.fileName);
  }
  if (!tsconfig) {
    warnings.push(unresolvedModuleWarning(kind, specifier, containingFile));
    return undefined;
  }
  const bases = fallbackImportBases(
    dirname(containingFile),
    specifier,
    tsconfig,
  );
  for (const base of bases) {
    const resolved = await fallbackFirstExistingModulePath(base);
    if (resolved) return resolved;
  }
  warnings.push(unresolvedModuleWarning(kind, specifier, containingFile));
  return undefined;
}

function fallbackImportBases(
  baseDir: string,
  specifier: string,
  tsconfig: TsConfigResolution,
): string[] {
  if (specifier.startsWith(".")) return [resolve(baseDir, specifier)];
  const matches = tsconfig.paths.flatMap((entry) => {
    if (
      !specifier.startsWith(entry.prefix) ||
      !specifier.endsWith(entry.suffix)
    )
      return [];
    const star = specifier.slice(
      entry.prefix.length,
      specifier.length - entry.suffix.length,
    );
    return entry.targets.map((target) => resolve(target.replace("*", star)));
  });
  if (matches.length > 0) return matches;
  return tsconfig.baseUrl ? [resolve(tsconfig.baseUrl, specifier)] : [];
}

async function fallbackFirstExistingModulePath(
  base: string,
): Promise<string | undefined> {
  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}.cts`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

function discoverServerActionImportAliases(
  modules: ReadonlyMap<string, ModuleRecord>,
  provenance: readonly EffectApiProvenanceEntry[],
  moduleResolver: SemanticModuleResolver | undefined,
  tsconfig: TsConfigResolution | undefined,
): Map<string, Map<string, string>> {
  const aliases = new Map<string, Map<string, string>>();
  const actionsByModule = new Map<string, Map<string, string>>();
  for (const entry of provenance) {
    if (!entry.opId.startsWith("ACTION ") || !entry.opId.includes("#"))
      continue;
    const exportName = entry.opId.slice(entry.opId.lastIndexOf("#") + 1);
    const modulePath = resolve(entry.source.file).split("\\").join("/");
    let byExport = actionsByModule.get(modulePath);
    if (!byExport) {
      byExport = new Map();
      actionsByModule.set(modulePath, byExport);
    }
    byExport.set(exportName, entry.opId);
  }
  for (const record of modules.values()) {
    if (record.classification.serverOnly) continue;
    const modulePath = normalizeSourcePath(record.path);
    const sourceFile = createSourceFile(record.path, record.text);
    const bindings = collectImportBindings(sourceFile, false);
    for (const binding of bindings) {
      if (binding.isTypeOnly || binding.local === "*") continue;
      if (!isLocalImportSpecifier(binding.specifier)) continue;
      let candidatePaths: string[];
      if (moduleResolver) {
        const resolved = moduleResolver.resolveModuleName(
          binding.specifier,
          record.path,
        );
        if (!resolved || resolved.isExternal) continue;
        candidatePaths = [storagePath(resolved.fileName)];
      } else {
        candidatePaths = fallbackImportBases(
          dirname(record.path),
          binding.specifier,
          tsconfig ?? { paths: [] },
        ).flatMap((base) => [
          resolve(base),
          `${resolve(base)}.ts`,
          `${resolve(base)}.tsx`,
        ]);
      }
      for (const candidate of candidatePaths) {
        const normalized = candidate.split("\\").join("/");
        const byExport = actionsByModule.get(normalized);
        if (!byExport) continue;
        const imported = binding.imported ?? binding.local;
        const canonical = byExport.get(imported);
        if (!canonical) continue;
        let perFile = aliases.get(modulePath);
        if (!perFile) {
          perFile = new Map();
          aliases.set(modulePath, perFile);
        }
        perFile.set(binding.local, canonical);
      }
    }
  }
  return aliases;
}
