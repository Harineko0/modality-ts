import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

/** Structural match for `TsConfigResolution` in cli/features/extract/project.ts */
export interface SemanticProjectTsConfig {
  baseUrl?: string;
  paths: Array<{ prefix: string; suffix: string; targets: string[] }>;
}

export interface SemanticProjectConfig {
  configFilePath?: string;
  configDir: string;
  parsedCommandLine: ts.ParsedCommandLine;
  projectReferences: readonly ts.ProjectReference[];
  rootNames: readonly string[];
}

export interface SemanticSourceEntry {
  path: string;
  text: string;
}

export interface ResolvedModuleName {
  fileName: string;
  sourceFile?: ts.SourceFile;
  isExternal: boolean;
}

export interface SemanticProject {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  config?: SemanticProjectConfig;
  canonicalFileName(fileName: string): string;
  getSourceFile(fileName: string): ts.SourceFile | undefined;
  resolveModuleName(
    specifier: string,
    containingFile: string,
  ): ResolvedModuleName | undefined;
  symbolAt(node: ts.Node): ts.Symbol | undefined;
  aliasedSymbolAt(node: ts.Node): ts.Symbol | undefined;
  symbolKey(symbol: ts.Symbol): string;
  localSymbolKey(node: ts.Node): string | undefined;
  getTypeAtLocation(node: ts.Node): ts.Type | undefined;
  getTypeFromTypeNode(node: ts.TypeNode): ts.Type | undefined;
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: false,
  };
}

function isSemanticProjectConfig(
  config: SemanticProjectConfig | SemanticProjectTsConfig,
): config is SemanticProjectConfig {
  return "parsedCommandLine" in config;
}

function pathPatternKey(entry: {
  prefix: string;
  suffix: string;
  targets: string[];
}): string {
  const hasStar = entry.targets.some((target) => target.includes("*"));
  return hasStar ? `${entry.prefix}*${entry.suffix}` : entry.prefix;
}

function compilerOptionsFromLegacyTsConfig(
  tsconfig: SemanticProjectTsConfig,
): ts.CompilerOptions {
  const baseUrl = tsconfig.baseUrl;
  const paths: Record<string, string[]> = {};
  for (const entry of tsconfig.paths) {
    const key = pathPatternKey(entry);
    paths[key] = entry.targets.map((target) => {
      if (!baseUrl) return target;
      const rel = relative(baseUrl, target);
      return rel.split("\\").join("/");
    });
  }
  return {
    ...defaultCompilerOptions(),
    ...(baseUrl ? { baseUrl } : {}),
    ...(Object.keys(paths).length > 0 ? { paths } : {}),
  };
}

function compilerOptionsFromConfig(
  config: SemanticProjectConfig | SemanticProjectTsConfig,
): ts.CompilerOptions {
  if (isSemanticProjectConfig(config)) {
    return {
      ...defaultCompilerOptions(),
      ...config.parsedCommandLine.options,
    };
  }
  return compilerOptionsFromLegacyTsConfig(config);
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  const ext = extname(fileName);
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
    return ts.ScriptKind.JS;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

function createSourceFile(
  fileName: string,
  sourceText: string,
  languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions,
): ts.SourceFile {
  const target =
    typeof languageVersion === "number"
      ? languageVersion
      : ts.ScriptTarget.ES2022;
  return ts.createSourceFile(
    fileName,
    sourceText,
    target,
    true,
    scriptKindForFileName(fileName),
  );
}

function formatConfigDiagnostic(error: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(error.messageText, "\n");
}

function findNearestConfigFile(startDir: string): string | undefined {
  const configNames = [
    "tsconfig.json",
    "tsconfig.app.json",
    "jsconfig.json",
  ] as const;
  for (const configName of configNames) {
    const found = ts.findConfigFile(startDir, ts.sys.fileExists, configName);
    if (found) return found;
  }
  return undefined;
}

export function loadSemanticProjectConfig(
  startDir: string,
): SemanticProjectConfig {
  const resolvedStartDir = resolve(startDir);
  const configFilePath = findNearestConfigFile(resolvedStartDir);
  const configDir = configFilePath ? dirname(configFilePath) : resolvedStartDir;
  if (!configFilePath) {
    return {
      configDir,
      parsedCommandLine: {
        options: defaultCompilerOptions(),
        fileNames: [],
        errors: [],
      },
      projectReferences: [],
      rootNames: [],
    };
  }

  const configFile = ts.readConfigFile(configFilePath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(formatConfigDiagnostic(configFile.error));
  }

  const parsedCommandLine = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    configDir,
    undefined,
    configFilePath,
  );
  if (parsedCommandLine.errors.length > 0) {
    throw new Error(
      parsedCommandLine.errors.map(formatConfigDiagnostic).join("\n"),
    );
  }

  return {
    configFilePath,
    configDir,
    parsedCommandLine,
    projectReferences: parsedCommandLine.projectReferences ?? [],
    rootNames: parsedCommandLine.fileNames,
  };
}

/** Transitional helper for project-surface code that still uses reduced path shapes. */
export function tsConfigResolutionFromSemanticConfig(
  config: SemanticProjectConfig,
): SemanticProjectTsConfig {
  const { baseUrl, paths: pathsOption } = config.parsedCommandLine.options;
  const resolvedBaseUrl = baseUrl
    ? resolve(config.configDir, baseUrl)
    : config.configDir;
  const paths = Object.entries(pathsOption ?? {}).map(([key, targets]) => {
    const star = key.indexOf("*");
    const prefix = star >= 0 ? key.slice(0, star) : key;
    const suffix = star >= 0 ? key.slice(star + 1) : "";
    return {
      prefix,
      suffix,
      targets: (targets as string[]).map((target) =>
        resolve(resolvedBaseUrl, target),
      ),
    };
  });
  return { baseUrl: resolvedBaseUrl, paths };
}

export function createSemanticProject(
  entries: readonly SemanticSourceEntry[],
  config: SemanticProjectConfig | SemanticProjectTsConfig,
): SemanticProject {
  const semanticConfig = isSemanticProjectConfig(config) ? config : undefined;
  const compilerOptions = compilerOptionsFromConfig(config);
  const sourceTextsByPath = new Map<string, string>();
  const sourceFilesByPath = new Map<string, ts.SourceFile>();
  const rootNames: string[] = [];

  for (const entry of entries) {
    const canonical = resolve(entry.path);
    sourceTextsByPath.set(canonical, entry.text);
    rootNames.push(canonical);
    if (canonical.endsWith(".ts")) {
      sourceTextsByPath.set(`${canonical.slice(0, -3)}.js`, entry.text);
    } else if (canonical.endsWith(".tsx")) {
      sourceTextsByPath.set(`${canonical.slice(0, -4)}.js`, entry.text);
    }
  }

  for (const entry of entries) {
    const packageJsonPath = join(dirname(resolve(entry.path)), "package.json");
    if (!sourceTextsByPath.has(packageJsonPath)) {
      sourceTextsByPath.set(
        packageJsonPath,
        JSON.stringify({ type: "module" }, null, 2),
      );
    }
  }

  const lookupInMemoryText = (fileName: string): string | undefined => {
    const canonical = resolve(fileName);
    const direct = sourceTextsByPath.get(canonical);
    if (direct !== undefined) return direct;
    if (canonical.endsWith(".js")) {
      const tsAlternative = `${canonical.slice(0, -3)}.ts`;
      const tsxAlternative = `${canonical.slice(0, -3)}.tsx`;
      return (
        sourceTextsByPath.get(tsAlternative) ??
        sourceTextsByPath.get(tsxAlternative)
      );
    }
    return undefined;
  };

  const inMemoryFileExists = (fileName: string): boolean =>
    lookupInMemoryText(fileName) !== undefined;

  const inMemoryDirectories = new Set<string>();
  for (const path of sourceTextsByPath.keys()) {
    inMemoryDirectories.add(dirname(path));
  }

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const canonicalFileName = (fileName: string): string => {
    const resolvedName = resolve(fileName);
    return defaultHost.getCanonicalFileName
      ? defaultHost.getCanonicalFileName(resolvedName)
      : resolvedName;
  };
  const host: ts.CompilerHost = {
    ...defaultHost,
    directoryExists: (directoryName) => {
      const canonical = resolve(directoryName);
      if (inMemoryDirectories.has(canonical)) return true;
      return defaultHost.directoryExists?.(directoryName) ?? false;
    },
    fileExists: (fileName) => {
      if (inMemoryFileExists(fileName)) return true;
      return defaultHost.fileExists(fileName);
    },
    readFile: (fileName) => {
      const inMemory = lookupInMemoryText(fileName);
      if (inMemory !== undefined) return inMemory;
      return defaultHost.readFile(fileName);
    },
    getSourceFile: (
      fileName,
      languageVersion,
      _onError,
      shouldCreateNewSourceFile,
    ) => {
      const canonical = canonicalFileName(fileName);
      const cached = sourceFilesByPath.get(canonical);
      if (cached && !shouldCreateNewSourceFile) return cached;
      const text =
        lookupInMemoryText(fileName) ?? defaultHost.readFile(canonical);
      if (text === undefined) return undefined;
      const sourceFile = createSourceFile(canonical, text, languageVersion);
      sourceFilesByPath.set(canonical, sourceFile);
      return sourceFile;
    },
    writeFile: () => {},
  };

  const program = ts.createProgram(rootNames, compilerOptions, host);
  const checker = program.getTypeChecker();

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      sourceFilesByPath.set(
        canonicalFileName(sourceFile.fileName),
        sourceFile,
      );
    }
  }

  const sourceFiles: ReadonlyMap<string, ts.SourceFile> = sourceFilesByPath;

  const getSourceFile = (fileName: string): ts.SourceFile | undefined =>
    sourceFiles.get(canonicalFileName(fileName));

  const resolveModuleName = (
    specifier: string,
    containingFile: string,
  ): ResolvedModuleName | undefined => {
    const resolution = ts.resolveModuleName(
      specifier,
      containingFile,
      compilerOptions,
      host,
    );
    const resolved = resolution.resolvedModule;
    if (!resolved) return undefined;
    const fileName = canonicalFileName(resolved.resolvedFileName);
    const sourceFile = program.getSourceFile(fileName);
    const isExternal =
      resolved.isExternalLibraryImport === true ||
      (sourceFile !== undefined && sourceFile.isDeclarationFile);
    return {
      fileName,
      ...(sourceFile && !sourceFile.isDeclarationFile ? { sourceFile } : {}),
      isExternal,
    };
  };

  const symbolAt = (node: ts.Node): ts.Symbol | undefined => {
    if (!node) return undefined;
    try {
      return checker.getSymbolAtLocation(node);
    } catch {
      return undefined;
    }
  };

  const aliasedSymbolAt = (node: ts.Node): ts.Symbol | undefined => {
    const symbol = symbolAt(node);
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        return checker.getAliasedSymbol(symbol);
      } catch {
        return symbol;
      }
    }
    return symbol;
  };

  const symbolKey = (symbol: ts.Symbol): string => {
    const declarations = symbol.getDeclarations();
    if (declarations && declarations.length > 0) {
      const declaration = declarations[0]!;
      const fileName = canonicalFileName(declaration.getSourceFile().fileName);
      return `${fileName}:${declaration.getStart()}:${symbol.getName()}`;
    }
    return checker.getFullyQualifiedName(symbol);
  };

  const localSymbolKey = (node: ts.Node): string | undefined => {
    const symbol = aliasedSymbolAt(node);
    if (!symbol) return undefined;
    return symbolKey(symbol);
  };

  return {
    program,
    checker,
    sourceFiles,
    ...(semanticConfig ? { config: semanticConfig } : {}),
    canonicalFileName,
    getSourceFile,
    resolveModuleName,
    symbolAt,
    aliasedSymbolAt,
    symbolKey,
    localSymbolKey,
    getTypeAtLocation(node: ts.Node): ts.Type | undefined {
      if (!node) return undefined;
      try {
        return checker.getTypeAtLocation(node);
      } catch {
        return undefined;
      }
    },
    getTypeFromTypeNode(node: ts.TypeNode): ts.Type | undefined {
      if (!node) return undefined;
      try {
        return checker.getTypeFromTypeNode(node);
      } catch {
        return undefined;
      }
    },
  };
}

export function createSemanticProjectForTest(
  entries: readonly SemanticSourceEntry[],
  config: SemanticProjectTsConfig = { paths: [] },
): SemanticProject {
  return createSemanticProject(entries, config);
}

export function writeSemanticProjectFixture(
  rootDir: string,
  files: Record<string, string>,
): void {
  for (const [relativePath, text] of Object.entries(files)) {
    const absolutePath = join(rootDir, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, text, "utf8");
  }
}
