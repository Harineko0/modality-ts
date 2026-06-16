import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import * as ts from "typescript";
import type {
  ImportEdgeContext,
  ModuleClassification,
  ModuleEntryExport,
  ModuleExtractionSurface,
  ModuleDirective,
  ModuleRuntimeContext,
  NavigationAdapter,
  RouteInventory,
  RouteNode,
} from "modality-ts/extract/engine/spi";

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

export interface TsConfigResolution {
  baseUrl?: string;
  paths: Array<{ prefix: string; suffix: string; targets: string[] }>;
}

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

function defaultClassification(): ModuleClassification {
  return { defaultContext: "unknown" };
}

function classifyModule(
  adapter: NavigationAdapter | undefined,
  path: string,
  text: string,
  route?: RouteNode,
): ModuleClassification {
  if (adapter?.classifyModule) {
    return adapter.classifyModule({ fileName: path, sourceText: text, route });
  }
  const directives = parseModuleDirectives(text);
  if (directives.includes("use client"))
    return { defaultContext: "client", directives };
  if (directives.includes("use server"))
    return { defaultContext: "server", serverOnly: true, directives };
  return defaultClassification();
}

function moduleEntryExports(
  adapter: NavigationAdapter | undefined,
  path: string,
  text: string,
  route?: RouteNode,
): readonly ModuleEntryExport[] {
  if (adapter?.moduleEntryExports) {
    return adapter.moduleEntryExports({
      fileName: path,
      sourceText: text,
      route,
    });
  }
  return inferDefaultEntryExports(text, path);
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

async function followDeclarationReference(
  record: ModuleRecord,
  declName: string,
  tsconfig: TsConfigResolution,
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
    dirname(record.path),
    reexport.specifier,
    tsconfig,
  );
  if (!importedPath) return undefined;
  const target = await ensureModule(importedPath);
  if (!target) return undefined;
  return followDeclarationReference(
    target,
    reexport.exportedName,
    tsconfig,
    ensureModule,
    warnings,
  );
}

function classifyImportEdge(
  adapter: NavigationAdapter | undefined,
  ctx: Parameters<NonNullable<NavigationAdapter["classifyImportEdge"]>>[0],
): ImportEdgeContext {
  if (adapter?.classifyImportEdge) return adapter.classifyImportEdge(ctx);
  return ctx.isTypeOnly ? "type" : "unknown";
}

function isServerOnlyTarget(
  adapter: NavigationAdapter | undefined,
  path: string,
  classification: ModuleClassification,
): boolean {
  if (adapter?.isServerOnlyModule?.(path)) return true;
  return classification.serverOnly === true;
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
  tsconfig: TsConfigResolution,
  adapter?: NavigationAdapter,
  inventory?: RouteInventory,
): Promise<ReachableImportsResult> {
  const warnings: string[] = [];
  const modules = new Map<string, ModuleRecord>();
  const manifestEntry = entries.find((entry) => isManifestFile(entry.path));
  const manifestDir = manifestEntry
    ? dirname(resolve(manifestEntry.path))
    : undefined;
  const broadEntry = !inventory || inventory.routes.length === 0;
  const entryPaths = new Set(entries.map((entry) => resolve(entry.path)));

  const ensureModule = async (
    path: string,
    text?: string,
  ): Promise<ModuleRecord | undefined> => {
    const canonical = resolve(path);
    const existing = modules.get(canonical);
    if (existing) return existing;
    const sourceText = text ?? (await readFile(canonical, "utf8"));
    const route = routeForFile(canonical, inventory, manifestDir);
    const classification = classifyModule(
      adapter,
      canonical,
      sourceText,
      route,
    );
    const entryExports = moduleEntryExports(
      adapter,
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
    modules.set(canonical, record);
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
      entryPaths.has(resolve(record.path)),
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
    const record = modules.get(resolve(next.path));
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
            dirname(record.path),
            binding.specifier,
            tsconfig,
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

        const edgeContext = classifyImportEdge(adapter, {
          importer: record.path,
          specifier: binding.specifier,
          imported: binding.imported,
          isTypeOnly: binding.isTypeOnly,
          importerContext: record.classification.defaultContext,
          surface: next.surface,
        });

        if (edgeContext === "type") {
          record.typeImports.add(binding.local);
          continue;
        }

        if (edgeContext === "asset") {
          continue;
        }

        const importedPath = await resolveImportPath(
          dirname(record.path),
          binding.specifier,
          tsconfig,
        );
        if (!importedPath) continue;

        const target = await ensureModule(importedPath);
        if (!target) continue;

        if (
          next.surface === "interaction" &&
          isServerOnlyTarget(adapter, target.path, target.classification)
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
            !adapter?.classifyModule);

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

    if (adapter?.discoverEffectApis) {
      const serverSurface =
        record.classification.serverOnly === true ||
        record.classification.defaultContext === "server" ||
        (adapter.id === "next" &&
          record.classification.defaultContext === "shared");
      if (serverSurface && !record.isManifest) {
        for (const entry of adapter.discoverEffectApis({
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

  const effectApis = [
    ...new Set(effectApiProvenance.map((entry) => entry.opId)),
  ].sort();
  return { sources, warnings, effectApiProvenance, effectApis };
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
  baseDir: string,
  specifier: string,
  tsconfig: TsConfigResolution,
): Promise<string | undefined> {
  if (specifier.startsWith("./+types/") || specifier.startsWith("../+types/"))
    return undefined;
  const bases = importBases(baseDir, specifier, tsconfig);
  for (const base of bases) {
    const resolved = await firstExistingModulePath(base);
    if (resolved) return resolved;
  }
  return undefined;
}

function importBases(
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

async function firstExistingModulePath(
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
