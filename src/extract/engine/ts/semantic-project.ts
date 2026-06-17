import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

/** @deprecated Test-only legacy shape; prefer SemanticProjectConfig */
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

export interface ResolvedModule {
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
  ): ResolvedModule | undefined;
  getTypeAtLocation(node: ts.Node): ts.Type | undefined;
  getTypeFromTypeNode(node: ts.TypeNode): ts.Type | undefined;
  symbolAt(node: ts.Node): ts.Symbol | undefined;
  aliasedSymbolAt(node: ts.Node): ts.Symbol | undefined;
  symbolKey(symbol: ts.Symbol): string;
  localSymbolKey(node: ts.Node): string | undefined;
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

function emptyParsedCommandLine(): ts.ParsedCommandLine {
  return {
    options: defaultCompilerOptions(),
    fileNames: [],
    errors: [],
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
    return { ...defaultCompilerOptions(), ...config.parsedCommandLine.options };
  }
  return compilerOptionsFromLegacyTsConfig(config);
}

const configHost: ts.ParseConfigHost = {
  fileExists: existsSync,
  readDirectory: ts.sys.readDirectory,
  readFile: (fileName) => readFileSync(fileName, "utf8"),
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
};

export function loadSemanticProjectConfig(
  startDir: string,
): SemanticProjectConfig {
  const resolvedStart = resolve(startDir);
  const configFilePath = ts.findConfigFile(
    resolvedStart,
    existsSync,
    "tsconfig.json",
  );
  if (!configFilePath) {
    return {
      configDir: resolvedStart,
      parsedCommandLine: emptyParsedCommandLine(),
      projectReferences: [],
      rootNames: [],
    };
  }
  const readResult = ts.readConfigFile(configFilePath, (fileName) =>
    readFileSync(fileName, "utf8"),
  );
  if (readResult.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(readResult.error.messageText, "\n"),
    );
  }
  const configDir = dirname(configFilePath);
  const parsedCommandLine = ts.parseJsonConfigFileContent(
    readResult.config,
    configHost,
    configDir,
    undefined,
    configFilePath,
  );
  const ignorableDiagnosticCodes = new Set([18003]);
  const fatalErrors = parsedCommandLine.errors.filter(
    (error) => !ignorableDiagnosticCodes.has(error.code),
  );
  if (fatalErrors.length > 0) {
    const message = fatalErrors
      .map((error) =>
        ts.flattenDiagnosticMessageText(error.messageText, "\n"),
      )
      .join("\n");
    throw new Error(message);
  }
  return {
    configFilePath,
    configDir,
    parsedCommandLine,
    projectReferences: parsedCommandLine.projectReferences ?? [],
    rootNames: parsedCommandLine.fileNames,
  };
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  const ext = extname(fileName);
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
    return ts.ScriptKind.JS;
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

function uniqueRootNames(paths: readonly string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function buildSemanticProject(
  program: ts.Program,
  sourceFilesByPath: Map<string, ts.SourceFile>,
  moduleResolutionHost: ts.ModuleResolutionHost & {
    getCanonicalFileName?(fileName: string): string;
  },
  config?: SemanticProjectConfig,
): SemanticProject {
  const checker = program.getTypeChecker();

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      sourceFilesByPath.set(resolve(sourceFile.fileName), sourceFile);
    }
  }

  const sourceFiles: ReadonlyMap<string, ts.SourceFile> = sourceFilesByPath;

  const canonicalFileName = (fileName: string): string => resolve(fileName);

  return {
    program,
    checker,
    sourceFiles,
    ...(config ? { config } : {}),
    canonicalFileName,
    getSourceFile(fileName: string): ts.SourceFile | undefined {
      return sourceFiles.get(resolve(fileName));
    },
    resolveModuleName(
      specifier: string,
      containingFile: string,
    ): ResolvedModule | undefined {
      const resolved = ts.resolveModuleName(
        specifier,
        containingFile,
        program.getCompilerOptions(),
        moduleResolutionHost,
      );
      const resolvedModule = resolved.resolvedModule;
      if (!resolvedModule) return undefined;
      const fileName = canonicalFileName(resolvedModule.resolvedFileName);
      return {
        fileName,
        sourceFile: program.getSourceFile(fileName) ?? sourceFiles.get(fileName),
        isExternal: resolvedModule.isExternalLibraryImport === true,
      };
    },
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
    symbolAt(node: ts.Node): ts.Symbol | undefined {
      if (!node) return undefined;
      try {
        return checker.getSymbolAtLocation(node) ?? undefined;
      } catch {
        return undefined;
      }
    },
    aliasedSymbolAt(node: ts.Node): ts.Symbol | undefined {
      const symbol = this.symbolAt(node);
      if (!symbol) return undefined;
      try {
        if (symbol.flags & ts.SymbolFlags.Alias) {
          return checker.getAliasedSymbol(symbol);
        }
        return symbol;
      } catch {
        return undefined;
      }
    },
    symbolKey(symbol: ts.Symbol): string {
      const declarations = symbol.getDeclarations();
      if (declarations && declarations.length > 0) {
        const declaration = declarations[0]!;
        const sourceFile = declaration.getSourceFile();
        const name = symbol.getName();
        return `${canonicalFileName(sourceFile.fileName)}:${declaration.getStart()}:${name}`;
      }
      return checker.getFullyQualifiedName(symbol);
    },
    localSymbolKey(node: ts.Node): string | undefined {
      const symbol = this.symbolAt(node);
      if (!symbol) return undefined;
      const declarations = symbol.getDeclarations();
      if (!declarations || declarations.length === 0)
        return this.symbolKey(symbol);
      const declaration = declarations[0]!;
      const sourceFile = declaration.getSourceFile();
      return `${canonicalFileName(sourceFile.fileName)}:${declaration.getStart()}:${symbol.getName()}`;
    },
  };
}

export function createSemanticProjectFromConfig(
  config: SemanticProjectConfig,
  additionalRootNames: readonly string[] = [],
): SemanticProject {
  const compilerOptions = compilerOptionsFromConfig(config);
  const rootNames = uniqueRootNames([
    ...additionalRootNames,
    ...config.parsedCommandLine.fileNames,
  ]);
  const host = ts.createCompilerHost(compilerOptions, true);
  const program = ts.createProgram({
    rootNames,
    options: compilerOptions,
    host,
    projectReferences: [...config.projectReferences],
  });
  return buildSemanticProject(program, new Map(), host, config);
}

export function createSemanticProject(
  entries: readonly SemanticSourceEntry[],
  config: SemanticProjectConfig | SemanticProjectTsConfig,
): SemanticProject {
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
      const canonical = resolve(fileName);
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
  const semanticConfig = isSemanticProjectConfig(config) ? config : undefined;
  return buildSemanticProject(program, sourceFilesByPath, host, semanticConfig);
}

export function createSemanticProjectForTest(
  entries: readonly SemanticSourceEntry[],
  config: SemanticProjectConfig | SemanticProjectTsConfig = { paths: [] },
): SemanticProject {
  return createSemanticProject(entries, config);
}
