import * as ts from "typescript";
import type { SymbolPortContext } from "./symbol-port.js";

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
};

// Parsing the default `lib.*.d.ts` files dominates the cost of building a
// program. Those files are content-stable per path, so cache their parsed
// `SourceFile`s once and share them across every program we create. The entry
// source is intentionally excluded (its `fileName` is not globally unique).
const sharedLibSourceFiles = new Map<string, ts.SourceFile>();

// `syntaxOnlyTypeContext` is called once per statement-list compilation, and
// `compileStatementList` recurses over the same `source`. Memoize by source
// instance (source files are immutable) so a single extraction builds at most
// one program per file instead of one per nested statement list.
const contextCache = new WeakMap<ts.SourceFile, SymbolPortContext>();

export function syntaxOnlyTypeContext(
  source: ts.SourceFile,
): SymbolPortContext {
  const cached = contextCache.get(source);
  if (cached) return cached;

  const host = ts.createCompilerHost(compilerOptions);
  const originalRead = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.readFile = (fileName) =>
    fileName === source.fileName ? source.text : originalRead(fileName);
  host.getSourceFile = (fileName, languageVersionOrOptions, ...rest) => {
    if (fileName === source.fileName) return source;
    const sharedLib = sharedLibSourceFiles.get(fileName);
    if (sharedLib) return sharedLib;
    const parsed = originalGetSourceFile(
      fileName,
      languageVersionOrOptions,
      ...rest,
    );
    if (parsed) sharedLibSourceFiles.set(fileName, parsed);
    return parsed;
  };

  const program = ts.createProgram([source.fileName], compilerOptions, host);
  const context: SymbolPortContext = {
    program,
    checker: program.getTypeChecker(),
    sourceFile: source,
    getSourceFile: (fileName) =>
      fileName === source.fileName
        ? source
        : (program.getSourceFile(fileName) ?? undefined),
  };
  contextCache.set(source, context);
  return context;
}
