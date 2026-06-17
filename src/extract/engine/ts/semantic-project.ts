import { dirname, extname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

/** Structural match for `TsConfigResolution` in cli/features/extract/project.ts */
export interface SemanticProjectTsConfig {
  baseUrl?: string;
  paths: Array<{ prefix: string; suffix: string; targets: string[] }>;
}

export interface SemanticSourceEntry {
  path: string;
  text: string;
}

export interface SemanticProject {
  program: ts.Program;
  checker: ts.TypeChecker;
  sourceFiles: ReadonlyMap<string, ts.SourceFile>;
  getSourceFile(fileName: string): ts.SourceFile | undefined;
  getTypeAtLocation(node: ts.Node): ts.Type | undefined;
  getTypeFromTypeNode(node: ts.TypeNode): ts.Type | undefined;
}

function scriptKindForFileName(fileName: string): ts.ScriptKind {
  const ext = extname(fileName);
  if (ext === ".tsx" || ext === ".jsx") return ts.ScriptKind.TSX;
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs")
    return ts.ScriptKind.JS;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

function pathPatternKey(entry: {
  prefix: string;
  suffix: string;
  targets: string[];
}): string {
  const hasStar = entry.targets.some((target) => target.includes("*"));
  return hasStar ? `${entry.prefix}*${entry.suffix}` : entry.prefix;
}

function compilerOptionsFromTsConfig(
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
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    allowJs: true,
    checkJs: false,
    ...(baseUrl ? { baseUrl } : {}),
    ...(Object.keys(paths).length > 0 ? { paths } : {}),
  };
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

export function createSemanticProject(
  entries: readonly SemanticSourceEntry[],
  tsconfig: SemanticProjectTsConfig,
): SemanticProject {
  const compilerOptions = compilerOptionsFromTsConfig(tsconfig);
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
      onError,
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
  const checker = program.getTypeChecker();

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      sourceFilesByPath.set(resolve(sourceFile.fileName), sourceFile);
    }
  }

  const sourceFiles: ReadonlyMap<string, ts.SourceFile> = sourceFilesByPath;

  return {
    program,
    checker,
    sourceFiles,
    getSourceFile(fileName: string): ts.SourceFile | undefined {
      return sourceFiles.get(resolve(fileName));
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
  };
}

export function createSemanticProjectForTest(
  entries: readonly SemanticSourceEntry[],
  tsconfig: SemanticProjectTsConfig = { paths: [] },
): SemanticProject {
  return createSemanticProject(entries, tsconfig);
}
