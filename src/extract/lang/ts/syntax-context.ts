import * as ts from "typescript";
import type { SymbolPortContext } from "./symbol-port.js";

export function syntaxOnlyTypeContext(
  source: ts.SourceFile,
): SymbolPortContext {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowJs: true,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const originalRead = host.readFile.bind(host);
  host.readFile = (fileName) =>
    fileName === source.fileName ? source.text : originalRead(fileName);
  const program = ts.createProgram([source.fileName], compilerOptions, host);
  return {
    program,
    checker: program.getTypeChecker(),
    sourceFile: source,
    getSourceFile: (fileName) =>
      fileName === source.fileName
        ? source
        : (program.getSourceFile(fileName) ?? undefined),
  };
}
